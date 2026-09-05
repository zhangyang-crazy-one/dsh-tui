## Context

`optimize-tui-streaming-renderer` 已经把 transcript 收成稳定物理行、可见切片、stream queue 和 latest-target 滚动。`restore-tui-conversation-streaming-design` 恢复了三层 footer、Ctrl+E 对称折叠和 Soft Slate 表面。产品路径仍然是：arbiter 每 16ms `dispatchViewport` → Ink 用 `bottom={-offset}` 挪整列 → 每行 `<Text wrap="truncate">` → `frame-fill` 再 CUP 覆盖。Ctrl+E 把 `layoutScope` 切到 `tools-open` 后同步投影全部卡体。C4 把 keyword/string 都映射到 `fg`，模块之间只靠 0–2 行空白。对照 Claude Code 2.1.x 的策略是：滚动尽量不进 React、绘制走增量、展开有界；本设计吸收这些约束，继续使用官方 Ink，不 fork。

约束：单一物理行坐标系、Soft Slate 表面表、`styled()` 唯一上色入口、无第二品牌色占用 logo `accent`、session event 与模型请求不变。

## Goals / Non-Goals

**Goals:**

- 滚动帧以 overlay 为 transcript 权威绘制，React/Yoga 只在挂载窗口变化时运行。
- Ctrl+E 保持全局命令，展开投影和 Ink 挂载有界、可分帧。
- follow 保留 overscan，消除离开 live edge 时的空白/截断。
- 模块之间用空白加 `line` 分隔；代码与 shell 命令使用专用语法 token。
- 用现有 `test:tui:perf` 和 keyless PTY 基线证明滚动、展开和着色。

**Non-Goals:**

- 不 fork Ink，不移植 DECSTBM/Yoga dirty 实现。
- 不引入按卡焦点模型或替换 Ctrl+E 为点击展开。
- 不把 logo `accent` 用于代码高亮。
- 不改变 session 日志、provider、SDK 或持久化格式。
- 不把完整 highlighter 依赖（tree-sitter 等）引入 renderer。

## Decisions

### 1. Transcript 绘制以 VisibleFrameSnapshot 为准

对话列的可见行在滚动和流式尾部更新时由 `frame-fill` 按绝对坐标重绘。Ink 继续绘制 AppShell chrome（标题、composer、footer、overlay pane）。StreamView 在 TTY 上不再为滚动改变 `bottom={-offset}` 的 Yoga 几何；presented 行只更新 snapshot 的 `visibleTop`。

备选：继续双写 Ink+overlay。否决，因为两套几何是截断和闪烁的来源。备选：fork Ink ScrollBox。否决，维护成本高于 overlay 通道已提供的能力。

### 2. 滚动量子化 React，不量子化像素

`offsetFromBottom` 的权威值放在 scheduler/ref 上。`useSyncExternalStore`（或等效订阅）的 snapshot 按 `floor(presented / max(1, overscan/2))` 量子化，只有跨桶才触发 commit 以更换 `SlicedLinesBlock` 窗口。方向键仍一帧一行，但这一行只走 overlay。PageDown 仍以 `viewportRows-1` 为 target；距离超过 catch-up 阈值时允许更大步长，Home/End 继续 snap。

备选：保留每帧 `dispatchViewport`。否决，这正是滚动卡顿的同步路径。

### 3. 帧仲裁器按需启动

`createFrameArbiter` 在没有 pending stream/scroll/动画时不持有 `setInterval`。`requestScroll`/`requestStream` 或 scheduler 进入 animating 时启动，空闲一帧后停止。滚动期间 `markScrollActivity` 等价开关跳过推理时钟、品牌动画和 metrics 采样。

### 4. Ctrl+E 仍是全局标志，正文按视口投影

保留 controller 的 `toolCardsExpanded` 布尔值和标题 `▸`/`▾` 切换，满足现有快捷键。`projectToolCardEntry` 在 `fold.tools` 时只为与 `[overscanTop, overscanBottom]` 相交的卡生成 body 行，其余卡只保留标题行加可选“已展开但未入视口”的零成本占位高度（用已知行数 spacer，不建 span）。单卡 body 超过配置上限（默认与围栏折叠相同的 500 行量级，实际投影再按 viewport 切片）时使用既有 `▾ … 还有 N 行` 脚注。新挂载行每帧有上限，避免一次把视口填满成数千 `<Text>`。

折叠/展开分槽缓存：`tools-open` 与 `tools-closed` 的派生行分开存放，避免切回折叠时丢掉折叠标题缓存。

备选：第一次 Ctrl+E 展开全部历史。否决，这是卡死原因。备选：立刻做 per-card 焦点。推迟，当前没有 transcript 焦点模型。

### 5. Follow overscan 不再降到 0

删除 `status === 'generating' && viewport.follow ? 0 : configuredOverscan`。活动块内部仍只把可变尾部当 dirty；其上方 settled 行保持 overscan。这会增加流式 follow 的少量挂载，但避免上翻空白，并符合已有“挂载由 viewport 决定”的预算。

### 6. 修订 C4：语法 token 不占用 accent

