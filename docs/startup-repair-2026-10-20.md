# 实际启动修复记录

## 已验证

2026-10-20，使用用户实际入口 `/home/zhangyangrui/.local/bin/dsh-tui` 进行 PTY 启动验证，终端尺寸 120×36：约 3.56 秒进入 TUI。没有发送模型请求。验证后用 Ctrl+C 中止测试进程（信号退出，不将其记作正常退出测试）。日志：`/tmp/dsh-tui-live-startup.log`，权限 0600。

启动前的三个问题：

1. 源码模式绕过了插件安装流程，仍依赖旧分支自带的 `@deepseek-ai/dsh-tui`。现改为把本仓库的 `@crazyhappyone/dsh-tui` 安装到原有 `deepseek-tui` profile。
2. 新版 dsh 的 `/typert` 导出需要生成的 JS 文件。已运行上游 `scripts/generate-typert.ts`，生成 30 个包的运行时产物；`dev:setup` 同步包含此步骤。源码启动发现产物缺失时也会先生成，失败则停止启动。
3. 旧 `pnpm dsh` 启动会执行工作区安装钩子。改为 `pnpm exec node --import tsx/esm apps/cli/src/bin.ts`，保留源码 checkout 的 pnpm 版本上下文，同时避免每次安装整个工作区。直接调用 Node 会使 profile 插件管理使用不同版本的 pnpm，曾实际复现 store v10/v11 不匹配，因此保留 `pnpm exec`。

本机 profile 的旧 bundle 名已替换为新包名并通过 dsh 的插件管理命令建立本地依赖链接。原 profile 设置与其他插件条目保留。修改前备份：

`/home/zhangyangrui/.dsh/profiles/deepseek-tui/startup-backup-UYfTVy`

默认源码地址现为官方公开仓库，ref 为 `dsh-v0.2.1-rc.2`，不再默认使用旧的私有功能分支。

验证：

- 三个新增 launcher 回归用例先失败，再通过：生成产物→安装本插件→启动、就绪启动不重复准备、产物生成失败阻止启动。
- `npm test`：43 项通过、0 失败，包含真实子进程信号退出码检查。
- `npm run dev:setup`：类型声明与 Typert 生成通过。
- `npm run pack:check`：通过。
- 本次修改的四个 JavaScript 文件 LSP 检查：0 错误、0 警告。
- 真实启动日志不再出现 TUI bundle 未解析及 Typert 文件缺失错误。

## 未验证

本次没有进行联网模型对话，也没有新增或读取模型认证密钥。

## 阻塞

下列已安装认证插件仍被 dsh 的版本检查拒绝，因此它们的认证入口暂不可用：

- `dsh-codex-auth@0.3.3-rc.1`
- `dsh-antigravity-auth@0.1.4-rc.1`

两者当前都声明 dsh 0.1.x 依赖，与运行中的 dsh `0.2.1-rc.2` 不匹配。未自动修改其兼容版本声明、禁用条目或授予版本豁免。TUI 本身已能启动；认证插件需要各自完成 dsh 0.2 适配。

## 后续：认证插件阻塞已解决

本轮已同步两个认证插件上游，并将 Antigravity 进一步适配到 dsh `0.2.1-rc.2`。两者均通过完整离线门禁与官方源码制品验证，真实 TUI 启动不再跳过它们。现用版本、测试数量、终端入口验证与未验证边界见 [认证插件适配记录](auth-plugin-compatibility-2026-10-20.md)。

## 后续：本地标准 dsh 命令注册

### 已验证

本机 PATH 原来只能找到 `~/.local/bin/dsh-tui`，找不到 `dsh`；Magpie 实际输出 `DeepSeek Harness  CLI not found`。本地源码 runtime 已存在，缺失的是标准 CLI 入口。

已创建 `~/.local/bin/dsh`，继续使用 `/home/zhangyangrui/my_programes/deepseek-harness`，支持现有 `DSH_TUI_RUNTIME_DIR` 覆盖。入口转发原始 CLI 参数，保留调用方 cwd，以绝对路径加载 tsx，并显式设置源码 tsconfig，避免在其他工作目录下丢失工作区别名。PATH 优先使用本机已安装的 pnpm 11.28.5，与当前源码 checkout 和插件依赖 store 匹配。该入口是本机安装项，不包含在本插件的发布 bin 中。

- `command -v dsh` 返回 `/home/zhangyangrui/.local/bin/dsh`。
- 在 `/tmp` 运行 `dsh --version` 返回 `0.2.1-rc.2`；`dsh --help` 显示原始 DSH profile/plugin 命令。
- 在临时独立 DSH_HOME 中运行插件管理版本探测，输出 pnpm `11.28.5`。
- `dsh --profile deepseek-tui` 真实终端约 2.75 秒进入界面，随后中断退出，没有模型请求。日志 `/tmp/dsh-standard-live-startup.log`，权限 0600。
- Magpie 实际复查不再显示 `CLI not found`。模型和 thinking 显示 `—`，仅表示没有在该列表读到当前选择，不能当作模型网关连通证据。

本次入口更新前保留 `~/.local/bin/dsh.before-pnpm-20261020`。未修改用户模型、密钥或 Magpie 配置。

Magpie 的 [DSH 适配器](https://github.com/yetone/magpie/blob/main/internal/agent/dsh.go) 以 `dsh` 为命令名，并读取 `$DSH_HOME/profiles/*/cordis.patch.yml`；[命令检测实现](https://github.com/yetone/magpie/blob/main/internal/agent/agent.go) 通过可执行路径探测。无需把第三方插件命令改名冒充 DSH。

### 未验证

未验证 Magpie 切换模型后的联网推理请求；没有自动选择模型。将来升级或移动本地源码 runtime/pnpm 时，应同步核对该本机入口的绝对路径与版本。

### 阻塞

本地命令发现问题已解决，无阻塞。
