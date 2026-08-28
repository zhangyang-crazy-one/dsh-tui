---
description: "面向 DSH 调用方的 Ink 终端渲染库，用于投影有界对话状态、面板、Markdown、工具卡与终端输入。"
kind: "package-library"
---

# @deepseek-ai/dsh-tui-render

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tui-render` 让 DSH 终端运行时通过 Ink 渲染有界对话状态、Markdown、工具卡、overlay、状态行与输入。调用方提供控制器状态与动作，并获得备用屏幕界面以及释放已挂载终端资源的 disposer。本库不注册 Cordis 服务、不拥有 Agent、不读取持久化，也不发起模型请求。请从 `@deepseek-ai/dsh-tui` 或已经拥有这些职责的其他终端 host 使用它。

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

### 何时使用

当 DSH 运行时已经拥有终端生命周期输入、会话投影、持久化访问与控制器动作，但需要 Ink 呈现层时使用本库。不要将它安装为 profile bundle，也不要将它挂载为 Cordis 插件；它导出普通渲染函数与类型。

### 入口

`mountTuiRender` 在备用屏幕上挂载 React node，并返回对应 disposer：

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

当调用方已经实现 `TuiController` 时，`mountTuiLoop(controller, options)` 是组装后的 TUI 入口。挂载过程会配置备用屏幕、检测到的颜色与超链接等级、frame background 处理和鼠标 I/O。Disposer 会卸载 Ink 并释放鼠标 adapter；host 必须在正常关闭与错误清理期间调用它。

投影、宽度测量、Markdown 渲染、终端能力检测与 panel component 等纯导出支持 focused consumer 和测试，无需挂载完整应用。源码入口拥有精确 export list。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

Renderer 遵循单向所有权模型。DSH 运行时将持久事件与 live 服务折叠为控制器快照；`TuiLoop` 观察这些快照、投影有界 view state、通过 Ink 渲染，并将输入动作发回控制器。Renderer component 不会访问持久化或 Agent。

布局保留一个对话列，将 composer 与状态区域固定在底部，并对长历史使用窗口。终端能力在呈现前解析：内容先转义再应用样式，显示宽度按终端列测量，不受支持的颜色、超链接、品牌、鼠标、剪贴板或通知功能会降级，但不会改变底层文本。

| 源码 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Public 入口、mount adapter 与 disposer contract |
| [`src/loop.tsx`](src/loop.tsx) | 控制器观察、交互所有权、overlay 与输入路由 |
| [`src/projection.ts`](src/projection.ts) | 将持久会话事件转换为有界终端 view state |
| [`src/stream-view.tsx`](src/stream-view.tsx) | 按顺序渲染对话、推理、工具与完成状态 |
| [`src/content.ts`](src/content.ts) | 控制字节转义与终端列宽操作 |
| [`src/terminal-capabilities.ts`](src/terminal-capabilities.ts) | 品牌与通知能力选择 |

精确的渲染单元格证据保留在[组装后的 DSH TUI 场景](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/apps/cli/tests)中。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [TUI 仓库映射](../README.zh.md) — 包所有权与 DSH 开发工作流。
- [TUI profile bundle](../tui/README.zh.md) — 控制器、生命周期、profile 组合与模型可见文本。
- [终端子系统](https://github.com/zhangyang-crazy-one/deepseek-harness/blob/feat/deepseek-tui/docs/subsystems/terminal.zh.md) — 生成的 Cordis 声明与运行时关系。
- [DSH 中的 renderer 测试](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/packages/tui/tui-render/tests) — focused 布局、输入、终端与投影证据。

-----

<a id="model-experience"></a>
## 模型体验

### 终端呈现

#### 模型看到的内容

Renderer 不添加 prompt 文本、工具 schema、会话事件或模型请求。它显示 DSH 运行时提供的控制器状态。

#### Token 影响

本包的输出仅在终端可见，因此没有直接 Token 影响。

#### KV Cache 影响

Renderer 不改变请求前缀，也不发起模型请求，因此不会影响 KV Cache。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **需要 DSH workspace** — 这个 private 镜像保留 DSH peer dependency 与 TypeScript project reference，因此不是独立 build workspace。
- **能力降级** — 不可用的颜色、OSC 8、鼠标、剪贴板、通知与品牌功能会降级到较低终端等级；renderer 不模拟缺少的 host 能力。
- **鼠标选择所有权** — 挂载期间 SGR mouse mode 会替代终端原生选择；复制使用 renderer 选择 overlay 与剪贴板 transport。
- **有界历史几何** — 滚动轨道表示投影消息窗口，而不是精确的换行后物理行；高于内容槽的单个轮次仍可能被裁切。
- **Caret 几何** — 光标位置假设 application shell 将 composer 固定在底部，并且不会在测量的终端列之外建模 host 软换行。
- **运行时拥有的数据** — 会话搜索、timeline、导出、设置、权限与持久化操作必须由 host 控制器提供。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
