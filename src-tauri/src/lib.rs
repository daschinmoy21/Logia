use chrono;
use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::Manager;
use uuid::Uuid;
use keyring::Entry;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit};
use base64::{Engine as _, engine::general_purpose};

mod audio;

// Hide console windows on Windows when spawning subprocesses
#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW
        cmd.creation_flags(0x08000000);
    }
}

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

// Keyring helpers: try keyring first, fallback to encrypted config file when unavailable
fn try_get_keyring(service: &str, username: &str) -> Option<String> {
    if let Ok(entry) = Entry::new(service, username) {
        if let Ok(pw) = entry.get_password() {
            return Some(pw);
        }
    }
    None
}

fn try_set_keyring(service: &str, username: &str, secret: &str) -> bool {
    if let Ok(entry) = Entry::new(service, username) {
        return entry.set_password(secret).is_ok();
    }
    false
}

fn try_delete_keyring(service: &str, username: &str) -> bool {
    if let Ok(entry) = Entry::new(service, username) {
        // older/newer API differences: try both methods if available
        let _ = entry.delete_credential();
        // delete_credential returns Result<(), _> in some versions; ignore errors
        return true;
    }
    false
}

// Service/username used for storing the Google API key
const KEYRING_SERVICE: &str = "Kortex";
const KEYRING_USERNAME: &str = "google_api_key";

#[tauri::command]
async fn get_google_api_key(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Try keyring first (works on Windows Credential Manager, macOS Keychain, Linux Secret Service)
    if let Some(pw) = try_get_keyring(KEYRING_SERVICE, KEYRING_USERNAME) {
        return Ok(pw);
    }

    // Fallback: check config.json for encrypted key
    let config_dir = get_config_directory(&app_handle)?;
    let config_file = config_dir.join("config.json");

    if config_file.exists() {
        let content = fs::read_to_string(&config_file)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))?;

        // Check for encrypted key
        if let Some(encrypted_key) = config.get("encrypted_google_api_key").and_then(|v| v.as_str()) {
            let key = decrypt_api_key(encrypted_key)?;
            // Try to migrate into keyring for future
            let _ = try_set_keyring(KEYRING_SERVICE, KEYRING_USERNAME, &key);
            return Ok(key);
        }

        // Legacy: Check for plain key and migrate
        if let Some(plain_key) = config.get("google_api_key").and_then(|v| v.as_str()) {
            // Migrate to keyring if possible
            if try_set_keyring(KEYRING_SERVICE, KEYRING_USERNAME, plain_key) {
                // Remove plain key from config
                let mut updated_config = config.clone();
                if let Some(obj) = updated_config.as_object_mut() {
                    obj.remove("google_api_key");
                    // also attempt to store encrypted form
                    if let Ok(encrypted) = encrypt_api_key(plain_key) {
                        obj.insert("encrypted_google_api_key".to_string(), serde_json::Value::String(encrypted));
                    }
                }
                let content = serde_json::to_string_pretty(&updated_config).unwrap_or_default();
                let _ = fs::write(&config_file, content);
            }

            return Ok(plain_key.to_string());
        }
    }

    Err("API key not configured".to_string())
}

#[tauri::command]
async fn save_google_api_key(key: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    // First attempt to save to keyring (preferred)
    if try_set_keyring(KEYRING_SERVICE, KEYRING_USERNAME, &key) {
        // Also persist an encrypted copy to config.json as a fallback for dev/reload scenarios
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

        let _ = fs::write(&config_file, content);

        // Also remove plain key from config.json if present
        // (already removed above)
        return Ok(());
    }

    // Fallback to encrypted config.json
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

    Ok(())
}

