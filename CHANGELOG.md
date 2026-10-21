# Changelog

## 0.1.0-alpha.51 — 2026-10-21

Prerelease for DSH `0.2.1-rc.2`; npm channel: `next`.

### Fixed

- Streamed transcript cells now have one physical painter. Ink reserves the slot and paints chrome; sparse incremental frames, pane transitions and resize restore or release that slot without retaining old prose in blank rows. HUD and input-height changes clear the old transcript area and paint the new layout in the same synchronized frame, preventing text from leaking below the transcript during unattended streaming.
- Mouse wheel and touchpad reports land at their target without row-by-row catch-up. Reports received before a React commit retain their combined movement, and scrolling no longer rerenders the parent loop for every report. Scroll latency is measured through the matching stdout callback.
- Render-store budgets use incremental row/byte totals and resident LRU order instead of repeatedly scanning all historical lines. Markdown settlement uses a source index to avoid repeatedly searching the full history.
- `/settings` now browses category → namespace → provider/object → model/array → fields. Search, back navigation and successful edits retain location/selection; nested edits preserve unknown user fields through the official settings service. Narrow layouts reserve space for values and actions.
- [#14](https://github.com/zhangyang-crazy-one/dsh-tui/issues/14): discard transient text from failed `assistant/attempt` streams, keeping live history consistent with durable replay. Successful retries and officially committed interrupted messages remain visible.
- [#15](https://github.com/zhangyang-crazy-one/dsh-tui/issues/15): restore SSH port-forward instructions when reopening an in-progress DeepSeek login. Automatic browser opening now checks the actual SSH environment; explicit `o` still opens the link.
- [#16](https://github.com/zhangyang-crazy-one/dsh-tui/issues/16): resolve file-panel relative paths against the current Session directory after `/cd`, with configured-cwd/filesystem fallback. Absolute paths and the previous root on failure retain their behavior.

### Verification and upgrade

- Passed 2,299 TUI tests across 173 files with two workers, 46 launcher tests, four strict TypeScript projects, five bundle builds/import checks and the npm package-content check.
- Production rendering in an OS PTY with synthetic services produced 2,928 completed frames. Of these, 2,812 had transcript snapshots for comparison: 77,558 physical rows, zero mismatches and zero transcript leaks into the input/HUD area. Initialization/layout transitions without snapshots were not counted as comparison passes.
- In the recorded 120×40 PTY fixture, a nine-line wheel burst reached its target in 17.93 ms instead of 168.07 ms. At 60 Hz, React commits fell from 175 to 60 and output from 804,570 to 307,651 bytes. These measurements depend on the fixture and machine; they do not measure physical touchpad or display latency. See the [verification report](docs/performance-audit-2026-10-21/fix-verification.md).
- Upgrade with `npm install --global @crazyhappyone/dsh-tui@next`, then relaunch. Source-linked installations can use `/reload` after the new bundle is available. The official `deepseek-tui` profile and settings/credential services remain authoritative; no configuration migration is required.
- Live model authentication and physical-device rendering were not part of this offline/PTY verification. Full TUI tests used two workers after timing-sensitive failures under high concurrency; assertions were not relaxed.

### 中文变更说明

- 修复无操作流式输出的重复正文、空白行残影及终端光标定位；聊天内容统一由物理帧绘制。切换面板、调整尺寸及 HUD/输入区高度变化时，在同步帧中清理旧正文区域，防止正文穿插到下方。
- 修复滚轮/触控板逐行追赶和同批输入只保留最后一次的问题；滚动直接进入视口，延迟统计到对应 stdout 写入回调为止。
- 历史渲染缓存改用增量行数/字节统计和驻留 LRU，移除预算检查中的反复全量扫描。
- 设置改为分类、namespace、Provider/对象、model/数组、字段的逐级浏览；支持搜索、返回和保存后停留。继续使用官方配置接口，保留未知字段，窄屏为值和操作预留空间。
- 修复失败流式片段残留为普通消息，保证实时历史与持久化回放一致；保留成功重试和官方已提交的中断消息。
- 修复 SSH 登录页关闭重开后丢失转发命令、错误自动打开远端浏览器；显式按 `o` 仍可打开链接。
- 修复 `/cd` 后文件面板相对路径仍使用启动目录；改用当前会话目录，保留绝对路径及失败时原目录。
- 验证：2,299 项 TUI 测试、46 项 launcher 测试、4 个严格类型检查项目及构建/打包通过；2,812 个有快照的 PTY 比较帧覆盖 77,558 行，正文不一致与越界均为 0。完整 TUI 测试限制为 2 个 worker，未放宽断言；不将 PTY 合成数据视为在线认证或真实设备验收。
- 升级：`npm install --global @crazyhappyone/dsh-tui@next` 后重新启动；源码链接安装可在新 bundle 就绪后 `/reload`。继续使用官方 profile 与配置服务，无需迁移配置。

[Full comparison](https://github.com/zhangyang-crazy-one/dsh-tui/compare/v0.1.0-alpha.50...v0.1.0-alpha.51)

## 0.1.0-alpha.50 — 2026-10-21

Prerelease for DSH `0.2.1-rc.2`; npm channel: `next`. The changes below include the unreleased work since `0.1.0-alpha.49`.

### Fixed

- **Shared official model configuration:** lightweight and source launch modes now both default to `deepseek-tui`. `--profile NAME` / `--profile=NAME` controls both bundle installation and boot; duplicate or missing profile arguments fail before installation. Previously, installing the official `dsh` executable could silently switch lightweight mode to the empty `tui` profile and hide providers configured by Magpie in `deepseek-tui`.
- `/model` continues to read DSH's `ctx.llm` registry and persists selections through `agentDefaultModel`. No parallel configuration reader, cross-profile copy, or provider credentials are added. Large catalogs now use the actual terminal height, keeping the heading, selected row, filter and navigation visible.
- Backend-started turns, including Goal continuation and scheduled wakeups, enter the running interaction state. Ctrl+C cancels the active turn. The Goal footer distinguishes durable `active` state from armed/disarmed continuation and explains `/goal resume`.
- Mouse selection preserves Chinese text, margins and copy order without repainting the entire screen. Repeated coordinates produce no extra output; a clipboard helper closing stdin no longer crashes the TUI with EPIPE.
- Approval, question and plan-review content uses physical row budgets so decisions stay visible. Custom answers, batch/multiple selections, pasted text, cancellation and chat drafts retain their separate ownership.
- Credential editors and secret `/key`/`/login` arguments are masked, including caret movement and selection; secret selections cannot be copied.
- Plugin-market registry selection is preserved through both inspection and installation, and cleared when switching to an official catalog target.

### Added

- `/timeline` event/tool/usage/timing details and full JSON; `/todos` complete task browsing; `/deliveries`, `/attachments` and `/review` for delivered files, typed references and exact per-file diffs.
- Official time context, `present`, and persistent schedule tools; `/schedules` lists, inspects, opens the owning Session and confirms cancellation. Pending reminders recover on restart; a closed process runs no timers.
- Subagent live output, continuation (`c`, queue or steer), Stop requests (`s`) and wide-terminal side-by-side viewing (`v`), preserving the main Session and draft.
- Light/dark themes across truecolor/256/16/plain terminals, grouped settings, `/keys`, conflict-checked composer `/bind` and `/unbind`, grapheme input selection and plain-stream screen-reader mode.
- File-tree coalesced automatic watching, manual refresh, preserved selection, recoverable errors and watcher disposal.
- `/preset` with isolated standard/PTC/minimal/cordis compositions, selected before the first turn; `/market` search and approved install preview; `/inspect` official Host contracts; `/focus` rendering.
- BCP47 locale registration, bounded language-specific lexical code highlighting and read-only Alt+H help during blocking dialogs.
- macOS image-paste adapter using `pngpaste`, explicit missing-helper errors and cancellation/timeout handling.
- Official-source runtime initialization, bundle linking, generated-contract preparation and standalone source/test type-check setup.

### Upgrade and boundaries

- Update with `npm install --global @crazyhappyone/dsh-tui@next`. Run `dsh-tui probe` to check the engine and default profile. Source mode also uses the same profile.
- Existing `tui` and `deepseek-tui` directories are retained. To keep the old lightweight configuration, use `dsh-tui --profile tui`. DSH profiles remain independent; a provider configured only in `web` is not automatically global. Refresh Magpie's DSH connection/catalog after creating a new profile.
- `/reload` refreshes code in a running source-linked installation while retaining its existing profile; quit and relaunch to change the default profile. Resumed Goals require explicit `/goal resume`.
- Images and PDF/Office documents use metadata/text or the system opener. IME preedit remains native to the terminal; Ink exposes no composition events. Physical macOS/IME/screen-reader devices, remote market downloads, live model replies and external Stop convergence are not established by offline tests.

### 中文变更说明

- **修复模型配置入口分裂：**轻量模式与源码模式统一默认使用官方 `deepseek-tui` profile；`--profile` 同时决定安装和启动目标。旧版在探测到官方 `dsh` 后会改用缺少配置的 `tui`，导致 Magpie 已写入的模型不出现在列表中。继续使用官方 `ctx.llm` / `agentDefaultModel`，不另建配置加载器、不复制其他 profile；模型列表按实际终端高度显示。
- **修复运行与输入状态：**后台 Goal/定时回合正确进入生成中，Ctrl+C 取消回合；页脚区分目标 active 和自动续跑是否启用。修复鼠标复制、EPIPE、窄屏决策按钮、自定义/多选问答和秘密输入遮罩。
- **新增会话与文件能力：**事件轨迹/JSON、完整 TODO、定时提醒、时间上下文、交付物、附件目录、逐文件 diff，以及子代理实时输出、排队/引导续聊、停止请求与宽屏并排。
- **新增操作与扩展能力：**明暗主题、设置分组、快捷键查看/重绑定、文件树监控、四种隔离 preset、市场预览、Host 自检、focus、语言包注册、有界词法高亮、字素选区、普通流无障碍和阻塞对话只读帮助。
- **升级：**`npm install --global @crazyhappyone/dsh-tui@next`。旧 profile 均保留；需要旧轻量配置时用 `--profile tui`。`/reload` 保留当前 profile，切换默认 profile 需退出后重新启动；Goal 恢复后执行 `/goal resume`。创建新 profile 后刷新 Magpie 的 DSH 接入/目录。
- **边界：**关闭进程期间提醒不计时；图片及 PDF/Office 使用文本/元数据或系统程序。未将离线测试等同于联网模型、远程安装、真实外部 Stop 收敛或 macOS/IME/屏幕阅读器实机验证。

[Full comparison](https://github.com/zhangyang-crazy-one/dsh-tui/compare/v0.1.0-alpha.49...v0.1.0-alpha.50)

## Earlier releases

See [GitHub Releases](https://github.com/zhangyang-crazy-one/dsh-tui/releases) for `0.1.0-alpha.49` and earlier release notes.
