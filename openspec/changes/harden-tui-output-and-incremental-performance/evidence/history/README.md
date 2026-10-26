# History 阶段 6 / 7.1 / 7.2 交付证据

状态：**已验证**（下面列明的离线、合成与受控 GC 边界）；**未验证**（真实终端硬件时延、长期生产堆趋势）；**阻塞**：无。源码和测试已冻结，不 commit、不勾任务。最后实际产品/测试写入仅 `tui-render/src/stream-view.tsx`、`tui-render/src/history-data.ts`、`tui-render/tests/stream-history.spec.tsx`；其余历史实现为接续已有共享改动，保留未回滚。

## 验收结论

| 项 | 结论与实际证据 |
| --- | --- |
| 6.1 | **已验证 / PASS**：active 读穿覆盖层；dirty descriptor 更新。100/1,000/10,000 各三轮、每轮五个固定 delta 均无历史 signature 扫描；实际外部 descriptor iterator/value visits 固定为 5/10，内部 dirty 更新 5 次。 |
| 6.2 | **已验证 / PASS**：八个展示请求在 projector 前合并成一次，canonical 所有 delta 保留；结算内容用直接 `projectBlockRows` 的独立同步 oracle 核对，不只用另一个优化 StreamView 对比。 |
| 6.3 | **已验证 / PASS**：精确后缀先形成首帧，后台每批 256 条；generation 对 source/width 判旧；未知前缀无假高度，oldest/position 命令先准确补齐索引。 |
| 6.4 | **已验证 / PASS（合成边界）**：三档工作量与首帧；80×24/120×40 detached anchor、oldest、resize/source replacement；既有 stream-view、compaction-divider、viewport-command、overscan/scroll 套件通过。实际设备 p95 50ms/展开 100ms 未重新测量。 |
| 7.1 | **已验证 / PASS**：有效 owner/scope 回收、64 个 projector key 上限；本轮修复长期 store/listener/disposer 闭包持有首次 render 环境的问题，同 scope canonical 替换时清理 tool/plain/presenter 派生索引。生命周期表见下。 |
| 7.2 | **已验证 / PASS（受控样本）**：行/投影预算、必要 pins、有效元数据和展示队列分层；1,000 及 10,000 条 GC/snapshot 回收对照均确认旧 canonical collectible。不是全堆硬预算、不是生产无泄漏证明。 |

本代理亲自执行：`targeted-final.log` **15 文件 / 266 passed**；最后纯缩进冻结后 `frozen-source-regression.log` **1 文件 / 8 passed**。主代理另行告知最终完整 gate：**181 文件、2,399 passed、1 skipped，4 个 TS 项目、5 bundles、pack imports、hash provenance PASS**；该完整门禁由主代理执行，本报告不把它冒充本代理独立重跑。主代理独立结果另见 `parent-independent-benchmark.json`（如已拷入）；其最终 heap `/tmp/dsh-history-parent-final.json` 为 `oldCanonicalOwnerCollected:true`、retired analysis 的 `oldestCanonicalObjects:0`，属于主代理独立证据。

## Owner / scope / pin / cleanup

| 层 / 索引 | owner 与 scope | pin / 预算 | 清理事件 |
| --- | --- | --- | --- |
| canonical `history` / active turn | runtime 会话；renderer 只读 | 不由 renderer 驱逐；按 entry 数量单列 | runtime 替换/压缩；renderer 不修改 canonical |
| `ExactHistoryWindow` + transcript / exact directory | 单个 StreamView，immutable source 与 width/theme/fold/locale revision | 初始精确 64 条（或几何要求更大）；后台每批 256；最终 O(N) 有效目录 | source/scope 更新递增 generation，旧 timer 无法重新入库；unmount 释放 |
| `settledProjectionCache` / signature / sticky / row directory | transcript owner ID + display revision + geometry/fold/presenter scope | 有效 metadata O(N)，不是 evictable physical-row budget | 非追加更新重建有效集合；scope 变更清空；unmount 清空 |
| `HistoryRowCache` materialized Markdown rows | StreamView；owner/block；源和精确 height 的 rebuild descriptor 独立保留 | renderer cache 行/字节预算；visible+overscan+anchor owner 和一次 rebuild transient 可 pin，超额单列；旧同 owner revision 受 LRU 预算约束 | retainOwners 移除过期 owner；scope clear；unmount clear；源-backed rows 可重建 |
| `TranscriptRenderStore` entries / physical rows | block ID + source + scope/revision | 同一 policy 独立的行/字节预算；active/visible/overscan/anchor pins 必要时可超额 | dirty block 更新；remove/retain 一并删除 source/rows/pin/active handle；reset 清空 |
| `rebuildBlocks` / previous active descriptors | 当前有效 block ID | 最小恢复 metadata，不冒充零成本；O(有效 blocks) | active owner 消失逐块 remove；settled 集合变更 retain；unmount clear |
| `activeLineRevisions` | 当前 active block + scope | active 必须 resident；revision handle 单独生命周期 | replace/settle/discard、owner retirement、unmount |
| `DisplayRevisionIndex` | WeakMap<object, fields/version> | 无强 owner 目录；`revisionOwners:0` 表示没有额外强引用目录，不表示 WeakMap 内没有存活项 | owner 不再强引用即可 GC；不枚举 WeakMap |
| projector states / source aliases | StreamView，block+归一化 scope；streaming→settled 可转移 | 最多 64 个 key；source alias 仅当前 retained state；touched stats 用 WeakMap | LRU evict 同步删除 alias；owner/scope retirement 清除；unmount clear |
| tool/plain/presenter caches | StreamView；tool call/source、width/fold/locale/presenter identity | tool entry/row policy、plain row/byte policy、presenter capacity，各层独立有界 | canonical source 替换或 scope 变更 clear；对应 cache owner unmount clear |
| layout heights / physical-line memo | StreamView geometry+revision；row object 的 WeakMap | height 是有效 metadata；physical memo 随 weak row owner | settled owner/scope 更新清 layout；unmount clear；weak row GC |
| callbacks / disposers / store rebuild closure | renderer lifetime | 只持 current callback ref 或 detached cleanup 参数 | current callback 每次 render 更新，避免首次 `history` 被长期闭包保留；dispose 解监听 |
| presentation queue | frame arbiter，当前 canonical snapshot 展示请求 | 同时一个未开始展示请求；canonical delta 不丢 | 投影前 flush 过时请求；idle/settle flush；dispose |
| pending stdout frames | frame/terminal-output owner（本代理范围外） | 与 presentation queue 不是同一统计；由阶段 7.3 验收 | 本报告不声称已验证 slow sink/output 预算 |

