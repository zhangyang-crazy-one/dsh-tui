---
description: "交互式终端 profile 层：面向在 dsh-base 上组合 deepseek-tui 并操作会话、工具、批准与通知的用户。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui

[English](README.md) | 中文

## 概述

deepseek-tui 的 profile bundle（配置包）与运行时插件让用户在 `dsh-base` 上运行交互式终端。`dsh --profile deepseek-tui` 等待应用就绪，验证终端，创建或恢复 Agent，并在退出前 flush（刷新）所拥有的会话。该层拥有终端生命周期与用户操作，能力包继续拥有 agent、持久化、工具与模型行为。

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

### 配置

bundle patch 从 `tuiStartup` 读取可选的 `task` 首条消息种子、可选的 `resume` 和可选的 `cwd`。启动 provider 接受可选的任务位置参数、`--resume <id>` 与 `--cwd <dir>`；无任务（或仅 `--resume <id>`）时 profile 以空闲的全屏循环启动，焦点位于空 composer（占位符 `输入消息`，以及一行操作/状态页脚），空 composer 上按 Enter 是无操作。

随产品交付的 profile 为 `{ bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui'], patchReload: 'startup' }`。profile 与 home patch 的修改在下次进程启动时生效，不会重新组合正在运行的终端、Agent 或会话。设置文件热更新仍由 settings 服务拥有。

可选 `renderPolicy` 配置在启动时解析一次，并显式传给渲染器。`transcriptOverscan` 与 `cache.maxRows`/`cache.maxBytes` 限制物理行投影和重建缓存；`stream` 拥有 smooth/catch-up 队列阈值与单帧工作量；`scroll` 拥有 latest-target 节奏、追赶步长和鼠标滚轮行数。`tools.previewRows`、`detailPageRows`、`cacheEntries` 和 `cacheRows` 分别限制工具预览、详情分页与派生存储，默认值为 6、40、128 和 2048。Config schema 要求帧间隔和缓存上限为正、overscan/缓存预算有界，且退出阈值严格小于对应进入阈值，因此无效组合会在插件加载时失败。随产品交付的值位于 [`cordis.patch.yml`](cordis.patch.yml)，`pnpm run test:tui:perf` 运行严格的真实 PTY 性能门禁。

思考默认隐藏。Ctrl+O 或 `/reasoning` 在共享 transcript 中显示完整的淡化思考正文；流式生成与结束不会将其折叠。`/scrollbar` 显示或隐藏右侧轨道，不改变阅读宽度与导航。`/status` 切换输入/输出等详细指标；默认单行页脚在权威值与宽度允许时保留上下文用量条、百分比和缓存命中率。模型名称只出现在输入区标签中。这些偏好也可在 `/settings` 中设置，并在重启后保留。`tui.locale` 为新增设置、状态与工具详情文案选择 zh-CN（默认）或 en-US；这些控制不改变模型推理或会话事件。

`--frame-stats <path>` 选择提交级渲染成本测量。目标在启动时解析为绝对路径且必须可写——不可写目标会使启动失败（绝不静默跳过）。有序退出时运行时向该路径写入一个 JSON 文件，且只写这个文件：

`renderMs` 与 `brandRenderMs` 包含最近的 count/mean/p95/p99/max/samples，以及记录每次已测提交的固定存储 `run` 分布。最近样本最多保留 120 个；全程分位数使用微秒直方图桶与三位有效数字。工作负载开始时只排除一次启动/历史恢复样本。这些 React Profiler 成本不包含 Ink diff/commit 或终端显示时间。`pacing` 记录提交数与经过时间；`brandRevealTimers` 记录有序退出时自有的空闲首页 timeout。`frameMetrics` 分别包含完成写出间隔、输入/合并计数、drain 与滚动延迟、解析工作量、队列深度/年龄及缓存统计。文件只含统计、平台/Node/架构及路径，不含会话文本，也不进入 stdout。

