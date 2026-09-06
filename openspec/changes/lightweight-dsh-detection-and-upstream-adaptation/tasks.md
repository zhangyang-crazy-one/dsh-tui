## 1. 探测已安装 dsh 与轻量启动器实现 (Launcher Probe & Zero-Clone)

- [x] 1.1 在 `dsh-tui/src/launcher.js` 中实现 `probeInstalledDsh()`，支持 `DSH_BIN`、`PATH`（`which dsh` / `where dsh`）与全局包探测。
- [x] 1.2 在 `dsh-tui/src/launcher.js` 中增加轻量模式执行器 `launchLightweightTui`，通过 `dsh --profile headless --patch` 启动官方运行时。
- [x] 1.3 为 `dsh-tui` 增加未安装 `dsh` 时的单行安装引导建议，防止直接执行 2GB monorepo clone；保留 `--source` 显式源码模式。
- [x] 1.4 为 `dsh-tui` 编写单元测试，覆盖环境变量指定、PATH 存在、未安装引导以及 `--source` 选项解析与分流。

## 2. TUI 会话持久化与上游 Handle 架构适配 (Upstream 0.1.3 Adaptation)

- [x] 2.1 在 `packages/tui/tui/src/index.ts` 中适配 `sessionPersistence.list()` 返回的 `SessionPersistenceSnapshot`，兼容读取 `snapshot.header`。
- [x] 2.2 在 `packages/tui/tui/src/index.ts` 中将 `inspectAgentHub` 与冷读取迁移至 `SessionHandle`（`persistence.open(id, 'read')` + `handle.read()`），并保留旧版 fallback。
- [x] 2.3 验证 TUI 在 `session-persistence-jsonl` 租约锁环境下的 `--resume` 与 `/export`，确保句柄在各分支中正确关闭。
- [x] 2.4 运行 `packages/tui/tui` 与 `packages/tui/tui-render` 全量测试，确保适配零破坏。

## 3. 预构建 Bundle 独立分发与双端验收 (Bundling & Distribution Verification)

- [x] 3.1 编写/更新打包脚本，将 prebuilt TUI 产物同步至 `dsh-tui` 并生成规范的 `cordis.patch.yml`。
- [x] 3.2 运行轻量模式端到端启动验证，确认从已安装 `dsh` 加载预构建 TUI 秒开成功。
- [x] 3.3 更新双语文档、README 以及 OpenSpec 验证状态。
