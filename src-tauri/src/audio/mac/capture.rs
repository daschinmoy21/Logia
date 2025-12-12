use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::os::unix::fs::PermissionsExt;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use tauri::{path::BaseDirectory, AppHandle, Manager};

// Global state to hold the running capture process and threads
static CAPTURE_STATE: OnceLock<Mutex<Option<CaptureState>>> = OnceLock::new();
static OUTPUT_FILE_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

struct CaptureState {
    child: Child,
    stdout_thread: Option<JoinHandle<()>>,
    stderr_thread: Option<JoinHandle<String>>,
}

fn generate_output_file(app_handle: &AppHandle) -> Result<String, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let file_name = format!("capture_{}", timestamp);

    let audio_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("audio");
    std::fs::create_dir_all(&audio_dir)
        .map_err(|e| format!("Failed to create audio directory: {}", e))?;

    Ok(audio_dir.join(file_name).to_string_lossy().to_string())
}

fn create_wav_header(data_size: u32) -> Vec<u8> {
    let sample_rate = 24000;
    let channels = 2;
    let bits_per_sample = 16;
    let byte_rate = sample_rate * channels * bits_per_sample / 8;
    let block_align = channels * bits_per_sample / 8;
    
    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&(data_size + 36).to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&16u32.to_le_bytes()); 
    header.extend_from_slice(&1u16.to_le_bytes());  
    header.extend_from_slice(&(channels as u16).to_le_bytes());
    header.extend_from_slice(&(sample_rate as u32).to_le_bytes());
    header.extend_from_slice(&(byte_rate as u32).to_le_bytes());
    header.extend_from_slice(&(block_align as u16).to_le_bytes());
    header.extend_from_slice(&(bits_per_sample as u16).to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_size.to_le_bytes());
    
    header
}

pub fn start_capture(app_handle: &AppHandle) -> Result<(), String> {
    println!("Starting audio capture on macOS (Native Rust)");
    
    let binary_path = if cfg!(debug_assertions) {
        PathBuf::from("src/audio/mac/SystemAudioDump")
    } else {
        app_handle
            .path()
            .resolve("src/audio/mac/SystemAudioDump", BaseDirectory::Resource)
            .map_err(|e| format!("Failed to resolve SystemAudioDump: {}", e))?
    };

    if !binary_path.exists() {
         return Err(format!("SystemAudioDump not found at {:?}", binary_path));
    }

    // Ensure executable permission
    if let Ok(metadata) = fs::metadata(&binary_path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o755);
        let _ = fs::set_permissions(&binary_path, perms);
    }

    let output_base = generate_output_file(app_handle)?;
    let pcm_path = format!("{}.pcm", output_base);
    
    // Spawn SystemAudioDump
    let mut child = Command::new(&binary_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped()) // Capture stderr
        .spawn()
        .map_err(|e| format!("Failed to start SystemAudioDump: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to open stderr")?;
    
    // Thread for stdout -> file
    let pcm_path_clone = pcm_path.clone();
    let stdout_handle = thread::spawn(move || {
        if let Ok(mut file) = File::create(&pcm_path_clone) {
            let _ = std::io::copy(&mut stdout, &mut file);
        } else {
            eprintln!("Failed to create PCM file: {}", pcm_path_clone);
        }
    });

    // Thread for stderr capture
    let stderr_handle = thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stderr.read_to_string(&mut buffer);
        buffer
    });

    // Store state
    let state_mutex = CAPTURE_STATE.get_or_init(|| Mutex::new(None));
    let mut guard = state_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    *guard = Some(CaptureState {
        child,
        stdout_thread: Some(stdout_handle),
        stderr_thread: Some(stderr_handle),
    });

    let path_mutex = OUTPUT_FILE_PATH.get_or_init(|| Mutex::new(None));
    let mut path_guard = path_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    *path_guard = Some(output_base);

    println!("Started audio capture process");
    Ok(())
}

pub fn stop_capture() -> Result<String, String> {
    let state_mutex = CAPTURE_STATE
        .get()
        .ok_or("Capture process not initialized")?;

    let mut guard = state_mutex
        .lock()
        .map_err(|e| format!("Mutex error: {}", e))?;

    let mut captured_stderr = String::new();

    if let Some(mut state) = guard.take() {
        // Stop the process
        unsafe {
            libc::kill(state.child.id() as i32, libc::SIGINT);
        }
        
        let _ = state.child.wait(); 
        
        // Join threads
        if let Some(handle) = state.stdout_thread.take() {
            let _ = handle.join();
        }
        if let Some(handle) = state.stderr_thread.take() {
            if let Ok(err_output) = handle.join() {
                captured_stderr = err_output;
            }
        }
    } else {
        return Err("Capture process was not running".to_string());
    }
    
    // Retrieve output path
    let path_mutex = OUTPUT_FILE_PATH
        .get()
        .ok_or("Output path not initialized")?;
    let mut path_guard = path_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    let output_base = if let Some(path) = path_guard.take() {
        path
    } else {
        return Err("Output path lost".to_string());
    };

    let pcm_path = format!("{}.pcm", output_base);
    let wav_path = format!("{}.wav", output_base);

    // Check data and convert
    {
        let mut pcm_file = File::open(&pcm_path).map_err(|e| {
            format!("Failed to open PCM file. Stderr from capture: {}", captured_stderr)
        })?;
        let mut pcm_data = Vec::new();
        pcm_file.read_to_end(&mut pcm_data).map_err(|e| format!("Failed to read PCM data: {}", e))?;
        
        if pcm_data.is_empty() {
             return Err(format!("Captured audio is empty. SystemAudioDump Stderr: {}", captured_stderr));
        }

        let header = create_wav_header(pcm_data.len() as u32);
        let mut wav_file = File::create(&wav_path).map_err(|e| format!("Failed to create WAV file: {}", e))?;
        wav_file.write_all(&header).map_err(|e| format!("Failed to write WAV header: {}", e))?;
        wav_file.write_all(&pcm_data).map_err(|e| format!("Failed to write WAV data: {}", e))?;
    }

    let _ = std::fs::remove_file(&pcm_path);
    
    Ok(wav_path)
}
