<div align="center">
  <img src="public/logo.png" alt="Logia Logo" width="120" />
  <h1>Logia</h1>
</div>

> A powerful, AI-enhanced notes application built with Tauri and React, designed for technical content creators and knowledge workers.

Logia blends structured text editing with infinite visual canvases, ensuring your ideas are captured exactly how you envision them. With local-first performance and optional cloud capabilities, it is the perfect companion for your second brain.

## Features

- **AI-Powered Assistance**: Chat with your notes and edit them with AI using the provider you prefer — Google Gemini, OpenAI, Anthropic Claude, OpenRouter, Groq, DeepSeek, Mistral, local models (Ollama, LM Studio, any OpenAI-compatible server), or the coding-agent CLIs you already have installed (Claude Code, Codex, OpenCode, Gemini CLI).
- **Vim Mode**: Optional modal editing in notes (motions, operators, text objects, visual mode, search, registers) plus keyboard navigation for the whole app — a leader key, a `:` command line and a file explorer.
- **Auto-hide Sidebar**: Pin the sidebar, or let it slide in when the pointer reaches the left edge (`Ctrl/⌘+\` to toggle).
- **UI Scaling**: Use `Ctrl/⌘` + `+` or `−` to resize the interface, and `Ctrl/⌘+0` to reset. Your scale is saved; controls are also in Settings → Editor & Vim.
- **Rich Text Editing**: Full-featured editor with BlockNote for structured content creation.
- **Visual Note-Taking**: Integrated **tldraw** canvas for infinite sketching, diagrams, and whiteboarding.
- **Audio Recording & Transcription**: Record and transcribe audio content directly in your notes.
- **File Management**: Hierarchical file tree with drag-and-drop organization.
- **Trash & Recovery**: Safely delete notes and folders with a 14-day recovery window.
- **Git Sync**: Optional git-based synchronization — connect any git remote to backup and sync your notes.
- **Search & Discovery**: Fast, fuzzy search across all your notes.
- **Kanban Boards**: Organize your tasks and workflows with visual boards.
- **Cross-Platform**: Native desktop app for Windows, macOS, and Linux.
- **Markdown Support**: Full markdown rendering with GitHub Flavored Markdown.

## AI providers

Open **Settings → AI providers → Add provider** to add a CLI agent, cloud API, or local server. The provider list shows your configured providers and detected CLIs; select one to edit its setup. API keys are stored encrypted in your OS keychain. You can switch providers and models directly in the chat composer, or use `:provider <id>` in Vim mode.

The model dropdown opens next to the composer, with live models grouped by provider, search, favorites, refresh, and locally bundled provider logos. Selecting a model applies it and closes the dropdown. Codex uses `app-server` → `model/list`; Claude Code uses its initialization catalog; OpenCode uses `models`; Pi uses `--list-models`; Gemini CLI uses its JSON model listing. Cloud and local API providers query their model-list endpoints, including pagination. No static model suggestions are shown when discovery fails. Custom IDs remain available as an explicit option.

Terminal sessions use the model chosen before starting; use the CLI's `/model` command (`/models` in OpenCode) to change it within a running session. API providers without an explicit selection use a default reported by the live catalog, or its first returned model.

Choosing an agent opens a chat transcript with a ready-to-use composer. **New session** immediately clears the conversation and focuses the input. Model selection and note attachment are in the composer; Codex also exposes reasoning efforts reported by its live catalog and an access selector (read-only by default). Follow-ups share a scratch workspace and include the conversation history. The terminal icon opens the CLI for sign-in or direct terminal use.

The active text note, including unsaved edits, is included with each agent message by default; the “Current note” chip shows what is shared and lets you leave it out. Sessions include a local copy of the live-note CLI with an explicit runtime and GUI endpoint, so packaged installs do not rely on the agent shell preserving environment variables. The app checks the live connection before starting an agent turn and reports connection failures directly.

| Kind | Providers | Notes |
| --- | --- | --- |
| Cloud APIs | Google Gemini, OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, Mistral | Need an API key |
| Local | Ollama, LM Studio, custom OpenAI-compatible URL | No key needed; runs offline |
| CLI agents | Claude Code (`claude`), Codex (`codex`), OpenCode (`opencode`), Gemini CLI (`gemini`) | Uses your existing CLI login/subscription. Logia runs them non-interactively in a scratch folder (Codex in its read-only sandbox) |

CLI agents power chat and transcript structuring; the inline `/ai` editor menu needs an HTTP provider.

## Vim mode

Turn it on in **Settings → Editor & Vim** or with the `VIM` badge in the header. The badge then shows the current mode; click it for the full cheat sheet.

- **Editor:** `hjkl`, `w b e`, `0 ^ $`, `gg G`, `f t ; ,`, `x r ~ J`, `d c y` + motion / text object (`dw`, `ciw`, `di"`), `dd yy cc p P`, `v V`, `>> <<`, `u` / `Ctrl-r`, `/ ? n N *`, counts.
- **Leader (`Space`):** `e` explorer, `f` find note, `a` AI chat, `n` new note, `c` new canvas, `b` pin/auto-hide sidebar, `t` to-do board, `h` home, `s` settings.
- **Explorer:** `j k` move, `l`/`Enter` open or expand, `h` collapse, `a`/`A` new note/folder, `r` rename, `d` delete, `s` star, `Esc` back to the editor.
- **Command line:** `:w`, `:q`, `:wq`, `:e <note>`, `:new`, `:canvas`, `:ai <prompt>`, `:provider <id>`, `:set novim`, `:help`.

## Installation

### Prerequisites

- [Bun](https://bun.com/)
- [Rust](https://rustup.rs/) (latest stable)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/daschinmoy21/Logia.git
   cd logia
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Run in development mode:

   ```bash
   bun run tauri dev
   ```

4. Build for production:

   ```bash
   bun tauri build
   ```

   > **Note for Linux Users**: There is a known issue with linuxdeploy in Tauri which may cause build errors with AppImage creation. usage:
>
   > ```bash
   > NO_STRIP=true bun tauri build
   > ```

### NixOS / Nix Installation

Logia is available as a Nix flake for easy installation on NixOS or any system with Nix.

**Run without installing:**

```bash
nix run github:daschinmoy21/Logia
```

**Install to user profile:**

```bash
nix profile install github:daschinmoy21/Logia
```

**Add to NixOS configuration:**

1. Add to your flake inputs:

   ```nix
   inputs.logia = {
     url = "github:daschinmoy21/Logia";
     inputs.nixpkgs.follows = "nixpkgs";
   };
   ```

2. Pass it through `specialArgs` and use in your config:

   ```nix
   environment.systemPackages = [
     logia.packages.${pkgs.system}.default
   ];
   ```

#### Git Sync

Logia uses git for note synchronization. To enable sync:

1. Create a private git repository (GitHub, GitLab, etc.)
2. Open Logia Settings → Git Sync
3. Enter your remote URL (e.g., `git@github.com:user/logia-notes.git`) and branch name
4. Click **Connect Remote**
5. Use **Sync Now** to push/pull changes

**Authentication**: Logia uses your system's git credentials — SSH keys, `gh auth`, or git credential helper. No cloud OAuth tokens are stored.

**Pinned development environments:**

```bash
nix develop                  # Desktop: Rust, GTK/WebKit on Linux, Bun/Node, Git, audio tools
nix develop .#frontend       # Frontend + agent CLI only; no native GUI or ML dependencies
nix develop .#audio          # Linux desktop plus the faster-whisper Python environment
nix develop .#browser        # Linux browser tests with a packaged Chromium
bun install --frozen-lockfile
bun run tauri dev            # Native desktop application
```

The committed `flake.lock` pins the toolchain. Enable `nix-command` and `flakes` in your Nix configuration, or invoke `nix --extra-experimental-features 'nix-command flakes' develop .#frontend`. Optional direnv support is included in `.envrc`; run `direnv allow` yourself if you use it. Entering a shell does not install npm or Python dependencies automatically or alter your desktop session variables.

For browser development on this shared host, use a free port in your own range:

```bash
bun run dev --host 127.0.0.1 --port 3420
```

The browser uses a separate localStorage workspace. It cannot access native desktop notes, Git sync, trash, audio capture, or system credentials. The desktop remains the primary application. Tauri desktop development still uses its configured port 1420; to run it on a host with an assigned port range, override both Vite's port and Tauri's `build.devUrl` together.

```bash
bun run check
bun run test:unit
bun run test:agent
nix develop .#browser --command bun run test:browser
bun run build
```

### Workspace and agent tools

The home screen offers note previews, tag discovery, type/star filters, sorting, daily notes, and Markdown import. Use `Ctrl/Cmd+P` to find notes and `Ctrl/Cmd+Shift+P` for commands; `Alt+P` remains available. `Ctrl/Cmd+N` creates a note and `Ctrl/Cmd+Shift+N` a folder, inside the folder selected in the tree. The note context panel provides headings, tags, outgoing wikilinks, and backlinks. Markdown import copies selected files; YAML is preserved visibly, while vault attachments, folder layouts, and community plugins are not imported.

The GUI owns live note state. Agents use the separate CLI to read unsaved content and apply edits through the running app, following Obsidian’s GUI/CLI split:

```bash
nix run .#cli -- help
logia-cli read
logia-cli search query="meeting notes"
logia-cli create path="Projects/Plan.md" content="# Plan" open
logia-cli append file="Plan" content="- [ ] Review"
# Full replacement requires the revision returned by read:
logia-cli write id=NOTE_ID ifRevision=REVISION --stdin < updated.md
```

`nix develop .#frontend` adds `logia-cli` to PATH. The standalone source client is `node scripts/logia-cli.mjs`. The desktop must be running; `--launch` can start an installed `logia`. Embedded agents receive CLI instructions and the parent GUI endpoint automatically. The GUI applies changes live and rejects stale replacements. There is no TCP server.

Agents can also read/search/link notes and create portable snapshots without starting the app using the separate offline CLI:

```bash
nix run .#agent -- --help  # No bun install needed for the read-only CLI
bun run agent --data-dir "$HOME/Documents/Logia" search '#research'
bun run agent --data-dir "$HOME/Documents/Logia" export --output /tmp/logia-snapshot
```

See the [agent interface](docs/agent-interface.md) for the versioned JSON contract and export limits. The [runtime and compatibility decision](docs/architecture-and-compatibility.md) assesses Tauri + CEF, GPUI, and the work required for Obsidian plugin support. Logia does not currently execute Obsidian plugins.

## Usage

- **Creating Notes**: Use the file tree sidebar to create new notes or organize existing ones.
- **AI Assistance**: Access AI features through the AI sidebar for content generation and editing.
- **Drawing**: Click the drawing tool to open the infinite canvas for visual notes.
- **Recording**: Use the recording feature to capture audio and automatically transcribe it.
- **Search**: Press `Alt+P` or `Meta/Cmd+P` (Mac) to open the command palette and search across all content.
- **Sync**: Configure a git remote in Settings and use Sync Now to push/pull your notes.

## Configuration

### Google AI API Key

Logia uses Google Generative AI for intelligent note generation and editing. To enable AI features:

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Open Logia and go to **Settings**
3. Enter your API key under the **Google AI** section
4. The key is stored securely via the system keyring / encrypted config — no `.env` files needed

> **Note**: Logia no longer requires Google OAuth. Only an API key is needed.

### Security / AI Keys

Logia uses a **Bring Your Own Key (BYOK)** model. The API key is stored in the OS keyring (Windows Credential Manager, macOS Keychain, Linux Secret Service) with an encrypted config file fallback — managed entirely in Rust. The key only enters the webview process when an AI feature is actively used (chat, slash-menu generation, or transcription structuring). Treat the machine as trusted; a full request-proxy through the Rust backend is a future hardening step.

### Git Sync

1. Create a **private** git repository (GitHub, GitLab, etc.)
2. Open Logia → **Settings** → **Git Sync**
3. Paste your remote URL (e.g., `git@github.com:user/logia-notes.git`) and branch name
4. Click **Connect Remote**, then use **Sync Now** to push/pull changes

**Authentication**: Logia uses your system's git credentials — SSH keys, `gh auth`, or git credential helper. No OAuth tokens are stored.

### Optional Dependencies

- **git** — required for Git Sync
- **Python 3.12+** and **FFmpeg** — required for audio transcription (the preflight check surfaces missing dependencies on first run)

## Development

### Project Structure

- `src/` - React frontend application
- `src-tauri/` - Tauri backend and Rust code
- `src/components/` - Reusable UI components
- `src/store/` - State management with Zustand

### Available Scripts

- `bun run dev` - Start the Vite development server
- `bun run build` - Build the frontend for production
- `bun run tauri dev` - Start Tauri development mode
- `bun run tauri build` - Build the native application

### Updating Frontend for Nix Builds

The `dist/` folder is committed to the repository for reproducible Nix builds. When you make frontend changes, you must rebuild and commit the dist folder:

```bash
# Enter dev shell (if on NixOS)
nix develop

# Make your frontend changes...

# Rebuild the frontend
bun run build

# Commit the updated dist
git add dist/
git commit -m "Update frontend build"
git push
```

> **Note**: This is required because Nix builds are sandboxed and cannot access the network to run `bun install`. Pre-building ensures reproducible builds for all users.

## Android

Android builds use the `android` dev shell (`nix develop .#android`). See
[docs/android.md](docs/android.md) for building the APK, running it on the
emulator and installing it on a phone.

## Packaging and Dependencies (Windows)

When distributing the Windows installer, include this checklist so users have the required runtime components for audio capture and transcription to work.

Required on target machine (or bundled in installer):

- Microsoft Visual C++ Redistributable (Visual Studio C++ 2015-2022 runtime)
- FFmpeg available on PATH (required by some audio libs and optional features)
- Python 3.12+ (if not bundling a portable Python)
  - pip available
  - If your installer does not bundle Python, the app will attempt to create a virtual environment and install dependencies at first run.
- Internet access for pip installs (unless you bundle prebuilt wheels)

Optional but recommended:

- Code-sign the EXE/MSI to avoid SmartScreen/AV false positives

Packaging tips:

- You can bundle a portable Python and a pre-created venv inside your installer to avoid first-run installs (tradeoff: larger installer size).
- Run installer tests on a clean Windows VM to reproduce missing-dependency issues.

## Using the preflight check

The app exposes a Tauri command `prereflight_check` that returns JSON with diagnostics (python presence, ffmpeg, VC++ runtime, network, resource paths). The UI can call this command at first run to show actionable errors to users.

## Contributing

DO NOT MAKE SPAM PRs.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](LICENSE) file for details.

### Agent panel

Open the AI sidebar and choose **Codex**, **Claude Code**, **Pi**, **OpenCode**, or **Grok Build**. External agents run interactively in the desktop app’s embedded terminal. Install the CLI separately, refresh detection, and set a custom executable in Settings → AI if needed. **Sign in** launches the CLI’s own login flow; Logia does not import subscription credentials into its API providers. Pi uses `/login` inside its terminal.

Use Ctrl+H/L to focus the pane to the left/right and Ctrl+J/K to cycle between file tree, editor, and AI; this works with Vim off and inside the terminal. Ctrl+Shift+P opens commands. The agent composer has an independent Vim toggle and NORMAL/INSERT indicator. Terminal input keeps the CLI’s own keybindings. See [agent terminal details](docs/agent-terminal.md) for scope and authentication behavior.
