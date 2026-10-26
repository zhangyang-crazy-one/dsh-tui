本记录复制自根目录 `evidence/scoped-updates-notes.md`，保留原始交接内容。本轮实际重跑/审查/CPU A/B 见 [acceptance-current.md](./acceptance-current.md)；历史 /tmp 引用不保证仍存在。

# Scoped updates — 阶段 4.1–4.3

日期：2026-10-23。职责：`loop.tsx`、新增局部 spinner、`tui/src/index.ts` 的 snapshot/emit 依赖段及对应测试。未改任务复选框、未提交、未发布。工作区存在其他代理改动；index.ts 的 deliverNotify/output 导入属于主代理，本记录不将其计为阶段 4 实现。

## 已验证

### 基线与运行来源

- 本仓库 HEAD：`1d25152831ede97cd2f706967020dd23f1053f1d`。
- 上游 HEAD：`687f282e8625c6b8d11ff58211a90524be2e4317`；DSH `0.2.1-rc.2`。
- Node `v22.23.1`；Vitest `4.1.11`。
- 上游 pnpm-lock.yaml SHA-256：`aa65620058d3c6c21ba006e3008a9990214327aaee3fd5e555497ed1b72a03ed`。
- 测试直接加载本仓库源码，不运行 build，不复制文件至日常上游。主代理临时配置在本环境曾回退至旧 lib 并出现 `invalid plugin`；本代理另存配置加入精确源码 alias，原配置未改。
- 其他代理尚未写完 `history-data.ts` 时曾发生零测试收集，明确不计为产品失败或通过。失败回归改用 `git archive HEAD tui tui-render` 解包至工具目录，再复制新测试：`/tmp/dsh-scoped-baseline-20261023`。