`signatures` 已从写死 0 改为实际 settled signature owner 数；新增 line-store `pinnedRows/pinnedBytes/overBudgetRows/overBudgetBytes` 和 tool-cache occupancy。`settledMapCopies:0` 是实现声明，外部 iterator 计数和 overlay 无枚举测试用于交叉验证，不能单凭这个常量作证。projection estimatedBytes 与 physical cachedBytes 不是 V8 retained heap，不能简单相加冒充总堆预算。canonical payload/source、O(N) 有效目录、必要 pins、各层可驱逐数据分别解释。

## 基准与首屏方案比较

同一 fixture：中文、emoji、Markdown、两段文本；80×24；Node v22.23.1；current/baseline 各规模各三轮，每轮五个固定 delta。baseline 取 HEAD 的 stream-view/line-store，其余源码与依赖保持 current；属于历史实现隔离对照，不是整个旧版本 bundle。原始样本见 `benchmark-baseline.json`、`benchmark-final.json`；源码哈希见 `source-identity.json`。

| 历史条数 | baseline 首帧中位 ms | current 首帧中位 ms | 首帧已索引 | current 全索引中位 ms | delta 等待样本中位 ms |
| --- | --- | --- | --- | --- | --- |
| 100 | 14.15 | 10.95 | 64 | 17.33 | 24.78 |
| 1,000 | 163.92 | 15.51 | 64 | 154.27 | 24.25 |
| 10,000 | 2404.11 | 24.98 | 64 | 2462.51 | 25.45 |

首帧时所有 current 样本 pendingEntries > 0；10,000 条的首帧为 64 已索引 / 9,936 pending。五 delta 外部计数 baseline 随 N 增长：iterator 505/5,005/50,005，values 1,010/10,010/100,010，JSON 520/5,020/50,020；current 全部固定 iterator=5、values=10、JSON=15，内部 settledSignatures delta=0、descriptorVisits=5、projectedRequests=5。JSON 总数包含合法的 Ink/layout 调用，不等同历史 JSON 签名次数。

**选择精确分批后缀，而非依赖同宽度暖缓存首屏**：`cacheCandidate` 给出独立纯 projector 原型，cold 必须投影 N 条后才获得精确 height，warm 只需 N 次 lookup/0 次 projection，但要求先持有同 source/width 数据，对首次打开无帮助。当前方案冷启动只投影必要精确后缀，保留准确滚动语义。warm 原型不是 mounted 首帧的实测数，不能把 lookup 时间对比 mounted frame。

这些时延来自 PassThrough-backed Ink，**不是 PTY 输入或设备启动延迟**；delta 样本刻意含约 20ms 等待，不能用来宣称 p95 门槛。冷热 JIT 与主代理并行完整 gate 可能影响墙钟时间，主要结论来自操作量与正确性。全量目录最终仍有 O(N) 构建/布局数组，未声称 renderer 的每项开销都变成 O(1)。

## 受控 heap：先失败，再修正，再回落

每组：mounted renderer → 完整后台索引 → 五次 active delta → exposed GC/snapshot → 同一 mounted 生命周期五次 history replacement/80↔120 resize → 多个事件循环与 GC → retired snapshot。1,000 默认 policy；10,000 另用 4,096 rows / 4 MiB 每层预算迫使物理/Markdown 行 eviction，canonical 和有效目录仍存活。

