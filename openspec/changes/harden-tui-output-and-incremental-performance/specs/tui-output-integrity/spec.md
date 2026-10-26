## ADDED Requirements

### Requirement: Chunk independent terminal output

The TUI output boundary SHALL preserve text, control-sequence semantics and final terminal state independently of write chunk boundaries. It MUST NOT insert decorations inside an unfinished CSI or OSC sequence or split encoded text incorrectly. Pending parser state SHALL have a documented finite bound and teardown policy.

#### Scenario: Split background color sequence
- **WHEN** `ESC[48;2;21;22;24mOK` is written whole or split at every possible boundary through the production output wrapper
- **THEN** each replay shows only `OK` with equivalent style and cursor state, without visible control-code fragments

#### Scenario: Mixed encoded writes and unfinished controls
- **WHEN** valid UTF-8 Buffer and string writes include split multibyte characters, CSI and OSC terminators, and an over-limit unfinished control or disposal is separately exercised
- **THEN** valid streams match their unsplit oracle and exceptional cases follow the documented bounded policy without emitting an orphaned tail or leaking pending state after disposal

### Requirement: Coordinated output transactions

Frame, overlay, caret, selection and notification writers SHALL preserve complete control transactions and restore the current composer caret when the composer owns focus. Existing single-owner transcript painting SHALL remain effective.

#### Scenario: Background output while composer is unchanged
- **WHEN** generation, a layout overlay and a notification occur while the user leaves the draft unchanged
- **THEN** completed terminal frames preserve draft text, blank composer cells and current caret without requiring a keypress to repair the screen

### Requirement: Independent whole screen verification

The verification harness SHALL compare terminal text, blank cells, styles and cursor against independently specified canonical content, composer state and geometry. It SHALL report uncomparable transitions separately and MUST NOT count them as passes.

#### Scenario: Sustained generation without keyboard input
- **WHEN** the production renderer runs synthetic generation and multiple continuation rounds for at least five minutes at 80×24 and 120×40, including notifications and resize transitions
- **THEN** every comparable completed frame passes transcript, composer, HUD, blank-cell and caret checks; unmatched, skipped and failed frame counts are recorded explicitly

### Requirement: Bounded diagnostics and slow output recovery

Diagnostics SHALL identify writer source, runtime bundle, block boundaries and frame state in finite storage; raw content capture SHALL require explicit opt-in. Under slow output the renderer SHALL use a documented finite pending-frame/byte budget, honor write backpressure and preserve ordered mandatory control output. Canonical session events MUST NOT be discarded.

#### Scenario: Slow sink then recovery
- **WHEN** a controlled sink returns false and delays drain while new presentation snapshots arrive, then resumes
- **THEN** pending output remains within the declared budget, already-started transactions finish intact, obsolete unstarted presentation frames may be coalesced, and the newest canonical view appears after drain

#### Scenario: Write failure and default tracing
- **WHEN** a write fails with diagnostic tracing enabled and raw capture disabled
- **THEN** failure is observable, the successful-paint baseline is not advanced for that failed write, recovery invalidates stale presentation state, and bounded trace records exclude raw conversation content
