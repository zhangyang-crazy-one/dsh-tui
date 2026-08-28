---
description: "Private source mirror for the DeepSeek Harness terminal interface, for contributors developing or reviewing the TUI against a matching DSH checkout."
kind: "package-group"
---

# dsh-tui — DeepSeek Harness terminal interface

English | [中文](README.zh.md)

## Summary

This private repository contains the terminal interface developed for DeepSeek Harness (DSH). It mirrors the `packages/tui/` source family: the `@deepseek-ai/dsh-tui` profile bundle owns terminal lifecycle and user interaction, while `@deepseek-ai/dsh-tui-render` renders the Ink interface. DSH continues to own agents, sessions, tools, persistence, providers, permissions, and profile assembly. Build and validation therefore run in the matching DSH monorepo rather than in this source-only mirror.

## Table of Contents

- [Relationship to DSH](#relationship-to-dsh)
- [Packages](#packages)
- [Development workflow](#development-workflow)
- [Related documentation](#related-documentation)
- [Known limitations](#known-limitations)
- [Dev Note](#dev-note)

-----

<a id="relationship-to-dsh"></a>
## Relationship to DSH

The TUI is a DSH profile layer, not a separate agent runtime. The assembled application follows this ownership chain:

```text
@deepseek-ai/dsh-base
  └─ @deepseek-ai/dsh-tui          profile patch, terminal lifecycle, controller
       └─ @deepseek-ai/dsh-tui-render   Ink projection and terminal I/O
```

The integration source lives on the private [`feat/deepseek-tui` DSH branch](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/packages/tui). Changes that affect DSH services, profile composition, assembled CLI snapshots, or Agent Notes belong in that monorepo and must follow its `AGENTS.md`, architecture, testing, and documentation rules.

-----

<a id="packages"></a>
## Packages

The repository keeps the two direct TUI packages at its root.

| Package | DSH shape | Responsibility |
|---|---|---|
| [`tui/`](tui/README.md) | Profile bundle plus runtime plugin | Composes the terminal layer over `dsh-base`, owns the live terminal session, and maps user actions to DSH services |
| [`tui-render/`](tui-render/README.md) | Library | Projects controller state through Ink without owning agents, persistence, or model requests |

-----

<a id="development-workflow"></a>
## Development workflow

Use the complete DSH checkout for implementation and verification:

1. Check out [`feat/deepseek-tui`](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui).
2. Make TUI changes under `packages/tui/tui/` and `packages/tui/tui-render/`.
3. Run the narrow DSH checks selected by the changed behavior. Terminal-visible behavior requires the owning real-PTY or expected-output scenario; package behavior requires its focused tests; documentation changes require the DSH documentation gates.
4. Run `pnpm dsh --profile deepseek-tui --help` to verify the source entry point. Starting the full-screen application requires an interactive TTY; model-backed turns also require provider credentials.
5. Export the confirmed `packages/tui/` tree to this private repository after the DSH branch is ready.

Do not install dependencies or run package builds from this mirror. Its manifests intentionally retain DSH `workspace:^` dependencies and its TypeScript projects reference the monorepo compiler configuration.

-----

<a id="related-documentation"></a>
## Related documentation

- [DSH architecture](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — plugin composition, capability ownership, and the agent loop.
- [DSH terminal subsystem](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.md) — terminal lifecycle and generated Cordis declarations.
- [DSH CLI reference](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/apps/cli/reference/README.md) — profile boot, plugin management, and configuration layering.
- [TUI assembled evidence](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests) — real-PTY scenarios and expected terminal output.

-----

<a id="known-limitations"></a>
## Known limitations

- **Source-only mirror** — this repository does not include the DSH workspace, CLI assembly, cross-package tests, generated catalogs, or Agent Notes.
- **No standalone package install** — `@deepseek-ai/dsh-tui` is not published in the npm registry, and a direct local install cannot resolve its `workspace:^` dependencies outside the DSH monorepo.
- **Integration owns release readiness** — a commit in this repository is not release evidence until the corresponding DSH branch passes the checks required by its affected behavior.

<a id="dev-note"></a>
## Dev Note

None.
