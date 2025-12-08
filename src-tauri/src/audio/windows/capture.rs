// src/capture.rs
use std::io::{Write, BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Manager};
use tauri::path::BaseDirectory;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

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
        .app_data_dir() // <- still on `Manager`
        .map_err(|e| format!("Failed to resolve app_data_dir: {e}"))?
        .join("audio");

    std::fs::create_dir_all(&audio_dir)
        .map_err(|e| format!("Failed to create audio directory: {e}"))?;

    Ok(audio_dir.join(file_name).to_string_lossy().into_owned())
}

pub fn start_capture(app_handle: &AppHandle) -> Result<(), String> {
    println!("Starting audio capture on Windows");

    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        println!("App data dir: {:?}", app_data_dir);
    } else {
        println!("App data dir not available");
    }

    let output_file = generate_output_file(app_handle)?;
    println!("Output file: {}", output_file);

    // Try to find the exe via resource resolver (works in packaged builds)
    let exe_resource = match app_handle.path().resolve("src/audio/windows/Windows.bin", BaseDirectory::Resource) {
        Ok(p) if p.exists() => Some(p),
        _ => {
            // Fallback: try to find the exe relative to the app exe (useful in dev or some packaging layouts)
            let app_exe = std::env::current_exe().map_err(|e| format!("Failed to get current exe: {}", e))?;
            let app_dir = app_exe.parent().ok_or("Failed to get app dir")?;
            let exe_path = app_dir.join("resources/audio/windows/Windows.bin");
            if exe_path.exists() {
                Some(exe_path)
            } else {
                None
            }
        }
    };

    // Write debug info to a file
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        let debug_file = app_data_dir.join("debug_audio.txt");
        let _ = std::fs::write(&debug_file, format!("Exe path: {:?}\n", exe_resource.as_ref().map(|p| p.display())));
    }

    let mut child = if let Some(exe_path) = exe_resource {
        let exe_str = exe_path.to_string_lossy().into_owned();
        println!("Found native Windows exe at {}, launching...", exe_str);

        // Build command so we can set Windows-specific creation flags to avoid showing a console window
        let mut cmd = Command::new(&exe_str);
        cmd.arg("--output")
            .arg(&output_file)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // On Windows, prevent a console window from being created for the child process
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW = 0x08000000
            cmd.creation_flags(0x08000000);
        }

        cmd.spawn()
            .map_err(|e| format!("Failed to start Windows.exe: {}", e))?
    } else {
        return Err("Windows capture executable not found. Ensure Windows.bin is in the app's resources/audio/windows/ directory.".to_string());
    };

    // Quick check: did the process exit immediately? If so, capture stderr/stdout and return an error with logs.
    match child.try_wait() {
        Ok(Some(status)) => {
            // Process has exited already; capture its output for diagnostics
            let output = child
                .wait_with_output()
                .map_err(|e| format!("Failed to collect process output: {}", e))?;

            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();

            // Write combined logs to app data dir
            if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
                let log_dir = app_data_dir.join("logs");
                let _ = std::fs::create_dir_all(&log_dir);
                let log_path = log_dir.join("windows_capture_startup.log");
                let _ = std::fs::write(&log_path, format!("exit: {:?}\nSTDOUT:\n{}\nSTDERR:\n{}\n", status.code(), stdout, stderr));
                return Err(format!("Windows capture helper exited immediately (code: {:?}). See log: {:?}", status.code(), log_path));
            }

            return Err(format!("Windows capture helper exited immediately (code: {:?}). STDERR: {}", status.code(), stderr));
        }
        Ok(None) => {
            // Process is still running -> good
            // Start background threads to capture runtime stdout/stderr and append to a runtime log file
            let runtime_log = if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
                let log_dir = app_data_dir.join("logs");
                let _ = std::fs::create_dir_all(&log_dir);
                log_dir.join("windows_capture_runtime.log")
            } else {
                std::path::PathBuf::from("windows_capture_runtime.log")
            };

            if let Some(stdout) = child.stdout.take() {
                let lp = runtime_log.clone();
                thread::spawn(move || {
                    let mut reader = BufReader::new(stdout);
                    let mut line = String::new();
                    loop {
                        line.clear();
                        match reader.read_line(&mut line) {
                            Ok(0) => break,
                            Ok(_) => {
                                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&lp) {
                                    let _ = f.write_all(line.as_bytes());
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }

            if let Some(stderr) = child.stderr.take() {
                let lp = runtime_log.clone();
                thread::spawn(move || {
                    let mut reader = BufReader::new(stderr);
                    let mut line = String::new();
                    loop {
                        line.clear();
                        match reader.read_line(&mut line) {
                            Ok(0) => break,
                            Ok(_) => {
                                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&lp) {
                                    let _ = f.write_all(format!("ERR: {}", line).as_bytes());
                                }
                            }
                            Err(_) => break,
                        }
                    }
                });
            }
        }
        Err(e) => {
            return Err(format!("Failed to query capture process status: {}", e));
        }
    }

    // Store child and output path for later stop
    CAPTURE_PROCESS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|e| format!("Mutex error: {e}"))?
        .replace(child);

    OUTPUT_FILE_PATH
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|e| format!("Mutex error: {e}"))?
        .replace(output_file);

    println!("Started audio capture process for Windows");
    Ok(())
}

pub fn stop_capture() -> Result<String, String> {
    let mut child = CAPTURE_PROCESS
        .get()
        .ok_or("Capture process not initialized")?
        .lock()
        .map_err(|e| format!("Mutex error: {e}"))?
        .take()
        .ok_or("Capture process was not running")?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(b"stop\n")
            .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    } else {
        return Err("Could not get stdin of child process".to_string());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Failed to wait for process: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Windows capture process exited with error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    OUTPUT_FILE_PATH
        .get()
        .ok_or("Output path not initialized")?
        .lock()
        .map_err(|e| format!("Mutex error: {e}"))?
        .take()
        .ok_or("Output path was not set".to_string())
}