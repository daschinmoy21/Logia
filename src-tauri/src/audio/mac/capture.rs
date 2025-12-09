use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use tauri::{path::BaseDirectory, AppHandle, Manager};

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

static CAPTURE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static OUTPUT_FILE_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn generate_output_file(app_handle: &AppHandle) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let file_name = format!("capture_{}.wav", timestamp);

    let audio_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("audio");
    std::fs::create_dir_all(&audio_dir)
        .map_err(|e| format!("Failed to create audio directory: {}", e))?;

    Ok(audio_dir.join(file_name).to_string_lossy().to_string())
}

pub fn start_capture(app_handle: &AppHandle) -> Result<(), String> {
    println!("Starting audio capture on macOS");
    // Path to the `record.js` script, assuming it's bundled as a resource
    let script_path = if cfg!(debug_assertions) {
        // In dev mode, use the source path
        std::path::PathBuf::from("src/audio/mac/record.cjs")
    } else {
        // In release, use bundled resource
        app_handle
            .path()
            .resolve("src/audio/mac/record.cjs", BaseDirectory::Resource)
            .map_err(|e| format!("Failed to resolve record.cjs script: {}", e))?
    };

    let output_file = generate_output_file(app_handle)?;

    // Get python executable from venv
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let venv_path = app_data_dir.join("transcription_venv");
    let python_path = python_executable_in_venv(&venv_path);

    let child = Command::new("node")
        .arg(&script_path)
        .arg(&output_file) // Pass output file path as an argument
        .arg(&python_path) // Pass python executable path
        .spawn()
        .map_err(|e| format!("Failed to start node script: {}", e))?;

    let process_mutex = CAPTURE_PROCESS.get_or_init(|| Mutex::new(None));
    let mut guard = process_mutex
        .lock()
        .map_err(|e| format!("Mutex error: {}", e))?;
    *guard = Some(child);

    let path_mutex = OUTPUT_FILE_PATH.get_or_init(|| Mutex::new(None));
    let mut path_guard = path_mutex
        .lock()
        .map_err(|e| format!("Mutex error: {}", e))?;
    *path_guard = Some(output_file);

    println!("Started audio capture process for macOS");
    Ok(())
}

pub fn stop_capture() -> Result<String, String> {
    let process_mutex = CAPTURE_PROCESS
        .get()
        .ok_or("Capture process not initialized")?;

    let mut guard = process_mutex
        .lock()
        .map_err(|e| format!("Mutex error: {}", e))?;

    if let Some(child) = guard.take() {
        // The node script will listen for SIGINT to stop recording gracefully.
        unsafe {
            libc::kill(child.id() as i32, libc::SIGINT);
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for node script: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "Node script exited with error: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    } else {
        return Err("Capture process was not running".to_string());
    }

    let path_mutex = OUTPUT_FILE_PATH
        .get()
        .ok_or("Output path not initialized")?;
    let mut path_guard = path_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;

    if let Some(path) = path_guard.take() {
        Ok(path)
    } else {
        Err("Output path was not set".to_string())
    }
}
