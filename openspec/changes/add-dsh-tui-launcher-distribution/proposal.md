## Why

The TUI currently requires contributors to remember `pnpm dsh --profile deepseek-tui` inside a full DSH checkout, and it has no safe upgrade command or installable package owned by this project. A stable `dsh-tui` launcher should make the private source build usable now and prepare a scoped npm distribution without pretending unavailable DSH packages can already support public installation.

## What Changes

- Add a `dsh-tui` executable that forwards ordinary arguments to the `deepseek-tui` DSH profile.
- Add `dsh-tui version` and `dsh-tui update` management commands.
- Make source-mode updates operate on a dedicated runtime checkout, require a clean worktree, fetch the configured private branch, and accept only fast-forward updates before refreshing dependencies.
- Add a root npm package named `@crazyhappyone/dsh-tui` with the `dsh-tui` bin and a package layout that can later depend on a compatible published DSH runtime.
- Keep public npm release gated until a compatible `@deepseek-ai/dsh` version containing the required TUI integration is available; do not publish a broken `latest` package.
- Document npm authentication, scoped publication, source-runtime installation, update behavior, recovery, and the current distribution limitation.

## Capabilities

### New Capabilities

- `dsh-tui-launcher`: Direct TUI launch, version reporting, dedicated source-runtime configuration, and safe fast-forward updates.
- `npm-distribution`: Scoped npm package metadata, tarball contents, install verification, release prerequisites, and authenticated publication procedure.

### Modified Capabilities

None.

## Impact

The change affects the private repository root, a new launcher implementation and tests, npm package metadata, bilingual documentation, and OpenSpec records. It invokes `git` and `pnpm` only through argument arrays, stores no credentials, does not mutate the contributor's DSH development checkout, and adds no behavior to the DSH agent loop or plugin packages.
