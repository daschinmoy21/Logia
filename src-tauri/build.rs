fn main() {
    // screencapturekit 1.4.2 requires macOS 14.0+ for SCScreenshotConfiguration
    // Set deployment target to ensure proper symbol linking
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=14.0");
    }
    tauri_build::build()
}
