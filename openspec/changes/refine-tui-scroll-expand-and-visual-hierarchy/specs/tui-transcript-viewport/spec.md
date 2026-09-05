## ADDED Requirements

### Requirement: follow 保留预渲染邻域

follow 状态 SHALL 为当前可见窗口保留配置的 transcript overscan（0 到一个 viewport）。流式追加 MUST NOT 把 overscan 降到 0。用户从 live edge 向上移动时，第一屏 MUST 由已投影物理行覆盖。

#### Scenario: 流式中上翻
- **WHEN** follow 生成期间 viewport 贴住最新行且用户按 `↑`
- **THEN** 新露出的物理行 SHALL 已在 overscan 中，不得先空白再重建

#### Scenario: overscan 仍有上限
- **WHEN** 配置 overscan 大于当前 viewport 行数
- **THEN** 实际预挂载行数 MUST 截到一个 viewport，RSS 不得随 overscan 配置无界增长

## MODIFIED Requirements

### Requirement: 会话内容使用固定物理行视口

TUI SHALL 在固定的 AppShell 内容区域内按终端物理行呈现会话，滚动不得移动标题、状态页脚、组合器或整棵会话容器。用户可见滚动状态 MUST 只有一个物理行坐标系；逻辑消息缓存不得形成第二个用户可见偏移。除挂载窗口移动、resize 或 chrome 更新外，单物理行滚动 MUST NOT 触发完整 transcript Yoga 布局。

#### Scenario: 单行滚动只移动一行
- **WHEN** 会话内容超过视口且用户按 `↑` 或 `k`
- **THEN** 下一帧 SHALL 显示前一物理行并保持固定区域位置不变，不得同时跳过一整条消息，也不得为这一行重算全部 transcript 布局

#### Scenario: 页滚动使用视口高度
- **WHEN** 用户按 PgUp 或 PgDn
- **THEN** TUI SHALL 按当前可见视口高度减一行移动，并保持一行阅读上下文重叠