| 报告 | 初始 canonical | heapUsed populated → retired bytes | oldCanonicalOwnerCollected | retired projectionOwners / lineEntries |
| --- | --- | --- | --- | --- |
| `heap-current.json` | 1,000 | 37,293,520 → 33,698,800 | false | 1 / 2 |
| `heap-budget.json` | 10,000 | 76,494,080 → 63,355,928 | false | 1 / 2 |
| `heap-fixed.json` | 1,000 | 37,173,776 → 31,389,840 | true | 1 / 2 |
| `heap-budget-fixed.json` | 10,000 | 76,647,160 → 40,422,624 | true | 1 / 2 |

修正前 snapshot 最短强引用路径：`stdout.resize → onResize → FiberNode.updateQueue → effect.inst.destroy → closure context.history → first canonical object`。缓存 occupancy 下降不足以证明回收，这条路径实际失败；见 `heap-retired-analysis.json`。修正后重建回调、scheduler listener、disposer 使用 current callback ref 或脱离组件首次 render 的闭包，旧 canonical 在两档样本中均被 GC。`heap-fixed-retired-analysis.json` 与 `heap-budget-fixed-retired-analysis.json` 对旧对象计数/强根路径作独立检查；主代理又独立确认 0 旧 canonical。

10,000 的小预算样本中，populated 有 10,000 projection metadata owner、10,001 line source entries，但 Markdown materialization 1,365 entries / 4,095 rows、physical 4,096 rows；retired 回到 1 projection owner、2 source entries、2 physical rows，必要 pins=2，pending presentation=0，超预算=0。说明物理行 eviction 不会让其他有效源/height目录凭空消失。`heapUsed` 是进程整体 GC 后数值（包含 React/Ink/parser 等），analysis 的 class/self_size 是 shallow size，**未计算 dominator retained size，不作逐层 retained-byte 归因或长期无泄漏承诺**。

Snapshots 全部仅为合成 fixture，不含用户会话。原始文件 gzip 后保留，`snapshot-sha256.json` 同时记录解压前/压缩后 SHA-256 和大小；analysis 可直接读 `.heapsnapshot.gz`。分析中列出的原始路径可对应到同名 `.gz`，无需把大原始文件重新放进仓库。

## 复现命令（仓库根目录）

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-tui-apply-vitest.config.mjs tui-render/tests/history-data.spec.ts tui-render/tests/stream-history.spec.tsx tui-render/tests/transcript-line-store.spec.ts
DSH_HISTORY_COUNTS=100,1000,10000 DSH_HISTORY_REPEAT=3 DSH_HISTORY_REPORT=/tmp/history-current.json TSX_TSCONFIG_PATH=tui-render/tsconfig.json node --import tsx tui-render/tests/history-benchmark.tsx
node openspec/changes/harden-tui-output-and-incremental-performance/evidence/history/prepare-baseline.mjs
DSH_HISTORY_SOURCE_ROOT=/tmp/dsh-history-baseline/src DSH_HISTORY_COUNTS=100,1000,10000 DSH_HISTORY_REPEAT=3 DSH_HISTORY_REPORT=/tmp/history-baseline.json TSX_TSCONFIG_PATH=tui-render/tsconfig.json node --import tsx tui-render/tests/history-benchmark.tsx
DSH_HISTORY_COUNTS=1000 DSH_HISTORY_REPEAT=1 DSH_HISTORY_HEAP_DIR=/tmp/history-heap DSH_HISTORY_REPORT=/tmp/history-heap.json TSX_TSCONFIG_PATH=tui-render/tsconfig.json node --expose-gc --import tsx tui-render/tests/history-benchmark.tsx
python3 openspec/changes/harden-tui-output-and-incremental-performance/evidence/history/analyze-heap.py openspec/changes/harden-tui-output-and-incremental-performance/evidence/history/heap-fixed/history-retired.heapsnapshot.gz
```

小预算 10,000 复现使用已保存的 `heap-budget-probe.tsx.txt`：这是现有 history-benchmark 的临时副本，仅把源码路径转成绝对路径并传入 `{...renderPolicyDefaults(), cache:{maxRows:4096,maxBytes:4194304}}`；放入有 `type:module`、`jsx:react-jsx` tsconfig 与 `tui-render/node_modules` 链接的临时目录，以同一 Node/tsx 命令运行。它未修改产品 benchmark 或 build，也不触碰上游 checkout。

曾出现的探针启动失败（缺自动 JSX 配置、临时 baseline 缺 ink link、临时 probe 导出名错误）只是运行器准备问题；成功报告均为后续实际 exit=0 运行，未把失败当 PASS。`heap-initial.log` 保留第一次 JSX 失败。最终源码仍需以主代理完整门禁来源链为准。
