# TUI 修复与验证

修复基线：`7952c5f`。本记录对应 `fix/tui-rendering-scroll-settings` 的源码与本地 bundle；npm 版本仍为 `0.1.0-alpha.50`，本轮没有发布新包。

## 已验证：渲染与交互

- TTY 聊天文字仅由 `VisibleFrameSnapshot` 绘制，Ink 保留视口尺寸并绘制输入框、HUD、状态栏；非 TTY 保留文本输出。
- stdout 适配器跟踪实际 Ink 光标移动，避免将增量帧里的少量换行误认为完整屏幕高度。切换短面板及返回聊天前清理旧正文区域。
- 终端缩小时不使用旧尺寸快照绘制正文、rail 或 caret。HUD/输入区改变高度时，旧正文区域清理、新 chrome 和新正文在同一 Ink 同步帧内提交，避免旧末行重复到下方。
- 滚轮直接更新目标位移；同一 React 提交前的多个报告不再互相覆盖。反向滚轮会取消键盘翻页的旧追赶方向；旧命令不会在追加内容或重挂面板后重放。
- 滚动延迟从输入时间计到对应 viewport revision 的 stdout 成功回调。合并输入使用常量空间，卸载取消旧回调。`mountedRows` 为兼容保留的名称，当前表示视口及 overscan 准备的物理行数。

### 逐帧检查

生产 `TuiLoop` 和 `mountTuiRender` 在 OS PTY 中运行；输入与服务快照为合成数据。将每个完成的同步帧输入 xterm headless，并逐行比较当前快照的正文区域，包括空白行和行尾，同时检查正文标记是否进入输入区/HUD。

| 场景 | 尺寸 | 完成帧 | 有快照的比较帧 | 正文不一致 | 正文越界 |
|---|---|---:|---:|---:|---:|
| 无操作流式 Markdown | 120×40 | 489 | 488 | 0 | 0 |
| 无操作流式 Markdown | 80×24 | 501 | 500 | 0 | 0 |
| 无操作流式 Markdown | 108×48 | 482 | 481 | 0 | 0 |
| HUD 变化、结算、长草稿、滚动 | 120×40 | 671 | 620 | 0 | 0 |
| HUD 变化、结算、长草稿、滚动 | 80×24 | 704 | 648 | 0 | 0 |
| 输出中缩窗并恢复 | 120×40→80×24→120×40 | 81 | 75 | 0 | 0 |
| 合计 | — | **2928** | **2812** | **0** | **0** |

比较覆盖 77,558 个物理行。其余帧为尚未发布正文快照的布局/初始化过渡；其中 2 个缩窗帧主动跳过过期尺寸。未将这些帧计为快照比较通过。逐帧结果在 [fix-evidence](fix-evidence/) 的 `verified-*.json`，修复后截图见 [live-stream-after.png](fix-evidence/live-stream-after.png)。

最初仅检查正文内部会漏掉区域外的旧末行。扩展检查后，真实捕获到 HUD 缩短正文区域时的 2 个重复帧，见 [失败记录](fix-evidence/hud-resize-before-fix.json) 与[失败画面](fix-evidence/hud-resize-before-fix.png)；本表是补齐修复后的新运行结果。

## 已验证：性能对照

同机、同一合成数据与驱动，120×40、500 条历史。延迟是输入进入进程到运动帧写出，不是显示器或触控板硬件延迟。每个场景只作为该次实测，冷启动和机器负载会波动。

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| 单次滚轮 3 行：React 提交 / 运动帧 | 4 / 3 | 1 / 1 |
| 3 个报告共 9 行：提交 / 运动帧 | 10 / 9 | 1 / 1 |
| 9 行滚动到达目标 | 168.07 ms | 17.93 ms |
| 60Hz 连续滚动：React 提交 | 175 | 60 |
| 60Hz 连续滚动：写出字节 | 804,570 | 307,651 |
| 60Hz 停手后的尾部更新 | 141.11 ms | 11.84 ms |
| 120Hz 停手后的尾部更新 | 122.84 ms | 7.12 ms |
| 10,000 条历史：首次提交时间 | 19.33 s | 7.14 s |