`/tools` 打开全部已记录调用，包括通用回退卡和进程失败。Enter 打开有界原文分页，页首保留所选操作与状态；n/p 前后翻页，d 开启原始元数据，y 复制完整原文，e 在启动工作目录中导出私有且不覆盖已有文件的 `tool-*.txt`。超大剪贴板载荷会被明确拒绝并提示导出，不会截断。Esc 先返回列表，再回到原对话。批准与用户提问对话始终保留输入优先级。

### 约定

- 运行时拥有 live Agent 句柄、会话投影和会话目录状态；渲染包只接收 controller 接口。顶栏标题是已折叠的 `session/title`，但与人类用户消息并存的 `fallback` 标题除外；在出现 provider 或重命名标题之前循环显示紧凑挂载名 `DeepSeek · deepseek-tui`。目录行仍使用第一条人类消息作为回退。空闲无消息时，对话列绘制生成的官方 FishLogo、`DeepSeek` 与 `有什么可以帮忙的`。环境独立于颜色选择 half-block、full-block、ASCII 或纯字标输出；`brandAnimation` 保存 `auto | on | off`，任何输入、历史、覆盖层、resize、播放完成或卸载 stop 都会清除一次性 reveal timer。运行时只为已绑定的 live agent 回答 `approval/request`，其他 agent 调用 `next()`。`y`/`a` 得到 `'allowed-once'`，`n`/`d`/Esc 得到 `'rejected'`，中止（含 Ctrl+C 停止生成）经请求 signal 得到 `'cancelled'`。策略 `'never'` 由 host 在该 listener 之前决定，因此不会出现 ApprovalPane。Ctrl+E 翻转当前窗口的工具卡折叠（`toolCardsExpanded`；不写 session 事件）。空 `/permission` 打开预设覆盖层；带参 `/permission <name>` 走 `ctx.commands.execute`。空 `/settings` 打开设置覆盖层，列出 `describe()` 的每个顶层字段（含 JSON 编辑的 `llm-deepseek · models` 与 `llm-pi-ai · providers`）；Enter 应用经 `ctx.settings.update` 写入所选字段。浏览态 `e` 报告 `prepareDocument()`，`r` 重读行（`✓ 已重载设置`）。空 `/resume` 打开会话列表。`/reload` 是本地命令：flush 当前会话、卸载终端、dispose 该会话，再以相同启动器标志加上 `--resume <id>` 拉起新的 Node，并丢掉原来的任务位置参数，以免首条消息再发一次。覆盖层上的 `r` 只重读设置行。空闲启动且未配置 `DEEPSEEK_API_KEY` 时打开 `首次设置`；Enter 经 `ctx.credentials.set` 保存后打开模型面板，Esc 跳过且不打开。`tui` 分节拥有 `colorTier`、`submitOnEnter`（为 false 时 Enter 插入换行）、`notify`（`off | attention | every-turn`，默认 `attention`）、`notifyQuietInputSeconds`（非负整数，默认 10）、`brandAnimation`（显示为 `自动 / 开启 / 关闭`）、`scrollbar`（布尔值，默认 `true`）、`reasoning` 与 `statusDetails`（布尔值，默认 `false`）、`locale`（`zh-CN | en-US`，默认 `zh-CN`）以及上文所述已验证的 `renderPolicy`。当前 runtime root Agent 的 scope 注册 `user-questions/request` waterfall listener；它用 `next()` 委托外部 root 与 child 请求，被接纳的请求则绘制 `AskUserPane`，把中止、Agent 替换与释放归并到同一清理，并只在准入时通知一次。↑↓/jk 移动高亮，数字键再 Enter 返回选项的原始 label。斜杠目录包含每条命令的 `description`。
- `g s` 在组合器缓冲恰好为 `g` 时切换已持久化的会话目录；`/resume` 打开同一列表且不会关掉已打开的列表。折叠标题相同的行会在行内追加稳定的最短唯一 session-id 提示；标题唯一的行保持不变。左右方向键按字素移动组合器 caret。↑/k 把对话移向更旧的行，↓/j 回到 live 边缘；有输入时方向键仍滚动，j/k 则插入字母。对话脱离底部时始终显示 `↓ 底部 · End/G`，有新输出时还会添加未读行数。鼠标滚轮在对话上与 ↑/k 同向，在列表面板上与 j/k 同向；每个报告移动 `scroll.wheelRows` 个物理行，同一 stdin 数据块内的报告合并为一个净请求。Ctrl+N 新建会话，目录动作通过所拥有的服务切换、重命名或删除会话。删除调用 persistence 服务；该服务拒绝 live、已预留或已借用的身份，并在持久删除后移除派生的投影缓存状态。
- 终端、回退标题和 `/export` Markdown 只包含直接人类输入的 `user/message` 事件（`source.kind === 'user'`）与 assistant 回复。来自 agent 指令、插件和 skill 目录的持久模型上下文有意不进入这份人类 transcript（文本记录）。
- Ctrl+K 搜索向 `ctx.sessionQuery` 请求 `literal-substring` 匹配，并过滤到 `user`/`assistant` transcript 角色，因此查询 `回复` 可以找到可见的 `只回复` 文本，同时不会显示注入的模型上下文；其他服务调用方仍保持默认的 token-phrase 模式与完整语义语料库。
- SIGINT 遵循交互状态机；SIGTERM 与 SIGHUP 请求退出。退出会在请求进程退出前 flush 所拥有的会话；`--frame-stats` 在同一有序退出路径写入其 JSON。
- 非 TTY 输出流或不受支持的终端会在渲染树挂载前被拒绝。TTY 对上由渲染层启用 SGR 鼠标和 OSC 8；`/help` 列出滚轮、点击打开与拖选复制。

