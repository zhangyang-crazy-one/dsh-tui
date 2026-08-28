## ADDED Requirements

### Requirement: Scoped package owns the launcher bin
The root manifest SHALL name `@crazyhappyone/dsh-tui`, declare the public `dsh-tui` bin, require a supported Node engine, and include only the executable runtime, license, package README pair, and required package metadata in the published tarball. It MUST NOT claim or publish the occupied unscoped `dsh-tui` name.

#### Scenario: Pack the npm artifact
- **WHEN** `npm pack --dry-run --json` runs from a clean package checkout
- **THEN** the reported files contain the declared launcher payload and exclude tests, OpenSpec working artifacts, TUI source mirrors, credentials, local runtime state, and Git data

#### Scenario: Install into a temporary prefix
- **WHEN** the packed tarball is installed globally under a temporary npm prefix
- **THEN** that prefix exposes a runnable `dsh-tui` command whose `version` output matches the tarball version

### Requirement: Runtime access limitations fail explicitly
The npm package SHALL state that its default source remote is private and requires Git authorization. Installation MUST NOT run a clone, dependency installation, credential prompt, or postinstall script; the user initiates runtime creation with `dsh-tui update` and may configure another compatible source.

#### Scenario: Anonymous user installs the package
- **WHEN** npm installation succeeds but the user lacks access to the default private source
- **THEN** package installation remains successful and `dsh-tui update` reports the Git access failure without exposing credentials or leaving a ready claim

### Requirement: Authentication and publication remain operator-owned
The repository SHALL document npm web login, `npm whoami`, scoped public publication, 2FA OTP handling, and tag selection. The implementation MUST NOT read, store, print, commit, or publish the npm authentication token, and publication MUST remain an explicit operator action.

#### Scenario: Publish prerelease after authorization
- **WHEN** packed-install checks pass and the authenticated `crazyhappyone` operator explicitly authorizes publication
- **THEN** the release command is `npm publish --access public --tag next` with an operator-supplied OTP when npm requires it

#### Scenario: Publication has not been authorized
- **WHEN** implementation and local verification complete without an explicit publish instruction
- **THEN** no registry package or dist-tag is created or changed

### Requirement: Runtime and launcher upgrades are distinct
`dsh-tui update` SHALL update the configured DSH runtime source. Updating the npm launcher itself SHALL use an explicit npm global install of a selected package version or dist-tag; neither operation may silently perform the other.

#### Scenario: Update runtime source
- **WHEN** the user runs `dsh-tui update`
- **THEN** only the dedicated source runtime and its dependencies are updated

#### Scenario: Update launcher package
- **WHEN** the operator runs `npm install --global @crazyhappyone/dsh-tui@next`
- **THEN** npm updates the launcher package while leaving the dedicated runtime checkout unchanged until the next explicit `dsh-tui update`
