---
description: "DeepSeek Harness 终端界面的私有源码镜像，供贡献者基于匹配的 DSH checkout 开发或审查 TUI。"
kind: "package-group"
---

# dsh-tui — DeepSeek Harness 终端界面

[English](README.md) | 中文

## 概述

本 private 仓库包含为 DeepSeek Harness（DSH）开发的终端界面。它镜像 `packages/tui/` 源码族：`@deepseek-ai/dsh-tui` profile bundle 拥有终端生命周期与用户交互，`@deepseek-ai/dsh-tui-render` 负责渲染 Ink 界面。Agent、会话、工具、持久化、provider、权限与 profile 组装仍由 DSH 拥有。因此，构建与验证在匹配的 DSH monorepo 中运行，而不在这个仅含源码的镜像中运行。

## 目录

- [与 DSH 的关系](#relationship-to-dsh)
- [包](#packages)
- [开发工作流](#development-workflow)
- [相关文档](#related-documentation)
- [已知限制](#known-limitations)
- [开发备注](#dev-note)

-----

<a id="relationship-to-dsh"></a>
## 与 DSH 的关系

TUI 是 DSH profile 层，而不是独立的 agent 运行时。组装后的应用遵循以下所有权链：

```text
@deepseek-ai/dsh-base
  └─ @deepseek-ai/dsh-tui          profile patch, terminal lifecycle, controller
       └─ @deepseek-ai/dsh-tui-render   Ink projection and terminal I/O
```

集成源码位于 private [`feat/deepseek-tui` DSH 分支](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/packages/tui)。影响 DSH 服务、profile 组合、组装后 CLI snapshot 或 Agent Note 的变更归该 monorepo 所有，并且必须遵循其中的 `AGENTS.md`、架构、测试与文档规则。

-----

<a id="packages"></a>
## 包

本仓库在根目录保留两个直接 TUI 包。

| 包 | DSH 形态 | 职责 |
|---|---|---|
| [`tui/`](tui/README.zh.md) | Profile bundle 与运行时插件 | 在 `dsh-base` 上组合终端层、拥有 live 终端会话，并将用户动作映射到 DSH 服务 |
| [`tui-render/`](tui-render/README.zh.md) | Library | 通过 Ink 投影控制器状态，但不拥有 agent、持久化或模型请求 |

-----

<a id="development-workflow"></a>
## 开发工作流

使用完整的 DSH checkout 实现与验证：

1. Checkout [`feat/deepseek-tui`](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui)。
2. 在 `packages/tui/tui/` 与 `packages/tui/tui-render/` 中修改 TUI。
3. 按变更行为运行范围最小的 DSH 检查。终端可见行为需要其所属的 real-PTY 或预期输出场景；包行为需要 focused test；文档变更需要 DSH 文档检查。
4. 运行 `pnpm dsh --profile deepseek-tui --help` 验证源码入口。启动全屏应用需要交互式 TTY；使用模型的轮次还需要 provider 凭据。
5. DSH 分支就绪后，将已确认的 `packages/tui/` tree 导出到本 private 仓库。

不要在这个镜像中安装依赖或运行包构建。它的 manifest 有意保留 DSH `workspace:^` 依赖，TypeScript project 也引用 monorepo 编译器配置。

-----

<a id="related-documentation"></a>
## 相关文档

- [DSH 架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md) — 插件组合、能力所有权与 agent loop。
- [DSH 终端子系统](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.zh.md) — 终端生命周期与生成的 Cordis 声明。
- [DSH CLI 参考](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/apps/cli/reference/README.zh.md) — profile 启动、插件管理与配置分层。
- [TUI 组装证据](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests) — real-PTY 场景与预期终端输出。

-----

<a id="known-limitations"></a>
## 已知限制

- **仅含源码的镜像** — 本仓库不包含 DSH workspace、CLI 组装、跨包测试、生成的 catalog 或 Agent Note。
- **没有独立安装路径** — `@deepseek-ai/dsh-tui` 未发布到 npm registry，直接本地安装也无法在 DSH monorepo 外解析其 `workspace:^` 依赖。
- **集成分支拥有发布就绪状态** — 本仓库中的 commit 只有在对应 DSH 分支通过受影响行为所需检查后，才能作为发布证据。

<a id="dev-note"></a>
## 开发备注

无。
