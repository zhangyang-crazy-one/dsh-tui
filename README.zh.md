---
description: "DeepSeek Harness 终端界面的可安装源码运行时 launcher 与公开源码镜像。"
kind: "package-group"
---

# dsh-tui — DeepSeek Harness 终端界面

[English](README.md) | 中文

[![CI](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/zhangyang-crazy-one/dsh-tui/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/zhangyang-crazy-one/dsh-tui?include_prereleases)](https://github.com/zhangyang-crazy-one/dsh-tui/releases)
[![npm next](https://img.shields.io/npm/v/%40crazyhappyone%2Fdsh-tui/next?label=npm%40next)](https://www.npmjs.com/package/@crazyhappyone/dsh-tui)

## 概述

`@crazyhappyone/dsh-tui` 提供 `dsh-tui` 命令，用于运行和安全更新 DeepSeek Harness 终端界面。Launcher 管理专用 DSH 源码 checkout，因此不会 pull、reset、stash 或 clean 贡献者的开发 checkout。本公开仓库还镜像 `packages/tui/` bundle 与 renderer 源码以供审查。Agent、会话、工具、持久化、provider、权限与 profile 组装仍由 DSH 拥有。

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

空闲首页：

![dsh-tui 空闲首页](assets/screenshots/dsh-tui-home.png)

发送 `你好` 后：

![dsh-tui 发送你好后的响应](assets/screenshots/dsh-tui-hello.png)

-----

<a id="install-the-launcher"></a>
## 安装 launcher

无 scope 的 `dsh-tui` 包属于另一位 maintainer。本项目只在已认证的 `crazyhappyone` npm scope 下发布。

Launcher 需要 Git、pnpm 与 DSH 支持的 Node 版本。无需单独安装 `@deepseek-ai/dsh`，launcher 也不会使用它：`dsh-tui` 始终从专用源码 checkout 运行 `deepseek-tui` profile。

安装 prerelease 并完成首次启动：

```text
npm install --global @crazyhappyone/dsh-tui@next
dsh-tui version
dsh-tui update
dsh-tui
```

安装 npm 包只会创建 launcher。它不会 clone DSH、运行 `pnpm install`、请求 Git 凭据或执行 postinstall script。显式执行 `dsh-tui update` 才会创建源码运行时；其默认 private 源码需要仓库授权。

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

TUI 是 DSH profile 层，而不是独立的 agent 运行时：

```text
@deepseek-ai/dsh-base
  └─ @deepseek-ai/dsh-tui          profile patch, terminal lifecycle, controller
       └─ @deepseek-ai/dsh-tui-render   Ink projection and terminal I/O
```

集成源码位于 private [`feat/deepseek-tui` DSH 分支](https://github.com/zhangyang-crazy-one/deepseek-harness/tree/feat/deepseek-tui/packages/tui)。影响 DSH 服务、profile 组合、组装后 CLI snapshot 或 Agent Note 的变更归该 monorepo 所有，并遵循其中的架构、测试与文档规则。

-----

<a id="packages"></a>
## 包

| 包 | DSH 形态 | 职责 |
|---|---|---|
| [`tui/`](tui/README.zh.md) | Profile bundle 与运行时插件 | 在 `dsh-base` 上组合终端层、拥有 live 终端会话，并将用户动作映射到 DSH 服务 |
| [`tui-render/`](tui-render/README.zh.md) | Library | 通过 Ink 投影控制器状态，但不拥有 agent、持久化或模型请求 |

-----

<a id="development-workflow"></a>
## 开发工作流

在完整 DSH checkout 中实现 TUI 行为，运行受变更行为影响的检查，并将确认后的 `packages/tui/` tree 导出到这里。在本仓库中使用 `npm test` 开发 launcher；通过 packed tarball 测试安装，不使用 workspace link。

Launcher runtime 必须与开发 checkout 分离。要安全测试其他源码，请将 `DSH_TUI_RUNTIME_DIR` 指向临时绝对目录，并配置 `DSH_TUI_SOURCE_URL` 与 `DSH_TUI_SOURCE_REF`。

-----

<a id="publish-the-npm-package"></a>
## 发布 npm 包

GitHub Actions 会在每个 pull request 和向 `main` 的 push 上使用 Node 22.19 与 24 运行测试。只有发布 GitHub Release 才会启动 npm 发布。工作流要求 Release tag 等于 `v` 加 `package.json` 中的版本；prerelease 发布到 npm `next` tag，stable release 发布到 `latest`。

在 `publish.yml` 进入默认分支后，一次性配置 npm Trusted Publishing。npm CLI 11.5.1 或更高版本可以通过已认证的 browser session 注册 GitHub workflow：

```text
npm trust github @crazyhappyone/dsh-tui \
  --file publish.yml \
  --repository zhangyang-crazy-one/dsh-tui \
  --allow-publish
```

对应的 npm 网站配置为：organization or user 填 `zhangyang-crazy-one`，repository 填 `dsh-tui`，workflow filename 填 `publish.yml`，environment 留空。工作流使用 GitHub OIDC，不保存 npm token、密码或 OTP。

每次发布时，先提升 `package.json` 版本，等待 CI 通过并合并，然后创建 tag 与 package version 一致的 GitHub Release：

```text
gh release create v0.1.0-alpha.3 --prerelease --generate-notes
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

<a id="dev-note"></a>
## 开发备注

无。
