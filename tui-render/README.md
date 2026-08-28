---
description: "The Ink terminal rendering library for callers projecting bounded session history, panels, Markdown, tool cards, and terminal input."
kind: "package-library"
---

# @deepseek-ai/dsh-tui-render

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tui-render` lets the terminal runtime project bounded session history, panels, Markdown, tool cards, and input through Ink. Callers supply a controller snapshot and receive terminal rendering and input actions without giving the library ownership of agents or persistence. The package registers no Cordis service and issues no model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The `dsh-tui` runtime imports this library when it already owns terminal lifecycle and a `TuiController`. Use [`mountTuiRender`](src/index.ts) to mount the Ink tree and dispose the returned handle during runtime teardown; use the pure projection and layout exports for owner tests and alternate terminal hosts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Contract

- `TuiLoop` observes a `TuiController` snapshot and dispatches input actions without accessing agent or persistence services. The top-bar title is `controller.getTitle()`: a folded `session/title` except a `fallback` title that coexists with a human user message (that echo is a directory-row label only). Before a provider or rename title exists the loop shows the compact mount title `DeepSeek · deepseek-tui`; the large generated FishLogo remains in the empty home rather than the top bar. While `getApprovalPane().open` is true the composer slot is `ApprovalPane` (`等待审批`, footnote `y 允许一次 · n 拒绝 · i 详情`); while `getAskUserPane().open` is true it is `AskUserPane` (numbered labels, footnote `↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问`). StreamView stays in `children` in both cases; `g s` (composer buffer exactly `g`) / Ctrl+K / Ctrl+T / `/help` / empty `/permission` / empty `/settings` do not open browse panels. While `getSettingsPane().open` is true the conversation column is `SettingsPane` (`设置`, or `首次设置` when `onboarding` is set; `namespace · field` rows such as `llm-deepseek · baseURL`); browse leaves the composer empty (`↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭`) and edit uses `InputBar`. `getSubmitOnEnter()` is false when Enter should insert a newline. `InputBar` segments ordinary text, slash commands, `@` mentions, and durable `[图片 #N]` placeholders into exact, lossless slices; styling changes only their presentation and the `none` color tier preserves the same literal text. `CommandMenu` paints under it as a two-column list (`/{name}` left, description right), both sides escaped; command and mention menus share Up/Down and j/k selection, and the selected row uses an accent `›` and an `fg` name. Enter on a non-empty `/` query executes the highlighted name-prefix match and keeps trailing arguments; empty `/` plus Enter does not fire a directory item.
- `createProjector()` treats only `user/message` events with `source.kind === 'user'` as human transcript rows. Agent instructions, plugin context, skill catalogs, and future non-user sources remain durable and model-visible without appearing as user-authored terminal messages.
- `SessionPane` renders supplied session rows, selection and delete confirmation state; persistence reads and mutations remain runtime-owned.
- **AppShell / StreamView layout** — the top bar sits under a thin full-width `─` separator; thick `═ ║` chrome is not used. `layoutTitleBar` fits the title and badge into the window width (badge truncates first when the title still fits; a one-column `…` marks a cut; wide glyphs stay whole). `conversationWidth` uses the full width below 80 columns and otherwise a left-aligned 72% column capped at 88 columns; a resize re-lays out without a centered or reserved sidebar gutter. StreamView fills the shell content slot. An empty idle window vertically centers the generated official FishLogo, the `DeepSeek` wordmark, and `有什么可以帮忙的`; a transcript packs to the bottom so the latest message sits above the status and composer rows. Follow mode alone advances that floor when events arrive. ↑/k and PageUp detach before moving older, PageUp/PageDown move by the 60-message history window, Home reaches the oldest available window, and End or an empty-composer `G` reattaches at the latest window and clears unseen state. New events preserve the detached window and increase `↓ 最新消息 · {n}`; an overflow-only one-column right rail shows the bottom-relative window with a thumb of at least three rows. `viewShift` extra bottom margin moves the packed column up so line movement can reveal older rows of a tall turn before the history window applies. User and assistant rows share that column and both left-align; the `>` / `●` markers distinguish them without a background plate or opposite edges. An assistant turn paints chronological parts (reasoning, text, tool cards) rather than every tool after concatenated body text. Assistant text goes through `MarkdownBlock` while it streams and after it settles, so formatting is live and a finishing turn does not reflow; the `● ` marker and the two-column continuation indent are painted row prefixes rather than a sibling span, because Ink fills the gap between two spans on one row with unstyled cells. The streaming cursor is the `tail` on the last painted row of the last text part; a generating turn with no tokens yet still paints that cursor so the slot is not empty. While generating, earlier reasoning runs collapse to their own `思考 (Ns)` fold and only the current run is a header plus the last four wrapped rows; each N is that run's elapsed time, not the whole turn, live and in frozen history. Collapsed tool cards paint `▸ {name}` in accent, then dim ` · ` and the status word, with the summary on the next dim line; Ctrl+E expands to `▾` with escaped 参数/结果/meta. Long rows wrap to the column width so Yoga's measured height matches the painted rows. Message blocks breathe with two blank rows between them and one inside the active turn. Rows no component paints — those blank separators, the filler above the status row — stay black through `frame-fill`, which brackets every erase Ink emits with the `bg` token: log-update's per-row `ESC[2K`/`ESC[K` and `clearTerminal`'s `ESC[2J` (visible screen; `ESC[3J` scrollback stays unbracketed so BCE does not paint the whole saved buffer), the path Ink takes whenever a frame overflows the viewport and writes its rows with no per-row erase (the pinned frame height makes that the normal case). Terminals without BCE fall back to the per-row `paintRow` strips.
- `mountTuiRender()` owns the Ink alternate-screen lifecycle and returns the matching unmount disposer; before the first render it installs the color tier detected from the environment (`installTheme(env)`, default `process.env`, injectable for tests), so every `styled()` call in the tree maps through the detected tier (truecolor → 256 → 16 → none). The same snapshot installs OSC 8 (`installHyperlinks(env)`). When given a `frameProbe` it wraps the tree in a `FrameProbe` so every React commit records its render cost.
- **Mouse and OSC 8** — on a TTY pair `mountTuiRender` enables SGR mouse (`1000`/`1002`/`1006`), strips reports from Ink's stdin, and disables tracking on unmount even when `render` throws. Unknown terminals and tmux/screen that do not advertise hyperlink forwarding keep plain text, with a dim `(href)` when the label differs from the href (`mailto:` compared without the scheme). Markdown links and collapsed tool-card summaries wrap already-styled text in OSC 8 after `escapeContent`/`styled`; only `http(s):`/`mailto:`/`file:` hrefs wrap or open. Every painted stdout chunk feeds the selection `ScreenAtlas` through one grapheme traversal; CSI and OSC readers advance absolute offsets in that original string, preserving split-sequence carry-over without allocating the remaining frame per cell. Wheel maps to the visible pane's j/k action (one line per event; settings edit/onboarding ignore it). Primary-button drag copies reading-order text via OSC 52 (capped at 100_000 characters) then a host clipboard helper; a click opens the href under the cell through the host opener.
- **Generated brand and theme styling** — `scripts/gen-tui-brand.ts` reads the exact `viewBox`, path data, and `currentColor` fill from the repository-owned `FishLogo.tsx` source without importing client runtime code. Deterministic nonzero-fill rasterization locks a 44×38 bitmap and packs it into the 44×19 A half-block tier; B full-block and C ASCII are derived from that same bitmap, followed by the plain `DeepSeek` wordmark. Four A-tier reveal frames keep every contour cell byte-identical and vary only exterior particles. `verify-tui-brand`, included in `doc-sync`, rejects any stale generated artifact. The generic whale emoji is not a brand or fallback tier. `styled(escapeContent(text), token)` is the single styling path: content is escaped before styling, and each token (`accent`/`success`/`error`/`fgDim`/…, the closed `THEME_LEVELS` set) maps through the installed tier. Truecolor `accent` is DeepSeek logo blue `#4D6BFE`, not Grok/Tailwind `#3B82F6`. At `none` the text renders unstyled, so 16-color and no-color terminals stay readable. `formatAdaptiveInfoFooter` paints up to three physical lines from controller-provided provider/model/status, optional effort, context pressure, token/cache totals, and a durable retry countdown. It drops whole low-priority segments as width narrows, escapes provider and failure text, and has no cost field because the runtime exposes no authoritative billing projection. The feedback row (`feedbackLine` — `✓` copy renders success, `✗` and other failure copy renders error), selected/list/timeline-current markers (accent), the generated idle contour and wordmark, the composer prompt (empty buffer shows dim `输入消息`), and panel footers (fgDim) complete the styled semantic matrix. Markdown renders through the same path: code spans map to tier tokens over a per-line `codeBg` strip (no hard-coded truecolor); inline emphasis, headings, GFM table headers, and links use accent (links then take the OSC 8 wrap above). Overlay pane titles stay bold fg.
- `escapeContent`, `displayWidth`, `wcwidthSafeSlice`, `padDisplayEnd`, and `wrapDisplayLines` — the render layer owns control-byte escaping, display-width measurement, column padding, and column wrapping (the `string-width` dependency lives here); the host re-exports `escapeContent`, `displayWidth`, and `wcwidthSafeSlice` so host-side imports keep working. GFM tables share a display-width maximum per column (`padDisplayEnd`), wrap cells inside a box-drawing grid (`┌─┬─┐` / `├─┼─┤` / `└─┴─┘`), and fall back to wrapped ` | ` lines when the window cannot hold the chrome; markdown rows set Ink `wrap="truncate"` so a fitted line cannot wrap a second time and overwrite the row below.
- `composerCursorPosition` / `composerFrameAnchor` / `clampCaretIndex` / `moveCaretByGrapheme` — pure composer caret geometry (row/col on the buffer's display grid: multiline, CJK/emoji width, no wide-glyph splits), grapheme-safe caret steps, and the CSI origin appended after Ink's frame write. `InputBar` publishes that origin during render onto the frame-fill stream at `caretIndex` (the end of the buffer if omitted). A TTY fullscreen frame (AppShell height equals the viewport, no trailing newline) leaves the cursor on the last output row, so the last composer line is `up = 0`; palette rows under the composer add `rowsBelow` to `up`; a non-TTY trailing-newline frame needs `up = 1`. Left/right that does not change the painted buffer still writes an absolute CUP so the hardware cursor follows `caretIndex` when Ink skips the frame. Ink 7.1.1 exposes no runtime IME composition state, so nothing detects composition and no key yields to it.
- `FrameProbe` — commit-driven render-cost instrumentation: each React commit in the wrapped subtree records its Profiler `onRender` `actualDuration` into a bounded 120-sample ring summarized as `count`/`mean`/`max`/`p95` (read-only `frameStatsSnapshot()`). `renderMs` is the React render-phase cost of the root commit, while the dedicated `PixelFishHome` probe supplies `brandRenderMs`; neither is a wall-clock terminal-paint claim or includes the Ink host-diff/commit phase. `activeBrandRevealTimerCount()` supplies the matching owned-timeout sample. The Profiler wrapper fires `onRender` for every commit in the subtree even when its own props stay referentially stable, so a stable mount cannot hide child commits.
- **Performance bounds** — immutable frozen assistant Markdown passes `settled` and reuses a parsed mdast; changing streaming sources always parse without entering that cache. Frozen Markdown rows are memoized by source, width, and theme tier. The mdast and syntax-token maps use independent 2,000-entry least-recently-used limits, exposed read-only through `markdownCacheInternals` for occupancy and hit/eviction tests. `transformFrameChunk` returns chunks without `ESC` before erase-sequence replacement scans.

### Advanced interaction contract

- Dialogs keep StreamView in the content slot and occupy the input slot; browse overlays replace the content and suppress the composer except during their editing states. Todo, jobs, and workflow HUD rows never capture input. The adaptive footer keeps provider/model/status, drops cache/token and effort as complete segments when width requires it, and shows retry copy only between the matching durable `llm/retry` and `llm/retry-started` records. A current goal remains visible within the same three-line cap.
- [`SessionPane`](src/session-pane.tsx) renders the controller-owned current parent as `会话 ID · {parentId}`, and [`AgentHubPane`](src/agent-hub-pane.tsx) renders each child as `子会话 ID · {childId}`. `SessionRow.id`, `SessionPaneState.currentId`, and `AgentHubRow.id` retain the exported `SessionId` type; fixture configuration does not supply these identities. [`session-pane.spec.tsx`](tests/session-pane.spec.tsx) and [`agent-hub-pane.spec.tsx`](tests/agent-hub-pane.spec.tsx) pin exact values and escaping.
- The [`Mention`](src/mention.tsx) selection in [`loop.tsx`](src/loop.tsx) uses Up/Down or j/k to change the highlighted candidate. Enter inserts that target with exactly one trailing space and does not submit it; Escape dismisses the selection menu. [`composer-tokens.spec.ts`](tests/composer-tokens.spec.ts), [`mention.spec.tsx`](tests/mention.spec.tsx), and [`loop-input.spec.tsx`](tests/loop-input.spec.tsx) own lossless tokenization and the focused key behavior.
- [`StreamView`](src/stream-view.tsx), [`ToolCard`](src/tool-card.tsx), and [`turn-tail.ts`](src/turn-tail.ts) render presenter-tagged folded cards, a width-aware dense digest, `── 已完成 ──`, and first-seen produced paths. [`visual-conformance.spec.tsx`](tests/visual-conformance.spec.tsx) owns the bounded layout rules; the assembled [`terminal.expected.txt`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/terminal.expected.txt) owns settled 80x24 and 200x50 ScreenAtlas cells. The rationale and evidence ownership are recorded in the [advanced-capability Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.md).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [TUI package map](../README.md) — terminal runtime and renderer ownership.
- [TUI profile layer](../tui/README.md) — controller, lifecycle, persistence, and assembled evidence.
- [Terminal subsystem](../../../docs/subsystems/terminal.md) — terminal types and generated Cordis declarations.
- [Advanced capability decision](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.md) — rendering rationale and evidence ownership.

-----

<a id="model-experience"></a>
## Model Experience

### Terminal conversation display

#### What the model sees

The renderer adds no prompt text, tool schema, session event or model request; it only displays the runtime's `ViewModel`.

#### Token effect

The package has zero direct token effect because its output is terminal-only.

#### KV Cache effect

The renderer does not alter request prefixes or issue model requests, so it has no KV-cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Terminal capability fallback** — color, OSC 8, and syntax highlighting degrade to lower terminal tiers; the renderer does not emulate unavailable terminal features.
- **SGR mouse owns the pointer** — mode `1002` replaces the terminal's native selection; copy is the in-process reverse overlay plus OSC 52.
- **Session directory data** — search, timeline and export data remain runtime-owned so this package can render them without owning storage or lifecycle.
- **Composer caret is layout-approximate** — the fullscreen vs trailing-newline origin assumes AppShell pins the composer slot to the bottom (`rowsBelow` counts palette rows under the composer) and does not model terminal soft-wrapping of over-wide lines.
- **The scroll rail represents message windows** — the one-column rail reflects the 60-message projection rather than exact wrapped physical rows, does not support pointer dragging, and still clips a single turn taller than the content slot from the top.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
