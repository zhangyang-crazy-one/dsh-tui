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

## Table of Contents

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

Interactive settings pane (`/settings`):

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

The first launch runs `dsh plugin --profile tui add <package directory>`, which links this package into the `tui` profile after `@deepseek-ai/dsh-base`; later launches find it there and run `dsh --profile tui` directly. Without the launcher, the same two dsh commands work by hand:

```text
dsh plugin --profile tui add @crazyhappyone/dsh-tui@next
dsh --profile tui
```

Installing as a bundle matters in dsh 0.2: `/settings` edits are written to the profile's own patch layer, which applies after bundle layers. A `--patch` overlay would apply after the profile layer and dsh refuses settings writes to rows such an overlay owns.

Detection checks an absolute `DSH_BIN` override, PATH, npm and pnpm global packages, then packages resolvable from the working directory and launcher directory. Each probe subprocess has a ten-second timeout, which covers a cold first start. A broken explicit `DSH_BIN` is reported without selecting another installation. Package bin entries run through the launcher's Node executable.

The bundle targets the dsh `0.2` release line (built against `0.2.1-alpha.2`, also verified on `0.2.0-rc.2`). The package declares `@deepseek-ai/dsh` `>=0.2.0-rc.2 <0.3.0` as an optional peer, so dsh's own plugin compatibility check covers manual installs, and the launcher refuses another engine line with the exact install command; `DSH_TUI_SKIP_ENGINE_CHECK=1` bypasses the launcher check.

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

Ordinary arguments pass unchanged to `tui` in lightweight mode or `deepseek-tui` in source mode:

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

The defaults track the owner's private `feat/deepseek-tui` branch. Git authorization for that repository is required. Other users can select a compatible accessible repository and ref.

| Environment variable | Default | Purpose |
|---|---|---|
| `DSH_TUI_RUNTIME_DIR` | `~/.local/share/dsh-tui/runtime` | Dedicated clone used only by the launcher |
| `DSH_TUI_SOURCE_URL` | `https://github.com/zhangyang-crazy-one/deepseek-harness.git` | Git remote cloned and fetched by `update` |
| `DSH_TUI_SOURCE_REF` | `feat/deepseek-tui` | Branch or ref fetched by `update` |
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
       └─ zen-proxy    (./zen-proxy)    optional OpenCode Zen header proxy
```

Rows name plugins through the package's `exports`, so a settings edit records a portable row name in the profile patch. The bundle also inserts the published dsh plugins `session-stats`, `message-feedback`, `tool-ask-user`, and `workspace-changes`, and overrides `system-prompt`, `tools`, `session-query-sqlite`, and `session-title-llm`.

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
git clone --branch dsh-v0.2.1-alpha.2 https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
(cd ../deepseek-harness && pnpm install)
npm run build          # or DSH_SOURCE=/path/to/checkout npm run build
```

`npm run build` copies the plugin packages and `cordis.patch.yml` into the checkout's `packages/tui/` workspace, bundles `dist/index.js`, `dist/startup.js`, `dist/settings.js`, and `dist/zen-proxy.js` with esbuild, and import-checks each output. Run the plugin tests from the checkout with `npx vitest run packages/tui`, and the launcher tests here with `npm test`; run `npm run pack:check` before release. Test installation through a packed tarball or `dsh plugin --profile <name> add <this directory>`.

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
gh release create v0.1.0-alpha.4 --prerelease --generate-notes
```

The `Publish npm` workflow runs tests and packed-package verification again before publishing. Do not rerun an old release tag: npm versions are immutable. Promotion to stable is a new version and a non-prerelease GitHub Release.

-----

<a id="known-limitations"></a>
## Known limitations

- **Private default source** — npm installation is public, but the default DSH runtime remote requires repository authorization; anonymous users must configure an accessible compatible source.
- **Source toolchain required** — runtime initialization requires Git, pnpm, and a DSH-supported Node version.
- **No automatic conflict resolution** — dirty or non-fast-forward runtime history requires explicit human action or a new runtime directory.
- **Runtime update is not launcher update** — `dsh-tui update` refreshes DSH source and dependencies; npm updates the launcher package.
- **Integration owns release readiness** — launcher success does not replace the DSH branch's behavior, snapshot, build, or hygiene checks.
- **Source mode targets the legacy integration branch** — `--source` boots the `deepseek-tui` profile of the configured DSH checkout (default `feat/deepseek-tui`, dsh 0.1.6); it does not use this 0.2 bundle.
- **No physical session deletion on dsh 0.2** — 0.2 session persistence archives instead of deleting, and the TUI composition mounts no workspace archive service, so the session list reports deletion as unavailable.

<a id="dev-note"></a>
## Dev Note

None.
