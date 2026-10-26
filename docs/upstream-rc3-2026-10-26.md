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

## 未验证

- 当前完整离线门禁、CI 和发布尚在执行。
- 真实模型请求、live 登录、用户现场终端根因和生产长期内存趋势不在离线验证结论内。

## 阻塞

暂无。下一步：完成 rc.3 完整门禁、托管 CI、GitHub release、npm OIDC 发布及公开包完整性复核。
