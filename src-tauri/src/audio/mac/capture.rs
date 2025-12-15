use std::fs::File;
use std::io::{Write, Read};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

// Note: These imports assume screencapturekit 0.2.0 API structure.
// Adjustments might be needed based on the exact version/API.
#[cfg(target_os = "macos")]
use screencapturekit::{
    sc_content_filter::{InitParams, SCContentFilter},
    sc_shareable_content::SCShareableContent,
    sc_stream::SCStream,
    sc_stream_configuration::SCStreamConfiguration,
    sc_output_handler::{StreamOutput, SCStreamOutputType, CMSampleBuffer},
};

// Global state to hold the running stream
#[cfg(target_os = "macos")]
static CAPTURE_STREAM: OnceLock<Mutex<Option<SCStream>>> = OnceLock::new();
static OUTPUT_FILE_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[cfg(target_os = "macos")]
struct AudioRecorder {
    file: Arc<Mutex<File>>,
}

#[cfg(target_os = "macos")]
impl StreamOutput for AudioRecorder {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type == SCStreamOutputType::Audio {
            // access the raw audio buffer list
            // For now, we assume simple safe access exists or use unsafe if required.
            // This logic implements a basic Float32 -> Int16 conversion if possible
            // or just writes raw bytes.
            
            // NOTE: In a real implementation with `screencapturekit` crate, 
            // you might need to iterate over the AudioBufferList.
            // Since we can't verify the crate internals here, we will outline the logic.
            
            // let audio_buffers = sample.get_audio_buffers(); // Hypothetical API
            // For each buffer, verify format (Native is usually F32)
            // Convert F32 to I16: (sample * 32767.0).clamp(-32768.0, 32767.0) as i16
            
            // Placeholder: Write raw bytes (user might need to refine this based on crate)
            // let bytes = sample.as_bytes(); 
            // if let Ok(mut f) = self.file.lock() {
            //      let _ = f.write_all(bytes);
            // }
        }
    }
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
    let sample_rate = 48000; // Native often 48k, assume this for now
    let channels = 2;
    let bits_per_sample = 16; // We aim to convert to 16-bit
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

#[cfg(target_os = "macos")]
pub fn start_capture(app_handle: &AppHandle) -> Result<(), String> {
    println!("Starting audio capture (sc-kit)");

    // 1. Setup Output File
    let output_base = generate_output_file(app_handle)?;
    let pcm_path = format!("{}.pcm", output_base);
    let file = File::create(&pcm_path).map_err(|e| format!("Failed to create PCM file: {}", e))?;
    let file_arc = Arc::new(Mutex::new(file));

    // 2. Setup ScreenCaptureKit
    // Create a filter for the main display
    let content = SCShareableContent::current(); 
    let display = content.displays.first().ok_or("No display found")?;
    
    // Filter: Include everything (default), but maybe exclude own app?
    // let filter = SCContentFilter::new(InitParams::Display(display.clone()));
    // For now simple filter:
    let filter = SCContentFilter::new(InitParams::Display(display.clone()));

    // Config: Audio Only
    let config = SCStreamConfiguration {
        captures_audio: true,
        excludes_current_process_audio: true,
        // width/height don't matter much for audio only but required
        width: 100, 
        height: 100,
        ..Default::default()
    };

    // Output Handler
    let recorder = AudioRecorder { file: file_arc };
    
    // Stream
    let mut stream = SCStream::new(filter, config, recorder);
    stream.add_stream_output(recorder, SCStreamOutputType::Audio);
    
    stream.start_capture().map_err(|e| format!("Failed to start capture: {:?}", e))?;

    // Store state
    let state_mutex = CAPTURE_STREAM.get_or_init(|| Mutex::new(None));
    let mut guard = state_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    *guard = Some(stream);

    let path_mutex = OUTPUT_FILE_PATH.get_or_init(|| Mutex::new(None));
    let mut path_guard = path_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    *path_guard = Some(output_base);

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn start_capture(_app_handle: &AppHandle) -> Result<(), String> {
    Err("Audio capture is only supported on macOS".to_string())
}

#[cfg(target_os = "macos")]
pub fn stop_capture() -> Result<String, String> {
    let state_mutex = CAPTURE_STREAM.get().ok_or("Capture not started")?;
    let mut guard = state_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;

    if let Some(stream) = guard.take() {
        stream.stop_capture().map_err(|e| format!("Failed to stop capture: {:?}", e))?;
    } else {
        return Err("Capture not running".to_string());
    }

    // Convert PCM to WAV
    let path_mutex = OUTPUT_FILE_PATH.get().ok_or("Output path lost")?;
    let mut path_guard = path_mutex.lock().map_err(|e| format!("Mutex error: {}", e))?;
    let output_base = path_guard.take().ok_or("Output path empty")?;

    let pcm_path = format!("{}.pcm", output_base);
    let wav_path = format!("{}.wav", output_base);

    let mut pcm_file = File::open(&pcm_path).map_err(|e| format!("Failed to open PCM: {}", e))?;
    let mut pcm_data = Vec::new();
    pcm_file.read_to_end(&mut pcm_data).map_err(|e| format!("Failed to read PCM: {}", e))?;

    let header = create_wav_header(pcm_data.len() as u32);
    let mut wav_file = File::create(&wav_path).map_err(|e| format!("Failed to create WAV: {}", e))?;
    
    wav_file.write_all(&header).map_err(|e| format!("Write header failed: {}", e))?;
    wav_file.write_all(&pcm_data).map_err(|e| format!("Write data failed: {}", e))?;

    let _ = std::fs::remove_file(&pcm_path);

    Ok(wav_path)
}

#[cfg(not(target_os = "macos"))]
pub fn stop_capture() -> Result<String, String> {
    Err("Not supported".to_string())
}
