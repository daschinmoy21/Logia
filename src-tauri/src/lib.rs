use chrono;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::Manager;
use uuid::Uuid;
use keyring::Entry;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use base64::{Engine as _, engine::general_purpose};

mod audio;

// Encryption key derived from app name (in production, this should be more secure)
fn get_encryption_key() -> &'static [u8; 32] {
    b"kortex-app-encryption-key-32byte"
}

fn encrypt_api_key(key: &str) -> Result<String, String> {
    let cipher_key = Key::<Aes256Gcm>::from_slice(get_encryption_key());
    let cipher = Aes256Gcm::new(cipher_key);
    let nonce = Nonce::from_slice(b"unique nonce"); // In production, use random nonce

    let ciphertext = cipher.encrypt(nonce, key.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    Ok(general_purpose::STANDARD.encode(ciphertext))
}

fn decrypt_api_key(encrypted: &str) -> Result<String, String> {
    let cipher_key = Key::<Aes256Gcm>::from_slice(get_encryption_key());
    let cipher = Aes256Gcm::new(cipher_key);
    let nonce = Nonce::from_slice(b"unique nonce");

    let ciphertext = general_purpose::STANDARD.decode(encrypted)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| format!("Decryption failed: {}", e))?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 decode failed: {}", e))
}

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

fn get_config_directory(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app_handle
        .path()
        .resolve("Kortex", BaseDirectory::AppConfig)
        .map_err(|_| "Could not find config directory")?;

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory:{}", e))?;
    }

    Ok(config_dir)
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
async fn get_google_api_key(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Try to get from keyring first
    if let Ok(entry) = Entry::new("kortex-app", "google_api_key") {
        if let Ok(password) = entry.get_password() {
            return Ok(password);
        }
    }

    // Fallback: Check config.json for encrypted key
    let config_dir = get_config_directory(&app_handle)?;
    let config_file = config_dir.join("config.json");

    if config_file.exists() {
        let content = fs::read_to_string(&config_file)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))?;

        // Check for encrypted key
        if let Some(encrypted_key) = config.get("encrypted_google_api_key")
            .and_then(|v| v.as_str())
        {
            let key = decrypt_api_key(encrypted_key)?;
            return Ok(key);
        }

        // Legacy: Check for plain key and migrate
        if let Some(plain_key) = config.get("google_api_key")
            .and_then(|v| v.as_str())
        {
            // Migrate to keyring if possible
            if let Ok(entry) = Entry::new("kortex-app", "google_api_key") {
                let _ = entry.set_password(plain_key);
            }

            // Remove plain key
            let mut updated_config = config.clone();
            if let Some(obj) = updated_config.as_object_mut() {
                obj.remove("google_api_key");
            }
            let content = serde_json::to_string_pretty(&updated_config).unwrap_or_default();
            let _ = fs::write(&config_file, content);

            return Ok(plain_key.to_string());
        }
    }

    Err("API key not configured".to_string())
}

