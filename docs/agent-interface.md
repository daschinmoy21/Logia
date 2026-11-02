# Working with Logia from an agent

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

The CLI is a read-only integration foundation, not an MCP server or a live write API. Use the app to edit notes. File-level writes from a second process would need conflict detection, revisions, and a shared locking protocol before they could safely run beside the editor. Don't rewrite note JSON behind the running app.

Run the contract tests with `bun run test:agent` and the indexing/Markdown tests with `bun run test:unit`.
