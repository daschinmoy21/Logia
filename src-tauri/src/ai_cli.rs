//! Run local AI coding-agent CLIs (Claude Code, Codex, OpenCode, Gemini CLI)
//! as chat backends. Output is streamed to the frontend through the
//! `ai-cli-event` event; the command itself resolves with the full text.

use serde::Serialize;
use crate::cli_invocation::{build_args, ChatSessionOptions};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;

/// Prompts larger than this are passed on stdin where the tool supports it;
/// tools that only take the prompt as an argument are capped to stay under
/// the per-argument limit on Linux (128 KiB).
const MAX_ARG_PROMPT_BYTES: usize = 100 * 1024;

#[derive(Default)]
pub struct AiCliState {
    running: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Clone, Serialize)]
struct AiCliEvent {
    request_id: String,
    kind: &'static str,
    data: String,
}

#[derive(Serialize)]
pub struct CliToolInfo {
    id: String,
    binary: String,
    available: bool,
    path: Option<String>,
}

struct ToolSpec {
    default_binary: &'static str,
    /// true: prompt goes on stdin; false: prompt is the last argument
    prompt_on_stdin: bool,
}

fn tool_spec(tool: &str) -> Option<ToolSpec> {
    match tool {
        "claude-code" => Some(ToolSpec { default_binary: "claude", prompt_on_stdin: true }),
        "codex" => Some(ToolSpec { default_binary: "codex", prompt_on_stdin: true }),
        "opencode" => Some(ToolSpec { default_binary: "opencode", prompt_on_stdin: false }),
        "pi" => Some(ToolSpec { default_binary: "pi", prompt_on_stdin: false }),
        "gemini-cli" => Some(ToolSpec { default_binary: "gemini", prompt_on_stdin: false }),
        _ => None,
    }
}

/// GUI apps (especially on macOS) don't inherit the login shell PATH, so the
/// usual install locations of these CLIs are appended.
pub(crate) fn augmented_path() -> OsString {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    let mut extra: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for rel in [
            ".local/bin",
            ".bun/bin",
            ".npm-global/bin",
            ".cargo/bin",
            ".opencode/bin",
            ".claude/local",
            ".volta/bin",
            ".nix-profile/bin",
            "go/bin",
            "bin",
        ] {
            extra.push(home.join(rel));
        }
        #[cfg(windows)]
        {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                extra.push(PathBuf::from(appdata).join("npm"));
            }
        }
    }
    for abs in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/run/current-system/sw/bin",
        "/etc/profiles/per-user",
    ] {
        extra.push(PathBuf::from(abs));
    }
    if let Ok(user) = std::env::var("USER") {
        extra.push(PathBuf::from(format!("/etc/profiles/per-user/{}/bin", user)));
    }

    for p in extra {
        if !paths.contains(&p) {
            paths.push(p);
        }
    }
    std::env::join_paths(paths).unwrap_or_default()
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() { return false; }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        return path.metadata().map(|m| m.permissions().mode() & 0o111 != 0).unwrap_or(false);
    }
    #[cfg(not(unix))] { true }
}

/// Resolve a binary name (or explicit path) to an executable file on disk.
pub(crate) fn resolve_binary(binary: &str, path_var: &OsString) -> Option<PathBuf> {
    let candidate = Path::new(binary);
    if candidate.components().count() > 1 || candidate.is_absolute() {
        return is_executable_file(candidate).then(|| candidate.to_path_buf());
    }

    #[cfg(windows)]
    let exts: &[&str] = &[".exe", ".cmd", ".bat", ""];
    #[cfg(not(windows))]
    let exts: &[&str] = &[""];

    for dir in std::env::split_paths(path_var) {
        for ext in exts {
            let full = dir.join(format!("{}{}", binary, ext));
            if is_executable_file(&full) {
                return Some(full);
            }
        }
    }
    None
}

