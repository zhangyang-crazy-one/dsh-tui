## 1. Frame clock and scroll quantum

- [x] 1.1 Add arbiter tests proving the shared timer starts on request and stops when idle, and that a single-row key does not require a React-visible state change.
- [x] 1.2 Make `createFrameArbiter` demand-driven and expose a scroll-activity flag that live-duration, brand animation and metrics can skip.
- [x] 1.3 Stop `StreamView` from `dispatchViewport` on every presented-row tick; keep presented offset on the scheduler and quantize React commits to `overscan/2`.

## 2. Overlay-authoritative transcript paint

- [x] 2.1 Add regressions proving a one-row scroll with a stable mount window does not remount `SlicedLinesBlock` or change Yoga `bottom` offset.
- [x] 2.2 Drive TTY transcript scrolling from `VisibleFrameSnapshot` CUP updates; keep Ink for chrome only.
- [x] 2.3 Keep one full snapshot scrub on settlement, resize, selection end and color-tier change so overlay and terminal cells stay aligned.
- [x] 2.4 Fit speaker prefixes into the projector wrap budget and treat Ink `wrap="truncate"` as overflow insurance only.

## 3. Follow overscan

- [x] 3.1 Add a StreamView test that generating+follow still mounts configured overscan and one `↑` reveals an already-projected row.
- [x] 3.2 Remove the generating+follow `overscan = 0` branch without exceeding one-viewport overscan.

## 4. Bounded Ctrl+E expansion

- [x] 4.1 Add projection tests: expanded cards outside the viewport keep a heading row only; bodies intersecting the window are sliced; oversize bodies use the fold footnote.
- [x] 4.2 Split `tools-open` / `tools-closed` derived-row caches and cap per-card body projection plus per-frame newly mounted rows.
- [x] 4.3 Keep the global Ctrl+E glyph toggle; update the same-instance expand/collapse PTY assertion to the visible window rather than every historical body.

## 5. Syntax tokens and command coloring

- [x] 5.1 Add `codeKeyword`, `codeString`, `codeComment` and `codeCommand` to `THEME_LEVELS` for all four tiers; pin truecolor values and `none` empty sequences.
- [x] 5.2 Point `markdown.tsx` `TOKEN_STYLES` and `markdown-render.tokenizeCodeLine` at the new tokens; keep `accent` off code spans.
- [x] 5.3 Highlight the command name on expanded terminal cards with `codeCommand` and cover `NO_COLOR` identity.

## 6. Module spacing

- [x] 6.1 Add block-row tests for a `line` separator in the two-row message gap and a blank row between reasoning, tool stacks and prose.
- [x] 6.2 Keep adjacent tool cards gapless; paint the message-gap separator with `line` across the conversation width, including widths below 40.

## 7. Quiet tools, inline permission strip, and compact footer

- [x] 7.1 Update `tool-card.tsx` and `tool-cards.ts` to silence completed tool calls: replace loud `ok: '完成'` with subtle `✓` and `fgDim` text; preserve strong highlights only on running and error states.
- [x] 7.2 Implement compact inline approval strip above the composer (`[Y] 允许 · [n] 拒绝 · [a] 本会话总是`) with single-key handling, settling into a dim single-line transcript entry.
- [x] 7.3 Format `adaptive-info-footer.ts` into a default 1-line quiet status row (hotkeys + compact context/state); embed model/mode chip on composer frame to eliminate 3x duplication.
- [x] 7.4 Support `Shift+Tab` mode cycling (`agent` / `plan` / `focus`); in `focus` mode, project transcript without tool cards so conclusions dominate.

## 8. Documentation and decision record

- [x] 8.1 Update TUI renderer/runtime bilingual README and public JSDoc for overlay scroll, bounded Ctrl+E, overscan, syntax tokens, module separators, quiet tools, and inline approval.
- [x] 8.2 Write or revise the bilingual Agent Note that supersedes C4 grayscale code mapping and records bounded expansion and Quiet Shell alignment.

## 9. Verification

- [x] 9.1 Run focused `tui-render` / `tui` tests covering theme, markdown, block-rows, stream-view, frame-arbiter, scroll-scheduler, tool cards, footer, and approval.
- [x] 9.2 Update and replay affected keyless TUI snapshots; run `test:tui:perf` for 10k-row scrolling and expand/collapse.
- [x] 9.3 Run typecheck for the touched packages, `openspec validate refine-tui-scroll-expand-and-visual-hierarchy`, documentation gates for edited README/notes, and `git diff --check`.

