## ADDED Requirements

### Requirement: 滚动帧不经完整 transcript 重布局

TUI SHALL 把最新滚动目标与实际呈现行保存在 viewport 坐标系中，但普通方向键、滚轮和页滚 MUST NOT 为每一物理行触发 React commit 或整列 Yoga 布局。可见 transcript SHALL 由已投影物理行的 overlay 按绝对终端坐标绘制；Ink/Yoga 只在挂载窗口必须移动、几何改变或 chrome 更新时参与。帧时钟 MUST 在无 pending 滚动、流式行和动画时停止。

#### Scenario: 单行键不提交 React 树
- **WHEN** 已挂载窗口覆盖目标行且用户按一次 `↑`/`↓`/`j`/`k`
- **THEN** 下一可绘制帧 SHALL 移动一物理行，React commit 计数 MUST 保持不变，input-to-paint p95 MUST 不高于 50ms

#### Scenario: 滚轮跨过挂载量子才重挂
- **WHEN** 连续滚轮使 presented 行穿过配置 overscan 的一半
- **THEN** 一次 React commit SHALL 更新可见加 overscan 切片，中间帧 MUST 只重绘 overlay 且不得重解析 settled Markdown

#### Scenario: 空闲停止帧时钟
- **WHEN** 没有 pending 滚动、stream 行、动画或强制请求
- **THEN** 共享帧定时器 SHALL 停止，直到下一次输入或模型 delta 再次请求一帧

#### Scenario: 滚动期间后台定时器让路
- **WHEN** 滚动正在追赶或 drain
- **THEN** 推理耗时刷新、品牌动画和周期性 metrics MUST 跳过该窗口，滚动结束后恢复，且不得因此丢失最终权威状态

### Requirement: 工具与围栏展开保持有界

Ctrl+E 仍是全局折叠命令，但展开 MUST 只投影当前 viewport、配置 overscan 和 pinned 活动/锚点块内的工具正文。每张展开卡的投影行数 MUST 有硬上限；超出部分 SHALL 以可恢复的折叠脚注表示。从折叠切到展开时，新挂载物理行 MUST 分帧进入，单帧新挂载行数有界。

#### Scenario: 长工具史展开不卡死
- **WHEN** 一个已完成回合包含至少 17 张工具卡且若干结果超过 500 行，用户按 Ctrl+E
- **THEN** 下一可交互帧 MUST 在 100ms p95 内到达，可见卡标题变为 `▾`，viewport 外卡体 MUST NOT 在该帧全部投影为 Ink 子树

#### Scenario: 展开体按行切片
- **WHEN** 一张展开卡的正文超过 viewport 高度
- **THEN** 只挂载与 viewport 加 overscan 相交的物理行，滚动进入其余行时再投影，copy/export MUST 仍能从权威 source 重建全文

#### Scenario: 再次 Ctrl+E 收起
- **WHEN** 用户在展开态再按 Ctrl+E
- **THEN** 所有卡标题恢复 `▸`，展开体从可见帧消失，锚点和最终正文保持有效，派生行缓存 MUST 按折叠 scope 失效而不是丢弃 canonical source

### Requirement: 流式 follow 保留 overscan

follow 状态下的可见窗口 MUST 仍包含配置的 transcript overscan（上限为一个 viewport）。生成中的活动尾部可以少挂其上方已滚出的 settled 行，但用户向上离开 live edge 的第一屏 MUST 已有可绘制行。

#### Scenario: 生成中上翻不出现空白
- **WHEN** follow 流式追加期间用户按一次 `↑`
- **THEN** 新可见行 SHALL 立即存在，不得先显示空白或截断行再异步重建
