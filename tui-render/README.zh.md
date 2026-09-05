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

默认的 [Soft Slate 主题](../../../.agents/notes/implemented/feature/2026-09-02-tui-soft-slate-visual-hierarchy.zh.md) 区分画面、用户消息、工具卡、代码与输入/状态带，同时保留 truecolor、256 色、16 色和 `NO_COLOR` 降级。字体和行高仍由终端模拟器拥有。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 约定

- `TuiLoop` 观察 `TuiController` 快照并分发输入动作，不访问 agent 或持久化服务。顶栏标题来自 `controller.getTitle()`：已折叠的 `session/title`，但与人类用户消息并存的 `fallback` 标题除外（那是目录行标签）。在出现 provider 或重命名标题之前，循环显示紧凑挂载标题 `DeepSeek · deepseek-tui`；大型生成 FishLogo 留在空闲首页，而不进入顶栏。仅当多行具有相同折叠标题时，`SessionPane` 才追加最短唯一 session-id 提示，使不同会话无需新增专用身份行即可辨认。`getApprovalPane().open` 为真时组合器槽是 `ApprovalPane`（行内权限问题、`[Y] 允许 · [n] 拒绝 · [a] 本会话总是` 以及可选详情）；`getAskUserPane().open` 为真时是 `AskUserPane`（编号选项，脚注 `↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问`）。两种情况下 StreamView 都仍在 `children`；`g s`（组合器缓冲恰好为 `g`）/ Ctrl+K / Ctrl+T / `/help` / 空 `/permission` / 空 `/settings` 不打开浏览面板。`getSettingsPane().open` 为真时对话列是 `SettingsPane`（`设置`，`onboarding` 时为 `首次设置`；`namespace · field` 行，例如 `llm-deepseek · baseURL`）；浏览态组合器为空（`↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭`），编辑态使用 `InputBar`。`getSubmitOnEnter()` 为 false 时 Enter 插入换行。`InputBar` 将普通文本、斜杠命令、`@` 提及和持久 `[图片 #N]` 占位符分割为精确且无损的片段；样式只改变展示，`none` 颜色档位保留相同的字面文本。`CommandMenu` 画在它下方，两列（左 `/{name}`、右描述），两侧都转义；命令与提及菜单共用 Up/Down 与 j/k 选择，选中行用 accent `›` 和 `fg` 名称。非空 `/` 查询上按 Enter 执行高亮的名称前缀匹配并保留尾随参数；空 `/` 再 Enter 不会触发目录项。
- `createProjector()` 只把 `source.kind === 'user'` 的 `user/message` 事件视为人类 transcript（文本记录）行。agent 指令、插件上下文、skill 目录以及未来的非用户来源仍会持久化且对模型可见，但不会作为用户撰写的终端消息出现。
- `SessionPane` 渲染传入的会话行、选择和删除确认状态；持久化读取与变更仍由运行时拥有。
- **AppShell / StreamView 布局** — 顶栏下方有一条全宽细线 `─` 分隔；不使用粗线 `═ ║` 铬。`layoutTitleBar` 把标题和徽标装进窗口宽度（标题仍能放下时先截断徽标；截断用一列 `…`；不切开宽字形）。`conversationWidth` 在小于 40 列时使用完整宽度，其他宽度左右各保留 2 列安全留白；生成的官方 FishLogo、`DeepSeek` 字标与问候语则独立居中。Transcript、推理、Markdown 表格、工具卡和相关 HUD 使用这块近全宽阅读区，结构化输出不再被压进 88 列上限。Todo、Jobs、Workflow、composer 或 queue HUD 行存在时，共享会话容器会填满 AppShell 的固定内容槽，StreamView 获得 HUD 之外的全部剩余行；单行 HUD 不能再把 transcript 压成零高度。Markdown 表格在可容纳时保持自然宽度，只有超过行预算时才缩小列宽或换行。受限表格比较换行数量收益，保留紧凑状态列和标识符可读下限；只有不等列宽能降低记录高度时才偏离均衡分配。多行记录之间增加细分隔线。单元格换行保留能容纳的完整单词，并按终端显示宽度拆分超长标识符与中日韩文本。助手 Markdown 在换行前为正文左右预留相同缩进，保持表格对称，并防止 Ink 截断删除文本。`InputBar` 是独立的全宽 `inputBg` 工作区，包含 accent 左竖线、标题提示行和 draft 行；其下的全宽状态区默认只显示一行简洁状态，活动目标进度优先于通用提示；主动开启指标详情后，才按高度最多展示三行。输入区标签是默认唯一的模型名称。Resize 会重排两个区域，低高度会先省略低优先级状态行并选择更小的品牌档位，不能挤出组合器。StreamView 裁切一个固定内容槽，并在换行后的终端物理行上拥有唯一 transcript 滚动坐标。↑/k 与 ↓/j 移动一个物理行，PageUp/PageDown 移动视口减一行，Home 到达最旧行，End 或空组合器下的 `G` 原子地重新跟随最新行。普通向下导航或轨道跳到 live 端也会恢复 follow 并清除未见行。脱离态在流式追加、活动回合冻结、工具完成、compaction、缓存重建或 resize 改变周边布局时保持 `{blockId,rowWithinBlock,viewportRow}`。脱离底部时，固定在右下的控制层提示显示 `↓ 底部 · End/G`；有物理行追加时，它还会显示 `最新消息 · {n}`；仅溢出时出现的轨道会在每个 Ink 帧之后用绝对终端坐标绘制到最右控制列，因此 emoji 宽度差异不会移动某一条轨道行。`scrollbar` 属性同时关闭轨道绘制与鼠标命中，不改变阅读宽度或脱离提示。可见单元与鼠标区域共享同一几何，左键点击或拖动会在文本选择开始前把轨道映射到最旧至 live 的范围。完整历史仍以 block/source 描述符为 canonical source（权威源）；`TranscriptRenderStore` 只挂载与已配置 overscan 相交的精确物理行。已结算行数组保持稳定身份，当前视口、活动块与锚点块会被固定，已配置的行数/字节 LRU 上限只淘汰可重建的派生行。用户与助手行在阅读区内靠左；整行 `messageBg` 区分用户行，助手正文保留在画面背景上，`>` / `●` 在不使用左右对贴的情况下保留说话方身份。助手回合按时间顺序绘制推理、正文和工具卡。关闭的工具堆栈最多保留三张代表性卡片，把更早调用放进一张 `工具记录` 卡片，并可通过 Ctrl+E 显示每张卡的有界预览；非零终端退出与 signal 仍显示为失败。相邻卡片之间不插入 transcript 空行。思考默认隐藏，不显示折叠标题。Ctrl+O 在共享 transcript 中显示完整的淡化思考正文，流式生成和结束后均保留；最终 Markdown 仍最突出，TurnTail 与完成元数据保持 dim。段落换行和完整围栏代码块均可继续浏览，不再设置局部 500 行上限。解析后的 Markdown 顶层块之间保留一个物理空行，使标题、段落、列表、表格和代码块在视觉上彼此分开。StreamView 绝不在助手正文内绘制光标字形；硬件 caret 只属于组合器。物理行投影只在思考、工具堆栈和正文之间保留一个空行。等待开始和最后可见思考的耗时会在模型事件之间每 0.1 秒前进；正文或工具成为最后可见部分后，计时器停止。提供方没有返回 reasoning 文本时，TUI 只显示动态进度标签，不合成隐藏思维链。消息块之间保留两个空行，活动回合内部保留一个空行。彩色 tier 下，`frame-fill` 会在每次完整 Ink 字符串写入期间保持 `bg` 令牌，并在 SGR reset 后重新应用。输入与状态区使用 Ink 的全宽 Box 几何，`paintBackgroundRow` 则在 reset 结束的内容片段之间恢复所属背景 token，并输出剩余实测背景单元；因此每个布局单元都由背景覆盖，不依赖 Text 内嵌行尾清除、终端 BCE 或 Ink 保留 Box 末尾空格。可见屏幕与行清除继承页面背景；scrollback 清除会临时恢复终端默认背景，写入结束时也恢复默认值。`none` tier 不增加背景 ANSI。
- `mountTuiRender()` 拥有 Ink 备用屏幕生命周期，并返回对应的卸载 disposer（释放函数）；首次渲染前它从环境安装检测到的颜色档位（`installTheme(env)`，默认 `process.env`，可注入以便测试），使渲染树中的每个 `styled()` 调用都映射到检测到的档位（truecolor → 256 → 16 → none）。同一快照安装 OSC 8（`installHyperlinks(env)`）。host 传入已验证的 `renderPolicy`，控制 transcript overscan、流节奏、latest-target 滚动以及行数/字节缓存上限；`frameMetrics` 记录投影、队列、滚动、缓存与 stdout drain 指标。传入 `frameProbe` 时它用 `FrameProbe` 包裹渲染树，使每个 React 提交都记录其渲染成本。
- **鼠标与 OSC 8** — 在 TTY 对上 `mountTuiRender` 启用 SGR 鼠标（`1000`/`1002`/`1006`），从 Ink 的 stdin 剥掉报告，并在卸载时关闭跟踪（即使 `render` 抛错）。未知终端以及不声明转发超链接的 tmux/screen 保持纯文本；标签与 href 不同时追加 dim 的 `(href)`（`mailto:` 比较时去掉 scheme）。Markdown 链接与折叠工具卡摘要在 `escapeContent`/`styled` 之后把已上样式的文本包进 OSC 8；只有 `http(s):`/`mailto:`/`file:` href 会包装或打开。产品帧发布一个共享 `VisibleFrameSnapshot`；其中的物理行、样式 span、href、轨道几何与 source 坐标会直接更新 `ScreenAtlas`。只有缺少产品自有几何的输出才使用 ANSI/OSC 字节解析 fallback。同一 stdin 数据块内的滚轮报告会在进入 React 输入处理前合并成一个有符号请求，每个报告贡献经验证的 `scroll.wheelRows` 个物理行（默认 3）；设置编辑/引导仍忽略滚轮。在已发布轨道单元格内按下左键后，点击和拖动定位会持续拥有该指针直至 release，且绝不复制 transcript 文本。轨道外出现左键 motion 时，渲染器立即恢复上一层叠加，并只反色当前阅读顺序范围内实际写入且不属于轨道的单元格。release 会经 OSC 52（上限 100_000 字符）和主机剪贴板助手复制，随后立即恢复已发布行的样式。轨道单元格及其左侧宽字符保护格既不进入叠加层，也不进入复制文本；轨道出现、消失或 resize 后换列时，绘制层会清除这两个单元格。即使终端省略中间移动报告，只要 release 位于不同单元格也会完成拖选；同一单元格的点击则通过主机打开器打开该单元格下的 href。Ctrl+Y 与鼠标选区无关，它复制最新一条非空 assistant 消息或其中最后一个闭合围栏代码块的正文。
- **生成品牌与主题样式** — `scripts/gen-tui-brand.ts` 从仓库拥有的 `FishLogo.tsx` 源文件读取精确 `viewBox`、path 数据和 `currentColor` fill，不导入客户端运行时代码。确定性的 nonzero-fill 栅格化在 44×32 逻辑位图上把 viewBox 比例误差控制在 2% 内，再打包为 44×16 的 A half-block 档；生成器会在输出产物前拒绝拉伸尺寸。B full-block 与 C ASCII 从同一位图派生，最后才是纯 `DeepSeek` 字标。四个 A 档 reveal 帧的每个轮廓单元逐字相同，只有外部粒子变化。`doc-sync` 包含的 `verify-tui-brand` 会拒绝任何过期生成产物。通用鲸鱼 emoji 不是品牌或降级档。`styled(escapeContent(text), token)` 是唯一样式路径：内容先转义再上样式，每个 token（`accent`/`success`/`error`/`fgDim`/…，封闭的 `THEME_LEVELS` 集合）都经已安装档位映射。truecolor `accent` 是 DeepSeek 标志蓝 `#4D6BFE`；`accentText` 是用于小号交互文本的较亮 `#7589FF`。16 色档位使次要文字与输入背景使用不同颜色；`none` 档位下文本不带样式。`formatAdaptiveInfoFooterRows` 从控制器提供的工作区/状态、provider/model、可选 effort、上下文压力、完整的输入/输出 token 总量、缓存命中率、操作提示与持久 retry 倒计时中绘制最多三层语义行；`formatAdaptiveInfoFooter` 以纯文本投影相同选择。上下文在空间充足时使用十格占用条与百分比，并按完整 segment 降级为百分比或数值。输入是未缓存输入、cache-read 和 cache-write token 之和；命中率以 cache-read token 为分子、以同一总量为分母。没有提示侧输入时缺席，且绝不以缺少直觉意义的原始缓存 token 合计替代。几何收窄时 formatter 按完整低优先级行与 segment（分段）丢弃内容，转义 provider 与失败文本；运行时没有权威计费投影，因此不包含费用字段。feedback 行（`feedbackLine` — `✓` 文案渲染为 success，`✗` 及其他失败文案渲染为 error）、选中/列表/timeline-current 标记（按尺寸使用 `accent` 或 `accentText`）、生成的空闲轮廓与字标、全宽输入工作区与面板脚注（fgDim）共同构成语义样式矩阵。Markdown 走同一路径：代码 span 在每行 `codeBg` 条带上映射到 tier token（无硬编码 truecolor）；标题和 GFM 表头使用可读的 `accentText`，粗体、强调、行内代码与链接分别使用金色、淡紫色、薄荷色和青色 token。段落与列表保留嵌套样式；`styled` 同时为普通绘制和直接滚动重绘提供行内代码的前景及背景（链接保留上面的 OSC 8 包装）。覆盖层面板标题保持粗体 fg。
- `escapeContent`、`displayWidth`、`wcwidthSafeSlice`、`padDisplayEnd` 与 `wrapDisplayLines` — 渲染层拥有控制字节转义、显示宽度测量、列对齐补齐和按列换行（`string-width` 依赖归属本包）；宿主 re-export `escapeContent`、`displayWidth` 和 `wcwidthSafeSlice` 以保持宿主侧导入不变。活动与已结束的 GFM 表格使用同一列宽分配器和按词换行器，按每列最大显示宽度补齐（`padDisplayEnd`），完整网格能容纳时保持自然列宽，在盒式网格（`┌─┬─┐` / `├─┼─┤` / `└─┴─┘`）内折单元格，对齐列无法满足最小宽度时回退到可读的键值记录；markdown 行设置 Ink `wrap="truncate"`，已量好的行不会二次换行并覆盖下一行。
- `composerCursorPosition` / `composerFrameAnchor` / `clampCaretIndex` / `moveCaretByGrapheme` 保留按字素计算的缓冲坐标。`InputBar` 发布绝对终端行列，并在面板拥有输入时隐藏光标。帧包装层先恢复 Ink 从底部开始清除的原点，再把当前光标与正文、轨道一起提交。重复叠加写出保持幂等；只移动光标时仍发送 CUP。草稿横向窗口以 `‹` 提示前方还有内容，并保持光标和邻近文本可见，不修改原始缓冲。Ink 7.1.1 不提供 IME 组合状态；原生预编辑和实体字形对齐仍需逐终端检查。
- `FrameProbe` 为每次子树提交记录 React Profiler 的 `actualDuration`。每个时长通道保留最近 120 个精确样本，以及固定存储的全程直方图，包含数量、均值、p95、p99 和最大值。直方图分位数使用微秒桶与三位有效数字；`beginMeasurement()` 只丢弃一次启动/恢复样本，之后重置窗口不会删除全程分布。根节点与品牌渲染成本不包含 Ink diff/commit、stdout drain 或实体显示延迟。`frameMetrics` 分别记录 drain、滚动、完成写出间隔、输入/合并计数、队列深度和缓存工作量。挂载期间会在观察者收到 React 开发模式 User Timing 记录后消费这些记录，不把组件属性保留整个会话，也不清除无关测量。
- **性能边界** — 每个流式 Markdown 块推进仅追加的完整行 collector，保留稳定 parsed block 与物理行引用，并只重新解析仍有歧义的后缀；引用定义、可视化指令、渲染 scope 变化以及无法证明局部性的结构走显式安全全量重算。fence-aware 表格 scanner 只从表头开始 holdback 当前活动表格；自适应布局保留紧凑值，依次收缩 token-heavy 与 narrative 列，并在必要时选择键值记录。`TranscriptRenderStore`、projector 缓存与语法 token 缓存均有界，且都能从 canonical source 重建。共享帧仲裁器让滚动优先于有界展示队列，并发布每次变化的物理偏移，包括最后一帧。Overscan 限制缓存行数，不限制绘制频率。反向输入从当前显示位置替换待完成的移动。滚动突发会保持已选追赶速度直到最后一步。变化的滚动偏移也会在布局阶段发布实测快照，无需等待 Ink 的独立输出节流。Ink 的最高帧率跟随配置中较快的流式/滚动节奏。在 Ink 增量输出之后，`VisibleFrameSnapshot` 会按终端坐标重绘变化的可见行，并清除缩短或不再占用的范围；未变化的物理行 identity 不产生 overlay 写出。Ink 完成一帧输出后，变化的几何或已结束轮次标识只清理当前 transcript 区域。正文、轨道和绝对光标在同一个 synchronized-output 结束标记之前提交。仅布局变化的轨道更新使用与 transcript 绘制相同的 synchronized-output 帧。浏览面板替换 transcript 时，会在布局清理阶段、替代面板绘制前释放正文快照、轨道和指针区域。`pnpm run test:tui:perf` 拥有严格的真实 PTY 长 Markdown、增长表格、10,000 行滚动、resize 与 slow-sink 目标。
- **工具检查** — Ctrl+E 显示有界预览，不预先格式化全文。`/tools` 列出全部调用；Enter 打开分页原文，n/p 翻页，d 主动显示原始元数据，y 复制完整文本，e 导出。失败摘要独立于流水线成功状态保留退出码或 signal。`ToolRowCache` 只在已验证的条目/行数预算内生成实际请求的行；展示转换器结果和思考换行索引可复用、可重建。紧凑显示版本号引用权威数据，不把完整回答嵌入每个帧标识。新增设置、状态与详情文案使用类型化 zh-CN/en-US 字典。


