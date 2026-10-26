# 输出边界验证

## 已验证

主代理直接读取当前源码运行六个 suite：output-integrity、terminal-chunks、terminal-output、frame-fill、mouse-io、screen-atlas；132 项通过，见 parent-targeted.log。后续退出路径补丁由最终完整门禁覆盖。

修复前的分块回归见 regression-red.log：在背景色前缀已写出后插入包装器装饰，剩余 `1;22;24m` 可成为可见文字。修复将 StringDecoder、UTF-16 suffix 和控制序列状态归属到每次 mount 的输出包装器，完整前缀才允许加背景/光标装饰。对 CSI/OSC 各分割点使用独立 xterm 终端回放检查，不依赖本项目 ScreenAtlas 充当 oracle。

### 实际写入路径

| 来源 | 路径与协调点 |
|---|---|
| Ink/chrome | Ink → frame-fill parser → TerminalOutput → mouse stdout wrapper → 物理 sink |
| transcript/rail | 已发布快照 → 延迟构造/合并 overlay → 同一 TerminalOutput → 物理 sink |
| composer caret | InputBar layout effect → writeTerminalControl(caret) → frame-fill 控制事务 → 同一队列 |
| selection/clipboard | MouseSession → 原始 stdout 的 registry alias → writeTerminalControl(selection/clipboard) → 同一队列 |
| notify | runtime deliverNotify → 原始 stdout registry alias → writeTerminalControl(notify) → 同一队列 |
| teardown | Ink unmount、鼠标关闭 → 同一队列；取消已透传但未结束的控制串、结束同步帧，然后按序释放已接收控制输出 |

正文仍由 frame snapshot 唯一绘制；Ink 只保留布局槽位。鼠标 wrapper 自己跟踪控制串边界，避免在尚未结束的串内注入选区。初始化的 enable-mouse 在输出 owner 创建前执行；screen-reader 模式保持原有无 ANSI 路径。

### 明确预算与超额策略

| 层 | 上限 | 超额/释放策略 |
|---|---:|---|
| 控制串 pending | 64 KiB，另有至多一个 UTF-16 high surrogate 与 UTF-8 解码 suffix | 超长串从起始码连续透传，直到 terminator 前不加任何装饰；dispose 对已透传未结束串发 CAN |
| 控制事务暂存 | 64 条 / 64 KiB | 等 CSI/OSC 或同步帧结束再发；超额明确抛错，不无限增长 |
| 必须保序的待写数据 | 256 次 / 4 MiB | write(false) 后等待 drain；超额抛错并失效绘制基线，不悄悄丢 Ink 增量 |
| 未开始的绝对 overlay | 16 个 key；产品使用 transcript/rail 两个 | 每 key 只保存最新构造闭包，drain 后才计算 diff；保留 canonical 事件 |
| 元数据 trace | 128 条 | 记录来源、大小、时间、几何、parser/caret 状态、成功/失败及模块身份；不保存正文 |

4 MiB 是应用侧等待队列预算，不是全进程堆、单个已开始帧或 Node Writable 内部缓冲的上限。必要 pins 和 canonical 数据另见 history 证据。命名常量与边界测试阻止无界排队；pending 超额不是自动重试，异常由运行时处理/重新挂载。

### 长测方法

`python3 scripts/check-output-soak.py --seconds 300 --columns 80 --rows 24 --output <prefix>`，另一组为 120×40。`node scripts/check-output-soak.mjs <prefix>` 执行独立 xterm 全屏回放。

真实 PTY + production mount/InputBar/frame snapshot，100ms canonical tick、每25tick模拟一个新回合，700ms通知、每3秒选区及缩放、每71次物理写延迟80ms，Writable highWaterMark=1024。没有草稿键盘输入。canonical tick 从 fixture 独立记录，期望文本由固定语法生成；全屏逐格检查文本/空白和背景色，检查固定HUD、完整草稿及光标。mount/resize过渡单独计数，不算通过。原始捕获只有显式运行此合成 fixture 时写入指定路径。

## 未验证

用户现场破坏序列的真正调用者及终端宿主仍无现场 trace。五分钟场景为合成持续生成/续跑，未连接真实模型或认证服务；不能宣称现场问题已根因闭环。oracle 检查背景色，未穷举每种字体装饰的视觉呈现。

## 阻塞

无；现场取证不阻塞已复现边界的修复。

### 五分钟结果及 oracle 校正

| 几何 | 实际秒数 | 完成帧 | 可比通过 | 过渡（不计通过） | 未匹配 | 失败 | 采样最大待写字节 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 80×24 | 300.345 | 3437 | 3328 | 109 | 0 | 0 | 6493 |
| 120×40 | ≥300 | 3440 | 3324 | 116 | 0 | 0 | 14742 |

原始合成PTY捕获与写入元数据以gzip保存，run/state/oracle JSON保留源码身份、时间、计数与诊断。字节规模见 representative-budgets.json：相邻完成帧间最大物理输出6705/14545字节，明显低于4MiB应用侧队列上限；这是代表性场景而非所有内容的最大帧保证。64KiB控制串与队列超额另有边界用例。

初版oracle只豁免尺寸变化的第一个完成写入，长测暴露13/16个额外过渡：逐个回放确认均紧随缩放，清屏/Ink布局/快照可能产生多个完成写入。当前按最多2个100ms tick及6个写入建立恢复窗口，遇到首个完整canonical帧立即关闭；超时、稳定状态错误均失败。所有恢复帧单列resizeRecovery，未计通过。早期失败原文保留在initial-soak-*-failed.json。

负向对照把捕获中的DRAFT改为DRXFT（其余元数据相同），得到3068个可比失败帧，程序退出1；见oracle-negative-draft.json。这不是只对正确捕获运行后宣称oracle有效。

补充真实TuiLoop/StreamView集成：live-markdown场景、1000历史、120×40，436完成帧、435快照可比、0内容越界、0正文不匹配。此旧检查器的正文期望取自snapshot，因此只作为集成检查；独立整屏真值来自上面的soak。

soak运行使用Node22.23.1。运行开始后工程build/validation脚本及oracle发生校正，已保存原始source hash；测试期间产品输出代码未变。最后emoji/CRLF输入边界修正若发生，则由完整门禁和composer针对验证覆盖，DRAFT场景未涉及这些字符。

### 最终稳定产品版本

`final-soak-*` 为最后的稳定产品源码复跑（80×24 300.346秒、120×40 300.350秒）。80尺寸3437帧=3324可比+113过渡；120尺寸3439帧=3325可比+114过渡，两组均0未匹配/0失败。后者含2个合法在途前一revision：canonical tick1559已就绪时，两个已开始的小写入仍显示1558，紧接完整快照追上1559。没有字符污染。

oracle分别构造独立canonical日志的当前与前一revision，允许最多1tick在途延迟且禁止呈现倒退，最后版本必须完全追上；resize阶段的旧revision仍算过渡，不提前关闭恢复窗口。草稿篡改与人为落后2tick的两项负向对照都失败（见`oracle-negative-*-final.json`），不能用版本容差掩盖长期停滞。仅此oracle校正发生在最终产品长测之后；没有据此修改产品输出或fixture。