### 先失败再实现

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-baseline-vitest.config.mjs tui/tests/snapshot-identity.spec.ts tui-render/tests/loop-input.spec.tsx -t 'dependency scoped|advances the footer'
```

输出：`Test Files 2 failed (2); Tests 3 failed | 49 skipped (52)`，退出码 1；日志 `/tmp/dsh-scoped-red-final.log`。失败为：普通面板切换重建未变聊天 model；生成事件重建未变 session/search 快照；350ms 静态 generating 观察窗多出 4 次 StreamView 渲染（早期同类采样为 3 次，取决于计时相位）。投影计数不是渲染次数，旧实现对不变历史已有投影缓存，不能声称每次旧 tick 都投影历史。

### 行为变化与 mutation → snapshot 依赖表

不引入新状态框架。保留同一个 listeners 集合、20ms 异步通知和设置选择 microtask 合并；`emit()` 在调度观察者之前比较所有依赖键，只清空变化域。快照 getter 在突变后立即可读，观察者获得一致状态。依赖比较不投影正文、不 tokenize、不枚举 job catalog 或历史；只保存每类最新依赖键（22 类），没有每次突变追加的无界日志。

| Mutation/source | 失效的 snapshot/依赖键 | 无关身份/说明 |
|---|---|---|
| admitted live session event | projector revision；durable session revision；model、依赖 model 的 tool details、session projection HUD/footer/stats/goal；带 callId 的可见 approval arguments | 不影响目录、search、model catalog、settings 等 pane；durable projection 是显式共享域 |
| live assistant stream frame | projector revision → model/tool details；可见 approval 若依赖 callId arguments | 不失效 durable HUD、settings、目录/search |
| interaction / reasoning / tool expansion / compaction expansion | model 的 status、reasoning、toolCardsExpanded、expandedCompactionId；footer 另依赖原始 machine | 纯面板操作不重建 chat model |
| session directory selection / load / close | session id、rows reference、selected row reference/index、open/confirm/deleteUnavailable | selected row key 覆盖会话切换后原地替换 liveRow 的既有路径 |
| search | open/query/results reference/selectedIndex/status | 重置空结果不制造新数组 |
| model catalog | open/filter/rows reference/selectedIndex/status/error | 重置空目录不制造新数组 |
| help | open/lines reference | 独立缓存 |
| tool details | open/selection/body/diagnostics/cursor tail+length/model keys | 覆盖 cursor 栈 push/pop |
| shared blocking FIFO | visible approval/ask entry identity；approval details；ask question/selectedIndex/custom draft+caret/answer/selectedIndices 值；plan review entry+delivery error | 原地多选 Set 内容和自定义编辑均进入依赖；FIFO 移交一次更新三个 slot snapshot |
| permission | open/names/selection/current/confirm/error/descriptions | 独立缓存 |
| settings navigation/edit/apply | open/rows reference/selection/searching/editing/onboarding/busy/error | 保留原有 selection 合并与取消过期 callback；model、目录/search/model catalog/plugins/schedule 身份不变 |
| agent hub / subagent controls | open/rows/selection/view/error/transcript/scroll；既有 controls 回调显式失效；limits 等继续由原 getter 校验 | child timer 同时使 jobs source revision 前进 |
| plan directory | open/selection/currentActive/switch/status error | 独立缓存 |
| workspace tree/preview/deliveries | open/mode/root、原地 Map/Set mutation revision、selection/edit/errors/preview；deliveries 模式额外依赖 projector revision | 不遍历 tree 计算失效键；异步 tree commit 后再通知 |
| feedback pane | open/editing/current/writeError/target id | 普通状态行 feedback 不清空聊天或其他 pane |
| workflow events | workflow revision → workflow HUD + overlay；overlay 另依赖 open/offset/agent | start/phase/member start/end/end 全部覆盖 |
| goal activation | goal revision + bound agent/session projection scope | 按当前 live session 过滤 |
| adaptive footer / retry timer / model choice | durable projection scope、selectionRef.current、machine、retry object + retry revision | retry countdown 不清空其他快照 |
| todo HUD / session stats | durable session projection scope | transient assistant chunks 不失效 |
| jobs lifecycle / child UI batch | jobs revision + bound agent | output-only job event不失效 HUD；既有生命周期订阅保留 |
| plugins/account/schedule | 既有不可变 state 直接作为快照 | closeOtherPanels 不再重建本来已关闭且不需清理的 plugins/schedule state |
| redraw | 清空依赖键，显式全域失效 | 保留 remount 强制刷新契约 |
| spinner tick | 只更新 `GeneratingSpinner` 子树中的 footer 格式化/绘制 | 0 transcript 投影、0 StreamView 渲染、0 composer tokenization、0 settings getter 调用；停止生成/卸载清理时钟 |

`settings-pane-integration` 的统计 fixture 原用 toggle-reasoning 偶然触发全局失效，现改为 durable `turn/start` 事件刷新；没有保留“无关 UI 操作刷新全部投影”的旧测试假设。

主代理后续授权的阶段5接入：`composerHeight(text, rows, rowsBelow=0)` 当前定义在 composer-index.ts，loop 从该实际定义处导入；普通输入未测量 fallback、设置编辑及会话重命名预算改用 `composerHeight(state.text, rows, statusRowCount + 1)`，匹配 InputBar 注入的 rowsBelow。dialog fallback 仍取 rows，inputMeasureKey 及实际测量逻辑不变。

### 相关离线回归

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-current-vitest.config.mjs tui/tests/snapshot-identity.spec.ts tui-render/tests/loop-input.spec.tsx tui/tests/settings-pane-integration.spec.ts tui/tests/approval-answerer.spec.ts tui/tests/ask-user-provider.spec.ts tui/tests/plan-review.spec.ts tui/tests/jobs-hud.spec.ts tui/tests/workflow-hud.spec.ts tui/tests/retry-footer.spec.ts tui/tests/goal-footer.spec.ts tui/tests/model-pane-integration.spec.ts tui/tests/permission-pane-integration.spec.ts tui/tests/workspace-pane-integration.spec.ts
```

输出：`Test Files 13 passed (13); Tests 228 passed | 1 skipped (229)`，退出码 0，29.11s；日志 `/tmp/dsh-scoped-targets-final.log`。唯一 skipped 是默认关闭的 CPU benchmark，另有显式运行证据如下。

新增审批测试同时断言 observer 的 generating/approval cut、一致关闭审批、settings 不抢审批焦点、展开详情不重建 model；原有 ask-user/plan-review FIFO、jobs/workflow/retry/goal/model/permission/workspace 回归通过。

此后加强 spinner 的无关 pane getter 计数，单独重跑：

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-current-vitest.config.mjs tui-render/tests/loop-input.spec.tsx -t 'generating animation scope|stops the local spinner'
```

输出：`1 passed; 2 passed | 44 skipped (46)`，退出码 0；日志 `/tmp/dsh-scoped-spinner-final.log`。只选择2项目标测试，其余44项为筛选排除，不冒充执行。

接入 composerHeight 后重跑：

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-current-vitest.config.mjs tui-render/tests/loop-input.spec.tsx tui-render/tests/viewport-command-interleaving.spec.tsx tui-render/tests/loop-mouse.spec.tsx tui-render/tests/loop-selection.spec.tsx tui-render/tests/input-bar-window.spec.tsx
```

