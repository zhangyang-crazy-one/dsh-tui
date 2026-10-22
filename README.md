---
description: "DeepSeek Harness terminal interface: a dsh plugin bundle plus its launcher."
kind: "package-group"
---

# dsh-tui — DeepSeek Harness terminal interface

English | [中文](README.zh.md)

[![CI](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/zhangyang-crazy-one/dsh-tui?include_prereleases)](https://github.com/zhangyang-crazy-one/dsh-tui/releases)
[![npm next](https://img.shields.io/npm/v/%40crazyhappyone%2Fdsh-tui/next?label=npm%40next)](https://www.npmjs.com/package/@crazyhappyone/dsh-tui)

## Summary

`@crazyhappyone/dsh-tui` is a terminal interface for DeepSeek Harness (dsh), shipped as a dsh **plugin bundle** plus a `dsh-tui` launcher. The package declares `dsh.bundle`, so dsh installs it into a profile like any other plugin; the launcher only automates that install and boots the profile. This repository owns the plugin sources (`tui/`, `tui-render/`). DSH continues to own agents, sessions, tools, persistence, providers, permissions, and profile assembly.

## Release 0.1.0-alpha.53

This prerelease targets DSH `0.2.1-rc.2`. String arrays such as `defaultInput` now edit in place, settings details truncate long values at the visible row budget, and settled transcript rows reuse their projection while unchanged. See the [changelog](CHANGELOG.md#010-alpha53--2026-10-22) for the verification boundary.

```sh
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui probe
dsh-tui
```

Both lightweight and source modes now default to the official `deepseek-tui` profile under `$DSH_HOME/profiles/` (normally `~/.dsh/profiles/`). `/model` reads `ctx.llm`, and model selection uses DSH's `agentDefaultModel`; this bundle does not read a private model configuration or copy another profile's providers. Magpie writes existing `profiles/*/cordis.patch.yml` files. If Magpie is connected before a new profile is created, refresh its DSH connection/catalog after the profile exists and restart the TUI.

Earlier lightweight versions used `tui`, while source mode used `deepseek-tui`. Neither directory is deleted or migrated automatically. To retain an older lightweight profile, run `dsh-tui --profile tui`. To use another TUI-enabled official profile, pass `--profile NAME`: installation and boot use that exact same target in either mode. Profiles remain independently configured by DSH; a provider configured only in `web` is not automatically global.

For a running source-linked installation, `/reload` loads the rebuilt bundle but preserves that process's selected profile. To change from `tui` to `deepseek-tui`, quit and launch again (or pass the desired profile explicitly). Resumed Goals require `/goal resume` to enable automatic continuation.

In `/settings`, Tab / Shift+Tab switches categories and restores each category's location. Enter opens a namespace, provider or model, edits a field, or changes a supported boolean/choice. ←/Esc returns one level and closes at the category root; `/` searches; `i` edits an editable object's JSON; Space also changes supported values. While searching, arrows and page keys move through results, Enter accepts the search without resetting selection, and Esc clears it. Successful edits stay in place and use DSH's official settings/credential services. Tabs are operated with the keyboard. See the [verification and screenshots](docs/settings-usability-2026-10-21/verification.md) for the 40/80/120-column PTY checks and their limits.

## Table of Contents

- [Release and upgrade](#release-010-alpha53)
- [Changelog](CHANGELOG.md)
- [Terminal capabilities](#terminal-capabilities)
- [Screenshots](#screenshots)
- [Install the launcher](#install-the-launcher)
- [Run and update](#run-and-update)
- [Configure the source runtime](#configure-the-source-runtime)
- [Relationship to DSH](#relationship-to-dsh)
- [Packages](#packages)
- [Development workflow](#development-workflow)
- [Publish the npm package](#publish-the-npm-package)
- [Known limitations](#known-limitations)
- [Dev Note](#dev-note)

-----

<a id="screenshots"></a>
## Screenshots

Settings category tabs and nested provider navigation (`/settings`, 80-column OS PTY with a synthetic catalog):

![dsh-tui settings pane](assets/screenshots/dsh-tui-settings.png)

After sending `你好`:

![dsh-tui response after sending hello](assets/screenshots/dsh-tui-hello.png)

-----

<a id="install-the-launcher"></a>
## Install the launcher and runtime modes

The unscoped `dsh-tui` package belongs to another maintainer. This project publishes only under the authenticated `crazyhappyone` npm scope.

`dsh-tui` supports two runtime modes:

### Mode A: Lightweight Mode (Recommended, Zero-Clone)
Install the official engine and the TUI launcher globally:

```text
npm install --global @deepseek-ai/dsh
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui probe
dsh-tui
```

The first launch runs `dsh plugin --profile deepseek-tui add <package directory>`, which links this package into the `deepseek-tui` profile after `@deepseek-ai/dsh-base`; later launches find it there and run `dsh --profile deepseek-tui` directly. Without the launcher, the same two dsh commands work by hand:

```text
dsh plugin --profile deepseek-tui add @crazyhappyone/dsh-tui@next
dsh --profile deepseek-tui
```

Installing as a bundle matters in dsh 0.2: `/settings` edits are written to the profile's own patch layer, which applies after bundle layers. A `--patch` overlay would apply after the profile layer and dsh refuses settings writes to rows such an overlay owns.

Detection checks an absolute `DSH_BIN` override, PATH, npm and pnpm global packages, then packages resolvable from the working directory and launcher directory. Each probe subprocess has a ten-second timeout, which covers a cold first start. A broken explicit `DSH_BIN` is reported without selecting another installation. Package bin entries run through the launcher's Node executable.

The bundle targets the dsh `0.2` release line (built against `0.2.1-rc.2`, also verified on `0.2.1-alpha.2`). The package declares `@deepseek-ai/dsh` `>=0.2.0-rc.2 <0.3.0` as an optional peer, so dsh's own plugin compatibility check covers manual installs, and the launcher refuses another engine line with the exact install command; `DSH_TUI_SKIP_ENGINE_CHECK=1` bypasses the launcher check.

### Mode B: Source Mode (Developer / Debugging)
To debug or hack on TUI or DSH source directly:

```text
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui update
dsh-tui --source
```

The explicit `dsh-tui update` command clones the monorepo via Git and runs `pnpm install`. You can use `dsh-tui probe` anytime to inspect the detected engine.

-----

<a id="run-and-update"></a>
## Run and update

After initialization, run `dsh-tui` from the workspace that the agent should use:

```text
dsh-tui
```

Run `dsh-tui update` when you want to refresh the dedicated runtime before launching it again.

Ordinary arguments pass unchanged to the selected official profile (`deepseek-tui` by default) in both modes:

```text
dsh-tui "review this repository"
dsh-tui --resume <session-id>
dsh-tui --cwd <directory>
```

`dsh-tui update` clones the configured source when the runtime is absent. For an existing runtime it requires a clean worktree, fetches the configured ref, proves the current HEAD is its ancestor, applies only `git merge --ff-only`, and runs `pnpm install --frozen-lockfile`. Dirty or divergent history stops before HEAD changes.

`dsh-tui version` reports the launcher version, runtime directory, runtime Git SHA, and DSH version without network access. The exact words `update` and `version` are launcher commands; use `dsh-tui -- update` or `dsh-tui -- version` to send either word as a TUI task.

Updating the launcher and updating the runtime are separate operations:

```text
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui update
```

-----

<a id="configure-the-source-runtime"></a>
## Configure the source runtime

The defaults use the official public repository at tag `dsh-v0.2.1-rc.2`. Source mode links this bundle into the existing `deepseek-tui` profile and preserves its user patch. Missing Typert runtime artifacts are generated with the upstream generator before boot. The source CLI runs through `pnpm exec node`, avoiding the `predsh` hook that reinstalls the entire workspace on every launch.

| Environment variable | Default | Purpose |
|---|---|---|
| `DSH_TUI_RUNTIME_DIR` | `~/.local/share/dsh-tui/runtime` | Dedicated clone used only by the launcher |
| `DSH_TUI_SOURCE_URL` | `https://github.com/deepseek-ai/deepseek-harness.git` | Git remote cloned and fetched by `update` |
| `DSH_TUI_SOURCE_REF` | `dsh-v0.2.1-rc.2` | Branch or ref fetched by `update` |
| `DSH_TUI_PNPM` | `pnpm` | pnpm executable used for install and launch |

Values must be non-empty, and the runtime directory must be absolute. The launcher refuses a symbolic-link runtime path and an existing directory that is not a Git checkout. Child commands receive argument arrays without shell interpolation.

If dependency refresh fails after a fast-forward, the runtime stays at the reported new SHA but is not ready. Run the exact recovery command printed by the launcher. For dirty or divergent state, inspect only the dedicated runtime directory or select a new empty `DSH_TUI_RUNTIME_DIR`; the launcher never discards it automatically.

-----

<a id="relationship-to-dsh"></a>
## Relationship to DSH

The TUI is a dsh plugin bundle, not a fork or a separate agent runtime:

```text
@deepseek-ai/dsh-base                  dsh core bundle (agents, sessions, tools)
  └─ @crazyhappyone/dsh-tui             this bundle: cordis.patch.yml + dist/*
       ├─ tui-startup  (./startup)      command-line provider (task, --resume, --cwd)
       ├─ tui          (./settings)     volatile TUI preferences shown in /settings
       ├─ tui-runtime  (./runtime)      terminal lifecycle and controller
       ├─ schedule     (./schedule)     official scheduler with shared Session activation
       └─ zen-proxy    (./zen-proxy)    optional OpenCode Zen header proxy
```

Rows name plugins through the package's `exports`, so a settings edit records a portable row name in the profile patch. The bundle also inserts the published dsh plugins `session-stats`, `message-feedback`, `tool-ask-user`, `workspace-changes`, `tool-schedule`, `time-context`, `tool-present`, and a loopback `webserver` for the account sign-in callback, and overrides `system-prompt`, `tools`, `session-query-sqlite`, and `session-title-llm`.

### Reminders and user questions

The model can use the official `schedule_create`, `schedule_list`, `schedule_update`, and `schedule_delete` tools. `/schedules` lists reminders across Sessions: ↑↓ or PgUp/PgDn selects, Enter shows the full prompt, a second Enter opens the owning Session, `r` refreshes, and `d` asks for cancellation confirmation (`y` confirms; `n` or Esc keeps it). Delivery resumes the original Session even after navigating elsewhere. Tasks persist across restart; timers run only while this process is open, and overdue tasks are handled on the next launch. A delivery receipt confirms durable inbox admission, not a completed model response. The adapter bundles the official scheduler and Session activation helpers from the pinned DSH build; upstream upgrades require integration checks.

User questions support all questions in a batch, multiple selections, and custom text. Space toggles a multi-select choice; `c` opens the custom editor; Enter saves text and submits choices. Questions without choices open the editor directly. Tab opens the complete question and answer for scrolling; Tab or Esc returns to editing. Esc in the editor discards that edit (or cancels a text-only question), while Esc on the choices cancels the request. Pasted multiline answers retain their original text and do not change the chat draft.

Credential editors and secret arguments in `/key` and `/login` display bullets while keeping credential reference names visible. Masking affects display only: editing and submission retain the original value, and cancelling restores the chat draft.

### Time context, delivered files, and image paste

The official `time-context` plugin supplies the current time and process time zone to the model when preparing a step, refreshing after ten minutes. This model context does not create an extra human transcript message.

The model can explicitly deliver existing files with the official `present` tool (up to eight files per call). `/deliveries` lists this Session's recorded deliveries: ↑↓ selects, Enter previews UTF-8 text, `o` requests opening the selected file in the local system application, and Esc returns. PDF, Office, images, and other binary formats show file details and use the system application. Text reads are limited to 1 MiB by default. Completed turns also show the delivered paths and descriptions; their records survive Session replay, but the files must still exist and remain accessible.

Clipboard image paste uses `pngpaste -` on macOS ([installation: `brew install pngpaste`](https://github.com/jcsalterego/pngpaste)), `wl-paste` on Wayland, or `xclip` on X11. A missing helper gives a visible error. Reads time out after five seconds by default and are cancelled when the TUI closes; existing image limits and validation still apply. The macOS command and subprocess behavior have automated coverage on Linux; macOS hardware validation remains pending.

### DeepSeek account, models, and working directory

- `/login` opens the DeepSeek account page when dsh mounts the `deepseek-account` service: Enter starts browser sign-in, `o` reopens the authorization link, `c` cancels, and the page shows the profile and balance once signed in. The browser returns to the bundle's `webserver` row on `127.0.0.1` with an OS-assigned port. Over SSH the page prints the `ssh -L` forward instead of opening a browser; pin `port` on the `webserver` row so the forward stays stable. Closing and reopening this page retains the active attempt and restores its forwarding instructions; `o` opens the link only when explicitly requested. Without the account service, `/login` and `/key` open the API-key editor.
- `/logout` signs out after confirmation; stored API keys remain.
- `/model` lists `deepseek-account` and `deepseek-official` with the step that makes their models available (`/login` or `/key`) while their catalogs are empty, and refuses to select such a row.
- `/cd [path]` shows or changes the Session working directory on dsh 0.2.1 and later. The header, `@` mentions, and `/files` follow it, including relative paths entered in the file panel, and the model receives the change notice; existing shells keep their own directories.
- `/plugins` lists official bundles in their own group. An official catalog entry whose files are not installed is marked installable, and Space opens the install preview for its exact target.

### OpenCode Zen free models

The bundled patch mounts `zen-proxy` (vendored from
[zhangyang-crazy-one/dsh-zen-proxy](https://github.com/zhangyang-crazy-one/dsh-zen-proxy),
fork of [Yee-h/dsh-zen-proxy](https://github.com/Yee-h/dsh-zen-proxy)): an in-process
localhost proxy that injects the official OpenCode client headers Zen requires
(`User-Agent`, `x-opencode-client/session/request/project`). Without it Zen answers
`400 MissingSessionID` / `429 FreeUsageLimitError` because dsh always sends its
own attribution `User-Agent`.

To use it, add a provider through the TUI `/settings` provider form (or the
profile's `cordis.patch.yml`) pointing at the proxy, and keep the key in credentials:

```yaml
- id: llm-pi-ai
  config:
    providers:
      opencode:
        api: openai-completions
        baseURL: http://127.0.0.1:4097/v1
        apiKeyEnv: OPENCODE_API_KEY
```

The proxy listens on `127.0.0.1:4097` only; add `- id: zen-proxy` with
`disabled: true` to the profile's `cordis.patch.yml` to turn it off.

-----

<a id="packages"></a>
## Packages

| Package | DSH shape | Responsibility |
|---|---|---|
| [`tui/`](tui/README.md) | Runtime, startup, and settings plugins | Composes the terminal layer over `dsh-base`, owns the live terminal session, and maps user actions to DSH services |
| [`plugins/zen-proxy/`](https://github.com/zhangyang-crazy-one/dsh-zen-proxy) | Vendored plugin (bundled as `dist/zen-proxy.js`) | In-process OpenAI-compatible proxy injecting OpenCode Zen client headers; mounted in `cordis.patch.yml` |
| [`tui-render/`](tui-render/README.md) | Library | Projects controller state through Ink without owning agents, persistence, or model requests |

-----

<a id="development-workflow"></a>
## Development workflow

`tui/` and `tui-render/` compile against an upstream dsh checkout at the tag named by `COMPATIBLE_DSH_VERSION` in `src/launcher.js`:

```text
git clone --branch dsh-v0.2.1-rc.2 https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
(cd ../deepseek-harness && pnpm install)
npm run build          # or DSH_SOURCE=/path/to/checkout npm run build
(cd ../deepseek-harness && pnpm install) # link the mounted plugin's dev dependencies
npm run dev:setup      # same DSH_SOURCE override; build types and link editor dependencies
npm run typecheck      # strict checks for sources and tests
```

`npm run build` copies the plugin packages and `cordis.patch.yml` into the checkout's `packages/tui/` workspace, bundles `dist/index.js`, `dist/startup.js`, `dist/settings.js`, `dist/schedule.js`, and `dist/zen-proxy.js` with esbuild, and import-checks each output. Run the plugin tests from the checkout with `npx vitest run packages/tui`, and the launcher tests here with `npm test`; run `npm run pack:check` before release. Test installation through a packed tarball or `dsh plugin --profile <name> add <this directory>`.

Local `tsconfig.json` files support editors in this standalone repository. The build mounts `tsconfig.workspace.json` as the checkout's package config to preserve upstream project references. `dev:setup` builds dependency declarations and links whole `node_modules` directories, preserving pnpm's relative links. Re-run build and setup after upstream or public type changes; restart the editor's TypeScript project if it still displays old missing-module diagnostics.

-----

<a id="publish-the-npm-package"></a>
## Publish the npm package

GitHub Actions tests every pull request and push to `main` on Node 22.19 and 24. Publishing starts only when a GitHub Release is published. The workflow rejects a release tag unless it equals `v` followed by the version in `package.json`; prereleases publish to npm's `next` tag and stable releases publish to `latest`.

Configure npm Trusted Publishing once after `publish.yml` is present on the default branch. npm CLI 11.5.1 or newer can register the GitHub workflow through an authenticated browser session. The command below runs a compatible npm 11 temporarily and does not replace the globally installed npm:

```text
npx --yes npm@11 trust github @crazyhappyone/dsh-tui \
  --file publish.yml \
  --repository zhangyang-crazy-one/dsh-tui \
  --allow-publish
```

The equivalent npm website settings are organization or user `zhangyang-crazy-one`, repository `dsh-tui`, workflow filename `publish.yml`, with no environment restriction. The workflow uses GitHub OIDC and stores no npm token, password, or OTP.

For each release, bump `package.json`, merge the change after CI passes, then create a GitHub Release whose tag matches the package version:

```text
gh release create v0.1.0-alpha.50 --prerelease --notes-file docs/releases/v0.1.0-alpha.50.md
```

The `Publish npm` workflow runs tests and packed-package verification again before publishing. Do not rerun an old release tag: npm versions are immutable. Promotion to stable is a new version and a non-prerelease GitHub Release.

-----

## Terminal capabilities

`/timeline` reads individual Session events, actual tool/token/timing data and full JSON; `/attachments` lists typed image/file references and opens local copies; `/review` reads each changed file's official diff. `/files` watches expanded directories with coalesced refresh and retains manual `r` refresh.

`/settings` uses Tab/Shift+Tab section navigation and persists `tui.theme=dark|light`. `/keys` lists context-specific bindings; `/bind ACTION Ctrl+X`, `/bind ACTION default` and `/unbind ACTION` edit composer shortcuts with conflict checks. Shift+arrows/Home/End selects input by grapheme, typing/paste replaces the selection, and Ctrl+Y copies ordinary selections; credential selections cannot be copied. Alt+H opens read-only help during approvals, questions and plan review.

`/agents` supports `c` continuation (Enter queues, Ctrl+Enter steers), `s` request Stop, and `v` side-by-side viewing at 100+ columns. Narrow terminals use the single-pane view. Human controls preserve the catalog's exact direct-parent address; Stop acknowledgement does not claim execution has already stopped.

`/preset` browses standard/PTC/minimal/cordis declarations; `/preset ID` selects an isolated composition before the first turn. Started Sessions remain locked. `/market QUERY` searches configured indexes and routes `i` through plugin-manager inspection and confirmation; `n/p` pages results. `/inspect` browses official Host providers; `/inspect host PROVIDER METHOD JSON` reads an exact contract. `/focus` hides intermediate tool cards without changing model tools or the Session log. External language packs can call `registerTuiLocale`; fenced code uses bounded language-specific lexical highlighting.

The Goal footer distinguishes armed automatic continuation from a stopped continuation requiring `/goal resume`. Backend-started turns update the running state and Ctrl+C cancellation path. After updating a running source installation, use `/reload`; a resumed Goal requires explicit `/goal resume` to rearm.

Verification and platform boundaries: [P1/P2 evidence](docs/p1-p2-verification-2026-10-20.md).

-----

<a id="known-limitations"></a>
## Known limitations

- **Third-party plugins must match the engine** — dsh 0.2 rejects older authentication plugins that only declare dsh 0.1.x support; the launcher never grants version exemptions automatically.
- **Source toolchain required** — runtime initialization requires Git, pnpm, and a DSH-supported Node version.
- **No automatic conflict resolution** — dirty or non-fast-forward runtime history requires explicit human action or a new runtime directory.
- **Runtime update is not launcher update** — `dsh-tui update` refreshes DSH source and dependencies; npm updates the launcher package.
- **Integration owns release readiness** — launcher success does not replace the DSH branch's behavior, snapshot, build, or hygiene checks.
- **Source mode also uses this plugin** — the configured checkout must be compatible with this bundle's dsh version. Replace a historical profile's `@deepseek-ai/dsh-tui` bundle with `@crazyhappyone/dsh-tui`; back up the profile and preserve user settings during migration.
- **Reminders need a running process** — `/schedules` uses the official service and persistent origin Sessions. Restart can recover pending reminders; a closed process runs no timers.
- **Terminal capability limits** — images and PDF/Office files use metadata/text or the system opener. Ink exposes no IME composition events; native terminal preedit remains authoritative. `INK_SCREEN_READER=true` enables plain-stream rendering, without mouse capture, alternate screen or animation; physical IME/screen-reader devices and macOS clipboard have not been verified.
- **Account sign-in needs a reachable Platform** — sign-in reports `no-response` when the host cannot reach `platform.deepseek.com`; use `/key` in that case.
- **No physical session deletion on dsh 0.2** — 0.2 session persistence archives instead of deleting, and the TUI composition mounts no workspace archive service, so the session list reports deletion as unavailable.

<a id="dev-note"></a>
## Dev Note

None.
