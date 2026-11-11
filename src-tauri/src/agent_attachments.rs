//! Images attached to agent chats: pasted ones are saved to disk so the agent
//! can read them by path, and chosen ones are read back for composer previews.
//! Bytes travel as raw IPC bodies, not JSON arrays, so large screenshots stay fast.

use std::path::Path;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

/// Previews and pastes larger than this are refused.
const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Saves a pasted image under the app data dir and returns its absolute path.
/// The body is the image bytes; the `x-extension` header names its type.
#[tauri::command]
pub async fn save_agent_attachment(request: Request<'_>, app_handle: tauri::AppHandle) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw image bytes".into());
    };
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image is empty or larger than 25 MB".into());
    }
    let extension = request
        .headers()
        .get("x-extension")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| IMAGE_EXTENSIONS.contains(&value.as_str()))
        .unwrap_or_else(|| "png".into());

    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = format!(
        "pasted-{}-{}.{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        &uuid::Uuid::new_v4().simple().to_string()[..6],
        extension
    );
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Reads an image file for a thumbnail. Only image extensions are served.
#[tauri::command]
pub async fn read_attachment_preview(path: String) -> Result<Response, String> {
    let path = Path::new(&path);
    if !is_image(path) {
        return Err("Not an image".into());
    }
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size as usize > MAX_IMAGE_BYTES {
        return Err("Image is larger than 25 MB".into());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}
