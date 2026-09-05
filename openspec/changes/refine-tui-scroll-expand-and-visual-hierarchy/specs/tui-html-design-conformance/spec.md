## ADDED Requirements

### Requirement: 模块边界在扫描时保持可辨

TUI SHALL 用物理空白行和既有 `line` token 区分不同语义模块，而不是只靠相近的表面色。用户消息与助手回合之间 MUST 保留两行空白，其中一行 SHALL 绘制会话宽度的 dim 分隔线。推理块、工具栈和助手正文之间 MUST 保留至少一行空白。同一工具栈内的相邻卡 MUST 继续紧贴，不得插入模块分隔线。

#### Scenario: 完成回合可扫描
- **WHEN** 一个完成回合按序包含用户消息、折叠推理、工具栈、最终 Markdown 和 TurnTail
- **THEN** 用户行与助手内容之间 SHALL 出现两行空白及一条 `line` 分隔，推理/工具栈/正文之间 SHALL 各有至少一行空白，工具卡彼此之间 MUST NOT 出现分隔线

#### Scenario: 窄屏分隔仍完整
- **WHEN** 会话宽度小于 40 列
- **THEN** 分隔线 SHALL 使用全部内容列，不得拆成残缺线段或覆盖 rail

### Requirement: 代码与命令使用可区分语法着色

TUI SHALL 为代码围栏和展开的 shell/命令正文绘制可区分的语法 span：keyword、string、comment 和命令名 MUST 映射到专用 theme token，不得复用 logo `accent`，也不得把全部代码画成单一 `fg`。链接和强调继续使用 `accentText`。16 色档 MUST 用不同 ANSI 色相或加粗保持可辨；`none` 档 MUST 不发射 ANSI，纯文本内容不变。

#### Scenario: JavaScript 围栏
- **WHEN** 助手 Markdown 包含 `const`/`function` 关键字、引号字符串和 `//` 注释的 fenced 代码
- **THEN** keyword、string 与 comment SHALL 使用不同 token，且不得使用 `accent` SGR

#### Scenario: 展开的 shell 命令
- **WHEN** 用户展开一张 terminal 工具卡，其参数或输出含 `pnpm`/`git` 等命令及其后参数
- **THEN** 命令名 SHALL 使用命令 token，参数使用主/次文本，注释或被降级的尾部使用 dim

#### Scenario: NO_COLOR
- **WHEN** `NO_COLOR` 或 `none` 档安装后渲染同一代码块
- **THEN** 输出 MUST 不含 SGR，关键字与字符串的字面文本 MUST 与彩色档相同

### Requirement: 成功工具状态保持视觉安静

TUI SHALL 为执行成功的工具卡提供次级强度的单行摘要展示，不得使用高饱和度绿色或大号“完成”字样打断用户阅读。成功工具行 SHALL 使用 `fgDim` 绘制轻量符号（如 `✓`）与执行耗时；失败工具（exitCode 非 0 或错误返回）MUST 保持醒目高亮及错误摘要；运行中工具 MUST 显示活动指示。

#### Scenario: 成功卡片静音呈现
- **WHEN** 多个 bash 和 fs 工具连续成功执行并结束
- **THEN** 工具标题行 SHALL 呈现为次级 dim 单行（如 `✓ bash pnpm test (12.4s)`），页面不得出现大面积高饱和“完成”字样

#### Scenario: 失败卡片突出保留
- **WHEN** 某个 terminal 工具执行 exitCode 为 1
- **THEN** 该卡片标题 SHALL 维持 `error` 红色与 `失败 exitCode 1` 标识，并显示末尾错误行，确保异常被一眼发现

### Requirement: 工具审批采用紧凑内联条呈现

针对工具执行的交互确认（Approval），TUI SHALL 紧贴输入框上方呈现紧凑单行条，不得默认弹出会遮挡整个对话视口或替换用户草稿的大块模态面板。确认条 SHALL 支持快捷键单键直接生效，并在确认或拒绝后就地收缩为单行轻量审计记录。

