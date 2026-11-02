# Interactive agents in Logia

The AI sidebar offers built-in Logia chat and interactive terminals for installed Codex, Claude Code, Pi, and OpenCode executables. API chat remains available through the existing provider settings. The terminal runs on the machine hosting the desktop application; a browser preview cannot launch processes.

A launch requires a click. Selecting an agent does not start it or sign in. Detection checks the executable path, not account status. **Installed** means the executable was found; it does not claim that authentication succeeded. Overrides come from Settings → AI. Logia spawns the executable directly with fixed arguments, without evaluating shell commands or automatically installing packages.

## Authentication

Credentials remain managed by the selected CLI. Logia does not read its auth files, receive OAuth tokens, or reuse subscription credentials as API keys. Login is an interactive terminal session:

| Agent | Sign-in action |
| --- | --- |
| Codex | `codex login --device-auth`; follow the printed link and enter its device code |
| Claude Code | `claude auth login`; complete the provider’s browser flow |
| OpenCode | `opencode auth login`; choose a supported provider and authentication method |
| Pi | Launch `pi`, then enter `/login` and choose a provider |

Availability of subscription login depends on the provider, account, CLI version, and policies. After a login command exits, start a normal session. A zero exit code reports that the process exited successfully, not a separately verified account status. Agent model selection, permissions, reasoning, and tool approvals remain native CLI controls.

References: [Codex authentication](https://developers.openai.com/codex/auth/), [Claude Code authentication](https://code.claude.com/docs/en/authentication), [OpenCode CLI](https://opencode.ai/docs/cli/), [Pi usage](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md).

## Workspace and context

Each session starts in a new private directory beneath the desktop app’s data directory, `agent-sessions/<session-id>`. Attaching the current text note explicitly copies a Markdown snapshot to `note-context.md`. The snapshot is best effort, capped at 1 MiB, and is separate from the live editor. Use the filename in a prompt to ask the agent to read it. Attachments are not copied, and canvas snapshots are not converted to Markdown.

This folder chooses the initial working directory; it is **not an OS sandbox**. Each CLI retains the user’s normal filesystem access and its own permission/trust settings. Logia does not enable approval bypass flags. CLI settings, extensions, and saved sessions still apply. The scratch directory and any files written there remain on disk after Stop, including an attached snapshot. Remove them when no longer needed. Terminal scrollback is held in memory by Logia, while the CLI may persist its own history.

Agents can read and edit live notes through `logia-cli`, which routes commands to the running GUI. Sessions receive a generated `AGENTS.md`, the GUI endpoint in `LOGIA_CLI_SOCKET`, and a bundled script location where available. Use `logia-cli help` or `node "$LOGIA_CLI_SCRIPT" help`. See [the GUI/CLI interface](agent-interface.md). There is no ACP client or structured tool-call UI. `logia-agent` remains the offline read-only reader/exporter.

## Keyboard and lifecycle

The Logia composer’s Vim mode is separate from the note editor’s mode. Ctrl+H/L moves left/right across the file tree, editor, and AI panel. Ctrl+J/K cycles to the next/previous pane, including from a terminal, and works with Vim disabled. The tree supports arrows and Enter. These four shortcuts are reserved by Logia; terminal focus passes other keys to the agent, including Escape, Ctrl+C, and the CLI’s own Vim support. Ctrl+Shift+P opens commands; Ctrl+P switches notes outside the terminal. The composer provides editable drafts before sending text to the terminal; avoid sending prompts while a login or permission question expects a different response.

Output travels as raw bytes through a Tauri IPC channel into xterm.js. Keeping the byte stream preserves split UTF-8 characters and terminal escape sequences. Resizing the pane updates PTY dimensions. Up to four sessions may run concurrently. Stop terminates the session; application exit closes all owned sessions. On Unix, termination kills the PTY’s process group; detached processes outside that group are not managed by Logia.

## Validation

Run these from the development shell:

```sh
bun run check
bun run test:browser
cargo test --manifest-path src-tauri/terminal-tests/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

The independent Rust harness exercises the same PTY implementation without GTK, a display server, a real provider account, or paid agent runs. Browser tests cover UI keyboard behavior and a deterministic IPC fixture; that fixture is not an OAuth or provider integration test. Real authentication and native GUI rendering require a desktop smoke test.
