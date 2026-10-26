# Stage 3.1–3.4 engineering verification

Scope: scripts/build.js, scripts/dev-setup.js, scripts/typecheck.js, scripts/validation.js,
scripts/validation-tools.json, scripts/validation-lock.patch, package.json,
.github/workflows/ci.yml, .github/workflows/publish.yml,
tests/validation.test.js, tests/workflows.test.js.
No product source edits, task checkbox changes, commits, pushes or publication performed by this worker.
Original untracked AGENTS.md, CLAUDE.md and docs retained. Existing editor node_modules links retained.

## 已验证

- RED: original CI command `node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests --maxWorkers 2` exited 1 with `No test files found` in repository cwd. See baseline-cwd.log.
- RED: new validation contract initially failed because scripts/validation.js did not exist. See red.log. Updated workflow contracts initially failed 2/2. See workflow-red.log.
- `node --test tests/validation.test.js tests/workflows.test.js`: 9 passed / 0 failed / 0 skipped. See targeted.log. Expected inner SENTINEL failures are caught by the outer regression tests.
- `npm test`: 53 passed / 0 failed / 0 skipped. See root-tests.log.
- Real Vitest negative fixture: old mirror passes; mounting repository CURRENT_SOURCE_SENTINEL test fails. Empty TUI tests also fail. Fixtures are isolated in /tmp and cleaned by node:test.
- Dirty upstream fixture: source local edit and untracked file survive preparation; mirror destination symlink is removed without deleting its external target; mounting an unowned checkout is rejected.
- `DSH_TUI_OFFLINE=1 DSH_TUI_STORE_DIR=/home/zhangyangrui/.local/share/pnpm/store npm run validate:prepare`: frozen offline install passed, 0 downloads, fresh tool-owned DSH workspace /tmp/dsh-tui-validation-21MdYW/dsh. See prepare.log.
- Dependency links checked: 39 top-level dependency symlinks remain inside the isolated DSH workspace. Original three editor links still target the developer checkout.
- Node v22.23.1; pnpm 11.28.5; esbuild 0.28.2; TypeScript 6.0.3; Vitest 4.1.11; tsx 4.23.13. Tools are pinned in validation-tools.json and frozen lock patch, never selected by store sorting.
- Publication gate regression rejects changed source, bundle, and tarball hashes. Five bundle hashes are required. Packed fixture exports import successfully; a throwing packed runtime import fails.
- Script syntax, workflow YAML parse, patch runtime dependency declarations and git diff --check passed. See static-checks.txt.
- Developer upstream `git status --short` matches the initial observed state; see upstream-status.txt. No upstream checkout source was overwritten.

## 未验证

- Complete `npm run validate` (full current-source build, complete real TUI suite and real release tarball imports) intentionally reserved for primary agent.
- Real GitHub CI Node 22.19.0/24 execution, network bootstrap on a machine without a dependency cache, Windows/macOS, and any live/authenticated runtime flow.
- No registry publish or release upload was executed. CI/publish YAML has static and regression coverage only.

## 阻塞

- Last `npm run typecheck` failed on concurrent product edits in tui/src/index.ts at lines 5066/5071/5079: write-only notification adapter is not assignable to WriteStream (TS2345). See typecheck.log. Product files are outside this worker's write scope; primary agent notified. Earlier unneeded createProjector import in stream-history.spec.tsx was also caught, and is no longer present in current source.

## Primary agent handoff

Full offline gate:
`DSH_TUI_OFFLINE=1 DSH_TUI_STORE_DIR=/home/zhangyangrui/.local/share/pnpm/store npm run validate`

Individual commands: `npm run validate:prepare`, `npm run typecheck`, `npm run build`, `npm run test:tui`.
`DSH_SOURCE` is a read-only clone source (defaults to sibling checkout, falling back to official remote if absent).
prepare always creates a unique tool-owned clone from dsh-vCOMPATIBLE_DSH_VERSION. It applies the checked-in lock patch and uses frozen install.
Full validation records source commit/hash, upstream commit/version/lock, effective lock, Node hash, pinned tools, counts, five bundle hashes and tarball hash.
The successful pointer is .runtime/validation/verified.json; the proof/tarball/test logs live in the reported /tmp workspace.
Run `npm run verify:artifact -- /absolute/path/provenance.json` to recheck the exact artifact. CI and publish use the same validate entrypoint; publish/upload consume that tarball without repacking.
Existing editor links are not release evidence. Temp workspace deletion requires re-preparation. When changing compatible upstream or plugin dependency manifests, regenerate and review scripts/validation-lock.patch; frozen install deliberately fails on drift.
