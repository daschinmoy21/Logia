use std::process::Command;
use std::path::Path;
use serde::{Deserialize, Serialize};

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

pub fn transcribe_audio(audio_path: &str) -> Result<TranscriptionResult, String> {
    let script_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/audio/transcription/transcribe.py");

    if !script_path.exists() {
        return Err("Transcription script not found".to_string());
    }

    let output = Command::new("python3")
        .arg(&script_path)
        .arg(audio_path)
        .output()
        .map_err(|e| format!("Failed to run transcription script: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Transcription failed: {}", stderr));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid output encoding: {}", e))?;

    // Try to parse as success result first
    if let Ok(result) = serde_json::from_str::<TranscriptionResult>(&stdout) {
        Ok(result)
    } else if let Ok(error) = serde_json::from_str::<TranscriptionError>(&stdout) {
        Err(error.error)
    } else {
        Err(format!("Unexpected output format: {}", stdout))
    }
}