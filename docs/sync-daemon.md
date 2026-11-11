# Sync over the tailnet (CRDT)

Status: design, not started. Replaces the GitHub-hub plan for device sync. Git stays as a backup only.

## Goal

The same notes on the PC, laptop, VPS and phone, with no Git on the phone. Edits merge automatically, offline edits included, and two devices editing the same note never produce a conflict to resolve by hand.

## Shape

```
  phone (Android app) ──┐
                        ├── tailnet ──  logia-syncd on netcup / oracle (always on, headless)
  PC (Logia app)  ──────┘                   │
     └ embeds logia-syncd                   └ optional: backup to private GitHub repo
```

- **logia-syncd** is one Rust crate. The desktop app embeds it. On the VPS it runs as a standalone headless binary. The Android app embeds it too, but only as a client.
- **No device is the primary.** Each one has a list of peers and syncs with whichever are reachable. The VPS is always on, so it ends up as the usual meeting point. That's a matter of being available, not of having any special role.

## Data model

- **CRDT: Yjs.** The Rust side uses `yrs`, which reads and writes the same binary format as Yjs, so the daemon and the webview share documents directly. BlockNote can edit a `Y.XmlFragment` natively through its collaboration option, so the editor binds straight to the synced document.
- **One `Y.Doc` per note**, holding:
  - `content`: the `Y.XmlFragment` BlockNote edits.
  - `meta`: a `Y.Map` with title, folder, tags, favorite, created and updated times.
- **One workspace `Y.Doc`** holds the list of notes, the folder tree and deletion markers. A deleted note gets a marker plus a deletion time. Its doc is kept for 30 days, then dropped.
- **On disk**, under `~/Documents/Logia/`:
  - `sync/<id>.ydoc` is the source of truth: a compacted Yjs update.
  - `notes/<id>.json` stays, rewritten from the doc after every change. Search, export, agents and the existing code keep reading JSON, so nothing downstream changes.
- **Tasks:** v1 syncs the tasks file as a whole, and the last write wins.
- **Kanban and canvas:** not in v1. They're added after notes sync is stable.

### Option considered: merge by block, no CRDT

Each block gets a version stamp (device + counter), and the merge works at the block level. Edits to different blocks both survive. If two devices edit the same block, both copies are kept and marked. That's simpler and keeps today's JSON files as the only storage, but it means a conflict UI. The CRDT avoids conflicts entirely, and BlockNote supports Yjs natively, so the CRDT is the pick. Merging by block is the fallback if `yrs` and BlockNote binding turn out painful in step 1. Both options have the same protocol, compression and pairing, so the rest of the design doesn't change.

## Edits from outside the editor (agents, hand edits)

On a device running the app, a file watcher notices when `notes/<id>.json` no longer matches the last export. It then diffs the old and new block lists by block ID: changed blocks are replaced, new ones inserted, missing ones deleted. Only those changes are written into the `Y.Doc`. Other blocks keep their history, so an agent editing one section can't clobber a phone edit to another. If the note is open, the editor updates live.

This conversion needs BlockNote's schema, so it runs in the app's JS (the `blocksToYXmlFragment`-style helpers in `@blocknote/core`). The VPS daemon never converts. It only stores and merges updates, which `yrs` does without knowing the schema.

## Protocol

It runs over WebSocket, bound **only** to the Tailscale address (100.x / MagicDNS), never `0.0.0.0`.

1. **Pairing.** The first device creates a workspace ID and secret. Other devices join with a code or QR. Every connection starts with an HMAC challenge on that secret, so other devices on the tailnet can't read notes.
2. **Catch-up.** Each side sends a manifest of `{docId: stateVectorHash}`. For every doc that differs, they swap state vectors, and each sends the other only what it's missing. This is the standard y-sync step 1/2.
3. **Live.** While connected, each local update goes to all peers, so edits land in under a second.
4. **Triggers on the phone:** app launch, return to the foreground, pull-to-refresh, every 2 min while open, and a push when the app goes to the background. The live connection makes the timer a fallback.

**Compression.** Every frame has a 1-byte header: raw or zstd.
- Payloads over **4 KB** are compressed with zstd level 3, which handles bulk catch-up, migration and large pastes. Smaller ones go raw, since live keystroke updates are tens of bytes and compressing them costs more than it saves.
- The threshold and level are config values.
- Yjs updates are already compact binary, so most of the gain shows up on catch-up batches. Those are batched into one frame per round trip, then compressed as a whole.
- Use zstd, not WebSocket permessage-deflate. It's better on binary data, and the same code works for the backup snapshots.

**Attachments** (images, PDFs) are kept out of the CRDT:
- They're content-addressed by sha256 and sent only when a peer lacks that hash.
- They go in 1 MB chunks so they can resume.
- They're never recompressed if already compressed (jpeg/png/webp/pdf).
- The phone could fetch them on demand rather than eagerly, which saves mobile data.

**Peers:** v1 reads a list of MagicDNS names from config (`pc`, `netcup`, `oracle`). Later it can find them automatically through the Tailscale local API.

## Migration (one-time)

Converting the same JSON note into a `Y.Doc` on two devices independently gives two unrelated histories. Merged, they would **duplicate all the content**. So:

1. One device, the PC, migrates every existing note into `.ydoc` and becomes the seed.
2. Every other device joins empty: its existing `notes/` folder is backed up, then it takes the seed's state.

## Backup

Git backup is **manual by default**: a "Back up now" action commits and pushes `notes/` (plus `sync/`) to the private GitHub repo. An optional setting, "Back up automatically every N hours", is off by default. When on, it only commits and pushes if something changed since the last backup. This reuses the existing desktop `git_sync` code.

## Things to watch

- Android allows one VPN at a time, so the Tailscale app can't run alongside WARP or any other VPN on the phone.
- Doc growth: keep Yjs GC on and re-compact `.ydoc` on save once the update log grows past a threshold.
- The current `git_sync` code and the new Git panel stay on desktop for anyone who still wants Git, but they're no longer how devices sync.

## Build order

1. `yrs` storage plus migration on the PC, with JSON still exported. Bind BlockNote to the `Y.Doc`. No networking yet.
2. Watcher plus block-diff ingestion for outside edits, with tests: agent edit, hand edit, simultaneous edits.
3. `logia-syncd` protocol, then PC ↔ VPS sync, with pairing.
4. Android app: plain touch editor (no vim mode, no command palette), notes list, search, tasks, sync status.
5. Manual Git backup, plus the optional every-N-hours setting.

## Open questions

- Peer list: is it PC, netcup and oracle, plus a laptop?
