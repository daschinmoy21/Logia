//! PTY lifecycle independent of the webview so it can be exercised without a GUI.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Write},
    sync::Mutex,
};

pub struct TerminalProcess {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    lifecycle: Mutex<(Option<Box<dyn Child + Send + Sync>>, Option<u32>)>,
}

pub struct StartedTerminal {
    pub process: TerminalProcess,
    pub reader: Box<dyn Read + Send>,
}

pub fn launch_spec(tool: &str, login: bool) -> Result<(&'static str, Vec<&'static str>), String> {
    let (binary, args) = match (tool, login) {
        ("codex", true) => ("codex", vec!["login", "--device-auth"]),
        ("claude-code", true) => ("claude", vec!["auth", "login"]),
        ("opencode", true) => ("opencode", vec!["auth", "login"]),
        ("codex", false) => ("codex", vec![]),
        ("claude-code", false) => ("claude", vec![]),
        ("opencode", false) => ("opencode", vec![]),
        ("pi", _) => ("pi", vec![]), // /login is interactive; no injected keystrokes.
        _ => return Err("Unknown agent. Choose Codex, Claude Code, Pi, or OpenCode.".into()),
    };
    Ok((binary, args))
}

pub fn launch_args(tool: &str, login: bool, model: Option<&str>) -> Result<Vec<String>, String> {
    let (_, args) = launch_spec(tool, login)?;
    let mut args: Vec<String> = args.into_iter().map(String::from).collect();
    if !login {
        if let Some(model) = model.map(str::trim).filter(|m| !m.is_empty()) {
            args.extend(["--model".to_string(), model.to_string()]);
        }
    }
    Ok(args)
}

pub fn pty_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
        return Err("Terminal size must be 2–500 columns and 1–300 rows".into());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

pub fn spawn(command: CommandBuilder, cols: u16, rows: u16) -> Result<StartedTerminal, String> {
    let pair = native_pty_system()
        .openpty(pty_size(cols, rows)?)
        .map_err(|e| e.to_string())?;
    // Prepare IO before spawning; failures cannot leave an unowned process behind.
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    Ok(StartedTerminal {
        process: TerminalProcess {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            lifecycle: Mutex::new((Some(child), None)),
        },
        reader,
    })
}

impl TerminalProcess {
    pub fn write(&self, data: &str) -> Result<(), String> {
        if data.len() > 64 * 1024 {
            return Err("Terminal input exceeds 64 KiB".into());
        }
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "Terminal input unavailable")?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    }
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|_| "Terminal unavailable")?
            .resize(pty_size(cols, rows)?)
            .map_err(|e| e.to_string())
    }
    pub fn close(&self) {
        if let Ok(mut lifecycle) = self.lifecycle.lock() {
            if let Some(child) = lifecycle.0.as_mut() {
                // The child has not been reaped while holding this lock, so its PID
                // cannot have been reused. portable-pty creates a new Unix session.
                #[cfg(unix)]
                if let Some(pid) = child.process_id() {
                    unsafe {
                        libc::kill(-(pid as i32), libc::SIGKILL);
                    }
                }
                let _ = child.kill();
                lifecycle.1 = Some(child.wait().map(|s| s.exit_code()).unwrap_or(1));
                lifecycle.0 = None;
            }
        }
    }
    pub fn try_wait(&self) -> Result<Option<u32>, String> {
        let mut lifecycle = self.lifecycle.lock().map_err(|_| "Terminal unavailable")?;
        if let Some(code) = lifecycle.1 {
            return Ok(Some(code));
        }
        if let Some(child) = lifecycle.0.as_mut() {
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                lifecycle.1 = Some(status.exit_code());
                lifecycle.0 = None;
            }
        }
        Ok(lifecycle.1)
    }
}

