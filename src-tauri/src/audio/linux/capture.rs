use libc::{kill, SIGINT};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
static CAPTURE_PROCESS: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();

fn generate_output_file() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_specs();
    format!("capture_{}.wav", timestamp)
}

fn get_default_sink() -> Result<String, String> {
    let output = Command::new("pactl")
        .args(&["get-default-sink"])
        .output()
        .map_err(|e| format!("Failed to execute pactl{}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to get default sink:{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let sink_name = String::from_utf8(output.stdout)
        .map_err(|e| format!("Invalid UTF-8 in sink name :{}", e))?
        .trim()
        .to_string();

    if sink_name.is_empty() {
        return Err("No default sink found".to_string());
    }
    Ok(sink_name)
}

pub fn start_capture() -> Result<(), String> {
    let default_sink = get_default_sink()?;
    let monitor_name = format!("{}.monitor", default_sink);
    let output_file = generate_output_file();

    let mut cmd = Command::new("ffmpeg");
    cmd.args(&[
        "-f",
        "pulse", // PulseAudio input format
        "-i",
        &monitor_name, // Input from default sink's monitor
        "-acodec",
        "pcm_s16le", // 16-bit little-endian PCM
        "-ar",
        "16000", // Sample rate (good for speech)
        "-ac",
        "1",          // Mono audio
        "-y",         // Overwrite output file if exists
        &output_file, // Output filename
    ]);

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start FFMPEG:{}", e))?;

    let process_mutex = CAPTURE_PROCESS.get_or_init(|| Mutex::new(None));
    let mut guard = process_mutex
        .lock()
        .map_err(|e| format!("Mutex error:{}", e))?;
    *guard = Some(child);

    println!("Capturing audio from '{}' to {}", monitor_name, output_file);
    Ok(())
}

pub fn stop_capture() -> Result<(), String> {
    let process_mutex = CAPTURE_PROCESS
        .get()
        .ok_or("Capture process not initialized")?;

    let mut guard = process_mutex
        .lock()
        .map_err(|e| format!("Mutext error {}", e))?;
    if let Some(mut child) = guard.take() {
        if let Err(e) = child.signal(libc::SIGINT) {
            eprintln!("Failed to send SIGINT:{}", e);
        }

        std::thread::sleep(std::time::Duration::from_millis(500));

        if let Ok(None) = child_try_wait() {
            if let Err(e) = child.kill() {
                return Err(format!("Failed to kill process:{}", e));
            }
        }

        child
            .wait()
            .map_err(|e| format!("Process wait failed:{}", e))?;
        println!("Audio capture stopped");
    }
    Ok(())
}

pub fn cleanup() -> Result<(), String> {
    stop_capture();
    println!("Cleanup done");
    Ok(())
}
