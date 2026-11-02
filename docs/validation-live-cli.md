# Live CLI validation

The client is a standalone Node process, not a wrapper that edits vault files. The native Rust transport and frontend command dispatcher are tested independently, then the real Node client is exercised against the actual Chromium editor through a local Unix-socket test broker. That broker substitutes only for the Tauri event adapter; it calls the same `executeGuiCommand` handler the desktop uses.

The browser tests exercise unsaved reads, visible Markdown/task insertion, preserved block IDs and formatting, persistence after reload, silent creation, exact-path targeting, GUI opening, stale-revision rejection, full replacement, frontmatter-preserving prepend, and active/background save failures with retry. Daily-note commands, tags, and search are also covered. Node tests cover CLI help/error behavior, revision calculation, target ambiguity, request expiration, and store persistence. Rust tests exercise actual socket permissions/ownership, protocol rejection, and timeout behavior. `cargo check` covers native Tauri wiring.

```sh
bun run check
bun run test:unit
bun run test:agent
nix develop .#browser --command bun run test:browser
cargo test --manifest-path src-tauri/cli-tests/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
nix run .#cli -- help
```

A full native desktop smoke test remains necessary for Windows named pipes, installed-bundle resource paths, and a real agent invoking the bundled CLI. No real provider login or paid model call is required for these tests. Browser workspaces remain separate from desktop data; the test broker is never started by the application.
