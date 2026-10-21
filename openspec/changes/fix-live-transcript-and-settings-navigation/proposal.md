# Live transcript correctness and settings navigation

## Why

The 2026-10-21 audit reproduced stale streamed prose with no user input. Ink and the physical snapshot adapter both painted transcript cells. Sparse Ink output also invalidated the adapter's newline-count cursor estimate. Wheel reports incurred delayed row-by-row catch-up, and multiple reports before a React commit could overwrite each other. Settings exposed long flat paths rather than navigable provider/model structures.

## What changes

- Reserve the TTY transcript slot in Ink; paint its contents only from the canonical physical snapshot. Track Ink cursor movement and clear/repaint ownership transitions.
- Deliver navigation to the measured viewport directly, preserve all wheel deltas, and land wheel input at the latest target. Measure scroll latency through the corresponding stdout callback.
- Maintain incremental render-store accounting and resident LRU order.
- Browse settings by category, namespace, object/provider, array/model and fields; retain search, selection and location after edits. Use official host configuration and credential services.

## Impact

Renderer, runtime settings UI, offline regression fixtures and documentation. No new configuration store, launcher behavior or provider authentication protocol.
