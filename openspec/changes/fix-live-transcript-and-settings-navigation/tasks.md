## Implementation and evidence

- [x] Reproduce and remove dual transcript painting; verify no-input streaming against canonical frames.
- [x] Fix sparse Ink cursor accounting and transcript/pane ownership transitions with actual incremental Ink regressions.
- [x] Preserve batched wheel deltas and eliminate wheel catch-up; compare PTY latency and write volume.
- [x] Tie scroll latency to the matching stdout write callback and clear pending metrics at teardown.
- [x] Replace repeated cache scans with incremental accounting; verify LRU and active/rebuild invariants.
- [x] Implement settings hierarchy, search/back, stable edits and unknown-field preservation through official services.
- [x] Verify settings layout and interactions at 40/80/120 columns.
- [x] Run full offline tests, build, strict typecheck and package checks; record fresh evidence and limits.
