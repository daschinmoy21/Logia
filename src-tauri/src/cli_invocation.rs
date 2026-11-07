//! CLI argument construction, shared by chat and its native-boundary tests.
use serde::Deserialize;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionOptions {
    pub(crate) session_id: String,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) access: Option<ChatAccess>,
}

#[derive(Deserialize)]
pub enum ChatAccess {
    #[serde(rename = "read-only")]
    ReadOnly,
    #[serde(rename = "workspace-write")]
    WorkspaceWrite,
    #[serde(rename = "danger-full-access")]
    FullAccess,
}

impl ChatAccess {
    fn as_str(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read-only",
            Self::WorkspaceWrite => "workspace-write",
            Self::FullAccess => "danger-full-access",
        }
    }
}

/// Build the argument list for a tool invocation. `live_cli` is the exact
/// logia-cli command from the agent workspace, when one was prepared.
pub(crate) fn build_args(
    tool: &str,
    model: Option<&str>,
    prompt: &str,
    options: Option<&ChatSessionOptions>,
    live_cli: Option<&str>,
) -> Vec<String> {
    let model = model.map(str::trim).filter(|m| !m.is_empty());
    let mut args: Vec<String> = Vec::new();
    match tool {
        "claude-code" => {
            args.extend(["-p", "--output-format", "text"].map(String::from));
            if let Some(m) = model {
                args.extend(["--model".to_string(), m.to_string()]);
            }
            // Print mode can't ask for approval, so unlisted tools are denied.
            // Pre-approve only the live note command, plus file edits inside the
            // private session directory (acceptEdits is scoped to the cwd), so large
            // content can be staged in a file and passed with --content-file.
            if let Some(command) = live_cli {
                args.extend([
                    "--permission-mode".to_string(),
                    "acceptEdits".to_string(),
                    "--allowedTools".to_string(),
                    format!("Bash({command} *)"),
                ]);
            }
        }
        "codex" => {
            let access = options
                .and_then(|o| o.access.as_ref())
                .map(ChatAccess::as_str)
                .unwrap_or("read-only");
            args.extend(
                [
                    "exec",
                    "--skip-git-repo-check",
                    "--sandbox",
                    access,
                    "--color",
                    "never",
                ]
                .map(String::from),
            );
            if let Some(options) = options {
                args.extend(["-c".to_string(), "approval_policy=\"never\"".to_string()]);
                if let Some(effort) = &options.reasoning_effort {
                    args.extend([
                        "-c".to_string(),
                        format!(
                            "model_reasoning_effort={}",
                            serde_json::to_string(effort).unwrap()
                        ),
                    ]);
                }
            }
            if let Some(m) = model {
                args.extend(["-m".to_string(), m.to_string()]);
            }
            // "-" makes codex read the prompt from stdin
            args.push("-".to_string());
        }
        "grok" => {
            // Tools aren't auto-approved: --always-approve would need its own explicit control.
            args.extend(["--no-auto-update", "--output-format", "plain"].map(String::from));
            if let Some(m) = model {
                args.extend(["-m".to_string(), m.to_string()]);
            }
            args.extend(["-p".to_string(), prompt.to_string()]);
        }
        "opencode" => {
            args.push("run".to_string());
            if let Some(m) = model {
                args.extend(["-m".to_string(), m.to_string()]);
            }
            args.push(prompt.to_string());
        }
        "pi" => {
            args.push("--print".to_string());
            if let Some(m) = model {
                args.extend(["--model".to_string(), m.to_string()]);
            }
            args.push(prompt.to_string());
        }
        "gemini-cli" => {
            if let Some(m) = model {
                args.extend(["-m".to_string(), m.to_string()]);
            }
            args.extend(["-p".to_string(), prompt.to_string()]);
        }
        _ => {}
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_args_per_tool() {
        assert_eq!(
            build_args("claude-code", Some("sonnet"), "hi", None, None),
            vec!["-p", "--output-format", "text", "--model", "sonnet"]
        );
        let codex = build_args("codex", None, "hi", None, None);
        assert_eq!(codex.first().map(String::as_str), Some("exec"));
        assert_eq!(codex.last().map(String::as_str), Some("-"));
        assert!(codex.contains(&"read-only".to_string()));
        assert_eq!(
            build_args("opencode", Some(" "), "hi", None, None),
            vec!["run", "hi"]
        );
        assert_eq!(build_args("gemini-cli", None, "hi", None, None), vec!["-p", "hi"]);
        assert_eq!(
            build_args("grok", Some("chosen-model"), "hi", None, None),
            vec!["--no-auto-update", "--output-format", "plain", "-m", "chosen-model", "-p", "hi"]
        );
        assert!(!build_args("grok", None, "hi", None, None).contains(&"--always-approve".to_string()));
    }

    #[test]
    fn claude_pre_approves_only_the_live_note_command() {
        let cli = "'/bin/node' '/data/s/logia-cli.mjs'";
        let args = build_args("claude-code", Some("sonnet"), "hi", None, Some(cli));
        assert_eq!(
            args,
            vec![
                "-p", "--output-format", "text", "--model", "sonnet",
                "--permission-mode", "acceptEdits",
                "--allowedTools", "Bash('/bin/node' '/data/s/logia-cli.mjs' *)",
            ]
        );
        assert!(!build_args("codex", None, "hi", None, Some(cli)).contains(&"--allowedTools".to_string()));
    }

    #[test]
    fn chat_controls_reach_codex_without_changing_other_providers() {
        let options: ChatSessionOptions = serde_json::from_str(
            r#"{"sessionId":"chat-session","reasoningEffort":"high","access":"workspace-write"}"#,
        )
        .unwrap();
        assert_eq!(options.session_id, "chat-session");
        let args = build_args("codex", Some("chosen-model"), "hi", Some(&options), None);
        assert!(args
            .windows(2)
            .any(|a| a == ["--sandbox", "workspace-write"]));
        assert!(args
            .windows(2)
            .any(|a| a == ["-c", "model_reasoning_effort=\"high\""]));
        assert!(args
            .windows(2)
            .any(|a| a == ["-c", "approval_policy=\"never\""]));
        assert!(args.windows(2).any(|a| a == ["-m", "chosen-model"]));
        assert_eq!(args.last().unwrap(), "-");
        assert_eq!(
            build_args("claude-code", None, "hi", Some(&options), None),
            build_args("claude-code", None, "hi", None, None)
        );
        assert!(serde_json::from_str::<ChatSessionOptions>(
            r#"{"sessionId":"x","access":"anything"}"#
        )
        .is_err());
    }
}
