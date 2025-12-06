use chrono;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;
use uuid::Uuid;

mod audio;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    id: String,
    name: String,
    #[serde(default)]
    parent_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KanbanTask {
    id: String,
    name: String,
    column: String,
    created_at: String,
    updated_at: String,
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
    #[serde(default)]
    folder_id: Option<String>,
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

fn get_folders_directory(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents_dir = app_handle
        .path()
        .resolve("Kortex/folders", BaseDirectory::Document)
        .map_err(|_| "Could not find document directory")?;

    if !documents_dir.exists() {
        fs::create_dir_all(&documents_dir)
            .map_err(|e| format!("Failed to create folders directory:{}", e))?;
    }

    Ok(documents_dir)
}

fn get_kanban_directory(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let documents_dir = app_handle
        .path()
        .resolve("Kortex/kanban", BaseDirectory::Document)
        .map_err(|_| "Could not find document directory")?;

    if !documents_dir.exists() {
        fs::create_dir_all(&documents_dir)
            .map_err(|e| format!("Failed to create kanban directory:{}", e))?;
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
    folder_id: Option<String>,
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
        folder_id,
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

#[tauri::command]
async fn create_folder(
    name: String,
    parent_id: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<Folder, String> {
    let folders_dir = get_folders_directory(&app_handle)?;
    let folder_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let folder = Folder {
        id: folder_id.clone(),
        name,
        parent_id,
        created_at: now.clone(),
        updated_at: now,
    };

    let file_path = folders_dir.join(format!("{}.json", folder_id));
    let folder_json = serde_json::to_string_pretty(&folder)
        .map_err(|e| format!("Failed to serialize folder: {}", e))?;

    fs::write(&file_path, folder_json)
        .map_err(|e| format!("Failed to write folder file: {}", e))?;

    Ok(folder)
}

#[tauri::command]
async fn get_all_folders(app_handle: tauri::AppHandle) -> Result<Vec<Folder>, String> {
    let folders_dir = get_folders_directory(&app_handle)?;
    let mut folders = Vec::new();

    if let Ok(entries) = fs::read_dir(&folders_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(folder) = serde_json::from_str::<Folder>(&content) {
                            folders.push(folder);
                        }
                    }
                }
            }
        }
    }

    // Sort by created_at
    folders.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(folders)
}

#[tauri::command]
async fn update_folder(folder: Folder, app_handle: tauri::AppHandle) -> Result<(), String> {
    let folders_dir = get_folders_directory(&app_handle)?;
    let file_path = folders_dir.join(format!("{}.json", folder.id));

    let mut updated_folder = folder;
    updated_folder.updated_at = chrono::Utc::now().to_rfc3339();

    let folder_json = serde_json::to_string_pretty(&updated_folder)
        .map_err(|e| format!("Failed to serialize folder: {}", e))?;

    fs::write(&file_path, folder_json)
        .map_err(|e| format!("Failed to write folder file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn delete_folder(folder_id: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let folders_dir = get_folders_directory(&app_handle)?;
    let file_path = folders_dir.join(format!("{}.json", folder_id));
    fs::remove_file(&file_path).map_err(|e| format!("Failed to delete folder file: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_kanban_data(app_handle: tauri::AppHandle) -> Result<Vec<KanbanTask>, String> {
    let kanban_dir = get_kanban_directory(&app_handle)?;
    let file_path = kanban_dir.join("data.json");

    if file_path.exists() {
        let content = fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read kanban data: {}", e))?;
        let tasks: Vec<KanbanTask> = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse kanban data: {}", e))?;
        Ok(tasks)
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
async fn save_kanban_data(tasks: Vec<KanbanTask>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let kanban_dir = get_kanban_directory(&app_handle)?;
    let file_path = kanban_dir.join("data.json");

    let data_json = serde_json::to_string_pretty(&tasks)
        .map_err(|e| format!("Failed to serialize kanban data: {}", e))?;

    fs::write(&file_path, data_json).map_err(|e| format!("Failed to write kanban data: {}", e))?;

    Ok(())
}

#[tauri::command]
fn get_google_api_key() -> Result<String, String> {
    std::env::var("GOOGLE_GENERATIVE_AI_API_KEY")
        .map_err(|_| "GOOGLE_GENERATIVE_AI_API_KEY environment variable not set".to_string())
}

#[tauri::command]
async fn start_recording(app_handle: tauri::AppHandle) -> Result<(), String> {
    audio::os_capture::start_capture(&app_handle)
}

#[tauri::command]
async fn stop_recording() -> Result<String, String> {
    audio::os_capture::stop_capture()
}

#[tauri::command]
async fn transcribe_audio(audio_path: String) -> Result<String, String> {
    let result = audio::transcription::transcribe_audio(&audio_path)?;
    serde_json::to_string(&result).map_err(|e| format!("Serialization error: {}", e))
}



#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_notes_path,
            create_note,
            get_all_notes,
            save_note,
            delete_note,
            create_folder,
            get_all_folders,
            update_folder,
            delete_folder,
            get_kanban_data,
            save_kanban_data,
            get_google_api_key,
            greet,
            start_recording,
            stop_recording,
            transcribe_audio
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
