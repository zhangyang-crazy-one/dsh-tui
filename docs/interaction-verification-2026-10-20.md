# Pi 遗留交互改动验收

## 已验证

本次从本项目 Pi 最新会话的最后一条失败回归接续。保留现有工作区改动，完成当前交互修复批次的验证；后续能力补齐范围仍见 [能力清单](capability-gap-roadmap.md)。

### 实现与回归

| 行为 | 实现及验证 |
| --- | --- |
| 鼠标选择边界 | `ScreenAtlas.collectRowTextRuns` 使用当前帧正文的实际列范围，排除终端补白和无正文的 transcript 行；源文本内的缩进保留。消费普通终端字节或 resize 后恢复相应的选择语义。 |
| 剪贴板助手失败 | `copyText` 监听助手 stdin 的异步错误。先写出的 OSC 52 保留，助手关闭管道不再导致未处理 EPIPE。新增回归先复现失败，再验证通过。 |
| 复制完整性 | 80×24、80×40、120×40 真实 PTY：复制中文、正文与越过视口边界的行均保留，顺序正确；不混入滚动提示。 |
| `/key` | 已有 provider 引用键的选择、补全与编辑流程通过；返回后草稿保留。 |
| 子代理查看 | 列表与详情、最新输出跟随、首尾/翻页导航、返回主会话通过。 |
| `/todos` | 2000 条待办的滚动、首尾导航与返回通过。 |
| Goal 决策卡 | 审批、询问、计划评审在 40×16、80×24、120×40 可见决策按键，全文可访问，返回后草稿保留。 |

### 自动化与真实终端

| 验收命令或场景 | 结果 | 原始证据 |
| --- | --- | --- |
| `npm run build` | 4 个发布入口构建及导入成功 | `/tmp/dsh-tui-resume-build.log` |
| `npm run dev:setup` | 依赖声明与 30 个 Typert 产物就绪 | `/tmp/dsh-tui-resume-setup.log` |
| `npm run typecheck` | 源码及测试共 4 个严格工程通过 | `/tmp/dsh-tui-resume-typecheck.log` |
| 上游开发副本 `vitest run packages/tui` | 148 文件、2114 项测试通过 | `/tmp/dsh-tui-resume-all-tests.log` |
| `npm test` | 43 项通过、无失败 | `/tmp/dsh-tui-resume-root-tests.log` |
| `npm run pack:check` | 14 个发布文件，无开发依赖目录 | `/tmp/dsh-tui-resume-pack.json` |
| 发布包导入 | `apply` 为函数 | `/tmp/dsh-tui-resume-import.log` |
| `git diff --check` | 通过 | 当前工作树 |
| `check-mouse-pty.py --check` × 3 种尺寸 | 完整性与差量绘制断言通过 | [鼠标指标与场景索引](evidence/2026-10-20/pty-metrics.json) |
| `capture-ux-pty.py` × 7 场景 × 3 种尺寸 | 21 组、111 帧截图通过行为断言 | `/tmp/dsh-tui-resume-ux/` |

鼠标三种尺寸的所有测量阶段中，整行擦除、整屏擦除、同步帧外文本绘制、嵌套同步帧均为 0。100 次重复拖动坐标各输出 0 字节；视口内选择移动各触发 0 次 React 提交。边缘滚动允许有界更新，不以零提交为目标。

PTY 使用真实操作系统终端、生产渲染与输入路径，场景数据来自合成服务，不调用模型。PNG 由捕获的终端字节经 xterm/headless 回放生成；代表截图已逐张视觉复核：

| 场景 | 截图 |
| --- | --- |
| 鼠标拖选与释放，80×24 | [拖选](evidence/2026-10-20/mouse-80-drag.png)、[释放](evidence/2026-10-20/mouse-80-release.png) |
| 窄屏审批、询问、计划 | [审批](evidence/2026-10-20/approval-40.png)、[询问](evidence/2026-10-20/question-40.png)、[计划](evidence/2026-10-20/plan-40.png) |
| provider 引用键、子代理、完整待办 | [键名选择](evidence/2026-10-20/key-80.png)、[子代理详情](evidence/2026-10-20/agents-80.png)、[待办末尾](evidence/2026-10-20/todos-120.png) |

用户实际入口 `dsh-tui` 约 2.81 秒进入界面；本次注册的 `dsh --profile deepseek-tui` 约 2.75 秒进入同一插件界面。均未出现 TUI bundle、Typert 或两个认证插件加载失败。启动测试通过中断终止，分别记录信号退出 -2 与退出码 130，不作为正常退出测试。原始启动日志权限为 0600。

## 未验证

- 联网模型回复、Magpie 模型切换后的真实请求、数小时持续运行、macOS 实机。
- 能力清单中的 time-context、schedule、present 及其他待实施项目。本记录仅验收已有交互改动和本次补修。

## 阻塞

本批验收无阻塞。