#[tauri::command]
async fn remove_google_api_key(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Try to remove from keyring
    let _ = try_delete_keyring(KEYRING_SERVICE, KEYRING_USERNAME);

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

// Helper to find the python executable inside a venv across platforms
fn python_executable_in_venv(venv_path: &std::path::PathBuf) -> std::path::PathBuf {
    if cfg!(windows) {
        let candidates = [
            venv_path.join("Scripts").join("python.exe"),
            venv_path.join("Scripts").join("python"),
            venv_path.join("Scripts").join("python3.exe"),
            venv_path.join("Scripts").join("python3"),
        ];
        for p in candidates.iter() {
            if p.exists() {
                return p.clone();
            }
        }
        // Default fallback
        venv_path.join("Scripts").join("python.exe")
    } else {
        let p = venv_path.join("bin").join("python");
        p
    }
}

async fn ensure_transcription_dependencies(app_handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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

    // Prepare an install log that the UI can read while installation is running
    let log_path = app_data_dir.join("transcription_install.log");
    // helper to append to the log file (best-effort)
    fn append_to_log(path: &std::path::PathBuf, msg: &str) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(msg.as_bytes());
            let _ = f.write_all(b"\n");
        }
    }

    append_to_log(&log_path, &format!("[{}] Starting dependency check/install", chrono::Utc::now().to_rfc3339()));

    let venv_path = app_data_dir.join("transcription_venv");

    let mut cmd_uv_check = Command::new("uv");
    cmd_uv_check.arg("--version");
    hide_console(&mut cmd_uv_check);
    let uv_available = cmd_uv_check
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    append_to_log(&log_path, &format!("uv available: {}", uv_available));

    // Python version check and venv recreation logic
    if venv_path.exists() {
        let python_bin = python_executable_in_venv(&venv_path);

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
                    append_to_log(&log_path, "Detected incompatible Python in venv, removing venv to recreate");
                    let _ = std::fs::remove_dir_all(&venv_path);
                }
            }
        }
    }

    // Create virtual environment if it doesn't exist
    if !venv_path.exists() {
        println!("Creating virtual environment...");
        append_to_log(&log_path, "Creating virtual environment...");

        let venv_created = if uv_available {
            let mut cmd_uv_venv = Command::new("uv");
            cmd_uv_venv.args(&["venv", &venv_path.to_string_lossy(), "--python", "3.12"]);
            hide_console(&mut cmd_uv_venv);
            let status = cmd_uv_venv.status().map(|s| s.success()).unwrap_or(false);
            if status {
                println!("Created venv with uv (Python 3.12)");
                append_to_log(&log_path, "Created venv with uv (Python 3.12)");
            }
            status
        } else if cfg!(windows) {
            // On Windows prefer the `py` launcher, fallback to `python`
            let path_str = venv_path.to_string_lossy().to_string();
            let mut cmd_py = Command::new("py");
            cmd_py.args(&["-3", "-m", "venv", &path_str]);
            hide_console(&mut cmd_py);
            let created_with_py = cmd_py.status().map(|s| s.success()).unwrap_or(false);

            if created_with_py {
                println!("Created venv with py launcher");
                append_to_log(&log_path, "Created venv with py launcher");
            }

            if !created_with_py {
                let mut cmd_python = Command::new("python");
                cmd_python.args(&["-m", "venv", &path_str]);
                hide_console(&mut cmd_python);
                let created_with_python = cmd_python.status().map(|s| s.success()).unwrap_or(false);

                if created_with_python {
                    println!("Created venv with python.exe");
                    append_to_log(&log_path, "Created venv with python.exe");
                }

                created_with_python
            } else {
                true
            }
        } else {
            // Unix-like fallback to python3
            let mut cmd_py3 = Command::new("python3");
            cmd_py3.args(&["-m", "venv", &venv_path.to_string_lossy()]);
            hide_console(&mut cmd_py3);
            let status = cmd_py3.status().map(|s| s.success()).unwrap_or(false);

            if status {
                println!("Created venv with python3");
                append_to_log(&log_path, "Created venv with python3");
            }
            status
        };

        if !venv_created {
            append_to_log(&log_path, "Failed to create virtual environment");
            return Err("Failed to create virtual environment".to_string());
        }
    }

    // Locate python executable inside venv
    let python_path = python_executable_in_venv(&venv_path);

    if !python_path.exists() {
        append_to_log(&log_path, "Python executable not found in venv after creation");
        return Err("Python executable not found in venv after creation".to_string());
    }

    // Ensure pip/setuptools/wheel/cython and imageio-ffmpeg are available to improve build success
    // (helps avoid building C extensions like 'av' from source when possible)
    println!("Upgrading pip/setuptools/wheel and installing build helpers (cython, imageio-ffmpeg)...");
    append_to_log(&log_path, "Upgrading pip/setuptools/wheel and installing build helpers (cython, imageio-ffmpeg)...");
    let mut cmd_upgrade = Command::new(&python_path);
    cmd_upgrade.args(&["-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel", "cython", "imageio-ffmpeg"]);
    hide_console(&mut cmd_upgrade);
    let _ = cmd_upgrade
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .status()
        .map(|s| if s.success() { println!("Build helpers installed/updated"); } else { println!("Warning: failed to upgrade/install build helpers (exit code: {:?})", s.code()); });
    
    append_to_log(&log_path, "Attempting to install build helper packages (pip upgrade etc.)");

    // Check if faster_whisper is already installed
    let mut cmd_check = Command::new(&python_path);
    cmd_check.args(&["-c", "import faster_whisper"]);
    hide_console(&mut cmd_check);
    let check_import_status = cmd_check
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .status();

    if let Ok(status) = check_import_status {
        if status.success() {
            println!("faster_whisper already installed in venv.");
            append_to_log(&log_path, "faster_whisper already installed in venv.");
            return Ok(venv_path); // Dependencies already installed, return venv_path
        }
    }

    // Install dependencies if not already installed
    println!("Installing transcription dependencies...");
    append_to_log(&log_path, "Installing transcription dependencies...");

    // Prefer uv for installs. If uv is available, use it exclusively. If uv is not present, fall back to pip routes.
    if uv_available {
        println!("uv found - installing dependencies using uv...");
        append_to_log(&log_path, "uv found - installing dependencies using uv...");
        let mut cmd_uv_install = Command::new("uv");
        cmd_uv_install.args(&["pip", "install", "-r", &requirements_path.to_string_lossy(), "--python", &venv_path.to_string_lossy()]);
        hide_console(&mut cmd_uv_install);
        let status_result = cmd_uv_install
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .status();

        match status_result {
            Ok(status) if status.success() => {
                println!("Successfully installed dependencies with uv");
                append_to_log(&log_path, "Successfully installed dependencies with uv");
                return Ok(venv_path);
            },
            Ok(status) => {
                println!("uv install failed with exit code: {:?}", status.code());
                append_to_log(&log_path, &format!("uv failed with exit code: {:?}", status.code()));
                // Do not fall back automatically when uv exists; surface the error and advise user
                return Err(format!("uv failed to install dependencies (exit code {:?}). Try running 'uv pip install -r {}'.", status.code(), requirements_path.to_string_lossy()));
            },
            Err(e) => {
                println!("Failed to execute uv: {}", e);
                append_to_log(&log_path, &format!("Failed to execute uv: {}", e));
                return Err(format!("Failed to execute uv: {}", e));
            }
        }
    } else {
        // uv not available — run pip-based fallback (prefer-binary first)
        println!("uv not found - falling back to pip-based installation (prefer-binary)...");
        append_to_log(&log_path, "uv not found - falling back to pip-based installation (prefer-binary)...");

        let mut install_success = false;

        println!("Attempting pip install with --prefer-binary to avoid building C extensions...");
        append_to_log(&log_path, "Attempting pip install with --prefer-binary to avoid building C extensions...");

        let mut cmd_prefer = Command::new(&python_path);
        cmd_prefer.args(&["-m", "pip", "install", "--prefer-binary", "-r", &requirements_path.to_string_lossy()]);
        hide_console(&mut cmd_prefer);
        let prefer_binary = cmd_prefer
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .output();

        match prefer_binary {
            Ok(output) if output.status.success() => {
                println!("Successfully installed dependencies with --prefer-binary");
                append_to_log(&log_path, "Successfully installed dependencies with --prefer-binary");
                install_success = true;
            }
            Ok(output) => {
                println!("--prefer-binary install failed, exit code: {:?}", output.status.code());
                // Save stderr for diagnostics
                append_to_log(&log_path, &format!("--prefer-binary failed: {}", String::from_utf8_lossy(&output.stderr)));
                append_to_log(&log_path, &format!("Wrote pip stderr to {:?}", log_path));

                // Try installing faster-whisper directly with prefer-binary
                println!("Attempting to install faster-whisper directly with --prefer-binary...");
                append_to_log(&log_path, "Attempting to install faster-whisper directly with --prefer-binary...");
                let mut cmd_direct = Command::new(&python_path);
                cmd_direct.args(&["-m", "pip", "install", "--prefer-binary", "faster-whisper"]);
                hide_console(&mut cmd_direct);
                let direct = cmd_direct
                    .env_remove("PYTHONHOME")
                    .env_remove("PYTHONPATH")
                    .output();

                match direct {
                    Ok(out2) if out2.status.success() => {
                        println!("Successfully installed faster-whisper directly");
                        append_to_log(&log_path, "Successfully installed faster-whisper directly");
                        install_success = true;
                    }
                    Ok(out2) => {
                        append_to_log(&log_path, &format!("Direct install failed: {}", String::from_utf8_lossy(&out2.stderr)));
                        append_to_log(&log_path, "Direct install also failed");
                    }
                    Err(e) => {
                        println!("Failed to execute pip for direct install: {}", e);
                        append_to_log(&log_path, &format!("Failed to execute pip for direct install: {}", e));
                    }
                }
            }
            Err(e) => {
                println!("Failed to execute pip (prefer-binary): {}", e);
                append_to_log(&log_path, &format!("Failed to execute pip (prefer-binary): {}", e));
            }
        }

        if install_success {
            append_to_log(&log_path, "Installation complete (prefer-binary route)");
            Ok(venv_path)
        } else {
            // Provide actionable guidance in the error message and point to log file
            let log_path = app_data_dir.join("transcription_install.log");
            let guidance = "If you see build errors for 'av' (PyAV) on Windows, try one of the following:\n"
                .to_string()
                + " 1) Install Microsoft Visual C++ Build Tools (Visual Studio C++ workload) and FFmpeg development headers, then retry.\n"
                + " 2) Install a prebuilt PyAV wheel matching your Python version (e.g., from https://www.lfd.uci.edu/~gohlke/pythonlibs/) or use conda: 'conda install -c conda-forge av ffmpeg'.\n"
                + " 3) Run 'pip install --prefer-binary -r requirements.txt' manually to prefer wheels.\n"
                + "Logs from pip were written to: ";

            append_to_log(&log_path, "Installation failed - see logs above");

            Err(format!("Failed to install transcription dependencies. {} Log: {:?}", guidance, log_path))
        }
    }
}