输出：`Test Files 5 passed (5); Tests 78 passed | 1 skipped (79)`，退出码0，22.93s；日志 `/tmp/dsh-scoped-height-final.log`。

### 同环境操作量与 CPU

固定 fixture：100 条静止 user 历史，800 UTF-16 单元 `草稿draft ` 重复100次；fake TTY Ink mount，generating 状态固定，无新内容或几何事件。预热1000ms后连续3个1000ms窗口，`process.cpuUsage()` 测进程 CPU user/system；统计真实函数调用。没有 OS PTY、真实模型或端到端按键时延。

隔离 A/B 都由同一 HEAD 解包，并共享同一上游依赖。A 仅加入同一个测试，B 仅替换本阶段的 loop/spinner/runtime 文件，保留相同旧 composer/history。因此不把其他代理阶段5/6优化混入动画 CPU 对照；高度预算接入发生在这次动画 A/B 之后。

已核对 A/B 的 stream-view.tsx SHA-256 同为 `e8ce2ad95db9601d6c8a2c3ddf3dbe4381226be78c7804476b5eef38533384f1`，input-bar.tsx 同为 `fda9de5356354d1cbf057dfd82acde53674567f198d742b4c6ba25d36687a44f`。测量 B 的 loop SHA-256 `a8a28672d2544d90d159452136a74df1dd80889437f5b35637769331b965f355`，spinner `62e4719b5a9954462803049a77aac5c53ce73c457c3fd66b4b6ec2a4a27aa578`；A/B 共用测试 hash `4c12c6aa4c050bc5c3deec545aa30bdfd0e7328281c2b36b12f5f714c8a840f9`。该 hash 是加入后续 pane getter 断言之前的 benchmark fixture。

```bash
DSH_SCOPED_BENCH=1 DSH_SCOPED_BENCH_OUTPUT=/tmp/dsh-scoped-baseline-cpu-final.json node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-baseline-vitest.config.mjs tui-render/tests/loop-input.spec.tsx -t 'records scoped animation'
DSH_SCOPED_BENCH=1 DSH_SCOPED_BENCH_OUTPUT=/tmp/dsh-scoped-after-cpu-final.json node node_modules/vitest/vitest.mjs run --config /tmp/dsh-scoped-after-vitest.config.mjs tui-render/tests/loop-input.spec.tsx -t 'records scoped animation'
```

两次均退出码0，`1 passed | 45 skipped (46)`，仅选择 benchmark；日志为同名 `*-cpu-final.log`。

| 版本 | 样本 | wall ms | CPU user ms | CPU system ms | CPU总计 ms | StreamView render | composer tokenize | block projection | spinner函数调用 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| HEAD | 1 | 1000.721 | 417.578 | 72.557 | 490.135 | 10 | 10 | 0 | 20 |
| HEAD | 2 | 999.935 | 432.563 | 65.981 | 498.544 | 10 | 10 | 0 | 20 |
| HEAD | 3 | 1000.111 | 458.913 | 75.435 | 534.348 | 10 | 10 | 0 | 20 |
| scoped spinner | 1 | 1000.328 | 238.545 | 70.791 | 309.336 | 0 | 0 | 0 | 10 |
| scoped spinner | 2 | 1000.259 | 226.497 | 73.707 | 300.204 | 0 | 0 | 0 | 10 |
| scoped spinner | 3 | 1000.620 | 214.985 | 71.761 | 286.746 | 0 | 0 | 0 | 10 |

CPU总计中位数：HEAD **498.544ms**，scoped spinner **300.204ms**。这是同机合成采样的进程 CPU 时间，受 JIT/GC 和机器并行负载影响，不设耗时硬门槛，不推断真实设备提升百分比。spinner 列为 getBrailleSpinnerFrame 调用次数，不是终端实际完成帧数；优化后每个窗口10次，动画继续推进。旧版 block projection 已为0，本次证据的直接收益是移除不必要的父组件 render/tokenize，而非虚构“从全量历史投影降到0”。

### 类型和静态检查

```bash
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
git diff --check
```

renderer sources/tests 类型检查退出码0（`/tmp/dsh-scoped-render-tsc-final.log` 为空），diff 检查退出码0。

## 未验证

- 本代理未执行完整工程门禁、构建打包、真实认证/模型调用、真实 PTY/分钟级 soak、现场根因闭环。主代理负责集成重跑；本记录仅证明阶段4及授权高度预算接入的离线范围。
- 外部 mutable source 后续新增 mutation 时，必须更新本表与 revision/依赖键，不能依靠任意 emit 的全局失效兜底。当前 source revisions 覆盖 durable session、transient projector、goal、jobs/child、workflow、workspace Map/Set 和 retry；不宣称自动追踪未知服务的任意原地写入。

