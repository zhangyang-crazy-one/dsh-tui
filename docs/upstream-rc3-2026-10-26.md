# DSH rc.3 跟进与 alpha.55 发布

## 范围与授权

用户要求调研 DSH 远端、完成插件跟进并发布 npm/GitHub release，并明确确认纳入当前未提交的 TUI 输出、性能及验证链改动。原工作区已备份至 /tmp/dsh-tui-alpha55-backup；日常上游 checkout 不修改。发布目标为 0.1.0-alpha.55，GitHub prerelease / npm next。

## 已验证

- [最新已发布版本](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3)：2026-10-23 的 0.2.1-rc.3，commit 1f81c047fc48fa190a683e469daa699857e9afe8；npm next=rc.3、latest=rc.2。本插件此前 next=alpha.54、latest=alpha.45。
- [rc.2 → rc.3](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-rc.2...dsh-v0.2.1-rc.3) 共 6 个提交。Web 导航更多菜单、草稿复用和导航统计属于浏览器表面；本 TUI 无需复制其 UI 插件。
- DeepSeek API-key 路由使用官方 /models 动态列表；账号与 API-key 路由共用目录、缓存及客户端版本门禁，补充 tool_update 能力读取和内置 1,048,576 context window。TUI 通过 ctx.llm.listProviders/listModels 消费官方注册表，保持官方模型及凭据所有权。
- Session/Agent/预设核心实现无变化。四份已分发预设与 rc.3 官方文件逐字节一致；40 个精确 rc.3 npm 依赖均存在。[依赖完整性和预设哈希](evidence/rc3-2026-10-26/upstream-packages.json)。
- 上游 master=22ddee3792402c3e70ec5f86a63c3e3e895a2f60，GitHub 比较显示比 rc.3 多 1533 个提交，属于未发布开发线。本次验证目标明确固定 rc.3，不声明兼容 master。
- 启动默认 tag 回归先失败（仍解析为 rc.2），修改后 38 项 launcher 测试通过。保留 rc.2 同发布线兼容用例。
- 原输出/性能实现的验收记录见 [OpenSpec verification](../openspec/changes/harden-tui-output-and-incremental-performance/verification.md)；以下补充本轮重新验证结果，不将旧证据替代当前源码测试。

- rc.3 首轮完整验证：四个 TypeScript 项目、56 根目录测试、181 个 TUI 测试文件（2399 通过 / 1 个默认关闭的性能基准跳过）、五个 bundle 及实际 tarball 五入口导入全部通过。[首轮证明](evidence/rc3-2026-10-26/initial-provenance.json)。
- 复现 CI=true 下 live-frame fixture 无输出失败，采纳现有分支 commit 016efe3 的 interactive=true 修正；相同测试由失败转为通过。其余 CI 准备/原生编译修复已由本次完整隔离验证链覆盖，不混入另一套准备实现。
- 原始合成 heap snapshot 继续保留本地；版本控制纳入实现、测试、验收文档与压缩输出/汇总证据，不上传进程堆快照。

- 本轮额外执行上游模型目录、缓存、能力合并与 API-key 路由的 5 个 suite，90 项通过；网络由官方测试 fixture 替代，未使用真实凭据。
- 发现实际 npm 安装的 ERESOLVE：原范围没有显式接纳 0.2.1 prerelease。补充 `|| ^0.2.1-0`，并加入使用标准 semver 的支持/拒绝版本回归测试；不使用 --force 或 --legacy-peer-deps 绕过。
- 80×24、120×40 各运行 300 秒 production 输出组件 PTY。当前独立 oracle：80 列 3440 完成帧、3323 可比、117 过渡；120 列 3439 完成帧、3329 可比、110 过渡；两者 0 未匹配/0 失败。
- 120 列初版 oracle 报过 1 个空白 resize 帧。逐帧回放确认，同一 resize tick 的控制写入仍可呈现旧的完整画面，之后 Ink 才输出 resize 布局；原 oracle 因该控制写入提前关闭过渡窗口。现改为收到 resize tick 之后的完整 canonical 帧才关闭窗口，仍保持原来的最多 6 写入/2 tick 上限，未修改产品代码。DRAFT 篡改、把同一空白帧延后 3 tick 均被拒绝。[失败原文](evidence/rc3-2026-10-26/soak120-original-oracle-failure.json)、[负向检查](evidence/rc3-2026-10-26/oracle-negative-checks.json)。全部原始合成捕获已压缩保存。
- 发布重跑判断改用 npm dist.integrity 与已验证 tarball 的 SHA-512；已验证不存在、相同和不匹配三种行为。tarball 内不要求 npm 自动添加 gitHead，源码提交通过 provenance 单独证明。

- 最终本地代码提交 e83e90e 完整验证：57 根目录测试、181 文件 / 2399 TUI 通过 / 1 性能基准默认跳过，四个 TS 项目、五 bundle 及实际打包导入通过；产物来源复核通过。[最终本地证明](evidence/rc3-2026-10-26/final-local-provenance.json)。
- 普通 npm install 同时安装官方 rc.3 与 alpha.55 tarball 成功（617 packages），没有 force/legacy-peer-deps。显式指定隔离安装的 DSH_BIN 后，probe 确认引擎 rc.3；临时 DSH_HOME 的首次插件安装及 --help 退出 0，profile 含官方 base 和本插件。未发送模型请求。
- 首次远端 CI 在创建 job 前拒绝 job.env 中的 runner.temp 引用。依据 [GitHub context 可用性](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#context-availability) 改为 step 写 GITHUB_ENV；actionlint 1.7.12 对旧配置报错、对修正后的 CI/publish 均通过，根目录工作流测试通过。该工作流修正后的完整门禁以远端新 run 为准。

- [Node 22.19 / 24 CI](https://github.com/zhangyang-crazy-one/dsh-tui/actions/runs/40279027259) 与 [OIDC 发布工作流](https://github.com/zhangyang-crazy-one/dsh-tui/actions/runs/40279451885) 均成功，发布提交 fc465f8fd86b28835509e302173d20a027094965。
- [GitHub v0.1.0-alpha.55](https://github.com/zhangyang-crazy-one/dsh-tui/releases/tag/v0.1.0-alpha.55) 已发布，npm next=0.1.0-alpha.55（latest 保持 alpha.45）。npm 接受提交后经历服务端处理，再通过公开 registry 下载验证。
- npm tarball 与 GitHub 附件逐字节相同，SHA-256 为 39b5a9a1cdde55e962e74695178873c097344534839cc8379d0d33516b5f3c2a；22 个包内文件、五 bundle 哈希、40 个 rc.3 依赖及 peer 范围全部复核。发布 provenance 与 CI/本地发布源码身份相同；registry 未附带 gitHead，因此使用来源证明中的 commit/source hash 建立关联。[发布核验记录](evidence/rc3-2026-10-26/publication.json)、[发布来源证明](evidence/rc3-2026-10-26/published-provenance.json)。

## 未验证

- 真实模型请求、live 登录、用户现场终端根因和生产长期内存趋势不在离线验证结论内。

## 阻塞

无。GitHub 与 npm 发布及公开包核验已完成。
