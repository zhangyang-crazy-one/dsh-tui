---
description: "The interactive terminal profile layer for users composing deepseek-tui over dsh-base and operating sessions, tools, approvals, and notifications."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

The deepseek-tui profile bundle and runtime plugin lets a user run the interactive terminal over `dsh-base`. `dsh --profile deepseek-tui` waits for application readiness, validates the terminal, creates or resumes an Agent, and flushes the owned session before exit. The layer owns terminal lifecycle and user actions while capability packages continue to own agents, persistence, tools, and model behavior.

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

### Configuration

The bundle patch reads the optional `task` seed, optional `resume`, and optional `cwd` from `tuiStartup`. The startup provider accepts an optional task positional, `--resume <id>`, and `--cwd <dir>`; with no task (or with `--resume <id>` alone) the profile boots the full-screen loop idle with an empty focused composer (placeholder `输入消息` and a one-line operation/status footer), and `Enter` on the empty composer is a no-op.

The shipped profile is `{ bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui'], patchReload: 'startup' }`. Profile and home patch edits take effect on the next process start; they do not recompose a running terminal, Agent, or session. Settings-file reload remains owned by the settings service.

The optional `renderPolicy` config is resolved once at startup and passed explicitly to the renderer. `transcriptOverscan` and `cache.maxRows`/`cache.maxBytes` bound physical-row projection and reconstruction caches; `stream` owns smooth/catch-up queue thresholds and per-frame work; `scroll` owns latest-target cadence, catch-up steps, and the mouse-wheel row count. `tools.previewRows`, `detailPageRows`, `cacheEntries`, and `cacheRows` bound tool previews, detail pages, and derived storage; their defaults are 6, 40, 128, and 2048. The Config schema requires positive frame and cache limits, bounded overscan/cache budgets, and exit thresholds strictly below their matching entry thresholds, so invalid combinations fail during plugin load. The shipped values live in [`cordis.patch.yml`](cordis.patch.yml), and `pnpm run test:tui:perf` runs the strict real-PTY performance lane.

Reasoning is hidden by default. Ctrl+O or `/reasoning` shows the complete dim reasoning body in the shared transcript; streaming and settlement do not collapse it. `/scrollbar` hides or shows the right-hand rail without changing reading width or navigation. `/status` toggles detailed input/output metrics; the default single-row footer retains the context meter, percentage and cache-hit rate when authoritative values and width permit. The model name appears only in the input chip. These preferences also appear in `/settings` and persist through restart. `tui.locale` selects zh-CN (default) or en-US for the new settings, status and tool-detail labels; these controls do not change model reasoning or session events.

`--frame-stats <path>` opts into per-commit render-cost measurement. The target resolves to an absolute path at startup and must be writable — an unwritable target fails the launch (never silently skipped). On orderly exit the runtime writes one JSON file to that path and nothing else:

`renderMs` and `brandRenderMs` contain recent count/mean/p95/p99/max/samples plus `run`, a fixed-storage distribution of every measured commit. Recent samples are capped at 120; full-run quantiles use microsecond histogram buckets with three significant digits. Startup/history hydration is excluded once when the workload begins. These React Profiler costs exclude Ink diff/commit and terminal display time. `pacing` records commit count and elapsed time; `brandRevealTimers` records owned idle-home timeouts at orderly exit. `frameMetrics` separately includes completed-write intervals, input/coalescing counters, drain and scroll latencies, parse work, queue depth/age and cache statistics. The file contains statistics, platform/Node/architecture and its path, not session text, and never reaches stdout.

`/tools` opens every recorded call, including generic fallbacks and process failures. Enter opens bounded source pages with the selected action and status kept in the header; n/p move forward/back, d enables raw metadata, y copies the complete original, and e exports a private, non-overwriting `tool-*.txt` file in the launch working directory. Oversized clipboard payloads are explicitly refused with an export hint rather than truncated. Esc returns to the list and then the unchanged conversation. Approval and ask-user dialogs keep input priority.

### Contract

