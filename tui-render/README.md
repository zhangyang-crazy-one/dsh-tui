---
description: "The Ink terminal rendering library for DSH callers projecting bounded conversation state, panels, Markdown, tool cards, and terminal input."
kind: "package-library"
---

# @deepseek-ai/dsh-tui-render

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tui-render` lets the DSH terminal runtime render bounded conversation state, Markdown, tool cards, overlays, status rows, and input through Ink. A caller supplies controller state and actions, then receives an alternate-screen interface and a disposer that releases the mounted terminal resources. The library does not register a Cordis service, own an Agent, read persistence, or issue a model request. Use it from `@deepseek-ai/dsh-tui` or another terminal host that already owns those responsibilities.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Use the library when a DSH runtime already owns terminal lifecycle inputs, session projection, persistence access, and controller actions but needs an Ink presentation layer. Do not install it as a profile bundle and do not mount it as a Cordis plugin; it exports plain rendering functions and types.

### Entry point

`mountTuiRender` mounts a React node on the alternate screen and returns the matching disposer:

```text
import { Text } from 'ink'
import { createElement } from 'react'
import { mountTuiRender } from '@deepseek-ai/dsh-tui-render'

const dispose = mountTuiRender(createElement(Text, null, 'ready'))
try {
  // The terminal host owns its controller and application lifecycle here.
} finally {
  dispose()
}
```

`mountTuiLoop(controller, options)` is the assembled TUI entry when the caller already implements `TuiController`. The mount configures the alternate screen, detected color and hyperlink tiers, frame background handling, and mouse I/O. The disposer unmounts Ink and releases the mouse adapter; the host must call it during normal shutdown and error cleanup.

Pure exports such as projection, width measurement, Markdown rendering, terminal capability detection, and panel components support focused consumers and tests without mounting a full application. The source entry point owns the exact export list.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The renderer follows a one-way ownership model. The DSH runtime folds durable events and live services into controller snapshots; `TuiLoop` observes those snapshots, projects bounded view state, renders it through Ink, and sends input actions back to the controller. No renderer component reaches into persistence or an Agent.

The layout keeps one conversation column, pins the composer and status area to the bottom, and windows long histories. Terminal capabilities are resolved before presentation: content is escaped before styling, display width is measured in terminal columns, and unsupported color, hyperlink, brand, mouse, clipboard, or notification features degrade without changing the underlying text.

| Source | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Public entry points, mount adapters, and the disposer contract |
| [`src/loop.tsx`](src/loop.tsx) | Controller observation, interaction ownership, overlays, and input routing |
| [`src/projection.ts`](src/projection.ts) | Durable session events to bounded terminal view state |
| [`src/stream-view.tsx`](src/stream-view.tsx) | Ordered conversation, reasoning, tool, and completion rendering |
| [`src/content.ts`](src/content.ts) | Control-byte escaping and terminal-column width operations |
| [`src/terminal-capabilities.ts`](src/terminal-capabilities.ts) | Brand and notification capability selection |

Exact rendered-cell evidence remains in the [assembled DSH TUI scenarios](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [TUI repository map](../README.md) — package ownership and the DSH development workflow.
- [TUI profile bundle](../tui/README.md) — controller, lifecycle, profile composition, and model-visible text.
- [Terminal subsystem](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.md) — generated Cordis declarations and runtime relationships.
- [Renderer tests in DSH](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/packages/tui/tui-render/tests) — focused layout, input, terminal, and projection evidence.

-----

<a id="model-experience"></a>
## Model Experience

### Terminal presentation

#### What the model sees

The renderer adds no prompt text, tool schema, session event, or model request. It displays the controller state supplied by the DSH runtime.

#### Token effect

The package has zero direct token effect because its output is terminal-only.

#### KV Cache effect

The renderer does not alter request prefixes or issue model requests, so it has no KV-cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **DSH workspace required** — this private mirror retains DSH peer dependencies and TypeScript project references, so it is not a standalone build workspace.
- **Capability fallback** — unavailable color, OSC 8, mouse, clipboard, notification, and brand features degrade to a lower terminal tier; the renderer does not emulate missing host capabilities.
- **Mouse selection ownership** — SGR mouse mode replaces native terminal selection while mounted; copy uses the renderer's selection overlay and clipboard transports.
- **Bounded history geometry** — the scroll rail represents the projected message window rather than exact wrapped physical rows, and one turn taller than the content slot can still be clipped.
- **Caret geometry** — cursor placement assumes the application shell pins the composer to the bottom and does not model host soft-wrapping beyond the measured terminal columns.
- **Runtime-owned data** — session search, timeline, export, settings, permissions, and persistence operations must be supplied by the host controller.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
