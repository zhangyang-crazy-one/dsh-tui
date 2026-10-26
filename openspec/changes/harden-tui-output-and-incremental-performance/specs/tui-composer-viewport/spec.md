## ADDED Requirements

### Requirement: Viewport bounded draft presentation

The composer SHALL retain the full draft but render only a geometry-bounded window containing the caret, including any explicit window indicators. For fixed terminal geometry, mounted input rows MUST NOT grow with total draft line count.

#### Scenario: Large multiline paste
- **WHEN** 10, 100 and 1,000 line drafts are pasted at the same terminal size
- **THEN** mounted input rows stay within the same documented viewport bound, the caret remains visible, and all draft lines remain available for editing and sending

### Requirement: Reusable line and grapheme indexing

The composer SHALL reuse line offsets and grapheme display-column indexes for unchanged text. Initial ingestion MAY require linear indexing, but repeated caret movement MUST NOT rescan the entire draft prefix or recompute each line's prefix independently.

#### Scenario: Moving within the tail of a long line
- **WHEN** an indexed 700, 7,000 or 70,000 UTF-16 unit line is unchanged and the caret moves within the visible tail
- **THEN** operation counts reflect the visible window and indexed lookup rather than a full prefix traversal on each movement

### Requirement: Lossless draft and caret semantics

Windowing SHALL preserve the existing complete draft, selection, history restoration, external editor and image-token semantics. Display columns and IME caret anchoring SHALL respect grapheme boundaries and terminal geometry.

#### Scenario: Wide text, selection and send
- **WHEN** a draft containing Chinese, combining marks, emoji, tabs, newlines and image tokens is selected, edited across a window boundary and sent
- **THEN** selection and caret match the full-draft reference model, the IME anchor follows the visible caret, and sent content exactly matches that edited model
