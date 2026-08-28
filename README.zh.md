---
description: "TUI 包组：面向查找终端所属行为的读者，说明终端 profile 层与有界 Ink 渲染器。"
kind: "package-group"
---

# tui/ — 终端界面家族

[English](README.md) | 中文

## 概述

tui 包组提供交互式终端应用及其渲染器。`tui` 在基础运行时上组合终端 profile，拥有终端生命周期和用户操作，并把这些操作连接到 harness 公开服务。`tui-render` 把控制器状态投影为 Ink 视图，不拥有 agent、持久化或能力服务。本页映射该家族；每个包的 README 拥有自身行为与限制。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

运行时包拥有终端集成，渲染包则保持为仅展示依赖。

| 包 | 职责 |
|---|---|
| [`tui/`](tui/README.zh.md) | 在 `dsh-base` 上组合并运行交互式终端 profile |
| [`tui-render/`](tui-render/README.zh.md) | 把有界会话与控制器状态投影到终端视图 |

<a id="related-documentation"></a>
## 相关文档

- [终端子系统](../../docs/subsystems/terminal.zh.md) — 终端生命周期、渲染器关系与生成的 Cordis 声明。
- [会话子系统](../../docs/subsystems/session.zh.md) — 终端应用消费的持久历史与生命周期数据。

<a id="dev-note"></a>
## 开发备注

无。