#[tauri::command]
async fn transcribe_audio(audio_path: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::process::Command;
    use tauri::path::BaseDirectory;

    let venv_path = ensure_transcription_dependencies(&app_handle).await?;

    let script_path = app_handle.path().resolve("src/audio/transcription/transcribe.py", BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve transcribe.py resource: {}", e))?;
    
    let python_path = python_executable_in_venv(&venv_path);

    if !python_path.exists() {
        return Err("Python executable not found in venv".to_string());
    }

    // Spawn the transcription script without creating a console window on Windows
    let mut cmd = Command::new(&python_path);
    cmd.arg(&script_path)
        .arg(&audio_path)
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
    }

    let child = cmd
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

#[tauri::command]
async fn install_system_dependencies(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use std::process::Command;
    use tauri::path::BaseDirectory;

    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let log_path = app_data_dir.join("transcription_install.log");
    fn append_to_log(path: &std::path::PathBuf, msg: &str) {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = f.write_all(msg.as_bytes());
            let _ = f.write_all(b"\n");
        }
    }

    append_to_log(&log_path, "Starting system dependency installer (best-effort)");

    let mut results = serde_json::Map::new();

    if cfg!(windows) {
        // Try winget first
        append_to_log(&log_path, "Windows detected: trying winget to install Python and ffmpeg");
        let mut cmd_w_py = Command::new("winget");
        cmd_w_py.args(&["install", "--id", "Python.Python.3", "-e", "--silent"]);
        hide_console(&mut cmd_w_py);
        let winget_py = cmd_w_py.status();
        append_to_log(&log_path, &format!("winget python status: {:?}", winget_py));
        let mut cmd_w_ff = Command::new("winget");
        cmd_w_ff.args(&["install", "--id", "Gyan.FFmpeg", "-e", "--silent"]);
        hide_console(&mut cmd_w_ff);
        let winget_ff = cmd_w_ff.status();
        append_to_log(&log_path, &format!("winget ffmpeg status: {:?}", winget_ff));

        // Fallback to choco if winget not present
        let mut cmd_ch_py = Command::new("choco");
        cmd_ch_py.args(&["install", "python", "-y"]);
        hide_console(&mut cmd_ch_py);
        let choco_py = cmd_ch_py.status();
        append_to_log(&log_path, &format!("choco python status: {:?}", choco_py));
        let mut cmd_ch_ff = Command::new("choco");
        cmd_ch_ff.args(&["install", "ffmpeg", "-y"]);
        hide_console(&mut cmd_ch_ff);
        let choco_ff = cmd_ch_ff.status();
        append_to_log(&log_path, &format!("choco ffmpeg status: {:?}", choco_ff));

        // Installer cannot reliably install Visual C++ redistributable automatically; link user instead
        results.insert("python_attempted".to_string(), serde_json::Value::Bool(true));
        results.insert("ffmpeg_attempted".to_string(), serde_json::Value::Bool(true));
        results.insert("vcruntime_note".to_string(), serde_json::Value::String("Install Visual C++ Redistributable manually from Microsoft if needed".to_string()));
    } else if cfg!(target_os = "macos") {
        append_to_log(&log_path, "macOS detected: trying brew to install python and ffmpeg");
        let mut cmd_brew_py = Command::new("brew");
        cmd_brew_py.args(&["install", "python"]);
        hide_console(&mut cmd_brew_py);
        let brew_py = cmd_brew_py.status();
        append_to_log(&log_path, &format!("brew python status: {:?}", brew_py));
        let mut cmd_brew_ff = Command::new("brew");
        cmd_brew_ff.args(&["install", "ffmpeg"]);
        hide_console(&mut cmd_brew_ff);
        let brew_ff = cmd_brew_ff.status();
        append_to_log(&log_path, &format!("brew ffmpeg status: {:?}", brew_ff));
        results.insert("python_attempted".to_string(), serde_json::Value::Bool(true));
        results.insert("ffmpeg_attempted".to_string(), serde_json::Value::Bool(true));
    } else {
        // Assume linux
        append_to_log(&log_path, "Linux detected: trying apt/dnf/pacman to install python3 and ffmpeg");
        let mut cmd_apt = Command::new("sh");
        cmd_apt.args(&["-c", "apt-get update && apt-get install -y python3 python3-pip ffmpeg"]);
        hide_console(&mut cmd_apt);
        let apt_update = cmd_apt.status();
        append_to_log(&log_path, &format!("apt status: {:?}", apt_update));
        let mut cmd_dnf = Command::new("sh");
        cmd_dnf.args(&["-c", "dnf install -y python3 python3-pip ffmpeg"]);
        hide_console(&mut cmd_dnf);
        let dnf = cmd_dnf.status();
        append_to_log(&log_path, &format!("dnf status: {:?}", dnf));
        let mut cmd_pac = Command::new("sh");
        cmd_pac.args(&["-c", "pacman -S --noconfirm python python-pip ffmpeg"]);
        hide_console(&mut cmd_pac);
        let pacman = cmd_pac.status();
        append_to_log(&log_path, &format!("pacman status: {:?}", pacman));
        results.insert("python_attempted".to_string(), serde_json::Value::Bool(true));
        results.insert("ffmpeg_attempted".to_string(), serde_json::Value::Bool(true));
    }

    append_to_log(&log_path, "System dependency installer finished (check OS package manager output above)");

    // Try installing Rust toolchain if pip builds require it
    append_to_log(&log_path, "Checking Rust toolchain (needed for building some Python wheels)...");
    let mut need_rust = true;
    if let Ok(status) = Command::new("rustc").arg("--version").status() {
        if status.success() { need_rust = false; }
    }
    if need_rust {
        append_to_log(&log_path, "Rust not found - attempting to install rust toolchain...");
        if cfg!(windows) {
            let mut cmd_r = Command::new("winget");
            cmd_r.args(&["install", "--id", "RustLang.Rust", "-e", "--silent"]);
            hide_console(&mut cmd_r);
            let r = cmd_r.status();
            append_to_log(&log_path, &format!("winget rust status: {:?}", r));
        } else if cfg!(target_os = "macos") {
            let mut cmd_r = Command::new("brew");
            cmd_r.args(&["install", "rust"]);
            hide_console(&mut cmd_r);
            let r = cmd_r.status();
            append_to_log(&log_path, &format!("brew rust status: {:?}", r));
        } else {
            let mut cmd_r = Command::new("sh");
            cmd_r.args(&["-c", "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"]);
            hide_console(&mut cmd_r);
            let r = cmd_r.status();
            append_to_log(&log_path, &format!("rustup install status: {:?}", r));
        }
    } else {
        append_to_log(&log_path, "Rust toolchain already present");
    }

    Ok(serde_json::Value::Object(results))
}

