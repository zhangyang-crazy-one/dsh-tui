# LSP 与测试修复记录

日期：2026-10-20。匹配上游：dsh `0.2.1-rc.2`。

## 已验证

### 修复与实施顺序

1. 独立仓库的 `tsconfig.json` 不再引用不存在的上游相对目录，保留 strict、索引访问和精确可选属性等检查。
2. 用 `tsconfig.workspace.json` 保留上游项目引用；构建脚本只在挂载进上游时使用它。`dev:setup` 生成真实依赖声明、链接整个依赖目录，保持 pnpm 相对链接有效。
3. 给测试建立独立 TypeScript 项目。修复缺少的夹具字段、品牌类型、可选值处理、元组参数、依赖声明和跨仓库路径。测试适配器继续使用真实 PassThrough 流。
4. 修复测试的 Ink 退出等待顺序，避免卸载后才注册 `beforeExit` 监听器。
5. Markdown 和思考块在父级已提供宽度时直接使用该宽度，消除每条消息重复订阅 `resize`；未提供宽度时保留 Ink 的尺寸订阅。
6. 增加两项真实监听器回归检查。修复前分别复现额外一个 `beforeExit` 监听器和额外两个 `resize` 监听器；修复后通过。

### 验证结果

| 检查 | 结果 |
| --- | --- |
| 全新 `typescript-language-server`，逐文件 semanticDiagnosticsSync | 257 个源码和测试文件，0 错误、0 警告 |
| `npm run typecheck` | 4 个严格 TypeScript 项目全部通过，覆盖源码与测试 |
| `npm run build` | 4 个发布入口打包和导入检查通过 |
| `npm run dev:setup` | 上游项目引用及测试依赖的声明构建通过 |
| 上游 checkout：`npx vitest run packages/tui` | 147 个文件，2073 项测试通过，退出码 0 |
| 性能门禁 | 完整套件中的大历史渲染时间、可见行挂载上限、增量解析及缓存边界检查通过 |
| 监听器警告 | 最后一次完整测试中 `MaxListenersExceededWarning` 为 0 |
| `npm test` | launcher 40 项通过 |
| `npm run pack:check` | 14 个发布文件，无 node_modules |
| `git diff --check` | 通过 |
| 本地依赖目录忽略规则 | 根目录及两个子包的 node_modules 符号链接全部被 Git 忽略 |

原始验证日志保存在本次机器的 `/tmp/dsh-tui-{typecheck,build,dev-setup,fresh-lsp,vitest-final,launcher-tests,pack}.log`；新鲜 LSP 报告为 `/tmp/dsh-tui-fresh-lsp-report.json`。这次没有调整监听器告警阈值或关闭 TypeScript 检查。

### 后续开发命令

依照 README 的顺序运行 build、上游 pnpm install、dev:setup，然后执行 `npm run typecheck`。上游镜像包继续使用 workspace 配置，本仓库编辑器使用独立配置。上游 pnpm-lock.yaml 的本地变化用于链接插件新增的测试依赖。

## 未验证

本轮没有重新进行真实账号、联网模型或持续运行数小时的终端验证。上述性能结果来自本地自动化测试。

TypeScript 的零诊断不代表所有第三方风格扫描器均零提示。ANSI 测试正则会有控制字符规则提示；已核实其中一处为测试所需的 ESC 匹配并标记误报。Node 22 的 SQLite ExperimentalWarning 和上游 Vite 配置迁移提示仍会出现，不属于 TypeScript 诊断。

## 阻塞

无。
