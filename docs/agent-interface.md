# Logia GUI and CLI for agents

Logia follows the [official Obsidian CLI](https://obsidian.md/help/cli) model: the desktop GUI owns the workspace, and a separate CLI sends commands to that running app. Reads include current in-memory edits; writes go through the editor and its persistence queue. A separate offline reader/exporter remains available when the GUI is closed.

## Live commands: logia-cli

```sh
nix run .#cli -- help                 # Standalone client; no bun install
nix develop .#frontend                # Includes logia-cli on PATH
logia-cli status
logia-cli active
logia-cli files
logia-cli search query="meeting notes" limit=20
logia-cli read                        # Active note, including unsaved edits
logia-cli read file="Project plan"
logia-cli read path="Projects/Plan.md" --format markdown
logia-cli create path="Projects/Plan.md" content="# Plan\n\nNext steps" open
logia-cli append file="Plan" content="- [ ] Review"
logia-cli prepend id=NOTE_ID content="New introduction"
logia-cli rename id=NOTE_ID name="Updated plan"
logia-cli open id=NOTE_ID
logia-cli daily
logia-cli daily:read
logia-cli daily:append content="- [ ] Follow up"
logia-cli links id=NOTE_ID
logia-cli backlinks id=NOTE_ID
logia-cli tags
logia-cli save id=NOTE_ID
```

The app must be open and its notes loaded. `--launch` can start the installed `logia` executable (or `LOGIA_APP_BINARY`) and wait for readiness. The CLI never silently falls back to filesystem edits. Run the source client with `node scripts/logia-cli.mjs`; it uses only Node built-ins and runs on Node 18+. The Nix client pins Node 24. This is a command client, without Obsidian’s interactive TUI or arbitrary JavaScript evaluation.

Parameters use `key=value` or `--key value`. Quote values containing spaces. Boolean flags include `open` and `silent` on create. Create is silent by default; `open` selects the new note. `id` selects a stable note ID; `file` resolves titles/wikilinks/aliases and rejects ambiguity; `path` requires an exact relative folder path, optionally ending in `.md`. Omit a selector to use the active note. `name` changes the note’s name independently from its Markdown heading. `folders`, `files` (alias `list`), and `status` expose workspace discovery.

Inline `content` interprets literal `\n` and `\t`. For code or multiline text, prefer literal stdin so escapes are preserved:

```sh
printf '%s\n' '## Review' '' '- [ ] Next step' | logia-cli append id=NOTE_ID --stdin
logia-cli read id=NOTE_ID              # Includes data.revision
logia-cli write id=NOTE_ID ifRevision=sha256-REVISION --stdin < replacement.md
logia-cli write id=NOTE_ID ifRevision=sha256-REVISION --blocks-json < blocks.json
```

`--content-file PATH` (or `contentFile=PATH`) reads literal content from a file, up to 1 MiB, and can't be combined with stdin or inline content. Agents that can't pipe or redirect without approval (such as Claude Code in Logia's chat pane, which may only write files in its own session directory) stage large Markdown in a file and pass it this way:

```sh
logia-cli append id=NOTE_ID --content-file ./section.md
```

Every read returns a SHA-256 revision over the note’s content and relevant metadata. Full replacement (`write`) requires `ifRevision`; append, prepend, and rename accept it optionally. Stale replacements fail with `REVISION_CONFLICT` and make no edit. Appends merge with the latest GUI content after Markdown parsing so newly typed text is retained. Existing rich blocks and IDs remain intact; prepend inserts after the title and imported YAML frontmatter. Markdown is parsed with the same BlockNote schema as the GUI. `--blocks-json` supplies raw BlockNote JSON through stdin and validates it against that schema. Canvas content can be read as JSON but is not writable through the text CLI.

Responses use `{ "schemaVersion": 1, "data": ... }` or `{ "schemaVersion": 1, "error": { "code": "...", "message": "..." } }`. Errors exit nonzero. `--format markdown` emits plain Markdown for `read` and `daily:read`. A `dirty` field reports unsaved state. `SAVE_FAILED` means an edit can be visible but unsaved: restore storage access and use `save`, rather than repeating an append. Background save failures follow the note and appear in the GUI when opened. A `TIMEOUT` or lost connection can have an unknown outcome after dispatch: read before retrying. Sent edits are never automatically retried. Queue-expired requests are rejected before execution.

## Local IPC and embedded agents

Linux/macOS use a Unix socket at `/tmp/logia-cli-<effective-uid>/cli.sock`. The dedicated directory is private (0700), the socket is 0600, and peers must have the same OS user ID. Endpoint ownership uses an advisory lock, and a live endpoint is never replaced. Windows uses a local named pipe `\\.\pipe\logia-cli-<USERNAME>`, with remote clients rejected and the OS default pipe ACL. Windows runtime behavior still needs a native smoke test.

There is no TCP listener or cloud service. `LOGIA_CLI_SOCKET` or `--socket` overrides the endpoint for isolated instances/tests; use an absolute Unix path. Only the native main window can register readiness and reply. Up to eight clients are accepted, requests are capped at 2 MiB, content at 1 MiB, and responses at 32 MiB. The default deadline is 30 seconds. This local bridge is available to your OS account while Logia is open; it is not an MCP server, an ACP client, or a plugin compatibility layer.

Embedded agents receive `LOGIA_CLI_SOCKET`, a generated `AGENTS.md` explaining the commands, and `LOGIA_CLI_SCRIPT` when the bundled/development script is available. They can use `logia-cli`, or `node "$LOGIA_CLI_SCRIPT"` (PowerShell: `node $env:LOGIA_CLI_SCRIPT`). Nix desktop/development environments include the wrapper and Node. Other desktop bundles include the script; install Node separately if your agent environment lacks it. An attached `note-context.md` remains a static copy; live edits use the CLI.

## Offline reads and export: logia-agent

The local CLI reads Logia's existing JSON notes without starting the desktop app, opening a port, or needing an API key. It never modifies source notes. Run `nix run .#agent -- --help` with no JavaScript dependency installation, or use Node 24+ in the pinned `nix develop .#frontend` shell.

```sh
bun run agent --help
bun run agent --data-dir "$HOME/Documents/Logia" list
bun run agent --data-dir "$HOME/Documents/Logia" search '#research is:starred'
bun run agent --data-dir "$HOME/Documents/Logia" read NOTE_ID
bun run agent --data-dir "$HOME/Documents/Logia" read NOTE_ID --format markdown
bun run agent --data-dir "$HOME/Documents/Logia" links NOTE_ID
bun run agent --data-dir "$HOME/Documents/Logia" export --output /tmp/logia-snapshot
```

`--data-dir` names the root containing `notes/` and `folders/`, not `notes/` itself. Set `LOGIA_DATA_DIR` to avoid repeating it. The default is `~/Documents/Logia`; if your documents directory is customized through XDG or the OS, pass the actual root. If desktop Settings → Git Sync reports a path ending in `/notes`, use its parent directory. Browser workspaces use separate localStorage and aren't visible to this CLI.

JSON responses have `{ "schemaVersion": 1, "data": ... }`. Recoverable malformed files appear in `warnings`. Errors return `{ "schemaVersion": 1, "error": { "code": "...", "message": "..." } }` and a nonzero exit code. Only `read --format markdown` emits plain text. Use note IDs from `list`/`search`; titles may be duplicated. `links` reports unresolved or ambiguous targets with `resolvedId: null`.

Search indexes visible text rather than editor metadata. Terms are combined with AND; quoted phrases, `#tag` (including nested descendants), `is:starred`, `is:text`, and `is:canvas` are supported. Canvases are searchable by title, not their drawing JSON. Results contain IDs, original folder paths, tags, and timestamps.

Export requires a new directory and refuses to overwrite an existing destination. It writes a flat Markdown snapshot, a `manifest.json` mapping original paths and IDs to exported files, and `.logia/` raw JSON for lossless recovery, including canvases and folders. Markdown conversion is best-effort; custom block styles and layout may not survive. Local attachment files aren't copied. Path-qualified wikilinks may need updating in a flat snapshot. If a write fails partway through, the partial directory remains for inspection; choose a new destination for the next attempt.

This offline CLI is read-only. Use logia-cli for live reads and writes through the running app. File-level writes from a second process would need conflict detection, revisions, and a shared locking protocol before they could safely run beside the editor. Don't rewrite note JSON behind the running app.

Run the contract tests with `bun run test:agent` and the indexing/Markdown tests with `bun run test:unit`.
