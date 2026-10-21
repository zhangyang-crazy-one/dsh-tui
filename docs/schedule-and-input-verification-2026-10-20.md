# Pi 接续开发：定时提醒与输入验收

## 已验证

本批在 `dsh-tui` 实现；上游 checkout 的 `packages/tui` 是构建副本。既有工作区改动保留，没有提交、推送、发布，未修改模型路由、用户凭据或 Pi 配置。

### 官方定时服务与会话生命周期

`tui/src/schedule.ts` 组合官方 `ScheduleService`，并复用固定 DSH 构建版本的 `ApiSessionAgentController` 与模型选择投影。只在定时服务自己的 Context 提供它实际消费的 `resolveAgent`；根 Context 不声明残缺的 `sessionController`，不为提醒挂载浏览器会话 API 或上传传输。

终端切回被定时服务恢复的会话时借用同一个 Agent，官方 resolver 负责并发恢复去重、持久化读取与子会话归属检查。根插件生命周期保有恢复句柄，终端释放借用不会停止后台提醒；新建会话仍使用原来的终端句柄所有权。官方任务记录、调度、投递与回执实现保持原样。

计时器仅在进程运行时工作。重启会加载持久任务并处理逾期任务；正常退出须先刷新当前会话。回执确认提醒消息已持久准入 Agent inbox，不代表模型完成响应。正常重启后的不重复投递已验证；不据此宣称崩溃窗口中的严格恰好一次。

`tui/tests/schedule.spec.ts` 使用真实 Cordis、官方四个工具、JSON 任务存储、JSONL 会话存储、Session 查询、Typert 和真实 Agent Loop，以离线 adapter 替代网络服务，覆盖：

- 创建、列出、更新和删除任务；根 Context 未注册 `sessionController`。
- 切换新会话后，提醒恢复原会话并完成一次离线模型回复。
- 并发恢复只调用一次 resume；终端借用释放不销毁 Agent。
- `/schedules` 实时刷新、确认/取消删除和返回原会话。
- 退出、等待到期、重启补投递，再次启动不重复投递已有回执的任务。

### 定时任务浏览

`/schedules` 使用有界窗口浏览全部会话的任务。Enter 展开完整提示词、规则、时区、任务/会话标识与最近回执；再次 Enter 打开原会话。↑↓、PgUp/PgDn、Home/End 阅读，`r` 刷新；`d` 后 `y` 确认删除，`n`/Esc 保留。已经进入会话的提醒消息不随任务删除。1000 条任务和详情首尾导航有组件及真实终端检查。

### 自定义问答与密钥显示

Ask-user 的队列条目保存逐题答案、多选集合与独立文本缓冲区。仅在整批完成时向官方服务提交全部答案，标签和自定义原文不经过显示文案替换。Space 多选，`c` 编辑自定义回答；无选项问题直接进入编辑器。Tab 阅读完整问题、描述和答案，Tab/Esc 返回编辑；多行粘贴保留换行及光标插入位置，不走图片附件准入，不修改聊天草稿。可选编辑取消返回选项；纯文本问题取消则中止请求。既有 FIFO、审批优先、中止、超时、会话切换清理和计划评审命名选项保留，重复结算不访问已结束的题目。

`secret-input.ts` 仅转换 InputBar 的显示文本及可见光标：凭据编辑器整体遮罩，`/key`、`/login` 保留命令与引用名，密钥参数按字素替换圆点。原始缓冲区继续负责光标、删除、粘贴和提交。Unicode 组合字符与 emoji 光标有测试；真实 Ink 路径同时检查原值提交、终端输出无原值、取消/保存/保存失败后的草稿恢复。

### 会话切换中的选中项

完整回归发现切换完成后、目录刷新完成前错误设置 `selectedIndex = 0`。这会使窗口内的重命名针对第一行。新增测试阻塞真实目录刷新，稳定复现原会话与选中项不一致；修复为保留目标行索引，通过后才重新执行完整回归。

### 自动检查与终端证据

| 检查 | 结果 | 记录 |
| --- | --- | --- |
| `npm run build` | 五个产物构建、导入通过 | `/tmp/dsh-tui-p1-build.log` |
| `npm run dev:setup`、`npm run typecheck` | 依赖声明及四工程严格检查通过 | `/tmp/dsh-tui-p1-{setup,typecheck}.log` |
| 上游 `node node_modules/vitest/vitest.mjs run packages/tui/tui/tests packages/tui/tui-render/tests` | 154 文件、2140 测试通过 | `/tmp/dsh-tui-p1-all-tests.log` |
| `npm test` | 43/43 | `/tmp/dsh-tui-p1-root-tests.log` |
| `npm run pack:check` | 包含 `dist/schedule.js`，预览通过 | `/tmp/dsh-tui-p1-pack.log` |
| `git diff --check` | 通过 | 本次工作区检查 |

真实 OS PTY 使用生产 TuiLoop 与合成服务数据，不调用网络模型：

```sh
python3 scripts/capture-ux-pty.py --scene schedules --columns 40 --rows 16 --output /tmp/dsh-tui-schedules-40
python3 scripts/capture-ux-pty.py --scene secret --columns 40 --rows 16 --output /tmp/dsh-tui-secret-40
python3 scripts/capture-ux-pty.py --scene question-custom --columns 40 --rows 16 --output /tmp/dsh-tui-question-custom-40
```

另以 80×24、120×40 执行相同场景，共 9 组、81 帧。secret 场景逐阶段检查累计原始终端字节不含合成测试密钥；其余覆盖列表、多选、全文首尾、自定义字母输入、保存、取消和草稿恢复。代表截图已人工复核：

- [40 列取消提醒确认](evidence/2026-10-20/schedule-and-input/schedules-40-cancel-prompt.png)、[80 列提醒全文](evidence/2026-10-20/schedule-and-input/schedules-80-details.png)。
- [40 列密钥遮罩](evidence/2026-10-20/schedule-and-input/secret-40-typed.png)、[80 列光标编辑](evidence/2026-10-20/schedule-and-input/secret-80-caret.png)。
- [40 列自定义回答](evidence/2026-10-20/schedule-and-input/question-custom-40-editor-again.png)、[80 列多选](evidence/2026-10-20/schedule-and-input/question-custom-80-selected-second.png)、[120 列全文末尾](evidence/2026-10-20/schedule-and-input/question-custom-120-end.png)。
- [全部 PTY 动作与状态指标](evidence/2026-10-20/schedule-and-input/pty-metrics.json)。

实际本机 `dsh-tui` 已打开 `/schedules`，正常返回并以 0 退出，没有发送模型消息。并行回归负载下本次检查约 7.85 秒，仅作入口可用性证据，不作启动性能基准。原始日志 `/tmp/dsh-tui-schedule-live-startup.log` 权限 0600，不纳入仓库。

## 未验证

联网模型服务、长期运行、跨进程竞争、崩溃提交窗口，以及此前保留的 macOS 实机和 GUI 查看器检查。官方激活助手的源码接口随固定版本打包，上游升级后需要重跑集成测试。其余 P1/P2 事项仍在 [能力清单](capability-gap-roadmap.md) 中跟踪。

## 阻塞

本批实现与本机入口检查无阻塞。
