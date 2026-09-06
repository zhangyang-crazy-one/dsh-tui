## Why

当前 `dsh-tui` 的运行时安装方式强制执行全量 `git clone`（拉取包含 70+ 个 package 的 monorepo）并执行 `pnpm install`，导致 1.5GB~2GB 的磁盘占用和高额的 CPU/网络开销，严重阻碍普通终端用户的快速安装与使用。与此同时，上游 `deepseek-ai/deepseek-harness` 远端主干已演进至 `0.1.3-alpha.1`（超前 750 commits），其中 `session-persistence` 重构为基于生命周期的 Handle 句柄模型并移除了 SQLite。TUI 需要在支持探测用户已通过 npm 安装的轻量 `@deepseek-ai/dsh` 核心包以实现“免 clone 秒开”的同时，完成对上游 0.1.3-alpha.1 内核生命周期与持久化 API 的对齐适配。

## What Changes

* **新增轻量化环境探测与免 Clone 启动机制**：在 `dsh-tui` 启动器中增加对系统全局/本地已安装 `dsh` 可执行命令（`PATH`、`DSH_BIN`、全局 `node_modules`）的检测。当检测到已安装官方 `dsh` 时，自动使用独立预编译产物通过 `dsh --patch` 启动，避免下载和构建 monorepo。
* **分层安装与友好降级引导**：未检测到 `dsh` 时，优先引导用户通过 `npm i -g @deepseek-ai/dsh`（仅数十 MB）极速安装官方运行时，仅在显式传入 `--source` 或开发模式下回退至 monorepo 源码模式。
* **独立发布预构建 Bundle 产物**：在 `@crazyhappyone/dsh-tui` 中包含预构建的 TUI 运行时产物与 `cordis.patch.yml`，具备独立分发能力。
* **适配上游 `0.1.3-alpha.1` 会话持久化与 Handle 架构**：**BREAKING** 将 TUI（`SessionDirectory`、`AgentHub`、`/export`、`--resume`）针对 `sessionPersistence` 的调用全面升级为新的 `SessionHandle`（`open('read')` / `read()` / `close()`）与 `SessionPersistenceSnapshot` 规范，对齐会话 Format v2。

## Capabilities

### New Capabilities
- `tui-launcher-lightweight-probe`: 覆盖启动器对系统已安装 `dsh` 的自动探测、免 clone 启动参数组合、独立预构建 Bundle 装载及轻量安装引导。

### Modified Capabilities
- `tui-dsh-compatibility`: 升级 TUI 与 DSH 0.1.3-alpha.1 内核契约，特别是基于 `SessionHandle` 的生命周期只读与冷读取规范、`SessionPersistenceSnapshot` 元数据读取及 Format v2 会话流兼容。

## Impact

* `dsh-tui` 启动器（`bin/dsh-tui.js`、`src/launcher.js`）：新增环境探测与模式切换逻辑，免去全量 clone。
* `packages/tui/tui`（`src/index.ts`、相关 spec 测试）：将会话读取从已废弃的 `borrowSession`/`inspect` 迁移至 `SessionHandle` 只读句柄。
* 打包发布流程：增加将 prebuilt TUI 产物注入 `@crazyhappyone/dsh-tui` 的自动化流程。
