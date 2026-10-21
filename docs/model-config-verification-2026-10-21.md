# 官方模型配置与 Magpie 验收

## 已验证

- TUI 的 `RuntimeController.loadModelCatalog` 读取官方 `ctx.llm.listProviders/listModels`，模型切换调用官方 `agentDefaultModel`；没有自有模型配置读取器。
- 根因是 launcher 模式切换造成 profile 分裂：原 lightweight 使用 `tui`，source 使用 `deepseek-tui`。本机前者无 `cordis.patch.yml`；官方 `--dump-config` 的 pi-ai providers 为空。后者由 Magpie 写有 magpie/magpie-responses/magpie-anthropic，分别 57/7/1 个模型。Magpie 官方源码按 `profiles/*/cordis.patch.yml` 发现目标，而不是读取 TUI 私有文件。
- 两种模式现在都默认 `deepseek-tui`，`--profile NAME` 与 `--profile=NAME` 同时决定安装与启动；重复/空参数被拒绝，`--` 后保留应用参数。没有复制、删除或改写用户 profile。
- 本机真实 lightweight 入口已启动 `/model` 并过滤 `magpie`，显示 **1/65**，保留其他 provider；未提交聊天/模型推理。代表截图保存在 evidence/model-config-2026-10-21/。
- 大目录暴露了旧模型面板固定 30 行的问题；失败测试显示 8 行预算渲染 33 行，现按物理高度分配目录窗口，保留标题、过滤输入、所选项与导航。
- 新增真实官方 pi-ai 适配器测试，三个协议共 65 个模型；TUI 列表逐项等于官方 LLM 服务目录。Launcher 配置选择三项回归先失败后通过。会话目录测试等待标题异步加载后再断言，保留原有结果要求。
- 最终门禁：169 文件/2232 项 TUI 测试、46 项入口测试、四工程严格类型、五产物构建导入、36 个新增运行时依赖的 npm 可获得性、built/source 隔离 profile 启动均通过。真实 PTY 检查以 0 正常退出。
- 官方约束：[DSH 扩展机制](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/cookbook/extension-cookbook.zh.md)、[官方 profile 层](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/boot/app-boot/src/profile-context.ts)、[Magpie DSH 适配器](https://github.com/yetone/magpie/blob/main/internal/agent/dsh.go)。各 profile 独立是 DSH 的官方语义；只配置 web 不等于全局配置。

重新启动 `dsh-tui` 使用统一默认值；已有 `tui` 进程的 `/reload` 会保留原 profile，因此切换需退出重启或显式 `--profile deepseek-tui`。若要保留旧轻量配置，使用 `--profile tui`。创建新 profile 后再刷新 Magpie 的 DSH 接入/目录，以便它发现新的官方 patch 文件。

## 未验证

未进行真实模型回复、Magpie 网关推理或认证流程，不将目录展示当作模型服务可用性证明。没有重启用户已有会话进程。

## 阻塞

本地修复无阻塞。GitHub/npm 已发布 0.1.0-alpha.50；原有 OIDC 工作流成功，npm next 指向新版本，包 gitHead 与 tag 一致；下载包和 GitHub 附件 SHA-256 相同。证据见 evidence/model-config-2026-10-21/publication.json。
