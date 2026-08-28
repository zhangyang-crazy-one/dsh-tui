---
description: "The interactive DeepSeek Harness terminal profile layer, for users running the shipped TUI and contributors integrating terminal behavior with DSH services."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-tui` lets a user run the interactive DeepSeek Harness terminal over `dsh-base`. The shipped `deepseek-tui` profile creates or resumes an Agent, presents session history and tools, handles terminal interactions, and flushes its owned session before exit. DSH capability packages continue to own model providers, tools, persistence, permissions, settings, workflows, and subagents. Use this package inside the matching DSH monorepo; this private mirror is not a standalone installable distribution.

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

### Run the shipped profile

The DSH source checkout includes the `deepseek-tui` profile and resolves this bundle from the same installation. Verify the application entry point from the DSH repository root:

```text
pnpm dsh --profile deepseek-tui --help
```

The command prints the optional task positional plus `--resume`, `--cwd`, and `--frame-stats`. Start the full-screen application with `pnpm dsh --profile deepseek-tui`; the process requires an interactive TTY, and model-backed turns require provider credentials.

This private source mirror has no external `dsh plugin add` path. The package is not published in the npm registry, and installing its directory outside DSH cannot resolve the retained `workspace:^` dependencies. Develop and run it through the matching DSH checkout.

### Startup inputs

The startup plugin parses application arguments and provides them to the runtime row in `cordis.patch.yml`.

| Input | Meaning | Failure or fallback |
|---|---|---|
| `[task...]` | Joins the positional words into the first user message | Missing or whitespace-only input opens the composer without sending a message |
| `--resume <id>` | Resumes one existing session | Session lookup and ownership errors fail through the owning DSH services |
| `--cwd <dir>` | Selects the working directory exposed to the session | Filesystem and workspace operations report resolution or access failures through their owning DSH services |
| `--frame-stats <path>` | Writes render-cost statistics on orderly exit | A directory or unwritable target fails before the render tree mounts |

### What the terminal owns

- The runtime owns one live Agent handle, its session projection, terminal signals, overlays, and the orderly flush-and-exit path.
- The controller maps approvals, questions, settings, sessions, plans, jobs, workflows, subagents, search, export, feedback, and draft submission to their public DSH services.
- The renderer receives controller state and actions; it does not acquire persistence or agent ownership.
- Transcript presentation and export include direct human messages and assistant replies. Model-only context remains durable and model-visible without appearing as human-authored terminal text.
- A non-TTY stream is rejected before Ink mounts. Supported terminals receive bounded color, hyperlink, mouse, clipboard, and notification behavior with capability-based fallback.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle patch layers terminal-specific rows over `dsh-base`. The startup plugin parses the application arguments, Loader resolves the runtime row after `tuiStartup` is available, and the runtime builds a controller over injected DSH services. The controller then mounts `dsh-tui-render` and retains ownership of session and process lifecycle.

| Source | Responsibility |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Profile rows, system prompt contribution, providers, and runtime wiring |
| [`src/startup.ts`](src/startup.ts) | Application argument parser and `tuiStartup` provider |
| [`src/index.ts`](src/index.ts) | Runtime controller, service integration, terminal lifecycle, and orderly exit |
| [`../tui-render/`](../tui-render/README.md) | Ink projection, layout, terminal capabilities, and input rendering |

Exact cross-package assembly and real-PTY evidence remain in the [DSH CLI test tree](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [TUI repository map](../README.md) — package ownership and the DSH development workflow.
- [TUI renderer](../tui-render/README.md) — renderer entry points, terminal ownership, and layout limits.
- [Terminal subsystem](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.md) — generated Cordis declarations and lifecycle relationships.
- [CLI profile reference](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/apps/cli/reference/README.md) — profile composition and application-argument routing.

-----

<a id="model-experience"></a>
## Model Experience

### Terminal profile system prompt

#### What the model sees

The bundle owns the following stable profile text after `{{model}}` and `{{cwd}}` are resolved:

##### Terminal identity

```markdown
You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
You are interacting with the user through the deepseek-tui terminal interface.
```

#### Token effect

The resolved two-sentence profile text is present in each request assembled under this profile. Ordinary user turns and all other context remain owned by their DSH producers.

#### KV Cache effect

The profile text is prefix-stable while the selected model and working directory stay unchanged. A different model, working directory, profile layer, or earlier model-visible context can change the reusable prefix; provider cache availability and eviction remain outside this package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **DSH workspace required** — this private mirror cannot resolve or build its `workspace:^` dependencies by itself.
- **Interactive terminal required** — the application rejects non-TTY input or output before mounting the alternate-screen interface.
- **Process-local drafts** — queued drafts that have not entered the Agent inbox or session log are not recovered after a crash.
- **Reload process nesting** — `/reload` starts a replacement Node process and the parent waits for it; repeated reloads nest waiting processes until the innermost TUI exits.
- **Provider cache behavior** — the bundle reconstructs session history but cannot guarantee provider-side KV-cache retention after process restart.
- **Fatal-memory diagnosis** — the TUI has no built-in heap profiler; a process-level out-of-memory termination can occur before controller feedback is rendered.
- **Frame statistics scope** — `--frame-stats` measures React render cost and commit pacing, not wall-clock terminal paint or Ink host commit cost.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
