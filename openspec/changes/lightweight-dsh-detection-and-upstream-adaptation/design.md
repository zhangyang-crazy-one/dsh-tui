## Context

当前 `dsh-tui` 启动器将运行时强绑定在 monorepo 源码模式上，通过 `git clone` 拉取 70+ 个包并执行完整 `pnpm install`，开销高达 1.5GB~2GB 磁盘与持续的构建资源。实际上，普通用户如果已经通过 `npm i -g @deepseek-ai/dsh` 安装了官方发布的轻量核心包（体积仅几十 MB），则无需任何源码仓库即可运行核心能力。同时，上游主干已演进至 `0.1.3-alpha.1`，移除了 SQLite 并全面引入基于句柄的 `SessionHandle` 与租约机制，TUI 必须兼容新旧内核契约。

## Goals / Non-Goals

**Goals:**
* 在 `dsh-tui` 启动器中实现 `dsh` 核心引擎自动探测机制（`DSH_BIN` -> `PATH` 中的 `which dsh` -> 全局 `node_modules`）。
* 在探测到全局已安装 `dsh` 时，支持基于 prebuilt 产物的轻量模式（Zero-Clone Mode），通过 `dsh --profile headless --patch <cordis.patch.yml>` 启动 TUI。
* 未探测到时，默认输出极简轻量安装建议（`npm i -g @deepseek-ai/dsh`），杜绝未经允许默认下载 2GB 仓库；保留 `--source` 显式源码调试入口。
* 在 `deepseek-harness` 中对齐 `0.1.3-alpha.1` 的 `session-persistence` 句柄模型，并做好对已发布 `0.1.2-rc.1` npm 包的双向兼容防御。
* 完善打包脚本，使 `dsh-tui` 独立发行包具备自包含的 prebuilt 运行时。

**Non-Goals:**
* 重新引入被上游废弃的 SQLite 会话持久化。
* 侵入修改官方 `@deepseek-ai/dsh` 的内部代码（全通过外部 patch 与 profile 机制挂载）。

## Decisions

### 决策 1: 启动模式双层架构（探测优先）
* **选择**：在 `dsh-tui` 启动时首先调用 `probeInstalledDsh()`：
  1. 环境变量 `DSH_BIN`；
  2. 命令查找（Linux/macOS 执行 `which dsh`，Windows 执行 `where dsh` 并测试 `dsh --version`）；
  3. 全局包目录查找。
* **分流策略**：
  * 若探测到：直接进入 `launchLightweightTui`（执行预构建 Bundle 挂载）；
  * 若未探测到：进入引导模式，告知用户运行单行安装命令；
  * 若显式带有 `--source`：进入 `launchSourceTui`（既有的 monorepo 调试模式）。
* **替代方案对比**：原方案无论用户环境如何均执行 git clone + pnpm install，被否决。

### 决策 2: 独立 Bundle 与 `cordis.patch.yml` 动态挂载
* **选择**：利用官方 `dsh` 支持 `--patch <file>` 的原生机制。在 `@crazyhappyone/dsh-tui` 发布时，内置 prebuilt 的 `dist/tui` 与 `cordis.patch.yml`。
* **路径解析**：依据 `app-boot` 的 `anchorInsertedPluginNames` 规范，patch 中以 `./dist/index.js` 相对路径引用插件入口，`dsh` 加载时会自动转换为 `file://...` 绝对路径注入。

### 决策 3: `sessionPersistence` 兼容层适配（0.1.2-rc.1 与 0.1.3-alpha.1 双向防御）
* **选择**：在 `packages/tui/tui/src/index.ts` 中实现渐进增强读取：
  * `list()` 结果适配：检查元素是否具有 `.header` 属性（`const header = (item as SessionPersistenceSnapshot).header ?? item`），同时兼容新旧接口；
  * `inspect`/`borrowSession` 适配：优先使用 `persistence.open(id, 'read')` 获取 `SessionHandle`，并在 `try ... finally` 中调用 `await handle.close()`；当处于旧内核环境时回退至 `persistence.inspect(id)`。

## Risks / Trade-offs

* **[Risk]** npm 官方 `@deepseek-ai/dsh` 当前版本为 `0.1.2-rc.1`，而 git master 为 `0.1.3-alpha.1`，API 存在差异。
  * → **Mitigation**: 在 TUI 的 persistence 适配层编写动态 duck-typing 防御，优先走 `open('read')`，未实现时无缝兼容 `borrowSession`/`inspect`，保证无论用户全局安装的是 0.1.2-rc.1 还是最新的 0.1.3 均能稳定启动。
* **[Risk]** 用户的 Node 环境缺乏 pnpm 或权限受限。
  * → **Mitigation**: 轻量模式只需 Node 和全局 npm 安装，无需 pnpm 和编译工具链，彻底消除该风险。
