---
description: "DeepSeek Harness 终端界面：一个 dsh 插件 bundle 及其 launcher。"
kind: "package-group"
---

# dsh-tui — DeepSeek Harness 终端界面

[English](README.md) | 中文

[![CI](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/zhangyang-crazy-one/dsh-tui?include_prereleases)](https://github.com/zhangyang-crazy-one/dsh-tui/releases)
[![npm next](https://img.shields.io/npm/v/%40crazyhappyone%2Fdsh-tui/next?label=npm%40next)](https://www.npmjs.com/package/@crazyhappyone/dsh-tui)

## 概述

`@crazyhappyone/dsh-tui` 是 DeepSeek Harness（dsh）的终端界面，以 dsh **插件 bundle** 加 `dsh-tui` launcher 的形式发布。包声明了 `dsh.bundle`，因此 dsh 会像安装其他插件一样把它装进 profile；launcher 只负责自动完成这一安装并启动 profile。本仓库拥有插件源码（`tui/`、`tui-render/`）。Agent、会话、工具、持久化、provider、权限与 profile 组装仍由 DSH 拥有。

## 目录

- [截图](#screenshots)
- [安装 launcher](#install-the-launcher)
- [运行与更新](#run-and-update)
- [配置源码运行时](#configure-the-source-runtime)
- [与 DSH 的关系](#relationship-to-dsh)
- [包](#packages)
- [开发工作流](#development-workflow)
- [发布 npm 包](#publish-the-npm-package)
- [已知限制](#known-limitations)
- [开发备注](#dev-note)

-----

<a id="screenshots"></a>
## 截图

交互式设置面板（`/settings`）：

![dsh-tui 设置面板](assets/screenshots/dsh-tui-settings.png)

发送 `你好` 后：

![dsh-tui 发送你好后的响应](assets/screenshots/dsh-tui-hello.png)

-----

<a id="install-the-launcher"></a>
## 安装 launcher 与运行模式

无 scope 的 `dsh-tui` 包属于另一位 maintainer。本项目只在已认证的 `crazyhappyone` npm scope 下发布。

`dsh-tui` 支持两种运行模式：

### 模式 A：轻量模式（推荐，零 Clone 秒开）
全局安装官方引擎与 TUI launcher：

```text
npm install --global @deepseek-ai/dsh
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui probe
dsh-tui
```

首次启动会执行 `dsh plugin --profile tui add <包目录>`，把本包链接进 `tui` profile，排在 `@deepseek-ai/dsh-base` 之后；之后的启动检测到已安装，直接执行 `dsh --profile tui`。不使用 launcher 时，也可以手动执行同样的两条 dsh 命令：

```text
dsh plugin --profile tui add @crazyhappyone/dsh-tui@next
dsh --profile tui
```

在 dsh 0.2 中以 bundle 方式安装是必需的：`/settings` 的修改写入 profile 自己的 patch 层，该层在 bundle 层之后生效；而 `--patch` overlay 位于 profile 层之后，dsh 会拒绝对此类 overlay 所拥有的行写入设置。

探测顺序为绝对路径 `DSH_BIN`、PATH、npm/pnpm 全局包、工作目录和 launcher 目录可解析的本地包；每个探测子进程限时十秒，以覆盖冷启动。显式 `DSH_BIN` 失败时不会选择其他安装。包内 bin 使用 launcher 的 Node 执行。

本 bundle 面向 dsh `0.2` 发布线（基于 `0.2.1-alpha.2` 构建，并在 `0.2.0-rc.2` 上验证）。包把 `@deepseek-ai/dsh` `>=0.2.0-rc.2 <0.3.0` 声明为可选 peer，因此手动安装时由 dsh 自身的插件兼容性检查把关；launcher 会拒绝其他引擎发布线并给出确切的安装命令，设置 `DSH_TUI_SKIP_ENGINE_CHECK=1` 可跳过 launcher 的检查。

### 模式 B：源码模式（开发者调试）
若需对 TUI 或 DSH 底层代码进行修改与调试：

```text
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui update
dsh-tui --source
```

显式执行 `dsh-tui update` 才会通过 Git 克隆源码并执行 `pnpm install`。可通过 `dsh-tui probe` 查看当前探测到的运行引擎。

-----

<a id="run-and-update"></a>
## 运行与更新

初始化后，在希望 agent 使用的 workspace 中运行 `dsh-tui`：

```text
dsh-tui
```

需要刷新专用运行时时，请先运行 `dsh-tui update`，然后再次启动。

普通参数会原样传递给 `deepseek-tui` profile：

```text
dsh-tui "review this repository"
dsh-tui --resume <session-id>
dsh-tui --cwd <directory>
```

运行时不存在时，`dsh-tui update` 会 clone 配置的源码。对于现有运行时，它要求工作树干净、fetch 配置的 ref、证明当前 HEAD 是该 ref 的祖先、只应用 `git merge --ff-only`，再运行 `pnpm install --frozen-lockfile`。Dirty 或 divergent history 会在 HEAD 改变前停止。

`dsh-tui version` 会报告 launcher 版本、运行时目录、运行时 Git SHA 与 DSH 版本，并且不访问网络。精确单词 `update` 与 `version` 是 launcher 命令；使用 `dsh-tui -- update` 或 `dsh-tui -- version` 将其作为 TUI task 发送。

更新 launcher 与更新运行时是不同操作：

```text
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui update
```

-----

<a id="configure-the-source-runtime"></a>
## 配置源码运行时

默认值跟踪所有者的 private `feat/deepseek-tui` 分支。该仓库需要 Git authorization。其他用户可以选择一个兼容且可访问的仓库与 ref。

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `DSH_TUI_RUNTIME_DIR` | `~/.local/share/dsh-tui/runtime` | 仅供 launcher 使用的专用 clone |
| `DSH_TUI_SOURCE_URL` | `https://github.com/zhangyang-crazy-one/deepseek-harness.git` | `update` clone 和 fetch 的 Git remote |
| `DSH_TUI_SOURCE_REF` | `feat/deepseek-tui` | `update` fetch 的 branch 或 ref |
| `DSH_TUI_PNPM` | `pnpm` | 安装和启动所用的 pnpm executable |

所有值都不得为空，运行时目录必须是绝对路径。Launcher 会拒绝 symbolic-link runtime path，也会拒绝不是 Git checkout 的现有目录。Child command 接收参数数组，不使用 shell interpolation。

如果 fast-forward 后的依赖刷新失败，运行时会停留在报告的新 SHA，但不会被声明为 ready。请运行 launcher 打印的精确恢复命令。对于 dirty 或 divergent 状态，只检查专用运行时目录，或选择新的空 `DSH_TUI_RUNTIME_DIR`；launcher 不会自动丢弃它。

-----

<a id="relationship-to-dsh"></a>
## 与 DSH 的关系

TUI 是 dsh 插件 bundle，不是 fork，也不是独立的 agent 运行时：

```text
@deepseek-ai/dsh-base                  dsh 核心 bundle（agent、会话、工具）
  └─ @crazyhappyone/dsh-tui             本 bundle：cordis.patch.yml + dist/*
       ├─ tui-startup  (./startup)      命令行 provider（任务、--resume、--cwd）
       ├─ tui          (./settings)     /settings 中可编辑的 TUI 偏好（volatile）
       ├─ tui-runtime  (./runtime)      终端生命周期与控制器
       └─ zen-proxy    (./zen-proxy)    可选的 OpenCode Zen 请求头代理
```

各行通过包的 `exports` 引用插件，因此设置修改会在 profile patch 中记录可移植的行名。本 bundle 还插入已发布的 dsh 插件 `session-stats`、`message-feedback`、`tool-ask-user` 与 `workspace-changes`，并覆盖 `system-prompt`、`tools`、`session-query-sqlite` 与 `session-title-llm`。

### OpenCode Zen 免费模型

打包后的 patch 挂载了 `zen-proxy`（vendored 自
[zhangyang-crazy-one/dsh-zen-proxy](https://github.com/zhangyang-crazy-one/dsh-zen-proxy)，
fork 自 [Yee-h/dsh-zen-proxy](https://github.com/Yee-h/dsh-zen-proxy)）：进程内 localhost
代理，注入 Zen 要求的 OpenCode 官方客户端头（`User-Agent`、
`x-opencode-client/session/request/project`）。没有它，Zen 会返回
`400 MissingSessionID` / `429 FreeUsageLimitError`，因为 dsh 始终发送自己的
attribution `User-Agent`。

使用方法：通过 TUI `/settings` provider 表单（或 profile 的 `cordis.patch.yml`）
添加一个指向该代理的 provider，并把密钥放在 credentials 中：

```yaml
- id: llm-pi-ai
  config:
    providers:
      opencode:
        api: openai-completions
        baseURL: http://127.0.0.1:4097/v1
        apiKeyEnv: OPENCODE_API_KEY
```

代理只监听 `127.0.0.1:4097`；在 profile 的 `cordis.patch.yml` 中加入 `- id: zen-proxy` 并设置 `disabled: true` 即可关闭。

-----

<a id="packages"></a>
## 包

| 包 | DSH 形态 | 职责 |
|---|---|---|
| [`tui/`](tui/README.zh.md) | 运行时、启动与设置插件 | 在 `dsh-base` 上组合终端层、拥有 live 终端会话，并将用户动作映射到 DSH 服务 |
| [`plugins/zen-proxy/`](https://github.com/zhangyang-crazy-one/dsh-zen-proxy) | Vendored 插件（打包为 `dist/zen-proxy.js`） | 进程内 OpenAI 兼容代理，注入 OpenCode Zen 客户端头；在 `cordis.patch.yml` 中挂载 |
| [`tui-render/`](tui-render/README.zh.md) | Library | 通过 Ink 投影控制器状态，但不拥有 agent、持久化或模型请求 |

-----

<a id="development-workflow"></a>
## 开发工作流

`tui/` 与 `tui-render/` 基于上游 dsh checkout 编译，版本为 `src/launcher.js` 中 `COMPATIBLE_DSH_VERSION` 指定的 tag：

```text
git clone --branch dsh-v0.2.1-alpha.2 https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
(cd ../deepseek-harness && pnpm install)
npm run build          # 或 DSH_SOURCE=/path/to/checkout npm run build
```

`npm run build` 把插件包与 `cordis.patch.yml` 复制进 checkout 的 `packages/tui/` workspace，用 esbuild 打包 `dist/index.js`、`dist/startup.js`、`dist/settings.js` 与 `dist/zen-proxy.js`，并逐个检查导入。插件测试在 checkout 中运行 `npx vitest run packages/tui`，launcher 测试在本仓库运行 `npm test`；发布前运行 `npm run pack:check`。通过 packed tarball 或 `dsh plugin --profile <name> add <本目录>` 测试安装。

-----

<a id="publish-the-npm-package"></a>
## 发布 npm 包

GitHub Actions 会在每个 pull request 和向 `main` 的 push 上使用 Node 22.19 与 24 运行测试。只有发布 GitHub Release 才会启动 npm 发布。工作流要求 Release tag 等于 `v` 加 `package.json` 中的版本；prerelease 发布到 npm `next` tag，stable release 发布到 `latest`。

在 `publish.yml` 进入默认分支后，一次性配置 npm Trusted Publishing。npm CLI 11.5.1 或更高版本可以通过已认证的 browser session 注册 GitHub workflow。下面的命令会临时运行兼容的 npm 11，不替换全局安装的 npm：

```text
npx --yes npm@11 trust github @crazyhappyone/dsh-tui \
  --file publish.yml \
  --repository zhangyang-crazy-one/dsh-tui \
  --allow-publish
```

对应的 npm 网站配置为：organization or user 填 `zhangyang-crazy-one`，repository 填 `dsh-tui`，workflow filename 填 `publish.yml`，environment 留空。工作流使用 GitHub OIDC，不保存 npm token、密码或 OTP。

每次发布时，先提升 `package.json` 版本，等待 CI 通过并合并，然后创建 tag 与 package version 一致的 GitHub Release：

```text
gh release create v0.1.0-alpha.4 --prerelease --generate-notes
```

`Publish npm` workflow 会在发布前再次运行测试与 packed-package 验证。不要重新运行旧的 release tag：npm version 不可覆盖。提升到 stable 必须使用新版本并发布 non-prerelease GitHub Release。

-----

<a id="known-limitations"></a>
## 已知限制

- **Private 默认源码** — npm 安装是 public，但默认 DSH runtime remote 需要仓库授权；匿名用户必须配置一个可访问的兼容源码。
- **需要源码工具链** — 初始化运行时需要 Git、pnpm 与 DSH 支持的 Node 版本。
- **不自动解决冲突** — dirty 或 non-fast-forward runtime history 需要显式人工操作或新的运行时目录。
- **运行时更新不是 launcher 更新** — `dsh-tui update` 刷新 DSH 源码与依赖；npm 更新 launcher package。
- **集成分支拥有发布就绪状态** — launcher 成功不能替代 DSH 分支的行为、snapshot、build 或 hygiene 检查。
- **源码模式面向旧集成分支** — `--source` 启动所配置 DSH checkout 的 `deepseek-tui` profile（默认 `feat/deepseek-tui`，dsh 0.1.6），不使用本 0.2 bundle。
- **dsh 0.2 不支持物理删除会话** — 0.2 的会话持久化以归档代替删除，而 TUI 组合未挂载 workspace 归档服务，因此会话列表会提示无法删除。

<a id="dev-note"></a>
## 开发备注

无。
