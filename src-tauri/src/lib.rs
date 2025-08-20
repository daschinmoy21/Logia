use chrono;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;
use uuid::Uuid;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    id: String,
    title: String,
    content: String,
    created_at: String,
    updated_at: String,
    #[serde(default = "default_note_type")]
    note_type: String,
}

fn default_note_type() -> String {
    "text".to_string()
}

fn get_notes_directory(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents_dir = app_handle
        .path()
        .resolve("Kortex/notes", BaseDirectory::Document)
        .map_err(|_| "Could not find document directory")?;

    if !documents_dir.exists() {
        fs::create_dir_all(&documents_dir)
            .map_err(|e| format!("Failed to create notes directory:{}", e))?;
    }

    Ok(documents_dir)
}

#[tauri::command]
async fn get_notes_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let notes_dir = get_notes_directory(&app_handle)?;
    Ok(notes_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn create_note(
    title: String,
    note_type: String,
    app_handle: tauri::AppHandle,
) -> Result<Note, String> {
    let notes_dir = get_notes_directory(&app_handle)?;
    let note_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let note = Note {
        id: note_id.clone(),
        title: title.clone(),
        content: String::new(),
        created_at: now.clone(),
        updated_at: now,
        note_type,
    };

    let file_path = notes_dir.join(format!("{}.json", note_id));
    let note_json = serde_json::to_string_pretty(&note)
        .map_err(|e| format!("Failed to serialize note: {}", e))?;

    fs::write(&file_path, note_json).map_err(|e| format!("Failed to write note file: {}", e))?;

    Ok(note)
}

#[tauri::command]
async fn get_all_notes(app_handle: tauri::AppHandle) -> Result<Vec<Note>, String> {
    let notes_dir = get_notes_directory(&app_handle)?;
    let mut notes = Vec::new();

    if let Ok(entries) = fs::read_dir(&notes_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(note) = serde_json::from_str::<Note>(&content) {
                            notes.push(note);
                        }
                    }
                }
            }
        }
    }

    // Sort by updated_at descending
    notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(notes)
}

#[tauri::command]
async fn save_note(note: Note, app_handle: tauri::AppHandle) -> Result<(), String> {
    let notes_dir = get_notes_directory(&app_handle)?;
    let file_path = notes_dir.join(format!("{}.json", note.id));

    let mut updated_note = note;
    updated_note.updated_at = chrono::Utc::now().to_rfc3339();

    let note_json = serde_json::to_string_pretty(&updated_note)
        .map_err(|e| format!("Failed to serialize note: {}", e))?;

    fs::write(&file_path, note_json).map_err(|e| format!("Failed to write note file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn delete_note(note_id: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let notes_dir = get_notes_directory(&app_handle)?;
    let file_path = notes_dir.join(format!("{}.json", note_id));
    fs::remove_file(&file_path).map_err(|e| format!("Failed to delete note file: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_notes_path,
            create_note,
            get_all_notes,
            save_note,
            delete_note,
            greet
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
