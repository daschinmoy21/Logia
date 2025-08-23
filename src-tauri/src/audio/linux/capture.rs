use std::process::Command;

pub fn create_sink() {
    let _ = Command::new("pactl")
        .args(&[
            "load-module",
            "module-null-sink",
            "sink-name=kortex-sink",
            "sink-properties=device.description='Kortex virtual sink'",
        ])
        .output();
}

pub fn start_capture() {
    let _ = Command::new("ffmpeg")
        .args(&[
            "-f",
            "pulse",
            "-i",
            "kortex-sink.monitor",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            "output.wav",
        ])
        .spawn(); //spawn runs it as a bg process
}

pub fn stop_capture() {}

pub fn cleanup_sink() {
    let _ = Command::new("pactl")
        .args(&["unload-module", "module-null-sink"])
        .output();
}