/// Remove ANSI escape sequences (colors, cursor movement) from CLI output.
fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    // CSI: parameters then a final byte in @..~
                    while let Some(&n) = chars.peek() {
                        chars.next();
                        if ('@'..='~').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC: terminated by BEL or ESC \
                    while let Some(n) = chars.next() {
                        if n == '\u{7}' {
                            break;
                        }
                        if n == '\u{1b}' {
                            chars.next();
                            break;
                        }
                    }
                }
                _ => {
                    chars.next();
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn workspace_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?
        .join("ai-cli-workspace");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create AI workspace: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub async fn ai_cli_models(app: tauri::AppHandle, tool: String, binary: Option<String>) -> Result<Vec<crate::cli_models::CliModel>, String> {
    let spec = tool_spec(&tool).ok_or("Unknown CLI provider")?;
    let path = augmented_path();
    let binary = binary.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(spec.default_binary);
    let executable = resolve_binary(binary, &path).ok_or("CLI not found. Set its binary path in Settings → AI.")?;
    crate::cli_models::discover(&tool, &executable, &path, &workspace_dir(&app)?).await
}

#[tauri::command]
pub async fn ai_cli_detect(overrides: Option<HashMap<String, String>>) -> Result<Vec<CliToolInfo>, String> {
    let overrides = overrides.unwrap_or_default();
    let path_var = augmented_path();
    let tools = ["claude-code", "codex", "opencode", "gemini-cli", "pi"];
    Ok(tools
        .iter()
        .map(|id| {
            let spec = tool_spec(id).expect("known tool");
            let binary = overrides
                .get(*id)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .unwrap_or(spec.default_binary)
                .to_string();
            let path = resolve_binary(&binary, &path_var);
            CliToolInfo {
                id: id.to_string(),
                binary,
                available: path.is_some(),
                path: path.map(|p| p.display().to_string()),
            }
        })
        .collect())
}

#[tauri::command]
pub async fn ai_cli_run(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AiCliState>,
    request_id: String,
    tool: String,
    prompt: String,
    model: Option<String>,
    binary: Option<String>,
    options: Option<ChatSessionOptions>,
) -> Result<String, String> {
    let spec = tool_spec(&tool).ok_or_else(|| format!("Unknown CLI tool: {}", tool))?;
    if let Some(effort) = options.as_ref().and_then(|o| o.reasoning_effort.as_deref()) {
        if !matches!(effort, "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") {
            return Err("Unsupported reasoning effort".into());
        }
    }
    if !spec.prompt_on_stdin && prompt.len() > MAX_ARG_PROMPT_BYTES {
        return Err(format!(
            "Prompt is too large for {} ({} KB). Try a shorter note or another provider.",
            tool,
            prompt.len() / 1024
        ));
    }

    let path_var = augmented_path();
    let binary = binary
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or(spec.default_binary)
        .to_string();
    let resolved = resolve_binary(&binary, &path_var).ok_or_else(|| {
        format!("`{}` was not found. Install it or set its path in Settings → AI.", binary)
    })?;

    let cwd = if let Some(options) = &options {
        let id = uuid::Uuid::parse_str(&options.session_id).map_err(|_| "Invalid agent session ID")?;
        let dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("agent-sessions").join(id.to_string());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
        }
        std::fs::write(dir.join("AGENTS.md"), crate::agent_terminal::WORKSPACE_INSTRUCTIONS).map_err(|e| e.to_string())?;
        dir
    } else {
        workspace_dir(&app_handle)?
    };
    let mut cmd = tokio::process::Command::new(&resolved);
    if options.is_some() {
        cmd.env("LOGIA_CLI_SOCKET", crate::cli_transport::endpoint());
        if let Some(script) = crate::agent_terminal::cli_script(&app_handle) { cmd.env("LOGIA_CLI_SCRIPT", script); }
    }
    cmd.args(build_args(&tool, model.as_deref(), &prompt, options.as_ref()))
        .current_dir(cwd)
        .env("PATH", &path_var)
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(if spec.prompt_on_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {}: {}", resolved.display(), e))?;

    if spec.prompt_on_stdin {
        if let Some(mut stdin) = child.stdin.take() {
            let bytes = prompt.into_bytes();
            tokio::spawn(async move {
                let _ = stdin.write_all(&bytes).await;
                let _ = stdin.shutdown().await;
            });
        }
    }

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state
        .running
        .lock()
        .map_err(|_| "AI CLI state poisoned".to_string())?
        .insert(request_id.clone(), cancel_tx);

    let mut stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf).await;
        String::from_utf8_lossy(&buf).to_string()
    });

    let emitter = app_handle.clone();
    let rid = request_id.clone();
    let stdout_task = async move {
        let mut full = String::new();
        let mut pending: Vec<u8> = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            pending.extend_from_slice(&buf[..n]);
            // Only emit complete UTF-8 sequences; keep a partial tail for later.
            let valid_up_to = match std::str::from_utf8(&pending) {
                Ok(_) => pending.len(),
                Err(e) => e.valid_up_to(),
            };
            if valid_up_to == 0 {
                continue;
            }
            let chunk = String::from_utf8_lossy(&pending[..valid_up_to]).to_string();
            pending.drain(..valid_up_to);
            let chunk = strip_ansi(&chunk);
            full.push_str(&chunk);
            let _ = emitter.emit(
                "ai-cli-event",
                AiCliEvent { request_id: rid.clone(), kind: "chunk", data: chunk },
            );
        }
        if !pending.is_empty() {
            full.push_str(&strip_ansi(&String::from_utf8_lossy(&pending)));
        }
        full
    };

    let outcome = tokio::select! {
        output = stdout_task => {
            let status = child.wait().await.map_err(|e| e.to_string());
            Ok((output, status))
        }
        _ = cancel_rx => {
            let _ = child.kill().await;
            Err("cancelled".to_string())
        }
    };

    if let Ok(mut running) = state.running.lock() {
        running.remove(&request_id);
    }

    let (output, status) = outcome?;
    let status = status?;
    if status.success() {
        return Ok(output.trim().to_string());
    }

    let stderr_text = strip_ansi(&stderr_task.await.unwrap_or_default());
    let tail: String = {
        let lines: Vec<&str> = stderr_text.lines().filter(|l| !l.trim().is_empty()).collect();
        lines[lines.len().saturating_sub(8)..].join("\n")
    };
    Err(format!(
        "{} exited with {}{}",
        binary,
        status.code().map(|c| format!("code {}", c)).unwrap_or_else(|| "a signal".into()),
        if tail.is_empty() { String::new() } else { format!(":\n{}", tail) }
    ))
}

#[tauri::command]
pub async fn ai_cli_cancel(state: tauri::State<'_, AiCliState>, request_id: String) -> Result<bool, String> {
    let sender = state
        .running
        .lock()
        .map_err(|_| "AI CLI state poisoned".to_string())?
        .remove(&request_id);
    Ok(match sender {
        Some(tx) => tx.send(()).is_ok(),
        None => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_sequences() {
        assert_eq!(strip_ansi("\u{1b}[1;32mhello\u{1b}[0m world"), "hello world");
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}text"), "text");
        assert_eq!(strip_ansi("plain"), "plain");
    }

    #[test]
    fn unknown_tools_are_rejected() {
        assert!(tool_spec("rm").is_none());
        assert!(tool_spec("claude-code").is_some());
    }
}
