# tui-launcher-lightweight-probe Specification

## ADDED Requirements

### Requirement: 启动器自动探测已安装的 dsh 引擎
启动器 `dsh-tui` SHALL 在每次启动时按固定优先级探测宿主系统是否已安装可用的 `dsh` 核心引擎：
1. 优先检查环境变量 `DSH_BIN` 显式指定的绝对路径；
2. 其次在系统 `PATH` 中查找可执行程序 `dsh` 并执行版本嗅探；
3. 再次探测全局 node_modules（如 `npm root -g` 或 pnpm global bin）中的 `@deepseek-ai/dsh`。
探测结果 MUST 缓存至单次启动上下文，且不得无故阻塞。

#### Scenario: 系统 PATH 中已存在全局 dsh
- **WHEN** 用户系统已通过 `npm i -g @deepseek-ai/dsh` 安装官方包且在 PATH 中可直接执行
- **THEN** 启动器识别到已安装引擎，返回其可执行路径与探测成功的状态

#### Scenario: 环境变量指定 DSH_BIN
- **WHEN** 用户通过 `DSH_BIN=/custom/path/to/dsh` 启动 `dsh-tui`
- **THEN** 启动器优先采用该绝对路径作为运行核心

#### Scenario: 系统未安装 dsh
- **WHEN** PATH、环境变量及全局 node_modules 均未发现 `dsh`
- **THEN** 探测结果明确标记为未就绪，并携带诊断原因

### Requirement: 检测到已安装 dsh 时支持轻量化免 clone 启动
当探测到系统中已存在可用的 `dsh` 时，`dsh-tui` SHALL 默认采用轻量模式（Zero-Clone Mode）运行：
直接借助官方 `dsh` 的 `--patch` 或 profile 覆盖能力装载随 `@crazyhappyone/dsh-tui` 一同分发的预构建 TUI 插件（Bundle），MUST NOT 要求用户运行 `dsh-tui update` 也不得执行 monorepo 的 `git clone` 或 `pnpm install`。

#### Scenario: 轻量模式启动 TUI
- **WHEN** 用户运行 `dsh-tui` 且全局已安装官方 `dsh`
- **THEN** 启动器直接执行 `dsh --profile headless --patch <bundled-tui-patch>` 启动终端界面，耗时在秒级，零源码依赖下载

#### Scenario: 强制源码调试模式
- **WHEN** 开发者显式设置 `DSH_TUI_MODE=source` 或传递 `--source` 选项
- **THEN** 启动器旁路轻量探测，继续遵循既有的 monorepo 源码目录和 `pnpm` 调用链路

### Requirement: 未检测到 dsh 时提供快速安装引导与降级
当未检测到任何可用 `dsh` 时，启动器 SHALL 打印友好清晰的引导建议，优先推荐用户通过单行轻量命令 `npm install --global @deepseek-ai/dsh` 安装官方核心运行时，并说明该方式仅需数十 MB 依赖，而非克隆 2GB 源码仓库。

#### Scenario: 未就绪时的命令行引导输出
- **WHEN** 宿主环境缺失 `dsh` 且用户直接运行 `dsh-tui`
- **THEN** 进程友好退出并输出提示：建议执行 `npm install -g @deepseek-ai/dsh`，且不自动拉取 2GB monorepo

### Requirement: 预构建 Bundle 具备独立分发与动态 patch 挂载能力
`@crazyhappyone/dsh-tui` 发行包 SHALL 包含编译就绪的 `tui` 与 `tui-render` 运行时文件及 `cordis.patch.yml` 描述文件。该 patch 文件 MUST 正确使用相对路径锚定（遵循 `anchorInsertedPluginNames` 契约），确保官方 `dsh` 加载时能正确解析出 TUI 插件 entry。

#### Scenario: 动态 patch 路径解析
- **WHEN** 官方 `dsh` 解析 `--patch <path-to-dsh-tui/cordis.patch.yml>`
- **THEN** TUI 插件模块通过 `file://` 规范正确注入运行时上下文并完成 Ink 界面挂载
