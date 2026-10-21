# P1/P2 实施状态

目标：按 capability-gap-roadmap.md 的完整剩余范围实施，已有 154 文件/2140 项回归为基线；不覆盖此前工作区，不推送或发布，不访问凭据或联网模型。

## 验收顺序

1. 明暗主题与分组设置、完整快捷键目录及可支持的重绑定。
2. 事件级 timeline（工具、token/耗时、完整 JSON）、文件树刷新与可恢复错误。
3. 子代理控制/续聊/并排查看、附件/图片与逐文件 diff/review。
4. 经上游接口核实后接入插件市场、自检、逐会话 preset、focus。
5. 语言注册、按语言代码高亮、键盘选择与无障碍、IME 能力边界、阻塞对话帮助。

每项用针对性失败测试先固定行为，再实现；公共类型变更后按 build → dev:setup → typecheck 更新。最后完整 TUI/入口回归、真实 PTY、构建导入、打包与差异检查。仅“已验证 / 未验证 / 阻塞”作为交付状态。

## 当前检查点（2026-10-20 19:32）

### 已验证

- P1/P2 实现及终端等价能力全部落盘：事件 timeline/JSON、设置分组、明暗主题、快捷键目录和输入动作重绑定、文件树自动/手动刷新、子代理续聊/Stop/并排、附件和逐文件 review、市场预览、自检、四种会话 preset、focus、语言注册、有界词法高亮、键盘选择/普通流无障碍、IME 接口边界和阻塞对话帮助。
- Goal 真实会话日志已检查：曾自动执行 1/2/3 轮，turn 12 completed，turn 13 接收人工继续，不能据截图推定后台未注册。确定缺陷是状态机忽略后台 turn/start，导致仍显示空闲且 Ctrl+C 错走退出；已修复 Runtime、状态机和 Goal activation 页脚。真实官方服务/驱动/loop 离线验证四轮、轮内 edit、预算停止、显式 resume。
- 最终 TUI：169 文件、2230 测试通过（/tmp/dsh-p12-all-tests-final19.log）；根入口 43/43（/tmp/dsh-p12-root-final19.log）；严格类型四工程通过（/tmp/dsh-p12-typecheck-final.log）；五个产物构建导入、打包及差异空白检查通过。
- 真实 PTY：browser/selection/help/light/split/child × 40×16、80×24、120×40，共 18 组、81 帧；人工复核代表截图。40 列子代理名称被统计行挤掉的问题已先复现后修复。
- built 官方 Loader/AppBoot 与源码 CLI 各在独立临时 profile 完整启动，正式安装 Resolver 只链接本 bundle；四 preset 无 broken，工具隔离成立，Host 自检通过，网络/模型请求 0，stderr 为空。
- 最后补的市场回归先失败后通过：registry 同时传递 inspect/install，切换官方目录目标时清除旧来源；真实文件监控测试类型修正。
- 证据已保存 docs/evidence/p1-p2-2026-10-20/，验收与复验命令见 docs/p1-p2-verification-2026-10-20.md。四份官方 preset 声明逐字校验；源码与 built 启动脚本可复验。
- 保留原工作区；没有提交/推送/发布，没有重载/停止用户进程，没有修改 Pi 配置。开发配置变更前备份 /tmp/dsh-tui-p12-config-before；上游仅离线安装/生成开发产物。

### 未验证

联网模型、远程插件市场下载及真实安装、真实外部进程 Stop 收敛、GUI 文件查看器、macOS/IME/屏幕阅读器实机、长期运行及崩溃竞争。图片采用元数据/系统打开降级；词法高亮不提供语言语义分析；部分静态中文尚未翻译。

### 阻塞

本地实现和离线验收无阻塞。当前用户进程仍运行旧构建：回合结束后执行 /reload；恢复后的 Goal 若显示自动续跑已停止，用 /goal resume 显式恢复。不要自行重载进程或自动重新授权 Goal。

## 2026-10-21 发布接续

- 已验证：修复 Magpie 模型目录入口 profile 分裂，两种模式默认 deepseek-tui，显式 --profile 控制安装和启动；官方 pi-ai 三协议 65 模型逐项一致，真实本机 /model 过滤后 1/65，退出 0。模型大目录按实际高度显示。
- 已验证：最终 169 文件/2232 测试、入口 46 项、四工程严格类型、五产物构建、双入口 profile 启动及 36 个 npm 依赖可获得性。说明见 model-config-verification-2026-10-21.md。
- 用户已授权推送、GitHub Release 和 npm 发布；目标 0.1.0-alpha.50，GitHub prerelease/npm next。README/changelog 已更新；采用既有 OIDC workflow，不需要本机 npm 登录。等待当前发布结果核验。
