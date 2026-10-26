# Composer phase 5 evidence — 2026-10-23

本轮恢复后的独立复核见 [acceptance-current.md](./acceptance-current.md)：重新跑基准与针对性测试，并复现、修复两处字素边界失败；Node24下最终23文件448通过/1可选benchmark跳过。以下原始记录保留为历史。

## 已验证

Latest follow-up: input-selection boundary now uses the shared index; 8 files / 239 tests passed / 1 optional benchmark skipped (`selection-integration-final.log`). Forty repeated warm selections at 700/7000/70000 UTF-16 units went from 318 Segmenter calls per size to 0, including range/copy operations. Replacement/delete also reuse the unchanged revision. CRLF snapping and crossing remain whole-grapheme operations. InputBar's layout-effect caret now uses writeTerminalControl(stdout, bytes, 'caret'); the registered queue source is checked by a regression test, while existing unregistered-stream tests remain passing. See `selection-summary.json`.

The unmodified composer-pty-fixture.tsx passes the ordinary `tui-render/tests/tsconfig.json` project compile. `tsc --listFilesOnly` confirms it is included; this was not a narrow fixture-only compilation. Log: `fixture-standard-tsconfig.log` (empty on successful exit 0).

- Red: `red.log` records four failures before implementation: 10/100/1000 lines mounted 11/101/1001 output rows. `vertical-red.log` records an emoji-internal caret (offset 4 instead of leading boundary 3).
- Green: `target-tests-final.log`: PASS, 8 files, 231 tests passed / 1 skipped (optional DSH_SCOPED_BENCH CPU benchmark from another worker). Tests use this repository's source and upstream read-only dependency symlinks, not an overwritten upstream checkout.
- `typecheck-owned.log`: owned production sources pass strict type checking via `/tmp/dsh-composer-phase5/tsconfig.json`.
- `typecheck-tests-final.log`: PASS, full render-test TypeScript project (exit 0, no diagnostics); earlier transient diagnostics in other agents’ stream code were superseded by the successful final project check.
- 80×24 and 120×40 mounted Yoga bounds tested for 10/100/1000 lines: total composer height ≤9 / ≤14 (header included). Data + hidden indicator rows ≤floor((rows-rowsBelow)/3). At tiny heights, indicator moves into the header to retain a caret row.
- Source, selection, copy/replacement and send use the complete canonical draft. Tests cover Chinese, combining glyphs, emoji, tabs, multiline range replacement, image tokens, restored history/editor text, stale external caret, secret masking, and middle/end IME anchors.
- Unchanged text shares newline offsets and lazily built per-line grapheme/column/token indexes. Forty tail movements: baseline segments about 120k/1.2M/12M UTF-16 units for 700/7000/70000 text; after warmup all three sizes record zero segmentation calls/units. Initial/new text indexing remains linear.

## Commands

```sh
# Initial red tests (own config, saved before implementation)
node_modules/.bin/vitest run --config /tmp/dsh-composer-phase5/vitest.config.mts

# Final targeted regressions, current source
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-tui-apply-vitest.config.mjs tui-render/tests/composer-cursor.spec.ts tui-render/tests/composer-index.spec.ts tui-render/tests/composer-tokens.spec.ts tui-render/tests/input-bar.spec.tsx tui-render/tests/input-bar-window.spec.tsx tui-render/tests/input-selection.spec.ts tui-render/tests/loop-keys.spec.tsx tui-render/tests/loop-input.spec.tsx

node node_modules/typescript/bin/tsc --noEmit -p /tmp/dsh-composer-phase5/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json

# Serial baseline then current; five warm SSR samples, five PTY moves and inserts per size/geometry
COMPOSER_SOURCE_ROOT=/tmp/dsh-composer-phase5/baseline/tui-render/src node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/dsh-composer-phase5/benchmark-before-serial.json
COMPOSER_SOURCE_ROOT=/home/zhangyangrui/my_programes/dsh-tui/tui-render/src node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/dsh-composer-phase5/benchmark-after-serial.json

git diff --check -- tui-render/src/input-bar.tsx tui-render/src/composer-cursor.ts tui-render/tests/composer-cursor.spec.ts
```

Baseline input-bar/composer-cursor were read from HEAD into an owned `/tmp` copy of dependencies; source files were not copied into the daily upstream checkout. Exact HEAD and owned source hashes: `source-identity-phase5.json` for the original benchmark revision, `source-identity.json` for the follow-up; benchmark JSON includes source hashes and all samples. Earlier baseline runner setup failures are retained in tool history (external tsx JSX/config handling); serial benchmark runs succeeded.