impl Drop for TerminalProcess {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_dimensions() {
        assert!(pty_size(0, 24).is_err());
        assert!(pty_size(80, 0).is_err());
        assert!(pty_size(501, 24).is_err());
        assert!(pty_size(80, 301).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn interactive_roundtrip_resize_and_exit() {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args([
            "-c",
            "stty -echo; printf 'READY\\n'; read line; stty size; printf 'reply:%s\\n' \"$line\"",
        ]);
        let StartedTerminal {
            process,
            mut reader,
        } = spawn(cmd, 80, 24).unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut output = Vec::new();
            let mut bytes = [0; 1024];
            loop {
                match reader.read(&mut bytes) {
                    Ok(0) => break,
                    Ok(n) => {
                        output.extend_from_slice(&bytes[..n]);
                        let _ = tx.send(String::from_utf8_lossy(&output).to_string());
                    }
                    Err(_) => break,
                }
            }
        });
        let deadline = std::time::Duration::from_secs(5);
        loop {
            if rx.recv_timeout(deadline).unwrap().contains("READY") {
                break;
            }
        }
        process.resize(100, 32).unwrap();
        process.write("hello π\n").unwrap();
        let mut got_reply = false;
        while let Ok(output) = rx.recv_timeout(deadline) {
            if output.contains("reply:hello π") {
                assert!(output.contains("32 100"), "{output}");
                got_reply = true;
                break;
            }
        }
        assert!(got_reply);
        loop {
            if let Some(code) = process.try_wait().unwrap() {
                assert_eq!(code, 0);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[cfg(unix)]
    #[test]
    fn close_terminates_child() {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "exec sleep 60"]);
        let StartedTerminal { process, .. } = spawn(cmd, 80, 24).unwrap();
        process.close();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if process.try_wait().unwrap().is_some() {
                break;
            }
            assert!(std::time::Instant::now() < deadline, "child survived close");
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[cfg(unix)]
    #[test]
    fn close_unblocks_pending_terminal_input() {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "trap '' HUP; printf READY; exec sleep 60"]);
        let StartedTerminal {
            process,
            mut reader,
        } = spawn(cmd, 80, 24).unwrap();
        let process = std::sync::Arc::new(process);
        let mut ready = [0; 5];
        reader.read_exact(&mut ready).unwrap();
        assert_eq!(&ready, b"READY");
        assert!(process.write(&"x".repeat(64 * 1024 + 1)).is_err());
        let writer = process.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(writer.write(&"x".repeat(64 * 1024)));
        });
        std::thread::sleep(std::time::Duration::from_millis(30));
        process.close();
        let _ = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("input stayed blocked after Stop");
        assert!(process.try_wait().unwrap().is_some());
    }
    #[test]
    fn launch_commands_are_allowlisted_and_login_is_explicit() {
        assert_eq!(
            launch_spec("codex", true).unwrap().1,
            ["login", "--device-auth"]
        );
        assert_eq!(
            launch_spec("claude-code", true).unwrap().1,
            ["auth", "login"]
        );
        assert_eq!(launch_spec("opencode", true).unwrap().1, ["auth", "login"]);
        for tool in ["codex", "claude-code", "pi", "opencode"] {
            assert!(launch_spec(tool, false).unwrap().1.is_empty());
        }
        assert!(launch_spec("sh", false).is_err());
        assert!(launch_spec("codex; touch /tmp/nope", false).is_err());
    }

    #[test]
    fn selected_model_is_an_argument_and_never_changes_login() {
        for tool in ["codex", "claude-code", "pi", "opencode"] {
            assert_eq!(launch_args(tool, false, Some(" provider/model ")).unwrap(), ["--model", "provider/model"]);
            assert_eq!(launch_args(tool, false, Some(" ")).unwrap(), Vec::<String>::new());
            assert!(!launch_args(tool, true, Some("custom-model")).unwrap().contains(&"custom-model".into()));
        }
        assert!(launch_args("sh", false, Some("x")).is_err());
    }
}
