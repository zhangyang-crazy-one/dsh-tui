---
description: "The TUI package group: the terminal profile layer and its bounded Ink renderer for readers navigating terminal-owned behavior."
kind: "package-group"
---

# tui/ — terminal interface family

English | [中文](README.zh.md)

## Summary

The tui group provides the interactive terminal application and its renderer. `tui` composes the terminal profile over the base runtime, owns terminal lifecycle and user actions, and connects those actions to public harness services. `tui-render` projects controller state into an Ink view without owning agents, persistence, or capability services. This page maps the family; each package README owns its behavior and limitations.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The runtime package owns terminal integration, while the render package remains a presentation-only dependency.

| Package | Role |
|---|---|
| [`tui/`](tui/README.md) | Composes and runs the interactive terminal profile over `dsh-base` |
| [`tui-render/`](tui-render/README.md) | Projects bounded session and controller state into the terminal view |

<a id="related-documentation"></a>
## Related documentation

- [Terminal subsystem](../../docs/subsystems/terminal.md) — terminal lifecycle, renderer relationships, and generated Cordis declarations.
- [Session subsystem](../../docs/subsystems/session.md) — durable history and lifecycle data consumed by the terminal application.

<a id="dev-note"></a>
## Dev Note

None.
