use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

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
    let script_path = app_handle
        .path()
        .resolve_resource("resources/audio/mac/record.js")
        .ok_or_else(|| "record.js script not found in resources".to_string())?;

    let output_file = generate_output_file(app_handle)?;

    let child = Command::new("node")
        .arg(&script_path)
        .arg(&output_file) // Pass output file path as an argument
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

    if let Some(mut child) = guard.take() {
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
