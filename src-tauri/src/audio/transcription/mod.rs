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

// This function is no longer used since we handle transcription directly in the Tauri command
pub fn transcribe_audio(_audio_path: &str) -> Result<TranscriptionResult, String> {
    Err("This function is deprecated. Use the Tauri command instead.".to_string())
}