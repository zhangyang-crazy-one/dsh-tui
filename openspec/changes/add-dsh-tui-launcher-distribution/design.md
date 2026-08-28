## Context

The private TUI repository is a source mirror, while the runnable application remains the `deepseek-tui` profile in a full DSH checkout. This machine has no installed `dsh`; npm authentication belongs to `crazyhappyone`, the unscoped `dsh-tui` name belongs to another maintainer, and the compatible DSH alpha packages are not yet available from npm. The first distribution therefore needs to manage a dedicated source checkout without touching the contributor's development tree, while the npm package supplies the launcher rather than falsely bundling an unavailable DSH runtime.

## Goals / Non-Goals

**Goals:**

- Provide `dsh-tui`, `dsh-tui version`, and `dsh-tui update` as one ESM executable.
- Forward ordinary arguments unchanged to `pnpm dsh --profile deepseek-tui` in a dedicated runtime checkout.
- Clone or fast-forward a configured DSH source branch safely and refresh its lockfile-pinned dependencies.
- Publish the launcher under the available scope `@crazyhappyone/dsh-tui` after local tarball/install verification and explicit user authorization.
- Keep credentials out of files, output, package contents, and child environments owned by this project.

**Non-Goals:**

- Update the contributor's existing `/home/zhangyangrui/my_programes/deepseek-harness` checkout.
- Merge upstream DSH history, resolve branch conflicts, or bypass the existing upstream-sync OpenSpec requirements.
- Publish packages in the `@deepseek-ai` scope or reuse the occupied unscoped `dsh-tui` name.
- Claim that anonymous npm users can clone the default private runtime remote; they must have repository access or configure another compatible source URL.
- Publish a `latest` package before explicit authorization and successful packed-install evidence.

## Decisions

### The npm package is a source-runtime launcher

The root package will be `@crazyhappyone/dsh-tui` and expose the `dsh-tui` bin. It will not copy or rescope the DSH dependency graph. Ordinary execution launches the DSH source command in a dedicated runtime checkout; this makes the current private build usable without waiting for unreleased official packages.

An npm wrapper that depended on `@deepseek-ai/dsh@latest` was rejected because the registry currently serves `0.1.1-rc.2`, which does not contain this TUI integration. Bundling the complete DSH workspace or publishing a rescaled dependency family was rejected as a separate release system with unacceptable size and maintenance cost.

### Runtime location and source are explicit deployment settings

The launcher resolves the runtime directory from `DSH_TUI_RUNTIME_DIR`, defaulting to the platform home under `.local/share/dsh-tui/runtime`. It resolves the remote from `DSH_TUI_SOURCE_URL`, defaulting to the private DSH repository, and the branch from `DSH_TUI_SOURCE_REF`, defaulting to `feat/deepseek-tui`. These are process inputs, not hidden package constants that vary by deployment.

The default supports the owner's current private workflow. Other users must have Git credentials for that repository or select a compatible source URL and ref. The launcher never reads or writes an npm token.

### `update` accepts only a clean fast-forward source transition

When the runtime is absent, `update` clones the configured branch. When it exists, the launcher validates that it is a real Git checkout, rejects a dirty worktree, fetches the configured ref, and proves the current HEAD is an ancestor of `FETCH_HEAD` before running `git merge --ff-only FETCH_HEAD`. It then runs `pnpm install --frozen-lockfile` in the runtime.

The launcher passes argument arrays directly to child processes with `shell: false`. It reports the exact failed operation and nonzero status. It does not stash, reset, clean, force, merge divergent history, or alter another checkout.

### Management words are explicit

An exact first argument of `update` or `version` selects launcher management. Every other argument is forwarded to the TUI profile. `dsh-tui -- update` removes the launcher separator and sends the literal task `update` to the TUI.

### The launcher is plain ESM with injected process adapters

The executable remains a small JavaScript entry over named ESM functions. Command execution, filesystem reads, home resolution, and output streams enter through one runtime object so tests can prove command arrays and failure states without mocking internal modules. Node's built-in test runner keeps the publish package dependency-free.

## Risks / Trade-offs

- **Private default remote limits anonymous installs** → README and diagnostics state the access requirement; `DSH_TUI_SOURCE_URL` and `DSH_TUI_SOURCE_REF` support authorized forks without code changes.
- **Dependency refresh can fail after a successful fast-forward** → the launcher reports the new HEAD and exact recovery command; it never describes the runtime as ready until `pnpm install --frozen-lockfile` succeeds.
- **Reserved management words can shadow a user task** → `dsh-tui -- <task>` provides an explicit pass-through escape.
- **Global npm update differs from runtime update** → `dsh-tui update` updates TUI runtime source only; launcher package upgrades remain the explicit `npm install --global @crazyhappyone/dsh-tui@<tag>` operation.
- **A future official DSH package may make source management unnecessary** → the launcher contract can add a packaged-runtime provider in a later change without changing the current command vocabulary.

## Migration Plan

1. Pack and install the scoped package into a temporary npm prefix.
2. Prove `version`, absent-runtime diagnostics, argument forwarding, initial clone, fast-forward update, dirty rejection, divergent rejection, and dependency-install failure.
3. Install the packed launcher locally for the owner only after verification.
4. Publish under `next` only after explicit authorization; promote to `latest` in a separate release decision.
5. Roll back the launcher with `npm install --global @crazyhappyone/dsh-tui@<previous-version>`; the dedicated runtime checkout remains separate and recoverable.

## Open Questions

None. npm publication itself remains an explicit external action after implementation evidence and user authorization.
