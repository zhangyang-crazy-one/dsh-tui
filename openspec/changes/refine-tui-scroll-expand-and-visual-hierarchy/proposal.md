## Why

现有物理行视口和 Soft Slate 表面已经能画出完整会话，但滚动仍经 React state 驱动 Yoga/Ink 再覆盖一层、Ctrl+E 会同步展开全部工具正文，流式 follow 还把 overscan 降到 0，于是出现截断、滚动卡顿和展开卡死。同时 C4 把代码/命令收成灰阶加粗，模块之间只靠空白行，长会话里关键字、命令和块边界几乎不可辨。此外，界面存在多重视觉噪音：每个成功的工具卡均高亮标注“完成”，连续执行时淹没回答结论；工具审批弹窗侵入性过高且遮挡输入；页脚三行仪表盘与顶栏重复打印模型与复杂 metrics，抢占了多达 4~6 行的宝贵对话空间。

## What Changes

- 滚动帧改为最新目标 + overlay 权威绘制：整数物理行仍由 viewport reducer 拥有，但普通滚轮/方向键不得每帧 `setState`、不得重跑整列 Yoga；React 只在挂载窗口必须移动时提交。
- 流式 follow 保留有界 overscan；离开 live edge 的第一屏不得出现空白或砍行。
- Ctrl+E 保持全局折叠命令，但展开工作有界：只投影视口附近卡片，工具/围栏正文按物理行切片且有硬上限，跨大窗口的挂载分帧完成。
- 帧时钟按需运行；滚动期间暂停与绘制竞争的定时器（时长、品牌动画、metrics）。
- 修订 C4：在不占用 logo 蓝的前提下为 keyword、string、comment 和 shell 命令增加语法 token；16 色保留加粗/色相降级，`none` 仍无 ANSI。
- 加强模块间隔：消息之间、推理/工具栈/正文之间使用稳定空白加可选 `line` 分隔，工具栈内部保持紧凑。
- 工具完成态安静：成功工具卡采用单行 dim 显示摘要（如 `✓ bash pnpm test (12.4s)`），移除显眼的“完成”词与大块成功高亮；仅失败或正在执行才保持警示。
- 紧凑内联权限条：工具审批从占据输入区的全覆面板改造为输入框上方的紧凑单行条（`[Y] 允许 · [n] 拒绝 · [a] 本会话总是`），单键响应且结算后转为浅色单行审计记录。
- 单行极简页脚与单一事实原则：默认将三行仪表盘收敛为 1 行极简页脚（快捷键 + 状态 / 紧凑上下文 `28K / 500K`），消除模型名在顶栏、输入框、页脚的三重重复显示。
- 模式切换与专注模式 (Focus View)：输入框边框嵌入模式/模型 Chip，支持通过快捷键（如 Shift+Tab）切换模式，并在 Focus 模式下一键隐藏所有工具调用历史，直接呈现最终解答。
- 不 fork Ink、不引入第二套滚动坐标系、不改变 session event 或模型可见内容。

## Capabilities

### New Capabilities

- `tui-interactive-paint`: 定义滚动/展开期间的绘制所有权（overlay 权威 transcript、按需帧时钟、有界展开与分帧挂载）及其 PTY 性能验收。

### Modified Capabilities

- `tui-html-design-conformance`: 修订模块间距、语法/命令着色、工具成功态静音、内联审批条与极简页脚，以及 Ctrl+E 展开的有界语义；保留 Soft Slate 表面与品牌 accent。
- `tui-transcript-viewport`: 要求 follow 保留 overscan，并禁止把每一物理行滚动实现为完整 transcript 重布局。

## Impact

- 主要影响 `packages/tui/tui-render` 的 `StreamView`、`frame-arbiter`、`scroll-scheduler`、`block-rows`、`theme`、`markdown-render`、`tool-card`/`tool-cards`、`adaptive-info-footer`、`approval-pane`、`input-bar` 和 frame-fill overlay；`packages/tui/tui` 仅在 Ctrl+E 语义、快捷键或 Config 需要时改动。
- 更新 TUI README/JSDoc、Soft Slate / C4 相关 Agent Note、单元测试、keyless PTY 基线和 `test:tui:perf`（万行滚动、工具展开/收起）。
- 不改变 session 日志、provider API、SDK、持久化格式或官方 Ink 依赖。
- 参考 Claude Code 2.1.x 的滚动量子化、DECSTBM/overlay 增量绘制、有界展开、静音工具与内联权限条，但不引入其源码或 fork 的 Ink。