### 高级入口与证据

- [`RuntimeController`](src/index.ts) 向渲染器的 [`Mention`](../tui-render/src/mention.tsx) 提供运行中的 subagent，并向 [`AgentHubPane`](../tui-render/src/agent-hub-pane.tsx) 提供全部所属子会话。提及选择中，Up/Down 或 j/k 改变高亮目标，Enter 插入该目标并带恰好一个 trailing space（尾随空格）但不提交，Escape 关闭菜单。`g a` 打开 Agent Hub。会话目录通过 [`SessionPane`](../tui-render/src/session-pane.tsx) 在行内标记控制器拥有的当前父会话，Agent Hub 通过 [`AgentHubPane`](../tui-render/src/agent-hub-pane.tsx) 把精确子会话渲染为 `子会话 ID · {childId}`；组装 PTY 将这些行与从所有权推导出的模型准入标记比较，fixture（测试前置数据）配置不提供任何一侧 id。完成这一身份转换后，控制器从 `sessionProjections.snapshot()` 为 live 子会话补充只用于渲染的 Hub 指标。cold 子会话先调用 `sessionProjectionCache.cachedSnapshot(header, keys)`；miss 时借用一次精确的持久化 observation，把其中不可变的 metadata 与完整有序 events 交给 `coldSnapshot(meta, events)` 折叠，并总是释放 borrow。它求和四个持久 token 桶，只根据已测压力与容量推导上下文占用，并使用持久 subagent 计时投影；只有已注册的子会话投影提供模型时才显示，因此当前投影集会省略模型，而不会复制父会话模型。服务缺失、cold 读取失败和值缺失都只省略对应分段，不会使身份表失败，也不会虚构零值。`Σ 子代理` 行汇总已知 token/耗时字段并报告覆盖数。`SubagentListEntry` 保持不变，base 恰好组合一次持久投影缓存。
- 空 `/plan` 打开计划目录；计划评审仍是唯一的用户提问 Dialog，其中 `y` 提交 host 标签 `Approve`，`n` 提交 `Keep planning`。goal 底栏、Todo HUD、后台任务 HUD 与工作流 HUD/`g w` 覆盖层都来自控制器投影，并保持组合器可用。`g t` 打开工作区树，`g f` 通过消息反馈伴随服务读写反馈。带展示转换器标签的工具结果选择 generic、terminal、diff、search、read 或 web 卡；[`stream-view.tsx`](../tui-render/src/stream-view.tsx) 仅在开启时显示完整思考，把关闭的工具堆栈限制为一张摘要加三张代表性卡片，把非零终端结果显示为失败，添加完成边界，并从精确本轮 token/cache 统计生成 TurnTail 产物与指标。
- [`deepseek-tui-advanced-entry.expected.e2e.ts`](../../../apps/cli/tests/deepseek-tui-advanced-entry.expected.e2e.ts) 驱动可运行 profile。其中 [`session.expected.jsonl`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/session.expected.jsonl) 只包含会话拥有的持久事件，[`fixture-audit.expected.jsonl`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/fixture-audit.expected.jsonl) 记录消息反馈 sidecar（伴随文件）读取与瞬态工作流事件，[`terminal.expected.txt`](../../../apps/cli/tests/snapshots/deepseek-tui-advanced-entry/terminal.expected.txt) 记录 80x24/200x50 的稳定单元格，以及归一化的 cold 子会话 Hub 行与汇总证据。`vitest.expected.config.ts` 要求的 TUI 文件在 `test:expected` 下拥有终端 transcript；顶层录制会话 snapshot 则分别拥有模型回放与持久会话输出。[高级能力 Agent Note](../../../.agents/notes/implemented/feature/2026-08-18-tui-advanced-capability-entries.zh.md)拥有理由和验证边界。

