# P1/P2 终端能力验收

范围：接续本项目 Pi 开发，落实 capability-gap-roadmap.md 的 P1/P2，并修复用户截图中 Goal 自动回合仍显示“空闲”的问题。保留原有未提交改动，没有提交、推送或发布，也没有重载/停止用户正在运行的进程。

## 已验证

### Goal 的后台回合与界面状态

确定缺陷在 `tui-render/src/interaction-state.ts`：原状态机对 `idle/stopped/exit-armed + turn-started` 不进入 generating。Goal、定时唤醒或其他后台入口直接开回合时，显示状态和 Ctrl+C 路径因此可能与真实 Agent 不一致。现以获准的实时 Session `turn/start` 进入 generating，正常结束回到 idle，中止进入 stopped，外部 Session 事件仍不能改变当前界面。

用户会话的只读日志检查确认 Goal 曾自动执行 1/2/3 轮，第 12 回合是 completed，第 13 回合已接收人工继续消息；不能据截图断言驱动未注册。模型文字中的“目标保持 active”也不等于驱动的运行事实。

页脚现在保留 durable phase，并显示 armed 的“自动续跑”或 disarmed 的“自动续跑已停止 /goal resume”；订阅 `goal/activation-changed`，即使没有持久事件也立即使快照失效。没有添加自动重新授权或第二个续跑调度器。官方 Goal 服务、真实 round driver 和 Agent Loop 的离线测试验证连续四轮、第三轮内修改目标后的第四轮、预算停止，以及解除后显式 resume。

当前进程加载的旧 JavaScript 不会被磁盘构建自动替换。当前回合结束后可执行 `/reload`；恢复会话的 Goal 默认 disarmed，确认继续时再用 `/goal resume`。

### P1

| 能力 | 实现与验收 |
| --- | --- |
| 事件轨迹 | `/timeline` / Ctrl+T，逐 Session 事件、真实工具/usage/时长、完整 JSON；有界物理行窗口和首尾导航。未测量字段保持缺省。 |
| 设置分组 | Tab/Shift+Tab 按 provider/外观/Agent/Subagent/Web/Shell/插件等分组导航，保留字段顺序与已有编辑器。 |
| 明暗主题 | `tui.theme` 持久化，truecolor/256/16/none 测试；挂载和外部编辑器返回保留显式 theme/colorTier；背景和投影缓存包含 appearance。 |
| 快捷键 | `/keys` 为场景目录；`/bind ACTION Ctrl+X|default`、`/unbind ACTION` 修改输入区八种动作。检查冲突、未知动作、保留的终端/编辑键，关闭旧按键，弹窗保持自己的仲裁。 |
| 文件树 | 官方 `fs.watch` 合并 200ms 刷新，至多观察 128 个展开目录；保留 `r`、选中身份和旧树；失败提示、卸载中止及迟到 close。真实 LocalFileSystem 文件创建/关闭后无更新验证通过。 |
| 子代理控制 | `c` 续聊、Enter queue / Ctrl+Enter steer，`s` interrupt 请求，`v` 100+ 列并排；编辑退出并排以保留正确原生光标。准确 parentId/mode 来自官方目录，不猜父级；Stop 等事件确认。请求防重、中止、迟到回执和主会话身份有回归。 |
| 附件/图片 | `/attachments` 仅从类型化用户消息列出 image/file，保留 opaque attachment identity 和重名；本地路径由官方 provider 给出、存在性检查后系统打开，无本地副本时明确报错。 |
| 文档/review | `/deliveries` 的文本/二进制信息与系统打开保留；新增 `/review` 通过 `(sessionId,eventSeq,fileIndex)` 读取逐文件官方 diff。同名文件不按 basename 猜测；丢失、二进制、过大记录明确说明。 |
| 问答/秘密 | 保留前批次自由文本、多选、FIFO/中止和秘密遮罩；新增键盘选区也不能复制秘密。 |

### P2