#[tauri::command]
async fn save_google_api_key(key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    // Try to save to keyring first
    let keyring_success = if let Ok(entry) = Entry::new("kortex-app", "google_api_key") {
        entry.set_password(&key).is_ok()
    } else {
        false
    };

    // If keyring failed, fall back to encrypted config.json
    if !keyring_success {
        let encrypted_key = encrypt_api_key(&key)?;

        let config_dir = get_config_directory(&app_handle)?;
        let config_file = config_dir.join("config.json");

        let mut config = if config_file.exists() {
            if let Ok(content) = fs::read_to_string(&config_file) {
                serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            }
        } else {
            serde_json::json!({})
        };

        if let Some(obj) = config.as_object_mut() {
            obj.insert("encrypted_google_api_key".to_string(), serde_json::Value::String(encrypted_key));
            // Remove any plain key
            obj.remove("google_api_key");
        }

        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&config_file, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
    } else {
        // Keyring succeeded, ensure it's not in config.json anymore (cleanup)
        let config_dir = get_config_directory(&app_handle)?;
        let config_file = config_dir.join("config.json");

        if config_file.exists() {
            if let Ok(content) = fs::read_to_string(&config_file) {
                if let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&content) {
                     if let Some(obj) = config.as_object_mut() {
                        if obj.remove("google_api_key").is_some() {
                            let content = serde_json::to_string_pretty(&config).unwrap_or_default();
                            let _ = fs::write(&config_file, content);
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn remove_google_api_key(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Remove from keyring
    if let Ok(entry) = Entry::new("kortex-app", "google_api_key") {
        let _ = entry.delete_credential();
    }

    // Also remove from config.json
    let config_dir = get_config_directory(&app_handle)?;
    let config_file = config_dir.join("config.json");

    if config_file.exists() {
        let content = fs::read_to_string(&config_file)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        let mut config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))?;

        if let Some(obj) = config.as_object_mut() {
            obj.remove("google_api_key");
            obj.remove("encrypted_google_api_key");
        }

        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&config_file, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
async fn start_recording(app_handle: tauri::AppHandle) -> Result<(), String> {
    audio::os_capture::start_capture(&app_handle)
}

#[tauri::command]
async fn stop_recording() -> Result<String, String> {
    audio::os_capture::stop_capture()
}

// New helper function for dependency management
async fn ensure_transcription_dependencies(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    use std::process::Command;
    use std::path::PathBuf;
    use tauri::path::BaseDirectory;

    let requirements_path = app_handle.path().resolve("src/audio/transcription/requirements.txt", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve requirements.txt resource: {}", e))?;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    let venv_path = app_data_dir.join("transcription_venv");

    let uv_available = Command::new("uv")
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    // Python version check and venv recreation logic
    if venv_path.exists() {
        let python_bin = if cfg!(windows) {
            venv_path.join("Scripts").join("python")
        } else {
            venv_path.join("bin").join("python")
        };
        
        if python_bin.exists() {
            let version_output = Command::new(&python_bin)
                .arg("--version")
                .output()
                .ok();
            
            if let Some(output) = version_output {
                let version_str = String::from_utf8_lossy(&output.stdout);
                let version_str_err = String::from_utf8_lossy(&output.stderr);
                
                if version_str.contains("3.14") || version_str_err.contains("3.14") {
                    println!("Detected Python 3.14 in venv, which is likely incompatible. Recreating venv with 3.12...");
                    let _ = std::fs::remove_dir_all(&venv_path);
                }
            }
        }
    }

    // Create virtual environment if it doesn't exist
    if !venv_path.exists() {
        println!("Creating virtual environment...");

        if uv_available {
            let status = Command::new("uv")
                .arg("venv")
                .arg(&venv_path)
                .arg("--python")
                .arg("3.12")
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            
            if status {
                println!("Created venv with uv (Python 3.12)");
            } else {
                return Err("Failed to create venv with uv".to_string());
            }
        } else if Command::new("python3")
            .args(&["-m", "venv", &venv_path.to_string_lossy()])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
        {
            println!("Created venv with python3");
        } else {
            return Err("Failed to create virtual environment".to_string());
        }
    }

    // Check if faster_whisper is already installed
    let python_path = if cfg!(windows) {
        venv_path.join("Scripts").join("python")
    } else {
        venv_path.join("bin").join("python")
    };

    if !python_path.exists() {
        return Err("Python executable not found in venv after creation".to_string());
    }

    let check_import_status = Command::new(&python_path)
        .args(&["-c", "import faster_whisper"])
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .status();

    if let Ok(status) = check_import_status {
        if status.success() {
            println!("faster_whisper already installed in venv.");
            return Ok(venv_path); // Dependencies already installed, return venv_path
        }
    }

    // Install dependencies if not already installed
    println!("Installing transcription dependencies...");
    
    let mut install_success = false;

    if uv_available {
        println!("Using uv to install dependencies...");
        let status_result = Command::new("uv")
            .args(&["pip", "install", "-r", &requirements_path.to_string_lossy(), "--python", &venv_path.to_string_lossy()])
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .status();

        match status_result {
            Ok(status) if status.success() => {
                println!("Successfully installed dependencies with uv");
                install_success = true;
            },
            Ok(status) => {
                println!("uv install failed with exit code: {:?}", status.code());
            },
            Err(e) => {
                println!("Failed to execute uv: {}", e);
            }
        }
    }

    if !install_success {
        // Fallback to pip inside venv
        let pip_path = if cfg!(windows) {
            venv_path.join("Scripts").join("pip")
        } else {
            venv_path.join("bin").join("pip")
        };

        if pip_path.exists() {
            let status_result = Command::new(&pip_path)
                .args(&["install", "-r", &requirements_path.to_string_lossy()])
                .env_remove("PYTHONHOME")
                .env_remove("PYTHONPATH")
                .status();

            match status_result {
                Ok(status) if status.success() => {
                    println!("Successfully installed dependencies in venv with pip");
                    install_success = true;
                }
                Ok(status) => {
                    println!("pip install failed with exit code: {:?}", status.code());
                }
                Err(e) => {
                    println!("Failed to run pip: {}", e);
                }
            }
        } else {
            println!("pip binary not found at {:?} and uv install failed/skipped.", pip_path);
        }
    }

    if install_success {
        Ok(venv_path)
    } else {
        Err("Failed to install transcription dependencies.".to_string())
    }
}

#[tauri::command]
async fn transcribe_audio(audio_path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::process::Command;
    use tauri::path::BaseDirectory;

    let venv_path = ensure_transcription_dependencies(&app_handle).await?;

    let script_path = app_handle.path().resolve("src/audio/transcription/transcribe.py", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve transcribe.py resource: {}", e))?;
    
    let python_path = if cfg!(windows) {
        venv_path.join("Scripts").join("python")
    } else {
        venv_path.join("bin").join("python")
    };

    if !python_path.exists() {
        return Err("Python executable not found in venv".to_string());
    }

    let child = Command::new(&python_path)
        .arg(&script_path)
        .arg(&audio_path)
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn transcription script: {}", e))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for transcription script: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8(output.stdout)
            .map_err(|e| format!("Invalid output encoding: {}", e))?;

        // Try to parse as JSON
        if let Ok(result) = serde_json::from_str::<serde_json::Value>(&stdout) {
            return serde_json::to_string(&result)
                .map_err(|e| format!("Serialization error: {}", e));
        } else {
            return Err(format!("Invalid JSON output: {}", stdout));
        }
    } else {
        // stderr is inherited so it's already printed, but we can't capture it here for the error message
        // unless we pipe it. But inheriting is better for UX.
        return Err("Transcription script failed (check terminal logs for details)".to_string());
    }
}

#[tauri::command]
async fn install_transcription_dependencies(app_handle: tauri::AppHandle) -> Result<(), String> {
    let _venv_path = ensure_transcription_dependencies(&app_handle).await?;
    Ok(())
}

fn install_python() -> Result<(), String> {
    use std::process::Command;

    // Try different package managers
    let install_commands = vec![
        vec!["apt-get", "update", "&&", "apt-get", "install", "-y", "python3", "python3-pip"],
        vec!["yum", "install", "-y", "python3", "python3-pip"],
        vec!["dnf", "install", "-y", "python3", "python3-pip"],
        vec!["pacman", "-S", "--noconfirm", "python", "python-pip"],
        vec!["brew", "install", "python3"],
    ];

    for cmd in install_commands {
        println!("Trying to install Python with: {:?}", cmd);
        let output = Command::new(&cmd[0])
            .args(&cmd[1..])
            .output()
            .map_err(|e| format!("Failed to run installation command: {}", e))?;

        if output.status.success() {
            println!("Successfully installed Python");
            return Ok(());
        }
    }

    Err("Failed to install Python with any package manager".to_string())
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
            save_google_api_key,
            remove_google_api_key,
            install_transcription_dependencies,
            greet,
            start_recording,
            stop_recording,
            transcribe_audio
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
