## ADDED Requirements

### Requirement: Direct command launches the DSH TUI profile
The launcher SHALL run the configured package manager in the dedicated runtime checkout with `dsh --profile deepseek-tui` followed by every non-management argument in its original order. It MUST invoke child commands without a shell and MUST return the child exit status or signal outcome.

#### Scenario: Launch without application arguments
- **WHEN** the user runs `dsh-tui` and the runtime checkout is ready
- **THEN** the launcher executes `pnpm dsh --profile deepseek-tui` in that checkout with inherited interactive stdio

#### Scenario: Forward TUI arguments
- **WHEN** the user runs `dsh-tui --resume session-1`
- **THEN** the launcher appends `--resume` and `session-1` unchanged after the profile selector

#### Scenario: Send a reserved word as a task
- **WHEN** the user runs `dsh-tui -- update`
- **THEN** the launcher removes the separator and forwards `update` to the TUI instead of selecting the update command

### Requirement: Source update owns a dedicated runtime checkout
`dsh-tui update` SHALL operate only on the resolved runtime directory. It MUST clone the configured remote and ref when absent; for an existing checkout it MUST reject uncommitted state and non-fast-forward history before changing HEAD. It MUST NOT stash, reset, clean, force, or modify a different checkout.

#### Scenario: Initialize an absent runtime
- **WHEN** the runtime directory does not exist and the configured remote and ref are accessible
- **THEN** the launcher clones that ref into the runtime directory and runs `pnpm install --frozen-lockfile`

#### Scenario: Fast-forward an existing runtime
- **WHEN** the runtime is clean and its HEAD is an ancestor of the fetched configured ref
- **THEN** the launcher merges `FETCH_HEAD` with `--ff-only`, refreshes frozen dependencies, and reports the old and new SHAs

#### Scenario: Reject a dirty runtime
- **WHEN** `git status --porcelain` returns any entry
- **THEN** the update exits nonzero before fetch or merge and identifies the dedicated runtime path that must be cleaned

#### Scenario: Reject divergent history
- **WHEN** the fetched ref does not descend from the current runtime HEAD
- **THEN** the update exits nonzero without changing HEAD and requires an explicit runtime replacement or reviewed history operation

#### Scenario: Dependency refresh fails
- **WHEN** the source fast-forward succeeds but `pnpm install --frozen-lockfile` fails
- **THEN** the update exits nonzero, reports the current runtime HEAD and recovery command, and does not claim readiness

### Requirement: Version output identifies launcher and runtime
`dsh-tui version` SHALL print the launcher package version, resolved runtime directory, runtime Git SHA when available, and DSH root package version when readable. Missing runtime state SHALL be reported without creating or updating it.

#### Scenario: Version before runtime initialization
- **WHEN** the user runs `dsh-tui version` before `dsh-tui update`
- **THEN** the command reports the launcher version and an uninitialized runtime without network or filesystem mutation

#### Scenario: Version for an initialized runtime
- **WHEN** the runtime contains Git HEAD and a root package manifest
- **THEN** the command prints their exact SHA and DSH version

### Requirement: Deployment inputs are explicit and validated
The launcher SHALL resolve runtime directory, source URL, source ref, and package-manager executable from documented environment variables with stable defaults. Empty values, a runtime path that is a symbolic link, and an existing non-Git runtime directory MUST fail before a destructive or network operation.

#### Scenario: Runtime path is a symbolic link
- **WHEN** the resolved runtime directory is a symbolic link
- **THEN** update and launch refuse the path without following or removing the link

#### Scenario: Custom compatible source
- **WHEN** the user supplies non-empty `DSH_TUI_SOURCE_URL` and `DSH_TUI_SOURCE_REF`
- **THEN** clone and fetch use those exact argument values without shell interpolation
