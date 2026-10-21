# GitHub issues 14–16 — 2026-10-21

Repository: `zhangyang-crazy-one/dsh-tui`; branch: `fix/github-issues-14-16`.
Base: `2cc5c3af05f2d7bd9acd0662330c202ca0188bb6` (published alpha.50 plus release verification).

## Goal and scope

Resolve the three open, reproducible TUI defects without changing official DSH service ownership or adding configuration readers.

| Issue | Acceptance criterion | Implementation |
| --- | --- | --- |
| [#14](https://github.com/zhangyang-crazy-one/dsh-tui/issues/14) | Failed audit-only streams leave no ordinary message; live and replay agree; successful/interrupted committed messages remain | Clear uncommitted projection content at stream end |
| [#15](https://github.com/zhangyang-crazy-one/dsh-tui/issues/15) | Reopening initializing/waiting SSH login restores forwarding, never auto-opens the remote browser, and preserves explicit opening | Derive forwarding from environment/listener on account snapshots; check SSH independently of pane state |
| [#16](https://github.com/zhangyang-crazy-one/dsh-tui/issues/16) | After `/cd B`, relative file paths resolve from B; absolute paths, cwd fallback and failed-path preservation work | Pass Session cwd to official `ctx.fs.resolve` |

Account watch closure does not cancel the official sign-in attempt. DSH commits durable events before stream-end notifications; `assistant/attempt` is audit-only and interrupted prefixes use `assistant/message`. These contracts were checked against the installed official source.

## 已验证

- Before fixes, account/workspace tests: 5 failed / 36 passed. Evidence: `/tmp/dsh-issues-15-16-red.log`.
- Projection regression failed with `DISCARDED PARTIAL` in live history before its fix.
- Main-agent rerun after fixes: 3 files / 75 tests passed. Evidence: `/tmp/dsh-issues-14-16-targeted.log`.
- File-panel regression uses the real official LocalFileSystem over temporary A/B directories; the working-directory service boundary is scripted. It checks unchanged filesystem deployment cwd as well as Session-relative resolution.
- `npm run build`: all five bundles built and imported against DSH `0.2.1-rc.2`; only `dist/index.js` changed. Evidence: `/tmp/dsh-issues-build.log`.
- `npm run dev:setup` then `npm run typecheck`: four strict source/test projects passed. Evidence: `/tmp/dsh-issues-setup.log`, `/tmp/dsh-issues-typecheck.log`.
- Full TUI regression: 169 files / 2245 tests passed. Evidence: `/tmp/dsh-issues-full-tui-final.log`.
- Launcher/package regression: 46 tests passed; `npm run pack:check` passed (22 package entries). Evidence: `/tmp/dsh-issues-launcher-tests.log`, `/tmp/dsh-issues-pack.log`.
- The first full run exposed an existing test synchronization defect: the cold-rename test captured session rows before their persisted titles finished loading (1 failed / 2244 passed). Its precondition now waits for all three fixture titles before taking the immutable snapshot. No session runtime behavior changed. Evidence: `/tmp/dsh-issues-full-tui.log`.
- Main-agent review of projection contracts and an independent read-only review of account/cwd changes found no blocking defects. Main-agent execution independently confirmed the targeted and full counts above; review alone is not counted as execution.
- `git diff --check` passed; README and changelog describe the revised behavior in English and Chinese.
- Fix commit [`7f93ca8e1ebd7167447a2c0178f2b644af4ce4a7`](https://github.com/zhangyang-crazy-one/dsh-tui/commit/7f93ca8e1ebd7167447a2c0178f2b644af4ce4a7) was pushed to `origin/main`. [GitHub CI run 39538429995](https://github.com/zhangyang-crazy-one/dsh-tui/actions/runs/39538429995) passed on Node 22.19.0 and 24.
- GitHub confirmed #14, #15 and #16 closed at `2026-10-21T03:24:50Z`–`03:24:52Z`; the repository has no remaining open issues at verification time.

## 未验证

- Real SSH browser authentication and live model failures are not exercised by the offline regressions. Account services and stream frames are scripted.
- No new npm release has been created for these changes; alpha.50 remains the published version.

## 阻塞

None. Implementation, local verification and GitHub delivery are complete. A future npm release must use a new version; the published alpha.50 package does not include this later fix commit.