- The runtime owns the live Agent handle, session projection and session-directory state; the render package receives only the controller interface. The top-bar title is a folded `session/title` except a `fallback` title that coexists with a human user message; before a provider or rename title the loop shows the compact mount name `DeepSeek · deepseek-tui`. Directory rows still use the first-human-message fallback. An empty idle window paints the generated official FishLogo, `DeepSeek`, and `有什么可以帮忙的` in the conversation column. The environment selects half-block, full-block, ASCII, or plain output independently of color; `brandAnimation` stores `auto | on | off`, and every input, history, overlay, resize, completion, or unmount stop clears the one-shot reveal timer. The runtime answers `approval/request` for that live agent and calls `next()` for every other agent: `y`/`a` resolve `'allowed-once'`, `n`/`d`/Esc resolve `'rejected'`, and abort (including Ctrl+C cancelling generation) resolves `'cancelled'` via the request signal. Policy `'never'` is decided by the host before this listener runs, so no ApprovalPane appears. Ctrl+E flips the current window's tool-card fold (`toolCardsExpanded`; no session event). Empty `/permission` opens the preset overlay; parameterized `/permission <name>` runs `ctx.commands.execute`. Empty `/settings` opens the settings overlay on every top-level `describe()` field (including `llm-deepseek · models` and `llm-pi-ai · providers` as JSON); Enter apply writes the selected field through `ctx.settings.update`. Browse `e` reports `prepareDocument()` and `r` rereads rows (`✓ 已重载设置`). Empty `/resume` opens the session list. `/reload` is a local command: it flushes the live session, unmounts, disposes that session, then spawns a replacement Node with the same launcher flags plus `--resume <id>`, dropping the original task positional so the first message is not sent again. Overlay `r` only rereads settings rows. Idle boot with no configured `DEEPSEEK_API_KEY` opens `首次设置`; Enter saves through `ctx.credentials.set` and then opens the model pane. Esc skips without opening it. The `tui` section owns `colorTier`, `submitOnEnter` (Enter inserts a newline when false), `notify` (`off | attention | every-turn`, default `attention`), `notifyQuietInputSeconds` (non-negative integer, default 10), `brandAnimation` (shown as `自动 / 开启 / 关闭`), `scrollbar` (boolean, default `true`), `reasoning` and `statusDetails` (booleans, default `false`), `locale` (`zh-CN | en-US`, default `zh-CN`), and the validated `renderPolicy` described above. A `user-questions/request` waterfall listener is registered in the current runtime-root Agent scope; it delegates foreign and child requests with `next()`, while accepted requests paint `AskUserPane`, bind abort/replacement/disposal to one cleanup, and notify exactly once at admission. ↑↓/jk move the highlight, and digit then Enter returns the original option label. The slash directory includes each command's `description`.
- `g s` toggles the persisted session directory when the composer buffer is exactly `g`; `/resume` opens the same list and does not close it. Rows with equal folded titles append a stable shortest-unique session-id hint inline; rows with unique titles remain unchanged. Left/right move the composer caret one grapheme. ↑/k shift the conversation toward older rows and ↓/j return toward live; arrows scroll even with composer text, while j/k insert when the buffer is not empty. A detached conversation always shows `↓ 底部 · End/G`, adding the unseen-row count when new output arrives. The mouse wheel uses the same direction as ↑/k on the conversation and as j/k on list panes, moves `scroll.wheelRows` physical rows per report, and combines reports from one stdin chunk into one net request. Ctrl+N starts a new session, and directory actions switch, rename or delete sessions through the owned services. Delete calls the persistence service, which rejects live, reserved, or borrowed identities and removes derived projection-cache state after durable deletion.
- The terminal, fallback titles, and `/export` Markdown include only direct human `user/message` events (`source.kind === 'user'`) plus assistant replies. Durable model context from agent instructions, plugins, and skill catalogs is intentionally absent from this human transcript.
- Ctrl+K search requests `literal-substring` matching from `ctx.sessionQuery` and filters to `user`/`assistant` transcript roles, so a query such as `回复` finds visible `只回复` text without surfacing injected model context; other service callers retain the default token-phrase mode and complete semantic corpus.
- SIGINT follows the interaction state machine; SIGTERM and SIGHUP request exit. Exit flushes the owned session before the process exit request; `--frame-stats` writes its JSON in the same orderly-exit path.
- A non-TTY output stream or unsupported terminal is rejected before the render tree mounts. On a TTY pair the render layer enables SGR mouse and OSC 8; `/help` lists wheel, click-to-open, and drag-copy.

