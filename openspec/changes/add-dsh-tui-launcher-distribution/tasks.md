## 1. Package and Test Contract

- [x] 1.1 Add the scoped root package manifest, executable file layout, ignore rules, and MIT license without including TUI source mirrors in the npm payload.
- [x] 1.2 Add failing Node tests for command parsing, argument pass-through, version output, runtime-path validation, initial clone, clean fast-forward update, dirty rejection, divergence rejection, and dependency failure.

## 2. Launcher Implementation

- [x] 2.1 Implement deployment setting resolution and side-effect-free management command parsing.
- [x] 2.2 Implement direct TUI launch through `pnpm dsh --profile deepseek-tui` with inherited stdio and exact exit propagation.
- [x] 2.3 Implement source runtime clone and clean fast-forward update using shell-free Git and pnpm argument arrays.
- [x] 2.4 Implement version reporting and actionable failure diagnostics without credential output.

## 3. Documentation and Distribution

- [x] 3.1 Update the English and Chinese root README pair with install, launch, source configuration, update, version, recovery, npm authentication, and publication commands.
- [x] 3.2 Re-record the root bilingual sidecar and keep package READMEs focused on the DSH bundle and renderer contracts.
- [x] 3.3 Confirm authenticated npm identity and document the occupied unscoped name plus the selected `@crazyhappyone/dsh-tui` scope.

## 4. Verification

- [x] 4.1 Run the launcher tests through both unit adapters and real temporary Git repositories.
- [x] 4.2 Run `npm pack --dry-run --json`, inspect the exact payload, install the tarball under a temporary global prefix, and execute its `dsh-tui version` bin.
- [x] 4.3 Run OpenSpec strict validation, Markdown/link/pair checks, `git diff --check`, and inspect the final source and package diff.
- [x] 4.4 Leave `npm publish` unexecuted until packed-install evidence passes and the authenticated operator explicitly authorizes the target tag and supplies any required OTP.
