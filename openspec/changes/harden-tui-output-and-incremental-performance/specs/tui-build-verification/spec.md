## ADDED Requirements

### Requirement: Verification targets current source

CI and release validation SHALL share a reproducible entrypoint or a verified artifact chain that mounts the current repository source, prepares compatible DSH dependencies and declarations, performs typechecking and builds, executes launcher and TUI tests in the correct working directories, and checks the packed entrypoints. Zero collected tests or any failed stage MUST fail validation.

#### Scenario: Fresh checkout with no mounted plugin source
- **WHEN** validation starts from a fresh repository and isolated compatible DSH workspace
- **THEN** it explicitly prepares current plugin source before setup and tests, collects nonzero launcher and TUI tests, and imports the packed runtime entrypoints successfully

#### Scenario: Current-source failure cannot be hidden by an older mirror
- **WHEN** the current repository contains a failing TUI test while an older workspace mirror passes
- **THEN** validation executes the current test and fails rather than accepting the mirror

### Requirement: Isolated and attributable artifacts

Verification SHALL use a tool-owned workspace without overwriting unrelated upstream edits. Build provenance SHALL identify source, DSH version and dependency lock, Node and build tool identities, and output hashes. Release MUST consume the verified artifact or verify a rebuild against its recorded provenance before publication.

#### Scenario: Dirty developer checkout exists
- **WHEN** verification runs while a developer's upstream checkout has local edits
- **THEN** the edits are untouched and the verification workspace is isolated from them

#### Scenario: Bundle differs from verified output
- **WHEN** source identity or bundle hashes differ from the artifact's verification record
- **THEN** publication is blocked until that exact source and artifact pass validation; matching gitHead alone does not satisfy the gate

#### Scenario: Local verification finishes without publication authorization
- **WHEN** all local validation stages pass without an explicit publication instruction
- **THEN** no registry package or dist-tag is changed