| 能力 | 实现与验收 |
| --- | --- |
| 插件市场 | 直接组合官方 Host service，不装 Web 实验 UI。`/market QUERY` 从配置索引分页搜索，`i` 进入原 plugin-manager inspect/确认，传递兼容的精确 spec 和 registry；拒绝无兼容版本。 |
| Cordis 自检 | `/inspect` 展示真实 Host/Client 方法；Enter 查询目录，`/inspect host PROVIDER METHOD JSON` 查询具体契约；官方 Tool 查询使用准确 Agent。终端不伪造 Client provider。 |
| 会话 preset | 四份 rc.2 官方声明逐字校验；禁用全局 agent-plane 贡献再挂载 registry，创建/恢复时按投影 mount；只允许首轮前选择，错误回滚。源码及 built 入口完整启动和隔离证据见下。 |
| focus | `/focus` 可见切换，隐藏中间 card/tool-summary；既有 StreamView 回归验证原文和工具能力不被修改。 |
| 多语言 | `registerTuiLocale` / `listTuiLocales` 注册 BCP47 文案包，检测重复/未知键并从内置目录回退；已接入的文案 catalog 可扩展。并非所有静态中文已翻译。 |
| 语法高亮 | 共享词法扫描器按 JS/TS/Python/Go/Rust/Shell/SQL/JSON/YAML/C/C++/Java 等语法着色，跨行注释/字符串不破坏正文；未知语言及超出 32KiB 预算降级纯文本。 |
| 选择/无障碍 | 输入按 grapheme 选择、替换、删除、复制，保留 UTF-16 坐标、emoji/CJK/组合字和秘密掩码；`INK_SCREEN_READER=true` 以普通输出流关闭备用屏幕、鼠标、颜色和品牌动画。 |
| IME | 核实 Ink 7.1.1 无 composition 事件；保留终端原生 preedit/原生 caret，支持完整多字符提交。不虚构可观测的候选窗状态。支持 Ctrl+Enter 的终端可关闭 submitOnEnter。 |
| 阻塞对话帮助 | Alt+H（非自定义编辑时也可 `?`）打开只读帮助；滚动/Esc 不提交、不拒绝、不改审批/答案/主草稿；帮助期间粘贴被拦截。Legacy Alt+? 不可靠，采用实测能解析的 Alt+H。 |

### 组合启动与交付检查

- 官方 Loader/AppBoot 和真实源码 CLI 各自使用一个隔离临时 profile，只链接本地 bundle；通过正式 installation Resolver，均 PASS、退出 0、stderr 为空。没有修改用户 profile 或读取凭据。
- 四个 preset roster 均无 broken；全局仅 `working_directory`。standard/PTC/minimal/cordis 工具数分别 31/31/3/35；minimal 精确 `bash/read_image/working_directory`，PTC 模型呈现仅 `run_code`，非 Cordis 不继承 inspect/manager/market。Host 自检实际查询通过，网络 fetch 与模型 request/header 均为 0。
- 严格类型检查覆盖 render/runtime 及各自测试四个工程；五个 dist 产物完成构建与实际 ESM 导入；入口测试 43/43，npm 打包预览与差异空白检查通过。完整 TUI 回归 169 文件、2230 项测试通过。
- 真实 OS PTY 使用生产 TuiLoop、输入解析、TerminalBrowser 和合成服务快照，覆盖 browser/selection/help/light/split/child × 40×16 / 80×24 / 120×40，共 18 组、81 帧。并排仅宽屏启用；窄屏单面板、JSON 末尾、选区替换、只读帮助、子代理续聊及返回草稿均有断言。40 列统计行换行挤掉所选名称的问题已复现后修复并加强断言。

代表截图和两种启动结果在 [证据目录](evidence/p1-p2-2026-10-20/pty-summary.json)。代码、驱动、服务协议测试不等同于真实模型/外部程序的执行结果。

复验：

```sh
npm run build
npm run dev:setup
npm run typecheck
# 在 ../deepseek-harness 中运行
node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests
# 回到本仓库
npm test
npm run pack:check
node docs/full-preset-boot.mjs
node docs/full-preset-boot.mjs --source
python scripts/capture-ux-pty.py --scene child --columns 40 --rows 16 --output /tmp/dsh-child-check
```

## 未验证

真实联网模型执行、真实子进程 Stop 收敛和 GUI 文件查看器；远程插件市场索引及安装下载；用户现有 profile 的额外扩展与私有配置；macOS 剪贴板实机、真实 IME 候选窗及屏幕阅读器设备；长期运行/跨进程竞争/崩溃时严格恰好一次投递。图片保持元数据及系统打开降级，未提供终端内 raster 协议渲染。Syntax 为有界词法高亮，不是语言语义分析。

## 阻塞

本地实现与离线验收无阻塞。上述外部及设备场景仍按“未验证”保留，不将其包装成通过。
