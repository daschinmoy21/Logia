# Runtime and Obsidian compatibility decision

Assessed 2026-11-02. Recommendation: deliver the workspace on Tauri 2 first, evaluate Tauri 3 + CEF in an isolated prototype, and defer a GPUI rewrite until native rendering is a demonstrated product requirement. These are engineering judgments based on the current code and the sources linked below, not benchmark results.

## Tauri with CEF

Logia currently uses Tauri 2, React 19, BlockNote, tldraw, and Rust services for notes, Git, credentials, and audio. Keeping the web frontend preserves the largest part of the application.

Tauri's current documentation places the official CEF runtime in **Tauri 3.0 alpha**, outside the Tauri 2 runtime. CEF offers a chosen Chromium version across desktop systems and CDP access, with larger bundles, more runtime memory, and a roughly 1 GB initial runtime download. It therefore requires a Tauri migration, not a configuration change in this repository. See [Tauri's CEF guide](https://v3.tauri.app/develop/cef/) and [runtime comparison](https://v3.tauri.app/develop/webview-runtime/).

CEF is worth testing if we can reproduce editing, canvas, media, or Linux WebKit problems that Chromium fixes. It also makes CDP-based desktop automation an option. Chromium alone does not supply semantic agent tools, a vault API, or Obsidian compatibility.

Prototype gates before adopting it:

1. Build an isolated shell against a pinned Tauri 3 alpha and CEF version. Keep existing Tauri 2 release builds working.
2. Exercise editing, large notes, tldraw, Vim and IME input, clipboard, file dialogs, keychain access, Git subprocesses, and system audio capture on Linux, macOS, and Windows.
3. Measure cold launch, idle memory, interaction latency, package size, and update size with identical workspace fixtures on the target hardware. No performance improvement is assumed in advance.
4. Verify packaging, signing, sandbox behavior, capability permissions, and plugin version support; assign ownership for Chromium security updates.
5. Adopt only if the observed compatibility or automation gain justifies the added distribution cost and alpha migration risk.

## GPUI

[GPUI](https://gpui.rs/) provides GPU-rendered Rust UI. A native shell could reuse Rust storage and service logic after extracting it from Tauri handles. The existing React/BlockNote/tldraw interface would need replacement or webview embedding; it is not a direct port.

For Logia, a native editor would require deliberate work on text input, selection, undo, accessibility, rich blocks, tables, attachments, Markdown fidelity, Vim integration, and canvas behavior. This is a product rewrite with substantial testing needs. Fast rendering of a shell alone would not establish that the resulting editor is better.

The hybrid route also has constraints. GPUI Kit's current [WebView integration](https://gpui-kit.com/docs/webview/) is experimental, uses system webviews, and requires X11/XWayland on Linux. Native overlays and focus require platform-specific testing. Its [JavaScript shell](https://github.com/longbridge/gpui-kit/blob/main/crates/shell/README.md) is an early extension framework, not a browser DOM or Node.js runtime. These projects do not provide Obsidian's plugin host.

A sensible GPUI experiment would be a separate read-only workspace browser sharing a UI-independent core, followed by a small Markdown editor benchmark. Do not replace the main app before editor fidelity, accessibility, and platform acceptance tests pass.

## What Obsidian compatibility actually needs

Markdown exchange and plugin compatibility are separate milestones. Logia persists BlockNote JSON under `Documents/Logia`, rather than using Markdown files as its canonical vault. The current work adds copied Markdown import, snapshots, daily notes, tag discovery, wikilinks and backlinks. It does not open an Obsidian vault in place, execute community plugins, embed referenced files, or implement Obsidian Canvas.

Obsidian plugins use the [Vault API](https://docs.obsidian.md/Plugins/Vault) to work with files, and the [Editor API](https://docs.obsidian.md/Plugins/Editor/Editor) to manipulate Markdown. Obsidian exposes CodeMirror; desktop plugins may additionally rely on [Node.js and Electron APIs](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins). Logia uses BlockNote's different document model. My inference: CEF can reduce browser-engine differences, but broad compatibility still requires the APIs and editor semantics those plugins expect. GPUI adds an additional DOM compatibility gap.

A practical sequence:

1. **Vault fidelity:** a versioned Markdown-backed vault adapter with attachments, YAML properties, path-qualified links, aliases, heading/block references, rename updates, external-change detection, and conflict handling. Keep a reversible migration from JSON notes.
2. **Human and agent command contract:** stable command IDs, structured read/search operations, revision-aware writes, events, explicit capability grants, and lifecycle cleanup. Both palette and future MCP tools should call the same services.
3. **Logia extensions:** a small versioned host with commands, settings, events, storage, and cleanup. A compatibility report must state the supported surface.
4. **Obsidian subset:** inventory the user's priority plugins and their imported APIs first. Implement and test a narrow facade for command/data plugins; do not claim a plugin works merely because it loads. Include mutation and unload tests against disposable vaults.
5. **Editor/desktop plugins:** separately assess CodeMirror extensions, DOM-dependent views, Node modules, and Electron integrations. Reusing a web-based Markdown source editor would be a more relevant prerequisite for these than switching rendering engines alone.

Full parity needs an explicit plugin compatibility matrix and release gates. The application should identify unsupported plugins before loading them rather than executing arbitrary bundles with desktop file permissions.

## Current exchange limits

Markdown import copies selected `.md`/`.markdown` files as root notes. It preserves YAML visibly in a code block after the title; basic `tags` and `aliases` are indexed, while arbitrary YAML is preserved without interpretation. Relative attachments, vault folder layouts, embeds, and plugin settings are not imported. Duplicate names remain separate notes; ambiguous wikilinks remain unresolved. The agent snapshot preserves raw JSON alongside best-effort Markdown. These behaviors are migration building blocks, not round-trip vault parity.


## GUI-owned live operations

The primary agent interface now follows [Obsidian’s official CLI](https://obsidian.md/help/cli): `logia-cli` is a client of the running GUI. Private local IPC carries semantic note commands into the same editor/store/save queue used by people. Reads observe in-memory notes, appends preserve existing blocks, and full replacements require revisions. `logia-agent` remains a separate offline reader/exporter. This does not add Obsidian plugin APIs, ACP, or an arbitrary-code CLI. See [the command contract](agent-interface.md).
