---
description: "交互式 DeepSeek Harness 终端 profile 层，供用户运行随附 TUI，也供贡献者将终端行为与 DSH 服务集成。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tui` 让用户在 `dsh-base` 上运行交互式 DeepSeek Harness 终端。随附的 `deepseek-tui` profile 会创建或恢复 Agent、呈现会话历史与工具、处理终端交互，并在退出前 flush 其拥有的会话。模型 provider、工具、持久化、权限、设置、workflow 与 subagent 仍由 DSH capability package 拥有。请在匹配的 DSH monorepo 内使用本包；这个 private 镜像不是可独立安装的发行版。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 运行随附 profile

DSH 源码 checkout 包含 `deepseek-tui` profile，并从同一 installation 解析本 bundle。在 DSH 仓库根目录验证应用入口：

```text
pnpm dsh --profile deepseek-tui --help
```

该命令会打印可选 task positional 以及 `--resume`、`--cwd` 与 `--frame-stats`。使用 `pnpm dsh --profile deepseek-tui` 启动全屏应用；进程需要交互式 TTY，使用模型的轮次还需要 provider 凭据。

这个 private 源码镜像没有外部 `dsh plugin add` 路径。本包未发布到 npm registry，在 DSH 之外安装其目录也无法解析保留的 `workspace:^` 依赖。请通过匹配的 DSH checkout 开发和运行。

### 启动输入

启动插件解析应用参数，并将参数提供给 `cordis.patch.yml` 中的运行时配置行。

| 输入 | 含义 | 失败或降级行为 |
|---|---|---|
| `[task...]` | 将 positional word 合并为第一条用户消息 | 缺少输入或输入仅含空白时打开 composer，但不发送消息 |
| `--resume <id>` | 恢复一个现有会话 | 会话查找和所有权错误通过所属 DSH 服务失败 |
| `--cwd <dir>` | 选择向会话公开的工作目录 | 文件系统与 workspace 操作通过各自所属的 DSH 服务报告解析或访问失败 |
| `--frame-stats <path>` | 在有序退出时写入渲染成本统计 | 目录或不可写目标会在 render tree 挂载前失败 |

### 终端拥有的内容

- 运行时拥有一个 live Agent 句柄、对应会话投影、终端信号、overlay，以及有序 flush 和退出路径。
- 控制器将审批、问题、设置、会话、计划、job、workflow、subagent、搜索、导出、feedback 与 draft 提交映射到它们的 public DSH 服务。
- Renderer 接收控制器状态与动作；它不取得持久化或 agent 所有权。
- Transcript 展示与导出包含直接人类消息和 assistant 回复。仅供模型使用的上下文仍然持久且对模型可见，但不会显示为人类编写的终端文本。
- 非 TTY stream 会在 Ink 挂载前被拒绝。受支持的终端按能力获得有界颜色、超链接、鼠标、剪贴板与通知行为，并在能力不足时降级。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

Bundle patch 在 `dsh-base` 上叠加终端专用配置行。启动插件解析应用参数，Loader 在 `tuiStartup` 可用后解析运行时行，运行时再基于注入的 DSH 服务构建控制器。随后，控制器挂载 `dsh-tui-render`，并保留会话与进程生命周期所有权。

| 源码 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Profile 配置行、system prompt 贡献、provider 与运行时 wiring |
| [`src/startup.ts`](src/startup.ts) | 应用参数 parser 与 `tuiStartup` provider |
| [`src/index.ts`](src/index.ts) | 运行时控制器、服务集成、终端生命周期与有序退出 |
| [`../tui-render/`](../tui-render/README.zh.md) | Ink 投影、布局、终端能力与输入渲染 |

精确的跨包组装与 real-PTY 证据保留在 [DSH CLI 测试树](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests)中。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [TUI 仓库映射](../README.zh.md) — 包所有权与 DSH 开发工作流。
- [TUI renderer](../tui-render/README.zh.md) — renderer 入口、终端所有权与布局限制。
- [终端子系统](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.zh.md) — 生成的 Cordis 声明与生命周期关系。
- [CLI profile 参考](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/apps/cli/reference/README.zh.md) — profile 组合与应用参数路由。

-----

<a id="model-experience"></a>
## 模型体验

### 终端 profile system prompt

#### 模型看到的内容

解析 `{{model}}` 与 `{{cwd}}` 后，bundle 拥有以下稳定 profile 文本：

##### 终端身份

```markdown
You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.
You are interacting with the user through the deepseek-tui terminal interface.
```

#### Token 影响

通过该 profile 组装的每个请求都包含解析后的两句 profile 文本。普通用户轮次与其他所有上下文仍由各自的 DSH producer 拥有。

#### KV Cache 影响

所选模型与工作目录不变时，profile 文本保持 prefix-stable。不同的模型、工作目录、profile 层或更早的模型可见上下文可能改变可复用前缀；provider cache 可用性与淘汰不属于本包。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **需要 DSH workspace** — 这个 private 镜像不能独立解析或构建其 `workspace:^` 依赖。
- **需要交互式终端** — 应用会在挂载备用屏幕界面前拒绝非 TTY 输入或输出。
- **进程内 draft** — 尚未进入 Agent inbox 或会话日志的 queued draft 不参与崩溃恢复。
- **Reload 进程嵌套** — `/reload` 会启动替代 Node 进程，父进程等待其退出；反复 reload 会嵌套等待进程，直到最内层 TUI 退出。
- **Provider cache 行为** — bundle 会重建会话历史，但不能保证进程重启后的 provider 侧 KV Cache 保留。
- **致命内存诊断** — TUI 没有内置 heap profiler；进程级内存耗尽可能在控制器 feedback 渲染前终止进程。
- **Frame statistics 范围** — `--frame-stats` 测量 React render cost 与 commit pacing，而不是墙钟终端 paint 或 Ink host commit cost。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
