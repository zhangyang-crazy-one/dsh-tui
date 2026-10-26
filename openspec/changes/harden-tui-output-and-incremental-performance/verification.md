# 实现验收：输出完整性与增量性能

本文件保留原实现阶段的验收时间与范围。2026-10-26 用户另行授权后，已在 DSH rc.3 上重验并发布 alpha.55；GitHub CI、npm 发布和公开包核验结果见 [后续发布记录](../../../docs/upstream-rc3-2026-10-26.md)。

## 已验证

当前产品修复跨块 ANSI/UTF-8 输出边界，统一正文、光标、选区和通知的有界输出队列；生成动画局部更新，runtime 按依赖域维护稳定 snapshot；输入区使用完整草稿索引与可见窗口；历史先准备精确尾部、后台分批索引，活动回合在昂贵投影前合并展示请求。canonical 会话和发送草稿没有截断。

最终集成修正还覆盖：emoji 内部外部 caret、CRLF End/Shift+End、overlay 帧计量、mouse teardown 顺序、render-lifetime 闭包持有旧历史、隔离 native 编译、验证入口循环导入和 solution-style tsconfig 的源码解析。

### 当前源码完整门禁

```sh
PATH=/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin:$PATH \
DSH_TUI_OFFLINE=1 DSH_TUI_STORE_DIR=/home/zhangyangrui/.local/share/pnpm/store \
npm run validate
npm run verify:artifact
openspec validate harden-tui-output-and-incremental-performance --strict
```

主代理实际执行：4 个 TypeScript 项目 PASS；根目录 56/56；TUI 181 个文件、2399 passed / 1 skipped（默认关闭的 scoped CPU benchmark，已单独显式运行）；五个 bundle 构建、实际 tarball 解包后五入口 import PASS；源码、产物、tarball 来源核对 PASS。离线依赖安装 downloaded=0，DSH原生模块在工具隔离工作区从该tag源码编译，未使用日常checkout现成二进制。

- DSH：0.2.1-rc.2，commit `687f282e8625c6b8d11ff58211a90524be2e4317`。
- Node：24.13.0；pnpm：11.28.5；esbuild：0.28.2；TypeScript：6.0.3；Vitest：4.1.11。
- 产品长测/干净副本源码 SHA-256：`8bd9500436991ee3e2c4d71e6adf80d34c601838e453f2fc544546d210396c9a`；基于HEAD并含工作区当前未提交改动，不以HEAD相同冒充源码相同。
- 日志、完整测试报告和provenance：[build证据](evidence/build/)。所有节点/锁/工具/bundle/tarball/native哈希在provenance.json。

源码错误被旧镜像掩盖、零测试、打包入口故意抛错、bundle/tarball/hash篡改均有负向测试；根目录日志出现的 SENTINEL 错误是这些预期失败用例，最终根目录结果56通过。另做过修改源码导致进行中验证立即拒绝的实际检验。

### 独立性能与回收复核

主代理亲自重跑 composer 基准：700/7000/70000 单元、80×24/120×40、SSR重复样本和真实PTY按键ACK；六组40次热态光标移动均0次重新分段全文。详细样本：[parent-final-benchmark.json](evidence/composer/parent-final-benchmark.json)。基线/当前同环境重复对照和限制见 [composer验收](evidence/composer/acceptance-current.md)。PTY ACK时延与SSR不是物理显示器按键到光子时延。

主代理亲自重跑100/1000/10000历史，首个可交互尾部只需64条精确投影；固定delta descriptor访问不随历史数量增长。重复基线、暖高度缓存候选和首屏选择见 [history验收](evidence/history/README.md)。静态生成时spinner不再触发transcript render或composer tokenize；源依赖表及CPU三次采样见 [scoped验收](evidence/scoped-updates/acceptance-current.md)。

主代理额外进行1000历史的受控GC与heap snapshot：projectionOwners 1000→1，lineEntries 1001→2，pins 8→2，pendingPresentation=0；旧canonical WeakRef被收集，独立snapshot解析旧canonical对象数为0。过程heapUsed约36.9MB→31.2MB，仅为这一受控样本；不是全堆分层retained-byte归因，也不是生产长期无泄漏保证。子代理10k小预算样本另见history证据，原始合成snapshot压缩保存并有SHA-256。

### 输出证据

三路分块对照有修复前失败记录，当前CSI/OSC所有分割点、Buffer/字符串、超长串、背压/错误/dispose、重新挂载均回归通过。主代理整屏PTY oracle独立使用canonical fixture语法，不从实现snapshot生成预期文本；逐格检查正文/输入/HUD/空白/背景和光标，缩放过渡独立计数；故意改变DRAFT会失败。命名预算、写入链和运行数据见 [output证据](evidence/output/README.md)。

## 未验证

- 用户截图现场的实际写入调用者、终端宿主与运行bundle仍缺现场trace。修复并证明的是可复现边界，不能将其写成用户现场根因已闭环。
- 所有长测均为合成持续生成/多轮续跑，未调用真实模型或进行live认证；真实设备p95、物理字体呈现和长期生产堆趋势未验证。
- GitHub托管runner和npm发布未执行；本地执行了共享验证入口与产物拒绝门禁。未提交、推送或发布。

## 阻塞

无产品实现阻塞。早期隔离工作区累积曾耗尽临时空间，导致一次干净副本安装与并行取证失败；已移除本任务创建的无成功证明工作区后重跑，不将中断数据计为通过。

补充干净副本验证：从当前源码物化一个不含node_modules、lib、dist和验证状态的临时源码目录（非历史checkout，不带.git），先核对其source SHA与当前工作区完全相同，再从零执行同一离线validate。结果4TS、56根测试、181文件/2399通过/1跳过、5bundle及tarball导入全部PASS；两次构建均分别核对自己的bundle哈希；跨路径字节差异另作比较，不声称可复现构建字节完全相同。详见 `evidence/build/clean-source-comparison.json`、`clean-source-validate.log` 与 `clean-source-provenance.json`。这验证了干净源码安装路径；Git提交标识为null被如实保留。

跨目录bundle比较：4/5文件逐字节一致；zen-proxy.js唯一差异是esbuild自动生成的源码路径注释（原工作区绝对路径相对化，与干净副本目录不同），运行代码一致。因此tarball SHA也不同；两次分别绑定各自验证过的tarball，不混用证明或声称跨路径字节完全相同。

最终稳定产品版本双尺寸PTY各300秒：80×24为3437完成帧、3324可比通过、113过渡；120×40为3439完成帧、3325可比通过、114过渡，其中2帧是慢sink已在途的前一canonical版本，随后立即追上。两组均0未匹配、0失败，最后呈现版本必须等于最后canonical版本。trace草稿完整，代码可见符号泄漏为0。最终source hash与soak运行时版本的唯一差异是独立oracle脚本（产品/fixture源码一致），详见 `evidence/build/final-source-delta.json`。

最终收尾门禁也已执行成功（独立oracle校正后的全部当前源码）：SHA-256 `0046b11858b1a8d80251a725f88bc67b9d2624ad80129c94067679f1cfde1e95`，4TS/56根测试/181文件2399通过1跳过/5bundle及pack-import再次全部PASS，已更新 `evidence/build/provenance.json` 与日志。产品长测版本、干净副本版本及最终版本的区别仅为oracle脚本，未将此前结果冒充这一版本的全量测试。
