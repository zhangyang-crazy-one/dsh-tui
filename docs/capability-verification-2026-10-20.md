# Pi 接续开发：模型能力与交付文件验收

## 已验证

工作仓库为 `dsh-tui`；上游 checkout 的 `packages/tui` 仅作为构建与测试副本。原有工作区改动保留，未提交、推送或发布；没有更改模型路由、凭据或 Pi 配置。

### 构建使用当前 renderer 源码

原构建复制了 renderer 源码，却通过其包入口加载 checkout 中旧的 `lib/index.js`。因此 renderer 源码测试可以通过，运行时仍缺少新投影。`scripts/build.js` 现在仅在挂载的开发副本中把 renderer 的 `main` 和默认 export 指向 `src/index.ts`；本仓库 renderer 发布清单不变。esbuild 将当前源码内联到 `dist/index.js`，运行时集成测试也走相同入口。

### 时间上下文

`cordis.patch.yml` 挂载官方 `@deepseek-ai/dsh-time-context`，`refreshIntervalMs: 600000`。`tui/tests/model-capabilities.spec.ts` 使用真实 Cordis、Agent Loop、Session 和官方插件，以离线 adapter 接收模型请求，验证当前时间与进程时区进入请求、短时间内下一回合不重复采样、投影不增加人类消息。

### 显式交付文件

官方 `@deepseek-ai/dsh-tool-present` 以 `maxFiles: 8` 挂载。真实 Agent Loop 发出 `present` 工具调用，登记临时目录中的二进制文件；测试确认工具成功、会话事件包含规范路径及说明、登记期间没有读取文件正文，事件回放后的交付列表与回合尾部一致。

`/deliveries` 列出当前会话显式交付的文件。↑↓ / PgUp / PgDn 选择；Enter 预览；`o` 请求系统应用打开；Esc 返回。UTF-8 文本通过 `ctx.fs` 读取，默认上限 1 MiB；二进制格式显示路径和说明并提供系统打开。新会话清空该列表；旧会话可随日志回放恢复。文件需仍存在且可访问，记录本身不复制产物。

`tui-render/src/delivery-lines.ts` 为回合尾部的两条绘制路径提供共同换行逻辑，保留完整路径和说明，并为绝对路径生成本地文件链接。会话级列表按路径合并重复声明，历史回合保留各自记录。异步加载中切换选中项曾会打开旧文件，新增失败回归后以当前路径校验修复。

### macOS 图片剪贴板

macOS 选择官方 [`pngpaste -`](https://github.com/jcsalterego/pngpaste) 的二进制 stdout 模式，缺少助手时提示 `brew install pngpaste`。Wayland/X11 保持 `wl-paste` / `xclip`。子进程默认五秒超时，控制器释放时取消；读取及验证结束后均检查取消状态，避免迟到的图片进入草稿。既有大小、MIME 校验保持有效。

`tui/tests/clipboard-image.spec.ts` 在 Linux 注入 macOS 平台，检查命令及参数；使用真实 Node 子进程分别输出 PNG、超时和取消，不调用本机真实剪贴板，也不把图片字节写入终端。

### 自动检查

| 检查 | 结果 | 记录 |
| --- | --- | --- |
| `npm run build` | 构建四个产物并成功导入 | 当前 `dist/*` |
| `npm run typecheck` | 四工程严格类型通过 | `/tmp/dsh-tui-capability-typecheck.log` |
| 上游 `node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests` | 151 文件、2126 测试通过 | `/tmp/dsh-tui-capability-all-tests.log` |
| `npm test` | 43/43 通过 | `/tmp/dsh-tui-capability-root-tests.log` |
| `npm run pack:check` | 打包预览通过 | `/tmp/dsh-tui-capability-pack.log` |
| `git diff --check` | 通过 | 本次工作区检查 |

新增回归对应 `model-capabilities.spec.ts`、`clipboard-image.spec.ts`、`deliveries.spec.ts`、`workspace-pane-integration.spec.ts`、`workspace-pane.spec.tsx` 和 `stream-view.spec.tsx`；命令目录断言包含新增 `/deliveries`。

### 真实终端与本机入口

使用生产 `TuiLoop`、真实 OS PTY 与合成服务数据执行：

```sh
python3 scripts/capture-ux-pty.py --scene deliveries --columns 40 --rows 16 --output /tmp/dsh-tui-deliveries-40
python3 scripts/capture-ux-pty.py --scene deliveries --columns 80 --rows 24 --output /tmp/dsh-tui-deliveries-80
python3 scripts/capture-ux-pty.py --scene deliveries --columns 120 --rows 40 --output /tmp/dsh-tui-deliveries-120
```

三组各八帧，覆盖初始列表、翻页、预览、预览翻页、系统打开动作、返回列表、屏蔽路径编辑和返回对话；草稿保持。系统打开只记录动作，不启动 GUI 程序。1000 文件的有界列表另有组件回归。代表截图和完整动作指标已保存：

- [40 列交付列表](evidence/2026-10-20/capabilities/deliveries-40-initial.png)
- [40 列中文预览翻页](evidence/2026-10-20/capabilities/deliveries-40-preview-page.png)
- [80 列预览](evidence/2026-10-20/capabilities/deliveries-80-preview.png)
- [120 列列表导航](evidence/2026-10-20/capabilities/deliveries-120-page.png)
- [三种尺寸的 PTY 动作指标](evidence/2026-10-20/capabilities/deliveries-pty-metrics.json)

本机已安装的 `dsh-tui` 进入真实 profile，执行 `/deliveries` 后显示“当前会话暂无显式交付文件”，再返回并正常退出，约 3.95 秒。该验证没有发送模型消息；原始日志位于 `/tmp/dsh-tui-delivery-live-startup.log`，权限 0600，不纳入仓库。

## 未验证

- macOS 实机剪贴板与真实 GUI 查看器启动。
- 联网模型服务及长时间运行。
- schedule 和其余 P1/P2 清单。schedule 必须对接官方 Session Controller 的持久化和唤醒生命周期，不能用单独挂载工具代表完成。

## 阻塞

本批实现和本机入口验证无阻塞；macOS 实机验证需要对应环境。完整未完成范围仍由 [能力清单](capability-gap-roadmap.md) 跟踪。
