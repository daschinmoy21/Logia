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
    println!("Starting transcription for file: {}", audio_path);

    let script_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/audio/transcription/transcribe.py");

    if !script_path.exists() {
        println!("Transcription script not found at: {:?}", script_path);
        return Err("Transcription script not found".to_string());
    }

    println!("Running transcription script: {:?}", script_path);

    let python_path = std::env::var("HOME").unwrap_or("~".to_string()) + "/.venv/bin/python3";
    let output = Command::new(&python_path)
        .arg(&script_path)
        .arg(audio_path)
        .output()
        .map_err(|e| {
            println!("Failed to execute {}: {}", python_path, e);
            format!("Failed to run transcription script: {}", e)
        })?;

    println!("Transcription script finished with status: {}", output.status);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        println!("Transcription script stderr: {}", stderr);
        return Err(format!("Transcription failed: {}", stderr));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| {
            println!("Invalid UTF-8 in stdout: {}", e);
            format!("Invalid output encoding: {}", e)
        })?;

    println!("Transcription script stdout length: {}", stdout.len());

    // Try to parse as success result first
    let result = if let Ok(result) = serde_json::from_str::<TranscriptionResult>(&stdout) {
        println!("Successfully parsed transcription result with text length: {}", result.text.len());
        // Clean up audio file after successful transcription
        if let Err(e) = std::fs::remove_file(audio_path) {
            println!("Warning: Failed to clean up audio file {}: {}", audio_path, e);
        } else {
            println!("Cleaned up audio file: {}", audio_path);
        }
        Ok(result)
    } else if let Ok(error) = serde_json::from_str::<TranscriptionError>(&stdout) {
        println!("Parsed transcription error: {}", error.error);
        // Still clean up on error
        let _ = std::fs::remove_file(audio_path);
        Err(error.error)
    } else {
        println!("Unexpected output format: {}", stdout);
        // Clean up on unexpected format
        let _ = std::fs::remove_file(audio_path);
        Err(format!("Unexpected output format: {}", stdout))
    };

    result
}