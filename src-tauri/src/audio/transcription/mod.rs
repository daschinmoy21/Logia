use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::{path::BaseDirectory, AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub language_probability: f64,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptionError {
    pub error: String,
}

// Helper to find the python executable inside a venv across platforms
fn python_executable_in_venv(venv_path: &PathBuf) -> PathBuf {
    if let Ok(path) = std::env::var("LOGIA_PYTHON_PATH") {
        return PathBuf::from(path);
    }
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

pub fn transcribe(app_handle: &AppHandle, wav_path: &str) -> Result<String, String> {
    let app_data_dir = app_handle.path().app_data_dir().unwrap();
    let venv_path = app_data_dir.join("transcription_venv");
    let python_path = python_executable_in_venv(&venv_path);

    if !python_path.exists() {
        return Err(format!("Python executable not found at {:?}", python_path));
    }

    // Check for LOGIA_TRANSCRIBE_SCRIPT env var first (set by Nix package)
    let script_path = if let Ok(script) = std::env::var("LOGIA_TRANSCRIBE_SCRIPT") {
        PathBuf::from(script)
    } else if cfg!(debug_assertions) {
        PathBuf::from("src/audio/transcription/transcribe.py")
    } else {
        app_handle.path().resolve("src/audio/transcription/transcribe.py", BaseDirectory::Resource)
           .map_err(|e| format!("Failed to resolve transcribe.py: {}", e))?
    };
    
    if !script_path.exists() {
        return Err(format!("Transcription script not found at {:?}", script_path));
    }

    // Run transcription script
    // usage: python transcribe.py <wav_path>
    // It prints JSON to stdout
    
    // Hide console on Windows
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new(&python_path);
    cmd.arg(&script_path).arg(wav_path);
    
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd.output()
        .map_err(|e| format!("Failed to execute transcription script: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Transcription script failed with code {:?}: {}", 
            output.status.code(), 
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout_str = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout_str)
}