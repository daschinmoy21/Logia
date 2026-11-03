//! Read-only model discovery. Never sends a prompt or starts an agent turn.
use serde::Serialize;
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::Command,
};

const MAX_OUTPUT: u64 = 2 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CliModel {
    pub id: String,
    pub label: String,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
    #[serde(rename = "reasoningEfforts", skip_serializing_if = "Vec::is_empty")]
    pub reasoning_efforts: Vec<String>,
}

fn parse_text_models(tool: &str, output: &str) -> Vec<CliModel> {
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            let id = match tool {
                "opencode" if fields.len() == 1 && fields[0].contains('/') => fields[0].to_string(),
                "pi" if fields.len() == 6
                    && matches!(fields[4], "yes" | "no")
                    && matches!(fields[5], "yes" | "no") =>
                {
                    format!("{}/{}", fields[0], fields[1])
                }
                _ => return None,
            };
            Some(CliModel {
                label: id.clone(),
                is_default: false,
                reasoning_efforts: Vec::new(),
                id,
            })
        })
        .collect()
}

fn parse_json_models(tool: &str, entries: &[Value]) -> Vec<CliModel> {
    entries
        .iter()
        .filter_map(|entry| {
            let id = if tool == "claude-code" {
                entry["resolvedModel"]
                    .as_str()
                    .or_else(|| entry["value"].as_str())
            } else {
                entry["modelId"].as_str().or_else(|| entry["id"].as_str())
            }?;
            let is_default =
                entry["value"] == "default" || entry["isDefault"].as_bool() == Some(true);
            let label = if tool == "claude-code" && is_default {
                entries
                    .iter()
                    .find(|item| {
                        item["resolvedModel"].as_str() == Some(id) && item["value"] != "default"
                    })
                    .and_then(|item| item["displayName"].as_str())
                    .unwrap_or(id)
            } else {
                entry["displayName"]
                    .as_str()
                    .or_else(|| entry["name"].as_str())
                    .unwrap_or(id)
            };
            Some(CliModel {
                id: id.into(),
                label: label.into(),
                is_default,
                reasoning_efforts: Vec::new(),
            })
        })
        .collect()
}

async fn response(
    reader: &mut (impl tokio::io::AsyncBufRead + Unpin),
    id: u64,
) -> Result<Value, String> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("The CLI closed before returning its model list.".into());
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value["id"].as_u64() != Some(id) {
            continue;
        }
        if value.get("error").is_some() {
            return Err(
                "The CLI could not list models. Try updating it or enter a model ID.".into(),
            );
        }
        return value
            .get("result")
            .cloned()
            .ok_or_else(|| "Invalid model-list response.".into());
    }
}