### 高级交互约定

- Dialog 把 StreamView 留在内容槽并占用输入槽；浏览覆盖层替换内容，除编辑态外隐藏组合器。Todo、jobs 与 workflow HUD 行绝不捕获输入。默认状态行在 80 列及以上显示十格上下文用量条、百分比、缓存命中率与运行状态，空间允许时补充紧凑的绝对用量和操作提示。没有权威值的指标保持缺席。上下文与缓存摘要和显式详情共享计算口径；一般提示与绝对用量先于指标摘要省略，错误与重试优先显示。Retry 文案只存在于匹配的持久 `llm/retry` 与 `llm/retry-started` 记录之间。默认页脚只有一行，主动开启详情后最多保留三行。当前 goal 会在受限第一行替换 cwd，而不会消失。
- [`ModelPane`](src/model-pane.tsx) 最多渲染 30 行目录，并让窗口跟随高亮索引移动，因此 Up/Down 或 j/k 可以到达长目录中的每个模型。脚注报告当前窗口上方与下方隐藏的数量；Enter 通过运行时控制器应用高亮的 provider/model 组合。
- [`SessionPane`](src/session-pane.tsx) 按 `columns` 和 `maxRows` 为标题、时间、当前会话标记及重名 id 提示分配空间。当前行可见且高度允许时，其下方显示精确的 `会话 ID · {parentId}`。[`AgentHubPane`](src/agent-hub-pane.tsx) 保留 `子会话 ID · {childId}`。两个面板都接收控制器提供的类型化 `SessionId`；[`session-pane.spec.tsx`](tests/session-pane.spec.tsx) 与 [`agent-hub-pane.spec.tsx`](tests/agent-hub-pane.spec.tsx) 拥有身份和转义行为验证。
- [`Mention`](src/mention.tsx) 在 [`loop.tsx`](src/loop.tsx) 中的选择用 Up/Down 或 j/k 改变高亮候选项。Enter 插入该目标并带恰好一个 trailing space（尾随空格），但不提交；Escape 关闭选择菜单。[`composer-tokens.spec.ts`](tests/composer-tokens.spec.ts)、[`mention.spec.tsx`](tests/mention.spec.tsx) 与 [`loop-input.spec.tsx`](tests/loop-input.spec.tsx) 拥有无损 token 分割和聚焦按键行为验证。
- [`StreamView`](src/stream-view.tsx)、[`ToolCard`](src/tool-card.tsx) 与 [`turn-tail.ts`](src/turn-tail.ts) 渲染带展示转换器标签的卡片、有界关闭工具堆栈、明确的进程失败、`── 已完成 ──`、按首次出现排序的产物路径和精确本轮输入/输出/cache 统计。[`visual-conformance.spec.tsx`](tests/visual-conformance.spec.tsx) 拥有有界布局规则；组装后的 [`terminal.expected.txt`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/terminal.expected.txt) 拥有 80x24 与 200x50 的稳定 ScreenAtlas 单元格。[有界工具卡堆栈](../../../.agents/notes/implemented/bug-fix/2026-09-04-tui-bounded-tool-card-stack.zh.md)与[高级能力](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.zh.md) Agent Note 记录其理由和证据归属。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [TUI 包映射](../README.zh.md) — 终端运行时与渲染器所有权。
- [TUI profile 层](../tui/README.zh.md) — 控制器、生命周期、持久化与组装证据。
- [终端子系统](../../../docs/subsystems/terminal.zh.md) — 终端类型与生成的 Cordis 声明。
- [高级能力决策](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.zh.md) — 渲染理由与证据所有权。
- [物理行视口与全宽工作区](../../../.agents/notes/implemented/bug-fix/2026-08-28-tui-physical-row-viewport-and-centered-layout.zh.md) — 唯一滚动坐标与 HTML 设计转译。

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
- **实体文本输入** — 组合器使用按字素计算的横向窗口和绝对坐标，但字体度量与 IME 预编辑仍由终端模拟器拥有。PTY 单元格断言不能证明实体显示的流畅度。
- **被淘汰行在展示前重建** — 缓存淘汰只删除派生物理行；再次访问被淘汰 block 时会同步从 canonical source 重新投影，因此这次导航可能比缓存命中更慢，但不会改变轨道几何或已锚定的阅读行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
