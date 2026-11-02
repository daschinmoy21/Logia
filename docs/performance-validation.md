# Workspace performance check

Measured during this change on the shared ARM64 development host (2 vCPUs), using Chromium 143 and the Vite development build. These are synthetic fixtures, not production/native benchmarks.

The large fixture contained 1,500 notes and a 303-block active note. Opus profiled 30 body keystrokes paced 100 ms apart with the context panel open. Median input-to-next-frame time fell from **1,036 ms to 62 ms**, with the 95th percentile falling from 1,310 ms to 78 ms. The primary bottleneck was rendering and committing every file-tree row on every content change. Hidden panel computations and repeated link-index construction added smaller costs.

The file tree and sidebar now subscribe to stable note metadata, tree rows are memoized, hidden panels skip unneeded subscriptions, and link/backlink inputs remain stable during body edits. Editor changes still reach the notes store synchronously; disk persistence remains debounced. Note actions resolve current content by ID instead of relying on cached list data.

Title editing remains more expensive: the measured median was 176 ms with the 1,500-note fixture. First mount and note switching were not profiled, and the tree is not virtualized. Production, native Tauri, and other hardware/browser engines need separate measurements. These figures establish a development regression check, not a latency guarantee.

The committed browser suite covers content persistence across immediate navigation, failed-save retry, and live alias changes invalidating backlinks, alongside home, command, import/export, and narrow-layout flows.