500 与 10,000 条历史各接收 268 个滚轮报告；各阶段最终位置与基线一致。空闲阶段没有 React 提交或终端写出。

缓存预算改为增量 rows/bytes 与驻留 LRU：回归中初始化 200 个单行块从读取 20,100 次降到 200 次；100 次 append/pins/stats 从读取 10,400 次降到 100 次。Markdown 结算复用另加 source 索引，移除逐条加载历史时的候选全扫。缓存仍允许 pinned/active 超预算；统计不等于进程 RSS，也不包含回滚快照、规范源和其他渲染缓存。

实测摘要见 [results.json](fix-evidence/results.json)；修复前数据见 [evidence/results.json](evidence/results.json)。完整原始 PTY 和事件文件保留在 `/tmp/dsh-perf-fix/verified-*`。

## 已验证：settings

分类 → namespace → Provider/对象 → models/数组 → 字段可逐级进入；支持 `/` 搜索、←/Esc 返回、`i` JSON 编辑、保留稳定选择。成功保存停留原位置，model ID 在数组重排后继续定位同一模型。继续使用官方 `settings.describe/update` 和 credentials，不新增配置文件读取器。

真实 controller integration 验证 65 个模型的深层数组编辑：保留其他模型、Provider 未知字段及 user 层被 schema 隐藏的字段；对象使用稀疏 patch，数组按官方替换语义复制必要祖先。秘密字段及包含秘密的整体 JSON 编辑被屏蔽，安全子字段仍可浏览。

40/80/120 列 PTY 均实际进入 Provider、65 个模型列表、单个模型详情，编辑 `contextWindow` 并保存为 `131072`，返回同一字段。截图：[40 列 Provider](fix-evidence/settings-40-provider.png)、[40 列模型列表](fix-evidence/settings-40-models.png)、[80 列保存后](fix-evidence/settings-80-model-saved.png)、[120 列 Provider 列表](fix-evidence/settings-120-providers.png)。额外布局回归覆盖 4/6/8/12 行预算。

## 未验证

- 用户当前已运行进程尚未重启；未干扰其 Goal。现有本机 `dsh-tui` 入口指向本仓 launcher；重新启动会读取本地新构建。
- 真实模型联网调用、真实触控板/GPU 呈现和所有终端模拟器组合不属于这次离线/PTY 验证。未将合成服务 fixture 等同于在线认证验收。
- 正文结构变化时下游主动拖选的独立绘制路径未增加新的真实设备验收；现有选择/复制回归由完整测试覆盖。

## 已验证：最终门禁

| 命令 | 结果 |
|---|---|
| `npm run build` | DSH 0.2.1-rc.2 下五个 bundle 构建和导入成功 |
| `npm run dev:setup` | 官方声明和 Typert 产物准备成功 |
| `npm run typecheck` | 源码与测试共 4 个严格检查项目通过 |
| `npm test` | 46 passed |
| `node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests --maxWorkers 2` | 173 文件、2299 passed |
| `npm run pack:check` | npm dry-run 包内容检查通过 |
| `openspec validate fix-live-transcript-and-settings-navigation --strict` | 通过 |
| `git diff --cached --check` | 通过；原始 ANSI 保留 CR/格子填充字节 |

默认高并发运行曾出现耗时阈值、5 秒超时与异步状态读取的 3 项竞争失败；最终限制为 2 个测试 worker，未放宽断言。改为生产 stdout 适配器的 TTY 测试继续断言原内容、宽度和布局。PTY 驱动另加入启动就绪握手，避免繁忙机器在处理器安装前发送 SIGUSR2 终止 fixture；握手与完整设置编辑 smoke 已通过。

上述日志在 [fix-evidence](fix-evidence/)；[source-sha256.json](fix-evidence/source-sha256.json) 记录交付源码及 `dist/index.js`。测试使用官方源码镜像 `/home/zhangyangrui/my_programes/deepseek-harness`，核心命令由主代理重新执行并核对结果。

## 阻塞

无。