| PTY geometry | UTF-16 units | Warm SSR median ms before → after | PTY move median ms before → after | PTY insert median ms before → after |
|---|---:|---:|---:|---:|
| 80×24 | 700 | 11.72 → 9.34 | 9.47 → 5.01 | 7.92 → 5.25 |
| 80×24 | 7000 | 52.59 → 10.64 | 53.13 → 5.90 | 49.71 → 7.57 |
| 80×24 | 70000 | 448.43 → 9.13 | 405.74 → 6.36 | 390.04 → 34.63 |
| 120×40 | 700 | 19.29 → 7.61 | 11.21 → 5.77 | 8.81 → 5.19 |
| 120×40 | 7000 | 53.33 → 6.72 | 47.40 → 5.81 | 44.61 → 8.10 |
| 120×40 | 70000 | 463.08 → 6.58 | 415.67 → 7.79 | 407.48 → 38.16 |

SSR uses Ink renderToString at 80 or 120 columns, with its fixed 24-row mock. PTY uses actual node-pty at the listed columns/rows; acknowledgment is emitted after useApp.waitUntilRenderFlush(), which explicitly settles pending Ink throttle (fixture maxFps 120). Measurements are independent fixture numbers, not physical key-to-photon or live provider/session results. Cold/new-revision samples are separate fields in the JSON; do not treat warm SSR as new-text ingestion latency.

## 未验证 / integration work for main agent

- Do not mark 5.1–5.4 complete solely from this report; main agent must verify integration and evidence. tasks.md was not edited.
- `loop.tsx` composerHeight integration belongs to Franklin. This worker did not edit loop.tsx or independently validate Franklin’s final height-budget integration.
- The previously reported input-selection.ts prefix-scan gap is resolved in the follow-up. The saved historical PTY benchmark deliberately measures InputBar + indexed cursor helpers and still does NOT represent the full TuiLoop pipeline; its numbers are not relabeled as an application benchmark.
- Restore tests exercise owner-supplied history/editor strings and existing loop key/input regression suites; no real external editor executable or clipboard/image service was launched.
- Initial indexing and changed-text insertion remain proportional to the changed revision (70k insert fixture ~35–38 ms). Credential masking in secret-input.ts remains full-text and was outside scope.
- No physical terminal screen oracle, full app PTY latency, live authentication/model call, five-minute session, release/build or publish was run by this worker. Main agent owns full offline gate and integration.
- A single most-recent pure-helper draft index plus each mounted editor's current useMemo index are retained; revision replacement releases their prior derived indexes. Hidden logical lines are indexed only on visit.

## 阻塞

No blocker for the assigned source implementation. Final full-app performance acceptance and loop.tsx layout integration remain the main agent’s responsibility; the input-selection boundary gap is resolved. No commits, pushes, publication, task checkboxes, AGENTS.md, CLAUDE.md or pre-existing docs were modified by this worker.


## Follow-up commands and reproducibility

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-tui-apply-vitest.config.mjs tui-render/tests/input-selection.spec.ts tui-render/tests/composer-index.spec.ts tui-render/tests/composer-cursor.spec.ts tui-render/tests/input-bar.spec.tsx tui-render/tests/input-bar-window.spec.tsx tui-render/tests/terminal-output.spec.ts tui-render/tests/loop-keys.spec.tsx tui-render/tests/loop-input.spec.tsx
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
node node_modules/typescript/bin/tsc --listFilesOnly -p tui-render/tests/tsconfig.json
```

Reproduction scripts remain in `tui-render/tests/composer-benchmark.mjs` and `composer-pty-fixture.tsx`. Key evidence has been copied here from /tmp; original commands above retain the paths actually used. In a fresh prepared validation workspace, use its generated Vitest config/current source mapping rather than requiring these old /tmp paths. To re-run the benchmark against current sources:

```sh
node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/composer-current.json
```

To reconstruct the baseline source without touching the daily upstream checkout: create a /tmp directory with a copy of `tui-render/src` and `tui-render/package.json`, replace only input-bar.tsx and composer-cursor.ts from commit `1d25152831ede97cd2f706967020dd23f1053f1d` using `git show`, link that temporary package’s node_modules to the prepared render dependencies, and pass its src path via COMPOSER_SOURCE_ROOT. The baseline runner supports classic JSX when loading isolated source files. Historical benchmark source hashes are preserved separately from follow-up source hashes.