在 `THEME_LEVELS` 增加封闭 token：`codeKeyword`、`codeString`、`codeComment`、`codeCommand`。Truecolor 对齐 Quiet Shell 原型（keyword `#7EB6FF`、string `#B9A4E8`、comment 使用现有 dim 色、command `#75B984` 即 success 绿的命令名用法）。`accent`/`accentText` 仍只用于品牌、链接、运行中标记和选中态。`markdown.tsx` 的 `TOKEN_STYLES` 与 `markdown-render.tokenizeCodeLine` 必须共用同一映射。Shell 命令名识别保持轻量：展开 terminal 卡的首个空白分隔 token，外加小型内置命令表；不是通用 shell 解析器。

16 色：keyword=cyan、string=magenta、command=green、comment=bright-black。`none`：全部空串。

备选：继续灰阶+bold。否决，用户已无法扫描关键字和命令。备选：keyword 用 `accentText`。否决，会与链接混淆。

### 7. 模块间隔：消息间加 line，栈内仍紧凑

消息块之间保持两行 `gapRows`；其中一行写成 `line` token 的全宽 `─`（或等宽 dim 规则），背景仍是 frame `bg`。`turnPartGap`：不同 kind 之间 1 行，工具卡之间 0 行。不引入 CSS 像素间距，不画圆角卡片边框。

### 8. 投影行宽度含前缀，Ink truncate 只作保险

`SlicedLinesBlock` 的 speaker 前缀计入投影宽度。投影器输出的行 MUST 已适配内容列。Ink `wrap="truncate"` 仅防止测量误差溢出到下一行；一旦 overlay 成为权威绘制，可见 transcript 可以不再挂每行 `<Text>`。

### 9. 工具完成态静音与紧凑单行

成功状态移除大号醒目的 `ok: '完成'` 文本和突出高亮绿色，改用单行次级文本呈现（`✓ ${name} ${summary}`，字体使用 `fgDim`/`fgSoft`，用时以次级格式标注）。仅失败工具（`error` 红色高亮、显示 exitCode 及末尾错误摘要）和正在运行中工具（`accentText` 动画标记）具有高视觉权重。这保证长工具链执行时，视觉重心牢牢留在助手最终结论上，不再产生满屏大绿字噪音。

### 10. 紧凑内联权限审批条

将占据输入区的大块覆盖式审批对话框改造为紧贴输入框上方的紧凑单行条：
`允许执行 bash "pnpm test" 吗？ [Y] 允许 · [n] 拒绝 · [a] 本会话总是`
支持 `Y`/`n`/`a` 单键立即响应；确认或拒绝后，该行就地收敛为浅色审计单行（如 `已允许执行 bash "pnpm test" · 本会话`），不替换用户正在编辑的 composer 草稿，不遮挡多行对话上下文。

### 11. 单行极简页脚与唯一事实原则

将三行仪表盘默认收敛为 1 行极简页脚：左侧显示交互快捷键（`Shift+Tab 模式 · Ctrl+O 思考 · Ctrl+E 工具`），右侧显示紧凑状态与上下文压力（`28K / 500K · 生成中`）。严格落实单一事实原则：
- 模型名称由输入框右下边框的 `model-chip` 统一承载；
- 当前工作目录与会话由顶栏统一承载；
- 底部页脚不重复打印模型名与全套详细指标，仅在垂直行数充裕（`rows > 30`）且用户配置时才按需展开第二行 metrics。

### 12. 模式切换与专注模式 (Focus View)

输入框右下嵌入当前模式标识（`agent` / `plan` / `focus`），快捷键 `Shift+Tab` 循环切换：
- `agent`：全功能自主执行模式；
- `plan`：规划模式，优先生成分析与步骤，写操作受控；
- `focus`：专注结论模式。视口投影器自动隐去所有中间工具卡，仅呈现用户输入与模型最终正文/代码建议，满足长链条排查后快速审阅结论的需求。

## Risks / Trade-offs

[滚动只画 overlay，Ink 缓冲区与屏幕不一致] → 结算、resize、选区结束和 tier 变化仍走一次完整 snapshot scrub；ScreenAtlas 继续以 overlay 写入为准。

[有界展开让 Ctrl+E 看不到视口外卡体] → 标题仍全部切换为 `▾`；滚入后再投影 body。PTY 场景断言可见区域，而不是一次断言全部 17 张卡的全文。

[新语法色在 16 色上与 status 绿/红接近] → command 用 green 只用于命令名；错误状态仍是整卡 `error` token。真彩色档不复用 `success` 文本于正文。

[Follow 保留 overscan 增加流式挂载] → overscan 仍封顶为一个 viewport；活动尾部增量路径不变。

[成功工具静音可能让用户误以为工具未执行] → 标题行保留轻量 `✓` 与耗时，运行中状态保留动画，失败状态强高亮。

[内联审批条挤占单行内容高度] → 审批仅在需要确认时动态插入单行，处理后转为纯文本归档并释放，比原有弹窗占用减少 3~5 行。

## Migration Plan

无需数据迁移。配置若已暴露 `transcriptOverscan` 则行为从“生成中为 0”变为“始终生效”。默认页脚高度从 3 行优化为 1 行自适应。文档与 Agent Note 同步修订 C4、Ctrl+E 有界语义及工具静音设计。回滚即恢复当前 React-per-row 与全量面板。

## Open Questions

无。per-card 点击展开留到后续 change，不阻塞本次。