#### Scenario: 输入框上方内联条
- **WHEN** 模型发起需审批的危险命令执行（如 `rm` 或未授权写操作）
- **THEN** 输入框上方 SHALL 插入单行审批条 `[Y] 允许 · [n] 拒绝 · [a] 本会话总是`，输入框正在编辑的内容 MUST NOT 被覆盖丢失

#### Scenario: 单键响应与安静归档
- **WHEN** 用户直接按 `y`、`n` 或 `a`
- **THEN** 对应决策 SHALL 立即提交，审批条就地收敛为一条浅色单行（如 `已允许 · 本会话`），后续视口滚动正常继续

### Requirement: 状态页脚默认极简单行

TUI 底部状态区域 SHALL 默认采用 1 行极简自适应页脚，左侧展示高频快捷键提示，右侧展示紧凑状态与上下文 token 占比（如 `28K / 500K · 生成中`）。模型信息 SHALL 统一由输入框边框芯片呈现，不得在标题栏、输入框与页脚同时重复输出。

#### Scenario: 单行页脚与上下文显示
- **WHEN** 终端窗口处于常规会话交互状态
- **THEN** 底部页脚占用行数 MUST 为 1 行，且清晰包含当前操作提示与紧凑上下文数据

#### Scenario: 消除模型信息多重显示
- **WHEN** 会话处于生成或空闲中
- **THEN** 完整模型名仅在输入框边框 chip 单一位置展示，顶栏保留 cwd，页脚不再重复打印模型全名

## MODIFIED Requirements

### Requirement: 会话内容具有渐进披露层级

TUI MUST 让用户消息、活动推理、已结算推理、工具卡、子代理活动、最终 Markdown、TurnTail 和完成分界具有不同且稳定的视觉优先级。已结算推理 SHALL 默认折叠；工具卡 SHALL 默认显示单行状态摘要；最终 Markdown SHALL 使用主文本层级；TurnTail 和统计 SHALL 使用次级层级。密集内容摘要 MUST NOT 删除推理或工具的可展开标题，物理行投影与组件回退路径 MUST 呈现相同的语义对象和状态。Ctrl+E SHALL 切换全局折叠标志并更新可见标题字形，但展开正文 MUST 遵守 `tui-interactive-paint` 的有界投影与分帧挂载，不得在一帧内把全部历史卡体送入 Ink 布局。

#### Scenario: 完成的复杂回合
- **WHEN** 一个回合包含多段推理、多个工具调用、最终 Markdown、产物和统计并已完成
- **THEN** 首屏 SHALL 优先呈现最终 Markdown，每段推理和每个工具仍保留可识别的折叠标题，TurnTail 后显示完成分界

#### Scenario: 正在生成的回合
- **WHEN** 回合仍在生成且存在多个推理段、运行中工具和 Markdown 内容
- **THEN** 只有最后一个可见对象确为推理时该段 SHALL 使用运行中强调，工具 SHALL 显示其真实运行状态，较早推理段不得与最终正文争夺同等视觉权重，助手正文 MUST NOT 绘制光标字形

#### Scenario: 恢复大型历史后继续生成
- **WHEN** resume 会话包含大型历史，活动回合已从推理进入工具或 Markdown
- **THEN** 已结束推理的耗时刷新 SHALL 停止，后续模型事件仍 SHALL 更新 transcript，组合器 SHALL 保持唯一硬件光标且输入交互不得被持续重绘阻塞

#### Scenario: 工具卡展开后收起
- **WHEN** 同一 TTY 实例中的用户先按 Ctrl+E 展开工具卡再按 Ctrl+E 收起
- **THEN** 每个可见工具标题 SHALL 从 `▸` 变为 `▾` 再恢复 `▸`，当前 viewport 内的展开体 SHALL 出现后完整消失，viewport 外的卡体 MUST NOT 在展开帧被完整挂载，transcript 锚点和最终正文 SHALL 保持有效
