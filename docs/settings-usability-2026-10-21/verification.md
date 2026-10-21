# Settings 显示与操作改进

基线：`9f846ff`（npm `0.1.0-alpha.51` 发布后的记录）。工作分支：`fix/settings-usability`。本记录描述 `0.1.0-alpha.52` 发布前的实现验收。

## 已验证

| 问题 | 当前行为 |
|---|---|
| 分类切换仅藏在页脚 | 显示分类栏，当前分类带方括号和强调色；窄屏保留当前分类及左右隐藏提示 |
| 选中行仅有小箭头 | 整行使用不同背景，保留箭头和粗体，普通行与选中行清楚区分 |
| 长值与来源被截断 | 表格下方提供有行数上限的详情；搜索时显示选中字段的 namespace 和完整来源路径 |
| 换类后丢失深层位置 | Tab / Shift+Tab 恢复每类最后访问的对象及选择；删除节点后回到有效父层 |
| 搜索无法直接移动结果 | 搜索中支持方向键、翻页、首尾跳转；Enter 完成搜索保留当前选择；Esc 清除后恢复原位置 |
| 所有行使用同一操作说明 | Enter 进入对象、编辑字段或切换已支持的布尔/枚举值；只读项不显示可修改操作，Right 仅进入分支 |
| 设置输入框仍提示发送消息 | 编辑框显示“设置值 · Enter 保存 · Esc 取消”，不显示聊天模型标签 |
| 快速操作触发并发设置写入 | 官方设置写入期间保持 busy，忽略重复提交、换位与取消；成功和失败均释放 busy |

继续使用官方 `settings.describe/update` 和 credentials 服务。嵌套编辑保留未知字段，秘密字段及含秘密对象的整体编辑规则不变。本次没有创建另一份配置读取器。

### 终端验证

生产 `TuiLoop` / `mountTuiRender` 在 OS PTY 中运行；settings 服务与数据为合成 fixture，包含 25 个 Provider、每个 65 个模型。测试脚本为 [check-settings-tabs-pty.py](../../scripts/check-settings-tabs-pty.py)。

40、80、120 列均完成 12 个步骤，共 36 个检查点：初始分类、Provider 列表、模型字段、换类、恢复原字段、搜索移动、确认搜索、清除搜索、编辑、保存 `131072`、长值输入、取消长值编辑。结果见 [pty-results.json](pty-results.json)。在 xterm headless 中回放真实 PTY 字节，主代理检查了窄屏、搜索、宽屏及编辑状态画面：

- [40 列 Provider 列表](40-providers.png)
- [40 列长值编辑](40-long-value-editor.png)
- [80 列搜索结果](80-search.png)
- [120 列保存结果](120-saved.png)

布局回归另覆盖 4/6/8/12 行预算，检查选中值、错误和动作提示不超出宽高；无色模式保留当前分类标记。

### 验证命令

- `npm run build`：五个 bundle 构建和导入通过，基于 DSH `0.2.1-rc.2`。
- `npm run dev:setup`、`npm run typecheck`：四个严格源码/测试检查项目通过。
- `npm test`：46 项 launcher 测试通过。
- `npm run pack:check`：打包检查通过。
- `openspec validate settings-tab-usability --strict`：通过。
- `node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests --maxWorkers 2`：174 个文件、2,325 项测试全部通过。主代理在官方源码镜像目录独立执行并核对结果。

[source-sha256.json](source-sha256.json) 记录源码与本地 `dist/index.js`，构建、类型检查与 launcher 日志保存在本目录。原始 PTY 文件保留于 `/tmp/dsh-settings-usability/final-{40,80,120}/`。

## 未验证

- 用户正在运行的进程未重启或热重载；本地新构建需重新启动或在源码链接安装中执行 `/reload` 才能载入。
- PTY 使用合成服务，不等同于联网模型认证或所有终端设备验收。分类切换按 Tab / Shift+Tab 验证，本次没有新增鼠标点击分类控件。

## 阻塞

无。
