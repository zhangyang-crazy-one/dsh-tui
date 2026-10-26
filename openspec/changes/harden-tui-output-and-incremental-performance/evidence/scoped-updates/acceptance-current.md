# 阶段 4 独立复核（2026-10-23）

## 已验证

原始阶段4交接记录完整复制为 [scoped-updates-notes.md](./scoped-updates-notes.md)，含 mutation→snapshot 22 类依赖表。该表已对照当前 `tui/src/index.ts` 的 getters、invalidateSnapshots、source revisions 和相关 mutation 路径审查，本轮未修改 runtime、loop、spinner 源码。composer后续仅修复InputBar外部caret与CRLF End边界，见 ../composer/acceptance-current.md。

审查核对：projector 的 durable/stream revision 分离；session 切换用 session/projector 对象身份；审批 callId arguments 跟随 projector；ask-user 原地 Set/question/custom caret 字段进入键；settings navigation 每次同步新 rows，selection 仍 microtask 合并；workspace Map/Set 每条写路径有 revision；workflow start/phase/member/end、jobs/child、goal 和 retry 有独立 revision；redraw 清空依赖键后强制全域刷新；emit 在异步订阅者回调之前统一失效。未发现需要新增生产改动的依赖漏项。表不是自动追踪未知服务原地突变的机制，后续新增 mutation 仍须维护键/revision。

### 当前源码针对性测试

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui/tests/snapshot-identity.spec.ts tui/tests/settings-pane-integration.spec.ts tui/tests/approval-answerer.spec.ts tui/tests/ask-user-provider.spec.ts tui/tests/plan-review.spec.ts tui/tests/jobs-hud.spec.ts tui/tests/workflow-hud.spec.ts tui/tests/retry-footer.spec.ts tui/tests/goal-footer.spec.ts tui/tests/model-pane-integration.spec.ts tui/tests/permission-pane-integration.spec.ts tui/tests/workspace-pane-integration.spec.ts
```

最终配置已加入 runtime/render 的精确当前源码 alias，保留 upstream paths、tsconfigPaths 和 standardDecoratorPlugin。`runtime-targets-exact-alias.log`：12 files passed、183 tests passed，退出码0，12.03s。首轮配置 runtime tests 已直接相对 import 当前 runtime，但为消除其他包入口回退的疑义，补精确 alias 后重新运行，未复用首轮通过结论。

本轮 composer/loop 11文件261通过的运行也包含 spinner 局部计数、停止/卸载清理测试，见 ../composer/composer-targets-current.log。其后发现并经授权修复 composer 新边界回归。最终 **Node24 23文件448 passed / 1 skipped**（composer/loop 11文件 + runtime 12文件），退出码0，25.55s，见 `targets-node24-final.log`。最终renderer/runtime两项Node24 tsc均退出码0，无诊断，分别见composer/render-types-node24-final.log、runtime-types-node24-final.log。

```sh
node node_modules/typescript/bin/tsc --noEmit -p /tmp/dsh-composer-phase5/runtime-tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
```

两命令均退出码0，无诊断，见 `runtime-types-current.log` 和 `../composer/render-types-current.log`。runtime tsconfig 对 renderer 也使用当前源码 alias，未生成 lib/declarations。未采信或替代主代理的四项目完整门禁。

### 同环境独立 A/B CPU 与操作量

```sh
DSH_SCOPED_BENCH=1 DSH_SCOPED_BENCH_OUTPUT=/tmp/dsh-composer-phase5/scoped-baseline-cpu.json node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/scoped-baseline.config.mjs tui-render/tests/loop-input.spec.tsx -t 'records scoped animation'
DSH_SCOPED_BENCH=1 DSH_SCOPED_BENCH_OUTPUT=/tmp/dsh-composer-phase5/scoped-after-cpu.json node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/scoped-after.config.mjs tui-render/tests/loop-input.spec.tsx -t 'records scoped animation'
```

两命令均退出码0：1 file / 1 test passed / 45 test filtered skipped。固定100条静态历史、800 UTF-16草稿、生成中，无新delta/几何事件，预热1000ms后3个1000ms窗口；fake TTY，不是OS PTY。原始样本见两个 cpu.json。A/B由同一HEAD archive重建，旧stream-view/input-bar字节身份相同，只接入当前loop + spinner及其高度helper依赖；source identity见 scoped-ab-source-identity.json。完整重建说明见 ../composer/reproduce-current.md。

| 版本 | 样本 | wall ms | CPU user ms | CPU system ms | CPU总计 ms | transcript render | tokenize | projection | spinner函数调用 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HEAD | 1 | 1000.452 | 399.450 | 72.301 | 471.751 | 10 | 10 | 0 | 20 |
| HEAD | 2 | 1000.291 | 361.262 | 53.345 | 414.607 | 10 | 10 | 0 | 20 |
| HEAD | 3 | 1000.450 | 372.602 | 56.415 | 429.017 | 10 | 10 | 0 | 20 |
| scoped spinner | 1 | 1001.075 | 234.360 | 60.891 | 295.251 | 0 | 0 | 0 | 10 |
| scoped spinner | 2 | 1000.828 | 195.642 | 53.173 | 248.815 | 0 | 0 | 0 | 10 |
| scoped spinner | 3 | 1000.419 | 201.252 | 72.065 | 273.317 | 0 | 0 | 0 | 10 |

CPU总计中位数429.017ms → 273.317ms。当前主代理可能并行跑完整validate，机器负载/JIT/GC影响耗时；不作为硬阈值，不推断真实设备提升百分比。spinner是格式化函数调用，不是实际输出帧；投影基线已经为0，收益是移除无谓父组件render/tokenize，不声称消除了原本不存在的每tick历史投影。

## 未验证

完整离线validate、产物哈希/打包、native构建、真实会话、物理终端、五分钟soak、现场根因由主代理独立验证，本记录不将消息中的主代理报告当作本代理已核实。外部服务后续新增任意原地写入并非自动受本依赖表追踪。

## 阻塞

阶段4本轮范围内无阻塞，无生产修复需求。阶段5两处字素边界失败已获授权并修复、通过Node24针对性回归，源码已重新冻结供主代理最终validate，见 ../composer/acceptance-current.md。未改tasks、未提交。
