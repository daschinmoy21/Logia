//! Stand-ins for desktop-only features on Android/iOS.
//!
//! The desktop modules spawn local tools (git, agent CLIs, Python/ffmpeg,
//! PTYs) or listen on a local socket for `logia-cli`, none of which exist in a
//! mobile app sandbox. These modules mirror their command names and state
//! types so `lib.rs` registers the same handler list on every platform: the
//! frontend's `invoke` calls still resolve, they just return a clear error.

pub const NOT_AVAILABLE: &str = "not available on mobile";

fn unavailable<T>() -> Result<T, String> {
    Err(NOT_AVAILABLE.to_string())
}

/// Declares `#[tauri::command]` stubs that ignore their arguments and fail.
/// Tauri skips IPC args a command doesn't declare, so no parameters are needed.
macro_rules! unavailable_commands {
    ($($name:ident),* $(,)?) => {
        $(
            #[tauri::command]
            pub async fn $name() -> Result<(), String> {
                super::unavailable()
            }
        )*
    };
}

pub mod git_sync {
    #[derive(Default)]
    pub struct GitSyncState;
    impl GitSyncState {
        pub fn new() -> Self {
            Self
        }
    }

    unavailable_commands![
        git_sync_status,
        git_sync_configure,
        git_sync_now,
        git_sync_force_pull,
        git_sync_force_push,
        git_sync_disconnect,
        git_panel_status,
        git_panel_init,
        git_panel_stage,
        git_panel_unstage,
        git_panel_stage_all,
        git_panel_unstage_all,
        git_panel_discard,
        git_panel_commit,
        git_panel_pull,
        git_panel_push,
    ];
}

pub mod ai_cli {
    #[derive(Default)]
    pub struct AiCliState;

    unavailable_commands![ai_cli_models, ai_cli_run];

    /// No CLI tools can be installed in the app sandbox.
    #[tauri::command]
    pub async fn ai_cli_detect() -> Result<Vec<serde_json::Value>, String> {
        Ok(Vec::new())
    }

    /// Nothing is ever running, so there is nothing to cancel.
    #[tauri::command]
    pub async fn ai_cli_cancel() -> Result<bool, String> {
        Ok(false)
    }
}

pub mod agent_terminal {
    #[derive(Default)]
    pub struct AgentTerminalState;
    impl AgentTerminalState {
        pub fn close_all(&self) {}
    }

    unavailable_commands![agent_terminal_start, agent_terminal_write, agent_terminal_resize];

    /// Closing a session that can't exist is a no-op, as on desktop.
    #[tauri::command]
    pub async fn agent_terminal_close() -> Result<(), String> {
        Ok(())
    }
}

pub mod cli_bridge {
    #[derive(Default)]
    pub struct CliBridgeState;
    impl CliBridgeState {
        pub fn shutdown(&self) {}
    }

    /// The `logia-cli` socket bridge is desktop-only; nothing to start.
    pub fn start(_app: tauri::AppHandle) {}

    unavailable_commands![cli_bridge_ready, cli_bridge_reply];
}

/// Audio capture and Whisper transcription (Python) commands.
pub mod transcription {
    unavailable_commands![
        start_recording,
        stop_recording,
        transcribe_audio,
        install_transcription_dependencies,
    ];
}