pub async fn discover(
    tool: &str,
    executable: &Path,
    path: &OsString,
    cwd: &Path,
) -> Result<Vec<CliModel>, String> {
    let args: &[&str] = match tool {
        "codex" => &["app-server"],
        "opencode" => &["models"],
        "pi" => &["--list-models"],
        "gemini-cli" => &["--list-models", "--output-format", "json"],
        "claude-code" => &[
            "--print",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--no-session-persistence",
            "--strict-mcp-config",
            "--mcp-config",
            "{\"mcpServers\":{}}",
            "--tools",
            "",
        ],
        _ => return Err("This CLI does not expose a supported model catalog.".into()),
    };
    let mut command = Command::new(executable);
    command
        .args(args)
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Couldn't query CLI models: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("CLI input unavailable")?;
    let stdout = child.stdout.take().ok_or("CLI output unavailable")?;
    let query = async {
        if tool == "claude-code" {
            let request = json!({"type":"control_request","request_id":"logia-models","request":{"subtype":"initialize"}});
            stdin
                .write_all(format!("{request}\n").as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            let mut reader = BufReader::new(stdout.take(MAX_OUTPUT));
            let mut line = String::new();
            loop {
                line.clear();
                if reader
                    .read_line(&mut line)
                    .await
                    .map_err(|e| e.to_string())?
                    == 0
                {
                    return Err("Claude Code closed before returning its model catalog.".into());
                }
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if value["type"] != "control_response"
                    || value["response"]["request_id"] != "logia-models"
                {
                    continue;
                }
                if value["response"]["subtype"] == "error" {
                    return Err(
                        "Claude Code could not load models. Check its sign-in and try again."
                            .into(),
                    );
                }
                let entries = value["response"]["response"]["models"].as_array().ok_or(
                    "Claude Code did not return a model catalog. Update the CLI and try again.",
                )?;
                return Ok(parse_json_models("claude-code", entries));
            }
        }
        if tool != "codex" {
            drop(stdin);
            let mut output = String::new();
            stdout
                .take(MAX_OUTPUT)
                .read_to_string(&mut output)
                .await
                .map_err(|e| e.to_string())?;
            if output.len() as u64 >= MAX_OUTPUT {
                return Err("Model list is too large.".into());
            }
            if !child.wait().await.map_err(|e| e.to_string())?.success() {
                return Err("Couldn't list models. Check the CLI's setup and try again.".into());
            }
            if tool == "gemini-cli" {
                let value: Value = serde_json::from_str(&output).map_err(|_| {
                    "Gemini CLI did not return a JSON model catalog. Update the CLI and try again."
                })?;
                return Ok(parse_json_models(
                    "gemini-cli",
                    value.as_array().ok_or("Invalid Gemini model catalog")?,
                ));
            }
            return Ok(parse_text_models(tool, &output));
        }
        let mut reader = BufReader::new(stdout.take(MAX_OUTPUT));
        let init = json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"logia","version":"0.10.0"}}});
        stdin
            .write_all(format!("{init}\n").as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        response(&mut reader, 0).await?;
        stdin
            .write_all(b"{\"method\":\"initialized\"}\n")
            .await
            .map_err(|e| e.to_string())?;
        let mut models = Vec::new();
        let mut cursor = Value::Null;
        for id in 1..=20 {
            let request =
                json!({"id":id,"method":"model/list","params":{"limit":100,"cursor":cursor}});
            stdin
                .write_all(format!("{request}\n").as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            let result = response(&mut reader, id).await?;
            for model in result["data"].as_array().ok_or("Invalid model list")? {
                if model["hidden"].as_bool() == Some(true) {
                    continue;
                }
                if let Some(id) = model["model"].as_str() {
                    models.push(CliModel {
                        id: id.into(),
                        label: model["displayName"].as_str().unwrap_or(id).into(),
                        is_default: model["isDefault"].as_bool().unwrap_or(false),
                        reasoning_efforts: model["supportedReasoningEfforts"].as_array().map(|efforts| efforts.iter().filter_map(|e| e["reasoningEffort"].as_str().map(String::from)).collect()).unwrap_or_default(),
                    });
                }
            }
            cursor = result["nextCursor"].clone();
            if cursor.is_null() {
                return Ok(models);
            }
        }
        Err::<Vec<CliModel>, String>("The CLI returned too many model pages.".into())
    };
    let result = tokio::time::timeout(Duration::from_secs(20), query)
        .await
        .map_err(|_| "Model discovery timed out. Enter a model ID or try again.".to_string());
    let _ = child.kill().await;
    let _ = child.wait().await;
    let models = result??;
    // Preserve the CLI's catalog ordering and merge alias/default metadata.
    let mut indices = std::collections::HashMap::<String, usize>::new();
    let mut unique = Vec::<CliModel>::new();
    for model in models {
        if let Some(index) = indices.get(&model.id) {
            unique[*index].is_default |= model.is_default;
        } else {
            indices.insert(model.id.clone(), unique.len());
            unique.push(model);
        }
    }
    let models = unique;
    if models.is_empty() {
        return Err("The CLI returned no models. Check its sign-in or enter a model ID.".into());
    }
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_catalogs_without_accepting_headers_or_warnings() {
        assert_eq!(
            parse_text_models("opencode", "warning: update available\nprovider/model\n"),
            vec![CliModel {
                id: "provider/model".into(),
                label: "provider/model".into(),
                is_default: false,
                reasoning_efforts: Vec::new(),
            }]
        );
        assert_eq!(parse_text_models("pi", "provider model context max-out thinking images\nanthropic claude-example 200K 32K yes yes\n")[0].id, "anthropic/claude-example");
        assert!(parse_text_models("pi", "No models available").is_empty());
    }

    #[test]
    fn reads_live_claude_and_gemini_catalog_metadata() {
        let claude = json!([
            {"value":"default","resolvedModel":"fresh-claude","displayName":"Default (recommended)"},
            {"value":"opus","resolvedModel":"fresh-claude","displayName":"Live Claude name"},
            {"value":"new-capability","resolvedModel":"brand-new-id","displayName":"Brand new model"}
        ]);
        let models = parse_json_models("claude-code", claude.as_array().unwrap());
        assert_eq!(models[0].id, "fresh-claude");
        assert_eq!(models[0].label, "Live Claude name");
        assert!(models[0].is_default);
        assert_eq!(models[2].id, "brand-new-id");
        let gemini = json!([{"modelId":"fresh-gemini","displayName":"Live Gemini name"}]);
        assert_eq!(
            parse_json_models("gemini-cli", gemini.as_array().unwrap())[0].id,
            "fresh-gemini"
        );
    }

    #[tokio::test]
    async fn rpc_ignores_notifications_and_surfaces_errors() {
        let input = b"{\"method\":\"status\"}\n{\"id\":1,\"result\":{\"data\":[]}}\n";
        assert_eq!(
            response(&mut &input[..], 1).await.unwrap()["data"],
            json!([])
        );
        assert!(response(&mut &b"{\"id\":1,\"error\":{}}\n"[..], 1)
            .await
            .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn discovers_codex_pages_without_starting_a_turn() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "logia-models-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let executable = dir.join("codex");
        std::fs::write(&executable, r##"#!/bin/sh
test "$1" = app-server || exit 1
read -r init
printf '%s\n' '{"id":0,"result":{}}'
read -r initialized
read -r first
printf '%s\n' '{"id":1,"result":{"data":[{"model":"one","displayName":"First","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}]},{"model":"hidden","hidden":true}],"nextCursor":"next"}}'
read -r second
case "$second" in *next*) ;; *) exit 1;; esac
printf '%s\n' '{"id":2,"result":{"data":[{"model":"two","displayName":"Second"}],"nextCursor":null}}'
read -r unexpected && exit 1
"##).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let result = discover(
            "codex",
            &executable,
            &std::env::var_os("PATH").unwrap_or_default(),
            &dir,
        )
        .await;
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            result.unwrap(),
            vec![
                CliModel {
                    id: "one".into(),
                    label: "First".into(),
                    is_default: false,
                    reasoning_efforts: vec!["low".into(), "high".into()],
                },
                CliModel {
                    id: "two".into(),
                    label: "Second".into(),
                    is_default: false,
                    reasoning_efforts: Vec::new(),
                }
            ]
        );
    }
}