### 终端原生交互

- Ctrl+Y 通过 OSC52 与可用的宿主剪贴板 helper 复制最新一条非空 assistant 消息；若存在闭合的反引号围栏代码块，则复制最后一个代码块正文。Ctrl+G 先解析 `$VISUAL`、再解析 `$EDITOR`，准备私有 draft，离开备用屏幕，直接在 `/dev/tty` 上运行编辑器，再用同一控制器重新挂载。未配置、编辑器失败或读回失败都保留原组合器文本。
- 只包含一个本地图片路径的 bracketed paste，或剪贴板含图片时的 Ctrl+P，会向 structured draft 添加仅驻留内存的 `[图片 #N]` segment。发送时准入通过一个有序的 `saveImages()` 批次提交全部尚未保存的 segment，并经既有 `user/message` 事件追加交错的文本与持久 `ImageBlock` 引用。Provider 序列化器把这些引用解析为瞬态请求字节；[`projection.ts`](../tui-render/src/projection.ts) 只渲染消息内序号与可选的已去路径名称，持久化原样加载相同 block，压缩保留含图片的前缀并拒绝图片摘要输出。独立的 [`deepseek-tui-image.expected.e2e.ts`](../../../apps/cli/tests/deepseek-tui-image.expected.e2e.ts) 通过组装 profile 证明组合器准入、终端 replay、只含持久引用的 JSONL，以及 text/image/text provider 顺序。这条路径既不更改 agent-loop，也不更改 `SessionEventMap`，因此不添加 TypeScript 或 Python SDK 上传操作，也不更改其预期输出。
- 轮次运行期间，第一份 immutable structured draft（不可变结构化草稿）进入现有 `agent.steer()` 路径，后续 draft 留在进程内 FIFO。HUD 只把尚未 handoff（移交）的 FIFO 项显示为 `待发 {n} · ↑ 取出`；只有组合器为空且没有模态输入所有者时，Up 才恢复最旧项。Inbox claim/discard、匹配的持久 `user/message`、`turn/end` 与 Agent idle 事件共同拥有清理和每次一项的 FIFO 提升。压缩事件在不删除已投影行的情况下添加非 accent 的 `✂ 已压缩` 分割线；存在分割线时 Ctrl+K 切换最新一条，否则保留会话搜索行为。[终端原生交互 Agent Note](../../../.agents/notes/implemented/feature/2026-08-21-tui-terminal-native-polish.zh.md)拥有理由与取舍。
- 通知只在注意力事件触发，而非每个回合结束：批准请求或 ask-user 问题入队时立即弹出；run 排空（`agent/status` 变为 `'idle'`）时按最后一个 `turn/end` reason 弹出一条摘要（`✅ 任务完成`、`❌ 回合失败:{error}`、`⚠ 输出达到上限`、`⛔ 回合被策略阻塞`、`⚠ 异常中断收尾`；用户自己发起的取消不弹）。中间回合结束从不通知，编排任务的连发合并为一次弹出。`tui.notifyQuietInputSeconds`（非负整数，默认 10 秒）内的本地输入把弹出降级为 BEL。正文携带 `· {session 标题}` 以区分并行实例；`notify-send` 收到 `-u critical|normal`。iTerm2、VTE 与 Konsole 使用 OSC 99，Windows Terminal 使用 OSC 9，其他终端接收 BEL 与一次尽力而为的字面 `notify-send` 尝试。helper 缺失绝不改变回合结算。`tui.notify` 选择 `off | attention | every-turn`（默认 `attention`；`every-turn` 保留旧的每回合弹出）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 在 base bundle 上添加终端所属提供方与运行时 glue，不重复 base 存储服务。[`src/index.ts`](src/index.ts) 拥有控制器与生命周期集成，[`../tui-render/`](../tui-render/README.zh.md) 拥有终端投影与绘制。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [TUI 包映射](../README.zh.md) — 终端运行时与渲染器所有权。
- [TUI 渲染器](../tui-render/README.zh.md) — 有界布局、输入渲染与终端能力。
- [终端子系统](../../../docs/subsystems/terminal.zh.md) — 终端生命周期与生成的 Cordis 声明。
- [Alpha.1 TUI 兼容性决策](../../../.agents/notes/implemented/architecture/2026-08-28-alpha1-tui-compatibility.zh.md) — 组合与生命周期理由。