### Advanced entries and evidence

- [`RuntimeController`](src/index.ts) supplies running subagents to the renderer's [`Mention`](../tui-render/src/mention.tsx) and all owned children to [`AgentHubPane`](../tui-render/src/agent-hub-pane.tsx). In mention selection, Up/Down or j/k change the highlighted target, Enter inserts it with exactly one trailing space without submitting, and Escape dismisses the menu. `g a` opens Agent Hub. The session directory marks the controller-owned current parent inline, and Agent Hub renders exact children as `子会话 ID · {childId}` through [`SessionPane`](../tui-render/src/session-pane.tsx) and [`AgentHubPane`](../tui-render/src/agent-hub-pane.tsx); the assembled PTY compares those rows with ownership-derived model-admission markers, and no fixture configuration supplies either id. After this identity conversion, the controller enriches render-only Hub rows from `sessionProjections.snapshot()` for live children. Cold children first use `sessionProjectionCache.cachedSnapshot(header, keys)`; a miss borrows one exact persistence observation, folds its immutable metadata and complete ordered events through `coldSnapshot(meta, events)`, and always disposes the borrow. It sums the four durable token buckets, derives context occupancy only from measured pressure plus capacity, and uses the durable subagent timing projection; a model appears only when a registered child projection provides one, so the current projection set omits it rather than copying the parent's model. Missing services, failed cold reads, and absent values omit their segments without failing the identity table or inventing zeroes. The `Σ 子代理` row aggregates known token/duration fields and reports coverage. `SubagentListEntry` remains unchanged, and base composes the persisted projection cache exactly once.
- Empty `/plan` opens the plan directory; plan review remains the unique user-questions dialog, where `y` submits the host label `Approve` and `n` submits `Keep planning`. The goal footer, Todo HUD, jobs HUD, and workflow HUD/`g w` overlay are controller projections and leave the composer active. `g t` opens the workspace tree, and `g f` reads and writes message feedback through its sidecar service. Presenter-tagged tool results select generic, terminal, diff, search, read, or web cards; [`stream-view.tsx`](../tui-render/src/stream-view.tsx) displays complete reasoning only when enabled, bounds a closed tool stack to one summary plus three representative cards, displays nonzero terminal outcomes as failures, adds the completion boundary, and derives TurnTail products plus exact turn-local token/cache statistics.
- [`deepseek-tui-advanced-entry.expected.e2e.ts`](../../../apps/cli/tests/deepseek-tui-advanced-entry.expected.e2e.ts) drives the runnable profile. Its [`session.expected.jsonl`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/session.expected.jsonl) contains session-owned durable events, [`fixture-audit.expected.jsonl`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/fixture-audit.expected.jsonl) records message-feedback sidecar reads and transient workflow events, and [`terminal.expected.txt`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/terminal.expected.txt) records settled 80x24/200x50 cells plus normalized cold-child Hub row and aggregate evidence. The TUI files required by `vitest.expected.config.ts` own terminal transcripts under `test:expected`; top-level recorded-session snapshots separately own model replay and durable session output. The [advanced-capability Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.md) owns the rationale and verification distinctions.

### Terminal-native interactions

