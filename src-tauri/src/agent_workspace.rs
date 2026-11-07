//! Self-contained note tools for agents, including unbundled Nix installs.
use std::path::{Path, PathBuf};
use tokio::process::Command;

const LIVE_CLI: &str = include_str!("../../scripts/logia-cli.mjs");

pub struct AgentWorkspace {
    pub script: PathBuf,
    /// The exact shell command agents are told to run for live note access.
    pub command: String,
    pub instructions: String,
}

fn quote(value: &Path) -> String {
    let value = value.to_string_lossy();
    #[cfg(windows)]
    {
        format!("'{}'", value.replace('\'', "''"))
    }
    #[cfg(not(windows))]
    {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

pub fn prepare(cwd: &Path, node: &Path, endpoint: &Path) -> Result<AgentWorkspace, String> {
    std::fs::create_dir_all(cwd).map_err(|e| e.to_string())?;
    let cwd = std::fs::canonicalize(cwd).map_err(|e| e.to_string())?;
    // The agent may write files inside its cwd (to stage large note content), and
    // it is pre-approved to run this script. Keep the script outside the cwd so the
    // agent can't rewrite it into arbitrary code.
    let _ = std::fs::remove_file(cwd.join("logia-cli.mjs"));
    let tools = cwd
        .parent()
        .ok_or("Agent workspace has no parent directory")?
        .join(".logia-tools");
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tools, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let name = cwd
        .file_name()
        .map(|n| n.to_string_lossy().replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', "_"))
        .unwrap_or_else(|| "session".into());
    let script = tools.join(format!("{name}-logia-cli.mjs"));
    // Bake in the parent GUI endpoint: agent shell environment filtering and
    // private temporary directories must not redirect calls to another socket.
    let socket = serde_json::to_string(&endpoint.to_string_lossy()).map_err(|e| e.to_string())?;
    let source = LIVE_CLI
        .strip_prefix("#!/usr/bin/env node\n")
        .unwrap_or(LIVE_CLI);
    std::fs::write(
        &script,
        format!("process.env.LOGIA_CLI_SOCKET = {socket};\n{source}"),
    )
    .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let command = format!("& {} {}", quote(node), quote(&script));
    #[cfg(not(windows))]
    let command = format!("{} {}", quote(node), quote(&script));
    let instructions = format!("# Logia agent workspace\n\nYou are inside the running Logia desktop app. Use this exact command for live note access; it includes the correct runtime and GUI endpoint and does not depend on shell environment variables:\n\n```\n{command} status\n{command} active\n{command} read id=NOTE_ID\n{command} help\n```\n\nCommands include files, search, read, create, append, prepend, write, rename, open, save, and daily:append. Read a note to obtain its revision before a full replacement with ifRevision. For anything longer than a line or two (code, tables, ```artifact or ```mermaid blocks), write the Markdown to a file in this working directory with your file-writing tool, then pass it with `--content-file ./FILE.md`, e.g. `{command} append id=NOTE_ID --content-file ./section.md` or `{command} write id=NOTE_ID ifRevision=REVISION --content-file ./note.md`. Don't put long content inline or use pipes, heredocs or redirects; those need approval and will be denied. Writes go through the GUI and its save queue. Never rewrite Logia note JSON directly. Notes render fenced ```mermaid blocks as diagrams and fenced ```artifact blocks (self-contained HTML/CSS/JS, sandboxed, no network) as live interactive views; to add a diagram or visualizer, append it to the note in one of those fences instead of writing a separate file. After a timeout, read before retrying a write. note-context.md, if present, is a static snapshot; editing it does not update the live note.\n\nIf a command fails, report its actual error. A missing command or a denied socket connection does not mean the Logia app is closed.\n");
    std::fs::write(cwd.join("AGENTS.md"), &instructions).map_err(|e| e.to_string())?;
    Ok(AgentWorkspace {
        script,
        command,
        instructions,
    })
}

pub async fn check_connection(node: &Path, workspace: &AgentWorkspace) -> Result<(), String> {
    let mut command = Command::new(node);
    command
        .arg(&workspace.script)
        .args(["status", "--timeout", "5000"])
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(std::time::Duration::from_secs(6), command.output())
        .await
        .map_err(|_| "The live note connection timed out. Try again.".to_string())?
        .map_err(|e| format!("Could not check the live note connection: {e}"))?;
    let reply: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        format!(
            "The live note tool returned an invalid response: {}",
            String::from_utf8_lossy(&output.stderr)
        )
    })?;
    if output.status.success() && reply["data"]["connected"] == true {
        return Ok(());
    }
    Err(format!(
        "Live note connection unavailable: {}",
        reply["error"]["message"]
            .as_str()
            .unwrap_or("unknown bridge error")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[tokio::test]
    async fn bundled_tool_reaches_the_parent_gui_without_inherited_environment() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let dir = std::env::temp_dir().join(format!(
            "logia-workspace-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let socket = dir.join("gui.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|p| p.join("node"))
            .find(|p| p.is_file())
            .expect("Node.js is required for the live CLI test");
        let workspace = prepare(&dir.join("agent's workspace"), &node, &socket).unwrap();
        assert!(workspace.instructions.contains(&quote(&node)));
        assert!(!workspace.instructions.contains("$LOGIA_CLI_SOCKET"));
        assert!(workspace.instructions.contains("--content-file"));
        // The agent can write inside its cwd, so the pre-approved script must not live there.
        let cwd = std::fs::canonicalize(dir.join("agent's workspace")).unwrap();
        assert!(!workspace.script.starts_with(&cwd));
        assert!(!cwd.join("logia-cli.mjs").exists());
        assert!(workspace.script.is_file());
        let server = tokio::spawn(async move {
            for expected in ["status", "active", "append"] {
                let (stream, _) = listener.accept().await.unwrap();
                let mut stream = BufReader::new(stream);
                let mut line = String::new();
                stream.read_line(&mut line).await.unwrap();
                let request: serde_json::Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["command"], expected);
                let data = if expected == "status" {
                    serde_json::json!({"connected":true})
                } else {
                    serde_json::json!({"id":"active-note","markdown":"Unsaved GUI content"})
                };
                stream
                    .get_mut()
                    .write_all(
                        format!("{}\n", serde_json::json!({"schemaVersion":1,"data":data}))
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        check_connection(&node, &workspace).await.unwrap();
        for command in ["active", "append"] {
            let output = Command::new(&node)
                .arg(&workspace.script)
                .args([command, "content=example"])
                .env_clear()
                .current_dir(&dir)
                .output()
                .await
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("Unsaved GUI content"));
        }
        server.await.unwrap();
        let failure = check_connection(&node, &workspace).await.unwrap_err();
        assert!(failure.contains("Live note connection unavailable"));
        assert!(failure.contains(&socket.to_string_lossy().to_string()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
