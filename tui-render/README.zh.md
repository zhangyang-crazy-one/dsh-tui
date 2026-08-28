---
description: "Ink 终端渲染库：面向投影有界会话历史、面板、Markdown、工具卡与终端输入的调用方。"
kind: "package-library"
---

# @deepseek-ai/dsh-tui-render

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tui-render` 让终端运行时通过 Ink 投影有界会话历史、面板、Markdown、工具卡与输入。调用方提供控制器快照，并获得终端渲染与输入动作，无需让本库拥有 agent 或持久化。本包不注册 Cordis 服务，也不发起模型请求。

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

`dsh-tui` 运行时已拥有终端生命周期与 `TuiController` 时导入本库。使用 [`mountTuiRender`](src/index.ts) 挂载 Ink 树，并在运行时拆卸期间处置返回的句柄；所有者测试与其他终端宿主可使用纯投影与布局导出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 约定

- `TuiLoop` 观察 `TuiController` 快照并分发输入动作，不访问 agent 或持久化服务。顶栏标题来自 `controller.getTitle()`：已折叠的 `session/title`，但与人类用户消息并存的 `fallback` 标题除外（那是目录行标签）。在出现 provider 或重命名标题之前，循环显示紧凑挂载标题 `DeepSeek · deepseek-tui`；大型生成 FishLogo 留在空闲首页，而不进入顶栏。`getApprovalPane().open` 为真时组合器槽是 `ApprovalPane`（`等待审批`，脚注 `y 允许一次 · n 拒绝 · i 详情`）；`getAskUserPane().open` 为真时是 `AskUserPane`（编号选项，脚注 `↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问`）。两种情况下 StreamView 都仍在 `children`；`g s`（组合器缓冲恰好为 `g`）/ Ctrl+K / Ctrl+T / `/help` / 空 `/permission` / 空 `/settings` 不打开浏览面板。`getSettingsPane().open` 为真时对话列是 `SettingsPane`（`设置`，`onboarding` 时为 `首次设置`；`namespace · field` 行，例如 `llm-deepseek · baseURL`）；浏览态组合器为空（`↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭`），编辑态使用 `InputBar`。`getSubmitOnEnter()` 为 false 时 Enter 插入换行。`InputBar` 将普通文本、斜杠命令、`@` 提及和持久 `[图片 #N]` 占位符分割为精确且无损的片段；样式只改变展示，`none` 颜色档位保留相同的字面文本。`CommandMenu` 画在它下方，两列（左 `/{name}`、右描述），两侧都转义；命令与提及菜单共用 Up/Down 与 j/k 选择，选中行用 accent `›` 和 `fg` 名称。非空 `/` 查询上按 Enter 执行高亮的名称前缀匹配并保留尾随参数；空 `/` 再 Enter 不会触发目录项。
- `createProjector()` 只把 `source.kind === 'user'` 的 `user/message` 事件视为人类 transcript（文本记录）行。agent 指令、插件上下文、skill 目录以及未来的非用户来源仍会持久化且对模型可见，但不会作为用户撰写的终端消息出现。
- `SessionPane` 渲染传入的会话行、选择和删除确认状态；持久化读取与变更仍由运行时拥有。
- **AppShell / StreamView 布局** — 顶栏下方有一条全宽细线 `─` 分隔；不使用粗线 `═ ║` 铬。`layoutTitleBar` 把标题和徽标装进窗口宽度（标题仍能放下时先截断徽标；截断用一列 `…`；不切开宽字形）。`conversationWidth` 在小于 80 列时使用全宽，80 列及以上使用靠左的 72% 宽度且最多 88 列；resize 后重排，不留居中或预留的侧栏空槽。StreamView 填满 shell 内容槽。空闲无消息时在该列垂直居中绘制生成的官方 FishLogo、`DeepSeek` 字标与 `有什么可以帮忙的`；有 transcript 后窗口堆到底部，最新消息落在状态行和组合器上方。只有跟随态会在新事件到达时推进该底端。↑/k 和 PageUp 先脱离再向旧处移动，PageUp/PageDown 按 60 条消息的历史窗口移动，Home 到达可用的最旧窗口，End 或空组合器下的 `G` 重新跟随最新窗口并清除未读状态。新事件保持脱离窗口并累加 `↓ 最新消息 · {n}`；仅溢出时出现的单列右侧轨道显示相对底端的窗口，滑块至少三行。`viewShift` 额外底边距把堆叠列上移，使逐行移动能在历史窗口生效前露出高回合里更旧的行。用户行与助手行共用该列并都靠左；`>` / `●` 标记区分二者，不用底色板块或左右对贴。一个助手回合按时间顺序绘制各段（推理、正文、工具卡），而不是把全部工具堆在拼接正文之后。助手正文在流式过程中和结束后都走 `MarkdownBlock`，因此格式是实时的、回合结束也不重排；`● ` 标记与两列续行缩进是已上色的行前缀，而不是兄弟 span——因为 Ink 会用未上色单元格填充同一行上两个 span 之间的空隙。流式光标是最后一个文本段最后一行上的 `tail`；还没有任何 token 的生成回合仍会画出该光标，避免槽位空着。生成中，更早的推理段折叠为各自的 `思考 (Ns)`，只有当前段保留标题加最后四行已换行文本；每个 N 是该段经过时间，不是整个回合，live 与冻结历史都是如此。折叠工具卡用 accent 绘制 `▸ {name}`，再用 dim ` · ` 和状态词，摘要在下一行 dim 文案；Ctrl+E 展开为 `▾` 并显示转义后的参数/结果/meta。长行走列宽换行，使 Yoga 量到的高度与随后写出的行一致。消息块之间空 2 行，活动回合内部空 1 行。没有任何组件绘制的行——这些空白分隔行、状态行上方的填充行——依靠 `frame-fill` 保持黑色：它用 `bg` 令牌为 Ink 发出的每个清除序列加括号，既包括 log-update 的逐行 `ESC[2K`/`ESC[K`，也包括 `clearTerminal` 的 `ESC[2J`（可见屏幕；`ESC[3J` 回滚缓冲不加括号，以免 BCE 把整段 scrollback 涂黑）——当一帧溢出视口时 Ink 走这条路径，把各行写出而不带逐行清除（钉死的帧高度使这成为常态）。不支持 BCE 的终端退回逐行 `paintRow` 条带。
- `mountTuiRender()` 拥有 Ink 备用屏幕生命周期，并返回对应的卸载 disposer（释放函数）；首次渲染前它从环境安装检测到的颜色档位（`installTheme(env)`，默认 `process.env`，可注入以便测试），使渲染树中的每个 `styled()` 调用都映射到检测到的档位（truecolor → 256 → 16 → none）。同一快照安装 OSC 8（`installHyperlinks(env)`）。传入 `frameProbe` 时它用 `FrameProbe` 包裹渲染树，使每个 React 提交都记录其渲染成本。
- **鼠标与 OSC 8** — 在 TTY 对上 `mountTuiRender` 启用 SGR 鼠标（`1000`/`1002`/`1006`），从 Ink 的 stdin 剥掉报告，并在卸载时关闭跟踪（即使 `render` 抛错）。未知终端以及不声明转发超链接的 tmux/screen 保持纯文本；标签与 href 不同时追加 dim 的 `(href)`（`mailto:` 比较时去掉 scheme）。Markdown 链接与折叠工具卡摘要在 `escapeContent`/`styled` 之后把已上样式的文本包进 OSC 8；只有 `http(s):`/`mailto:`/`file:` href 会包装或打开。每个已绘制 stdout 分片都通过一次字素遍历进入选区 `ScreenAtlas`；CSI 与 OSC 读取器在原始字符串上推进绝对偏移，既保留拆分序列续接，也不为每个单元格分配剩余整帧。滚轮映射为当前可见面板的 j/k 动作（每次一行；设置编辑/引导忽略滚轮）。左键拖动按阅读顺序复制文本，先写 OSC 52（上限 100_000 字符）再走主机剪贴板助手；点击通过主机打开器打开单元格下的 href。
- **生成品牌与主题样式** — `scripts/gen-tui-brand.ts` 从仓库拥有的 `FishLogo.tsx` 源文件读取精确 `viewBox`、path 数据和 `currentColor` fill，不导入客户端运行时代码。确定性的 nonzero-fill 栅格化锁定 44×38 bitmap（位图），再打包为 44×19 的 A half-block 档；B full-block 与 C ASCII 从同一位图派生，最后才是纯 `DeepSeek` 字标。四个 A 档 reveal 帧的每个轮廓单元逐字相同，只有外部粒子变化。`doc-sync` 包含的 `verify-tui-brand` 会拒绝任何过期生成产物。通用鲸鱼 emoji 不是品牌或降级档。`styled(escapeContent(text), token)` 是唯一样式路径：内容先转义再上样式，每个 token（`accent`/`success`/`error`/`fgDim`/…，封闭的 `THEME_LEVELS` 集合）都经已安装档位映射。truecolor `accent` 是 DeepSeek 标志蓝 `#4D6BFE`，不是 Grok/Tailwind `#3B82F6`。`none` 档位下文本不带样式渲染，因此 16 色与无色终端保持可读。`formatAdaptiveInfoFooter` 根据控制器提供的 provider/model/status、可选 effort、上下文压力、token/cache 总量与持久 retry 倒计时绘制最多三行。宽度收窄时它按完整 segment（分段）丢弃低优先级内容，转义 provider 与失败文本；运行时没有权威计费投影，因此 formatter 不包含费用字段。feedback 行（`feedbackLine` — `✓` 文案渲染为 success，`✗` 及其他失败文案渲染为 error）、选中/列表/timeline-current 标记（accent）、生成的空闲轮廓与字标、组合器提示符（空缓冲显示 dim `输入消息`）与面板脚注（fgDim）共同构成语义样式矩阵。Markdown 走同一路径：代码 span 在每行 `codeBg` 条带上映射到 tier token（无硬编码 truecolor）；行内强调、标题、GFM 表头和链接使用 accent（链接再按上面的 OSC 8 规则包装）。覆盖层面板标题保持粗体 fg。
- `escapeContent`、`displayWidth`、`wcwidthSafeSlice`、`padDisplayEnd` 与 `wrapDisplayLines` — 渲染层拥有控制字节转义、显示宽度测量、列对齐补齐和按列换行（`string-width` 依赖归属本包）；宿主 re-export `escapeContent`、`displayWidth` 和 `wcwidthSafeSlice` 以保持宿主侧导入不变。GFM 表格按每列最大显示宽度补齐（`padDisplayEnd`），在盒式网格（`┌─┬─┐` / `├─┼─┤` / `└─┴─┘`）内折单元格；窗口放不下边框时退回已换行的 ` | ` 拼接行；markdown 行设置 Ink `wrap="truncate"`，已量好的行不会二次换行并覆盖下一行。
- `composerCursorPosition` / `composerFrameAnchor` / `clampCaretIndex` / `moveCaretByGrapheme` — 纯组合器光标几何（caret 在缓冲显示网格上的行/列：多行、CJK/emoji 宽度、不切宽字形）、按字素步进，以及 Ink 写帧后追加的 CSI 原点。`InputBar` 在 render 期间把该原点按 `caretIndex`（省略则为缓冲末尾）发布到 frame-fill 流。TTY 全屏帧（AppShell 高度等于视口、无尾随换行）把光标留在最后一行输出上，因此组合器末行是 `up = 0`；命令目录画在组合器下方时，`rowsBelow` 计入 `up`；非 TTY 的尾随换行帧需要 `up = 1`。左右移动若不改变已绘制缓冲，仍写入绝对 CUP，使硬件光标在 Ink 跳过该帧时仍跟随 `caretIndex`。Ink 7.1.1 不提供运行时 IME 组合状态，因此没有任何组合检测，也没有按键让位。
- `FrameProbe` — 提交驱动的渲染成本仪器：被包裹子树中的每个 React 提交经其 Profiler `onRender` `actualDuration` 记入有界 120 样本环形缓冲，汇总为 `count`/`mean`/`max`/`p95`（只读 `frameStatsSnapshot()`）。`renderMs` 是根提交的 React 渲染阶段成本，专用 `PixelFishHome` 探针提供 `brandRenderMs`；两者都不是墙钟终端绘制声明，也不含 Ink host diff/commit 阶段。`activeBrandRevealTimerCount()` 提供配套的自有 timeout 采样。Profiler 包装器在自身 props 保持引用稳定时仍对每个子树提交触发 `onRender`，因此稳定挂载不会漏掉子提交。
- **性能界限** — 不可变的冻结 assistant Markdown 传入 `settled` 并复用已解析 mdast；持续变化的流式源始终解析且不进入该缓存。冻结 Markdown 行按源文本、宽度和主题档位 memo。mdast 与语法 token map 各自使用 2,000 项的 least-recently-used（最近最少使用）上限，并通过只读 `markdownCacheInternals` 向占用量和命中／淘汰测试公开。`transformFrameChunk` 在擦除序列替换扫描前直接返回不含 `ESC` 的分片。

### 高级交互约定

- Dialog 把 StreamView 留在内容槽并占用输入槽；浏览覆盖层替换内容，除编辑态外隐藏组合器。Todo、jobs 与 workflow HUD 行绝不捕获输入。自适应底栏保留 provider/model/status，在宽度需要时把 cache/token 与 effort 作为完整 segment 丢弃，并只在匹配的持久 `llm/retry` 与 `llm/retry-started` 记录之间显示 retry 文案。当前 goal 仍在同一个三行上限内可见。
- [`SessionPane`](src/session-pane.tsx) 把控制器拥有的当前父会话渲染为 `会话 ID · {parentId}`，[`AgentHubPane`](src/agent-hub-pane.tsx) 把每个子会话渲染为 `子会话 ID · {childId}`。`SessionRow.id`、`SessionPaneState.currentId` 与 `AgentHubRow.id` 保留导出的 `SessionId` 类型；fixture（测试前置数据）配置不提供这些身份。[`session-pane.spec.tsx`](tests/session-pane.spec.tsx) 与 [`agent-hub-pane.spec.tsx`](tests/agent-hub-pane.spec.tsx) 固定精确值和转义行为。
- [`Mention`](src/mention.tsx) 在 [`loop.tsx`](src/loop.tsx) 中的选择用 Up/Down 或 j/k 改变高亮候选项。Enter 插入该目标并带恰好一个 trailing space（尾随空格），但不提交；Escape 关闭选择菜单。[`composer-tokens.spec.ts`](tests/composer-tokens.spec.ts)、[`mention.spec.tsx`](tests/mention.spec.tsx) 与 [`loop-input.spec.tsx`](tests/loop-input.spec.tsx) 拥有无损 token 分割和聚焦按键行为验证。
- [`StreamView`](src/stream-view.tsx)、[`ToolCard`](src/tool-card.tsx) 与 [`turn-tail.ts`](src/turn-tail.ts) 渲染带展示转换器标签的折叠卡、宽度自适应过程摘要、`── 已完成 ──` 和按首次出现排序的产物路径。[`visual-conformance.spec.tsx`](tests/visual-conformance.spec.tsx) 拥有有界布局规则；组装后的 [`terminal.expected.txt`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/terminal.expected.txt) 拥有 80x24 与 200x50 的稳定 ScreenAtlas 单元格。[高级能力 Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.zh.md)记录其理由和证据归属。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [TUI 包映射](../README.zh.md) — 终端运行时与渲染器所有权。
- [TUI profile 层](../tui/README.zh.md) — 控制器、生命周期、持久化与组装证据。
- [终端子系统](../../../docs/subsystems/terminal.zh.md) — 终端类型与生成的 Cordis 声明。
- [高级能力决策](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.zh.md) — 渲染理由与证据所有权。

-----

<a id="model-experience"></a>
## 模型体验

### 终端对话展示

#### 模型看到的内容

渲染器不添加提示词文本、工具 schema（模式）、会话事件或模型请求；它只显示运行时提供的 `ViewModel`。

#### Token 影响

该包的输出仅在终端可见，因此没有直接 Token 影响。

#### KV Cache 影响

渲染器不改变请求前缀，也不发起模型请求，因此不会影响 KV Cache。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **终端能力降级** — 颜色、OSC 8 与语法高亮会降级到较低终端等级；渲染器不会模拟不可用的终端功能。
- **SGR 鼠标占用指针** — `1002` 模式替代终端原生选择；复制走进程内反色叠加再加 OSC 52。
- **会话目录数据** — 搜索、时间线和导出数据仍由运行时拥有，使该包能渲染它们而不拥有存储或生命周期。
- **组合器光标为布局近似** — 全屏与尾随换行两种原点都假设 AppShell 把组合器槽钉在底部（`rowsBelow` 计入组合器下方的命令目录行），且不建模超宽行的终端软换行。
- **滚动轨道表示消息窗口** — 单列轨道反映 60 条消息投影，而非精确的换行后物理行；它不支持指针拖动，且单个高于内容槽的回合仍从顶部裁切。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