-----

<a id="model-experience"></a>
## 模型体验

### 终端应用请求

#### 模型看到的内容

profile 的系统提示词标识终端界面，运行时通过常规 Agent API 发送用户输入，并从会话日志重建可见历史。来源过滤只影响终端呈现和导出：非人类上下文消息仍留在持久日志与模型请求构造中。

#### Token 影响

运行时不会在 profile 的 `system-prompt` 配置与常规用户轮次之外添加模型可见文本。

#### KV Cache 影响

新轮次通过 Agent 的常规请求构造追加；恢复会在下一次请求前重建会话历史，因此缓存复用仍取决于 provider。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **需要交互式终端** — 非 TTY 启动会在挂载前失败，因为备用屏幕界面需要终端控制。
- **跨进程会话所有权** — 一个运行时拥有一个 live Agent 句柄；切换会等待前一个所拥有句柄停稳，再恢复另一个会话。
- **Provider 缓存行为** — bundle 会保留会话历史，但不能保证 provider 在恢复进程后的 KV Cache 保留。
- **`/reload` 会堆叠一个等待中的 Node** — 父进程无法原地 `execve`，因此会等到子进程退出。反复 `/reload` 会嵌套进程，直到退出最内层 TUI。
- **内存证据只适用于对应负载** — keyless UI 压测分别记录首次激活与稳定阶段的 RSS。其缓存与 React 计时检查不会为无关提供方、子进程或致命内存耗尽失败归因。
- **Draft FIFO 仅在进程内存在** — 后续轮次 draft 不参与崩溃恢复；只有已移交 Agent inbox 或已追加到会话日志的消息具有持久所有权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
