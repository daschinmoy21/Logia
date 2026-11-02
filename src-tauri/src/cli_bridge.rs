use crate::cli_transport::{self, Handler};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager};
use tokio::sync::{oneshot, Notify};

#[derive(Default)]
pub struct CliBridgeState {
    ready: AtomicBool,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    stop: Arc<Notify>,
    error: Mutex<Option<String>>,
}
impl CliBridgeState {
    pub fn shutdown(&self) {
        self.ready.store(false, Ordering::SeqCst);
        self.stop.notify_one();
        self.pending.lock().unwrap().clear();
    }
}
#[derive(Serialize, Clone)]
struct FrontendRequest {
    id: String,
    command: String,
    params: serde_json::Map<String, Value>,
    deadline: u64,
}

pub fn start(app: tauri::AppHandle) {
    let endpoint = cli_transport::endpoint();
    let callback_app = app.clone();
    let callback: Handler = Arc::new(move |request| {
        let app = callback_app.clone();
        Box::pin(async move {
            let state = app.state::<CliBridgeState>();
            if !state.ready.load(Ordering::SeqCst) {
                return cli_transport::error(
                    "GUI_NOT_READY",
                    "The Logia GUI is still loading or reloading.",
                );
            }
            let id = uuid::Uuid::new_v4().to_string();
            let (tx, rx) = oneshot::channel();
            state.pending.lock().unwrap().insert(id.clone(), tx);
            let deadline = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64
                + 29_000;
            let payload = FrontendRequest {
                id: id.clone(),
                command: request.command,
                params: request.params,
                deadline,
            };
            let response = if app.emit_to("main", "logia-cli-request", payload).is_err() {
                cli_transport::error("GUI_NOT_READY", "Main window is unavailable")
            } else {
                match tokio::time::timeout(std::time::Duration::from_secs(29), rx).await {
                    Ok(Ok(value)) => value,
                    _ => cli_transport::error(
                        "TIMEOUT",
                        "GUI did not reply. An edit may have applied; read before retrying.",
                    ),
                }
            };
            state.pending.lock().unwrap().remove(&id);
            response
        })
    });
    tauri::async_runtime::spawn(async move {
        let stop = app.state::<CliBridgeState>().stop.clone();
        if let Err(error) = cli_transport::serve(endpoint, callback, stop).await {
            *app.state::<CliBridgeState>().error.lock().unwrap() = Some(error);
        }
    });
}

#[tauri::command]
pub fn cli_bridge_ready(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CliBridgeState>,
    ready: bool,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("CLI bridge belongs to the main window".into());
    }
    if let Some(error) = state.error.lock().unwrap().as_ref() {
        return Err(error.clone());
    }
    state.ready.store(ready, Ordering::SeqCst);
    Ok(json!({"endpoint":cli_transport::endpoint().display().to_string()}))
}
#[tauri::command]
pub fn cli_bridge_reply(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, CliBridgeState>,
    id: String,
    response: Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("CLI bridge belongs to the main window".into());
    }
    if response.get("schemaVersion") != Some(&json!(1)) {
        return Err("Invalid CLI response".into());
    }
    if let Some(sender) = state.pending.lock().unwrap().remove(&id) {
        let _ = sender.send(response);
    }
    Ok(())
}
