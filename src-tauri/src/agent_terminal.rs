//! Interactive, user-launched agent sessions. Authentication stays inside each CLI.
use crate::{
    ai_cli::{augmented_path, resolve_binary},
    terminal_process::{self, TerminalProcess},
};
use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Arc, Mutex},
};
use tauri::{ipc::Channel, Manager};

pub(crate) const WORKSPACE_INSTRUCTIONS: &str = "# Logia agent workspace\n\nUse the live Logia CLI for notes. Run `logia-cli help`, or `node \"$LOGIA_CLI_SCRIPT\" help` if the wrapper is not on PATH (PowerShell: `node $env:LOGIA_CLI_SCRIPT help`). LOGIA_CLI_SOCKET targets the parent GUI. Commands include status, active, files, search, read, create, append, prepend, write, rename, open, save, and daily:append. The GUI must be running.\n\nRead a note to get its revision; full replacement requires ifRevision. CLI writes go through the GUI and its save queue. Do not rewrite Logia note JSON directly. After a timeout, read before retrying a write. note-context.md, if attached, is a static snapshot; editing that file does not update the live note.\n";

pub(crate) fn cli_script(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let mut script = app.path().resolve("cli/logia-cli.mjs", tauri::path::BaseDirectory::Resource).ok().filter(|path| path.is_file());
    #[cfg(debug_assertions)] if script.is_none() {
        script = Some(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/logia-cli.mjs"));
    }
    script
}

#[derive(Default)]
pub struct AgentTerminalState(pub Arc<Mutex<HashMap<String, Arc<TerminalProcess>>>>);
impl AgentTerminalState {
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.0.lock() {
            for (_, process) in sessions.drain() {
                process.close();
            }
        }
    }
}
#[derive(Deserialize)]
pub struct NoteContext {
    title: String,
    markdown: String,
}
#[derive(Deserialize)]
pub struct StartOptions {
    tool: String,
    binary: Option<String>,
    model: Option<String>,
    cols: u16,
    rows: u16,
    #[serde(default)]
    login: bool,
    context: Option<NoteContext>,
}
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AgentTerminalEvent {
    Data { data: Vec<u8> },
    Exit { code: u32 },
    Error { message: String },
}
#[derive(Serialize)]
pub struct SessionInfo {
    id: String,
    cwd: String,
}

#[tauri::command]
pub async fn agent_terminal_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentTerminalState>,
    options: StartOptions,
    on_event: Channel<AgentTerminalEvent>,
) -> Result<SessionInfo, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-sessions");
    let sessions = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (default_binary, _) = terminal_process::launch_spec(&options.tool, options.login)?;
        let args = terminal_process::launch_args(&options.tool, options.login, options.model.as_deref())?;
        terminal_process::pty_size(options.cols, options.rows)?;
        if options.context.as_ref().is_some_and(|c| c.markdown.len() > 1024 * 1024 || c.title.len() > 4096) {
            return Err("Note context exceeds the 1 MiB limit".into());
        }
        let path = augmented_path();
        let binary = options.binary.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(default_binary);
        let executable = resolve_binary(binary, &path).ok_or_else(|| format!("{default_binary} was not found. Install it or set its binary path in Settings → AI."))?;
        // Lock through spawn to enforce the limit even for concurrent start requests.
        let mut running = sessions.lock().map_err(|_| "Agent sessions unavailable")?;
        if running.len() >= 4 { return Err("Close an agent session before opening another (maximum 4).".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        let cwd = root.join(&id);
        std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cwd, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        }
        if let Some(context) = options.context {
            // Fixed filename, no user-supplied paths; this is a copy, never a live note.
            std::fs::write(cwd.join("note-context.md"), format!("<!-- Logia note snapshot: {} -->\n\n{}", context.title.replace("--", "—").replace(['\n', '\r'], " "), context.markdown)).map_err(|e| e.to_string())?;
        }
        let executable = std::fs::canonicalize(executable).map_err(|e| format!("Cannot resolve agent executable: {e}"))?;
        std::fs::write(cwd.join("AGENTS.md"), WORKSPACE_INSTRUCTIONS).map_err(|error| error.to_string())?;
        let mut command = CommandBuilder::new(executable);
        if let Some(script) = cli_script(&app) { command.env("LOGIA_CLI_SCRIPT", script); }
        command.args(args);
        command.cwd(&cwd);
        command.env("PATH", path);
        command.env("TERM", "xterm-256color");
        command.env("LOGIA_CLI_SOCKET", crate::cli_transport::endpoint());
        command.env("COLORTERM", "truecolor");
        command.env_remove("NO_COLOR");
        let started = match terminal_process::spawn(command, options.cols, options.rows) {
            Ok(started) => started,
            Err(error) => { let _ = std::fs::remove_dir_all(&cwd); return Err(error); }
        };
        let process = Arc::new(started.process);
        running.insert(id.clone(), process.clone());
        drop(running);
        let thread_id = id.clone();
        let mut reader = started.reader;
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        if on_event.send(AgentTerminalEvent::Data { data: buffer[..n].to_vec() }).is_err() {
                            process.close();
                            break;
                        }
                    }
                    // EIO is normal on Unix after the slave closes.
                    Err(e) if e.raw_os_error() == Some(5) => break,
                    Err(e) => { let _ = on_event.send(AgentTerminalEvent::Error { message: e.to_string() }); process.close(); break; }
                }
            }
            let code = loop {
                match process.try_wait() {
                    Ok(Some(code)) => break code,
                    Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
                    Err(_) => { process.close(); break 1; }
                }
            };
            if let Ok(mut running) = sessions.lock() { running.remove(&thread_id); }
            let _ = on_event.send(AgentTerminalEvent::Exit { code });
        });
        Ok(SessionInfo { id, cwd: cwd.display().to_string() })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_terminal_write(
    state: tauri::State<'_, AgentTerminalState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let process = sessions
            .lock()
            .map_err(|_| "Agent sessions unavailable")?
            .get(&id)
            .cloned()
            .ok_or("Agent session has ended")?;
        process.write(&data)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn agent_terminal_resize(
    state: tauri::State<'_, AgentTerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "Agent sessions unavailable")?
        .get(&id)
        .ok_or("Agent session has ended")?
        .resize(cols, rows)
}
#[tauri::command]
pub fn agent_terminal_close(
    state: tauri::State<'_, AgentTerminalState>,
    id: String,
) -> Result<(), String> {
    let process = state
        .0
        .lock()
        .map_err(|_| "Agent sessions unavailable")?
        .remove(&id);
    if let Some(process) = process {
        process.close();
    }
    Ok(())
}