#[tauri::command]
async fn prereflight_check(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use std::process::Command;
    use std::time::Duration;
    use std::net::TcpStream;
    use tauri::path::BaseDirectory;

    let mut map = serde_json::Map::new();

    // Platform
    map.insert("platform".to_string(), serde_json::Value::String(std::env::consts::OS.to_string()));

    // Check for Python (try py launcher on Windows first, then python)
    let mut python_found = false;
    let mut python_version: Option<String> = None;
    let mut python_exec: Option<String> = None;

    let try_python_cmd = |cmd: &str, args: &[&str]| -> Option<(String, String)> {
        if let Ok(output) = Command::new(cmd).args(args).output() {
            if output.status.success() {
                let out = String::from_utf8_lossy(&output.stdout).to_string();
                let mut lines = out.lines();
                let exe = lines.next().map(|s| s.to_string()).unwrap_or_default();
                let ver = lines.next().map(|s| s.to_string()).unwrap_or_default();
                return Some((exe, ver));
            }
        }
        None
    };

    if cfg!(windows) {
        if let Some((exe, ver)) = try_python_cmd("py", &["-3", "-c", "import sys;print(sys.executable);print(sys.version)"]) {
            python_found = true;
            python_exec = Some(exe);
            python_version = Some(ver);
        }
    }

    if !python_found {
        if let Some((exe, ver)) = try_python_cmd("python", &["-c", "import sys;print(sys.executable);print(sys.version)"]) {
            python_found = true;
            python_exec = Some(exe);
            python_version = Some(ver);
        }
    }

    map.insert("python_found".to_string(), serde_json::Value::Bool(python_found));
    map.insert("python_version".to_string(), match python_version { Some(v) => serde_json::Value::String(v), None => serde_json::Value::Null });
    map.insert("python_executable".to_string(), match python_exec { Some(p) => serde_json::Value::String(p), None => serde_json::Value::Null });

    // Check ffmpeg availability
    let ffmpeg_available = if let Ok(output) = Command::new("ffmpeg").arg("-version").output() {
        output.status.success()
    } else { false };
    map.insert("ffmpeg_available".to_string(), serde_json::Value::Bool(ffmpeg_available));

    // Check for Visual C++ runtime on Windows by probing common DLL locations (vcruntime140.dll)
    let vcruntime_found = if cfg!(windows) {
        std::env::var("WINDIR").ok().map(|w| {
            let sys32 = std::path::Path::new(&w).join("System32").join("vcruntime140.dll");
            let wow64 = std::path::Path::new(&w).join("SysWOW64").join("vcruntime140.dll");
            sys32.exists() || wow64.exists()
        }).unwrap_or(false)
    } else { false };
    map.insert("vcruntime_found".to_string(), serde_json::Value::Bool(vcruntime_found));

    // Check that packaged Windows helper exists in resources
    let windows_bin_path = app_handle.path().resolve("src/audio/windows/Windows.bin", BaseDirectory::Resource).ok();
    map.insert("windows_helper_present".to_string(), serde_json::Value::Bool(windows_bin_path.as_ref().map(|p| p.exists()).unwrap_or(false)));
    map.insert("windows_helper_path".to_string(), match windows_bin_path { Some(p) => serde_json::Value::String(p.to_string_lossy().to_string()), None => serde_json::Value::Null });

    // Simple network check to pypi.org (used by pip installs)
    use std::net::ToSocketAddrs;
    let network_ok = {
        let timeout = Duration::from_secs(3);
        match ("pypi.org", 443).to_socket_addrs() {
            Ok(mut addrs) => {
                if let Some(addr) = addrs.next() {
                    std::net::TcpStream::connect_timeout(&addr, timeout).is_ok()
                } else {
                    false
                }
            }
            Err(_) => false,
        }
    };
    map.insert("network_ok".to_string(), serde_json::Value::Bool(network_ok));

    Ok(serde_json::Value::Object(map))
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
            install_system_dependencies,
            greet,
            start_recording,
            stop_recording,
            transcribe_audio,
            prereflight_check,
            read_install_log
        ])
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn read_install_log(app_handle: tauri::AppHandle) -> Result<String, String> {
    // Return contents of the transcription_install.log in the app data directory (best-effort)
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    let log_path = app_data_dir.join("transcription_install.log");
    if log_path.exists() {
        std::fs::read_to_string(&log_path).map_err(|e| format!("Failed to read log file: {}", e))
    } else {
        Ok(String::new())
    }
}
