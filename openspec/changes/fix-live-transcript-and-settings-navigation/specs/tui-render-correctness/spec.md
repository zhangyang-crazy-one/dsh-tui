## ADDED Requirements

### Requirement: Single transcript paint owner
TTY transcript cells SHALL be painted exclusively from the current physical snapshot. Ink SHALL reserve geometry and paint chrome, with explicit ownership transitions when panes replace the transcript.

#### Scenario: Streaming without interaction
- **WHEN** Markdown grows and settles without input
- **THEN** completed terminal frames match the snapshot, including blank cells, and transcript text does not overwrite composer or status rows

#### Scenario: Sparse frame followed by a pane or resize
- **WHEN** an incremental Ink frame changes height or replaces the transcript with a pane
- **THEN** cursor position remains correct and old transcript cells do not remain in unused pane rows

### Requirement: Wheel input fidelity
Every accepted wheel delta SHALL contribute to the viewport target and SHALL land without row-by-row animated catch-up. The latency metric SHALL end at the corresponding successful stdout write callback.

#### Scenario: Multiple wheel reports before React commits
- **WHEN** three three-row reports arrive together
- **THEN** the resulting viewport moves nine rows, subject to bounds

### Requirement: Incremental cache budget accounting
Reading cache totals or changing pins under budget SHALL NOT enumerate cached physical lines.

#### Scenario: Sequential block initialization
- **WHEN** N single-row blocks are settled under budget
- **THEN** budget accounting measures each row once rather than rescanning previous blocks