- Ctrl+Y copies the latest non-empty assistant message through OSC52 and an available host clipboard helper; the final closed backtick-fenced body wins over the whole message. Ctrl+G resolves `$VISUAL` before `$EDITOR`, prepares a private draft, leaves the alternate screen, runs the editor directly on `/dev/tty`, and remounts the same controller. Missing configuration and failed editor/readback paths keep the original composer text.
- A bracketed paste containing one local image path, or Ctrl+P with an image clipboard, adds a memory-only `[图片 #N]` segment to the structured draft. Send-time admission commits all unsaved segments through one ordered `saveImages()` batch and appends the interleaved text and durable `ImageBlock` references through the existing `user/message` event. Provider serializers resolve those references to transient request bytes; [`projection.ts`](../tui-render/src/projection.ts) renders only the message-local ordinal and optional path-stripped name, persistence loads the same blocks unchanged, and compaction preserves image-bearing prefixes while rejecting image summary output. The dedicated [`deepseek-tui-image.expected.e2e.ts`](../../../apps/cli/tests/deepseek-tui-image.expected.e2e.ts) proves composer intake, terminal replay, durable reference-only JSONL, and text/image/text provider order through the assembled profile. This path changes neither agent-loop nor `SessionEventMap`, so it adds no TypeScript or Python SDK upload operation or expected-output change.
- During a running turn, the first submitted immutable structured draft enters the existing `agent.steer()` path; later drafts remain in an in-memory FIFO. The HUD shows only not-yet-handed-off FIFO items as `待发 {n} · ↑ 取出`; Up restores the oldest item only while the composer is empty and no modal owner has captured the key. Inbox claim/discard, matching durable `user/message`, `turn/end`, and Agent idle events own cleanup and one-at-a-time FIFO promotion. Compaction events add a non-accent `✂ 已压缩` divider without deleting projected rows; Ctrl+K toggles the latest divider when present and otherwise keeps its session-search behavior. The [terminal-native interaction Agent Note](../../../.agents/notes/implemented/feature/2026-08-21-tui-terminal-native-polish.md) owns the rationale and trade-offs.
- Notifications fire on attention events, not every turn end: an approval ask or ask-user question pops the moment it enqueues, and a run settling to `agent/status` `'idle'` pops one summary line picked by the last `turn/end` reason (`✅ 任务完成`, `❌ 回合失败:{error}`, `⚠ 输出达到上限`, `⛔ 回合被策略阻塞`, `⚠ 异常中断收尾`; a user-initiated abort stays silent). Intermediate turn ends never notify, so an orchestration burst collapses into one popup. Input within `tui.notifyQuietInputSeconds` (non-negative integer, default 10s) downgrades the popup to BEL. The body carries `· {session title}` so parallel instances are distinguishable; `notify-send` receives `-u critical|normal`. iTerm2, VTE and Konsole use OSC 99; Windows Terminal uses OSC 9; other terminals receive BEL plus one best-effort literal `notify-send` attempt. Helper absence never changes turn settlement. `tui.notify` selects `off | attention | every-turn` (default `attention`; `every-turn` keeps the legacy per-turn popup).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) adds terminal-owned providers and runtime glue over the base bundle without duplicating base storage services. [`src/index.ts`](src/index.ts) owns controller and lifecycle integration, while [`../tui-render/`](../tui-render/README.md) owns terminal projection and painting.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [TUI package map](../README.md) — terminal runtime and renderer ownership.
- [TUI renderer](../tui-render/README.md) — bounded layout, input rendering, and terminal capabilities.
- [Terminal subsystem](../../../docs/subsystems/terminal.md) — terminal lifecycle and generated Cordis declarations.
- [Alpha.1 TUI compatibility decision](../../../.agents/notes/implemented/architecture/2026-08-28-alpha1-tui-compatibility.md) — composition and lifecycle rationale.

-----

<a id="model-experience"></a>
## Model Experience

### Terminal application request

#### What the model sees

The profile's system prompt identifies the terminal interface, while the runtime sends user input through the ordinary Agent APIs and reconstructs visible history from the session log. Source filtering affects only terminal presentation and export: non-human context messages remain in the durable log and in model request construction.

#### Token effect

The runtime adds no model-visible text beyond the profile's `system-prompt` configuration and ordinary user turns.

#### KV Cache effect

New turns append through the Agent's normal request construction; resuming reconstructs the session history before the next request, so cache reuse remains provider-dependent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Interactive terminal required** — non-TTY launches fail before mounting because the alternate-screen interface needs terminal control.
- **Cross-process session ownership** — one runtime owns one live Agent handle; switching waits for the previous owned handle to settle before another session is resumed.
- **Provider cache behavior** — the bundle preserves session history but cannot guarantee a provider's KV-cache retention across a resumed process.
- **`/reload` stacks a waiting Node** — the parent cannot `execve` in-place, so it waits until the child exits. Repeated `/reload` nests processes until you quit the innermost TUI.
- **Memory evidence is workload-specific** — keyless UI stress records cold activation and stable-stage RSS separately. Its cache and React timing checks do not attribute unrelated provider, subprocess, or fatal out-of-memory failures.
- **Draft FIFO is process-local** — later-turn drafts are not crash-recovered; only messages handed to the Agent inbox or appended to the session log have durable ownership.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