## 阻塞

无。曾发现通知 helper 要求完整 WriteStream，而 TuiIo.stdout 只有 write(string):boolean；主代理已将 helper 参数收敛为实际 write 契约，本代理未修改其通知函数或 terminal-output.ts。

修正后已重跑：

```bash
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p /tmp/dsh-scoped-runtime-tsconfig.json
git diff --check
```

三个命令均退出码0；`/tmp/dsh-scoped-render-tsc-height.log` 和 `/tmp/dsh-scoped-runtime-source-tsc-verified.log` 为空。前者在 composerHeight 接入之后运行。runtime 临时配置如下，使类型检查读取当前 renderer 源码而非日常上游的陈旧 declarations，不生成声明、不覆盖上游：

```json
{
  "extends": "/home/zhangyangrui/my_programes/dsh-tui/tui/tests/tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@deepseek-ai/dsh-tui-render": [
        "/home/zhangyangrui/my_programes/dsh-tui/tui-render/src/index.ts"
      ]
    },
    "typeRoots": [
      "/home/zhangyangrui/my_programes/dsh-tui/node_modules/@types"
    ],
    "jsx": "react-jsx"
  }
}
```

直接使用旧 tui/tests/tsconfig.json 曾因陈旧 renderer declarations 报缺少 writeTerminalControl export；初次 source-alias 检查暴露的3处 notify 参数错误保留在 `/tmp/dsh-scoped-runtime-source-tsc-complete.log`，均属于历史失败记录，不计为通过证据。

## 临时测试配置与当前文件身份

以下为本代理配置正文。baseline/after 配置只把 root 和 cacheDir 换为对应工具目录，所有 dependency aliases 相同。

```js
import {createRequire} from 'node:module'
const root='/home/zhangyangrui/my_programes/dsh-tui'
const upstream='/home/zhangyangrui/my_programes/deepseek-harness'
const require=createRequire(upstream+'/package.json')
const {default:tsconfigPaths}=await import(require.resolve('vite-tsconfig-paths'))
const ts=require('typescript')
const fs=require('node:fs')
const paths=ts.parseConfigFileTextToJson(upstream+'/tsconfig.base.json',fs.readFileSync(upstream+'/tsconfig.base.json','utf8')).config.compilerOptions.paths
const aliases=Object.entries(paths).filter(([name])=>!name.includes('*') && name!=='@deepseek-ai/dsh-tui-render').map(([name,targets])=>({find:new RegExp('^'+name+'$'),replacement:upstream+'/'+targets[0]}))
const {standardDecoratorPlugin}=await import(upstream+'/vitest.shared.ts')
export default {
 root,
 cacheDir:'/tmp/dsh-scoped-current-vite-cache',
 plugins:[standardDecoratorPlugin(),tsconfigPaths({projects:[upstream+'/tsconfig.base.json']})],
 resolve:{alias:[{find:/^@deepseek-ai\/dsh-tui-render$/,replacement:root+'/tui-render/src/index.ts'},...aliases]},
 test:{include:['tui/tests/**/*.spec.{ts,tsx}','tui-render/tests/**/*.spec.{ts,tsx}'],pool:'threads',maxWorkers:2,testTimeout:15000,hookTimeout:30000}
}

```

记录时当前文件 SHA-256（index.ts 同时含主代理 notify 改动）：

```text
edd3e4706cfcab16dfdf30197f3acae28adec526a86ac8aa7b35412f0ef7e9ef  tui-render/src/loop.tsx
62e4719b5a9954462803049a77aac5c53ce73c457c3fd66b4b6ec2a4a27aa578  tui-render/src/generating-spinner.tsx
1c4881aba024eae1a0e85d3adc7d4c1a0b3c3babe3b5c7ed1708669b4f3a0483  tui/src/index.ts
e3fb4d39733ec6ea55d4e82b6fefc9689d815ddecf2fd68e69ed2333957b9b85  tui-render/tests/loop-input.spec.tsx
5b1d896b68bf239b77a48dc5e248bc4d67f93d36041cc47fe531b7020adb5ce0  tui/tests/snapshot-identity.spec.ts
396bac91fa060b277ffeeb3a44403b2a8bfaaa52d25efd5b07083b67a0c49fe1  tui/tests/settings-pane-integration.spec.ts
e4ec28794ce640f86dbaa98aec6473b1f2f91bce4a31ae93f4371c81352d8bb5  tui/tests/approval-answerer.spec.ts
```
