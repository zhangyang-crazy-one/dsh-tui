# 阶段 5 独立复核（2026-10-23）

## 已验证

此文件记录恢复代理后实际重跑的结果，旧 README 和旧日志保留为历史。原 `/tmp/dsh-composer-phase5` 及旧 Vitest configs 均不存在，已重建临时目录。未修改 tasks、未 commit；收到主代理源码冻结后暂停写生产源码；主代理确认全量门禁复现相同4项失败并显式授权解除冻结后，已完成下述两处最小生产修复。

- `composer-targets-current.log`：11 文件通过，261 tests passed / 1 skipped，退出码 0。覆盖 composer-cursor/index/tokens、input-bar/window、input-selection、loop-keys/input/mouse/selection、viewport-command-interleaving。跳过项是默认关闭的 CPU benchmark，CPU 另有显式执行记录。**该结果在新增边界回归之前，最终结果见下述 Node24 23文件448通过记录。**
- `render-types-current.log`：`node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json`，退出码 0，无诊断；包含本次新增测试和 PTY fixture。
- 已有 input-selection range/copy/replace/delete 复用索引，热态 700/7,000/70,000 单元的选区测试通过；layout-effect caret 继续经 `writeTerminalControl(stdout, bytes, 'caret')`，对应现有回归通过。
- loop 的普通输入、settings editing、session rename fallback 均接入 `composerHeight(text, rows, statusRowCount + 1)`，与实际 InputBar `rowsBelow` 一致；对应 loop 与几何回归通过。
- 重跑当前与 HEAD 基线 benchmark，6 个长度/几何组合，每组 1 cold + 5 warm SSR、5 次 PTY left + 5 次 insert，原始数据及源码哈希见 `benchmark-baseline.json`、`benchmark-current-final.json`（两处修复后的最终版本）；`benchmark-current.json`保留为修复前热态复测。当前 40 次热态光标移动每组均 0 segment calls / 0 segmented UTF-16 units。

| PTY 几何 | UTF-16 单元 | warm SSR 中位 ms 基线→当前 | PTY left 中位 ms 基线→当前 | PTY insert 中位 ms 基线→当前 | segment calls / source units 基线→当前 |
|---|---:|---:|---:|---:|---:|
| 80×24 | 700 | 12.79 → 6.18 | 10.13 → 4.48 | 9.05 → 4.00 | 4067 / 120175 → 0 / 0 |
| 80×24 | 7000 | 64.57 → 7.34 | 60.59 → 4.17 | 55.69 → 5.36 | 40067 / 1200175 → 0 / 0 |
| 80×24 | 70000 | 484.77 → 5.96 | 463.15 → 3.58 | 406.44 → 31.11 | 400067 / 12000175 → 0 / 0 |
| 120×40 | 700 | 18.65 → 6.45 | 10.12 → 5.66 | 8.45 → 4.77 | 4067 / 121408 → 0 / 0 |
| 120×40 | 7000 | 51.65 → 6.70 | 44.59 → 5.76 | 41.12 → 7.09 | 40067 / 1201408 → 0 / 0 |
| 120×40 | 70000 | 409.20 → 5.30 | 399.35 → 5.87 | 383.02 → 32.79 | 400067 / 12001408 → 0 / 0 |

SSR 为 Ink `renderToString`，只改变列宽，内部固定 24 行 mock；表中几何是 PTY 的实际尺寸。PTY 使用 node-pty，计时从输入 write 到 fixture `waitUntilRenderFlush()` 后 OSC ack，验证 sequence/草稿长度/caret；不校验完整草稿逐字内容或物理终端屏幕。它是 InputBar + cursor helper fixture，不是完整 TuiLoop/真实会话端到端指标。初次当前先测、基线后测；源码修复后又单独重跑当前最终版本，均串行执行；主代理同时执行独立 validate，存在机器负载/JIT/GC 噪声，不设 CPU/时延硬阈值，不从样本推断设备提升百分比。changed revision 仍需线性摄入（本轮70k插入最终样本详见上表）。完整发送内容另由编辑/发送单测核对。

基线取 `git archive HEAD tui tui-render` 到临时工具目录，使用其原始 composer 源码与只读 dependency symlinks；没有写日常 upstream。重建源码/config 的说明在 `reproduce-current.md`；临时目录基线/缓存/node_modules 未整体入库。

### 字素边界失败与修复（先 FAIL，后 PASS）

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui-render/tests/input-selection.spec.ts tui-render/tests/input-bar-window.spec.tsx -t 'stale editor offset|whole CRLF grapheme'
```

退出码 1，`2 failed files; 4 failed | 1 passed | 20 skipped (25)`，见 `boundary-regression-red.log`。

1. `👩‍💻x` 的外部 caret UTF-16 偏移 2/3/4 应吸附到完整 ZWJ 字素前端（终端第5列），实际第7列。旧测试只覆盖偏移1，因此之前通过记录不能证明所有字素内部偏移都正确。最小修复：InputBar 将用于选区、窗口与锚点的 caret 先经 index.snapCaret 归一化。
2. `a\r\nb` 从偏移0按 End/Shift+End，实际返回偏移2（CRLF 中间），应为偏移1。已有左右/删除 CRLF 测试没有覆盖 End。最小修复：input-selection 的 End 结果先经 boundary 归一化。

冻结前只修改 `tui-render/tests/input-selection.spec.ts`、`tui-render/tests/input-bar-window.spec.tsx` 来固化失败；解冻授权后仅修改 `tui-render/src/input-bar.tsx`、`tui-render/src/input-selection.ts`，保留已有 indexed boundary 与 writeTerminalControl 接入。

按主代理要求，先用 **Node v24.13.0 + 隔离工作区原 Vitest 配置** 单独运行这两个完整 suite，退出码1：4 failed / 21 passed（25），日志 `boundary-node24-original-red.log`。cwd 为 `/tmp/dsh-tui-validation-aN6rfv/dsh`，命令：

```sh
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/vitest/vitest.mjs run packages/tui/tui-render/tests/input-bar-window.spec.tsx packages/tui/tui-render/tests/input-selection.spec.ts --maxWorkers 2 --passWithNoTests=false
```

不是 Node24 特有问题或必须依赖跨 suite mock 才能触发：此前 Node22 已复现相同4项失败；Node22（ICU78.2）/Node24（ICU77.1）独立进程对 `👩‍💻x\r\nb` 都返回起点0/5/6/8，CRLF与ZWJ均保持完整字素。修复的是未使用已存在的吸附结果，而非更换 Segmenter。

修复后 Node24 使用当前源码精确 alias，两个 suite **25 passed**，退出码0，见 `boundary-node24-current-green.log`。继续跑完整授权范围的23个针对性suite：**23 files passed; 448 passed / 1 skipped (449)**，退出码0，25.55s，见 `targets-node24-final.log`。覆盖11个composer/loop文件及12个runtime/settings/审批/ask/plan/HUD/pane文件；唯一skip为另行显式跑过的CPU benchmark。Node24 下 renderer tests 和 source-alias runtime tests 两项 tsc 均退出码0，无诊断，见 `render-types-node24-final.log` 和 `../scoped-updates/runtime-types-node24-final.log`。最终源码哈希见 `source-identity-final.json`。

源码写入在2026-10-23约20:15结束并已通知主代理可重新捕获sourceIdentity。本轮没有再改runtime/loop/spinner，没有改frame/output/build/history。

## 未验证

- 新发现的两项字素边界回归已修复并在Node24通过；相关完整草稿编辑/发送、选区、几何、历史恢复和editor owner输入回归通过。真实外部editor/IME宿主的设备表现仍只在下述未验证范围内。
- 完整应用 PTY、物理终端屏幕 oracle、真实外部 editor/剪贴板/图片服务、live auth/model、五分钟 soak、发布/打包门禁不在本代理实测范围。主代理的完整 validate、native 和四项目 TS 结果由主代理单独归档，不在此冒称独立核实。
- 未声明现场问题根因闭环；未勾 tasks。

## 阻塞

无。主代理已解除冻结并授权两处修复，源码修复与针对性绿测完成后已再次冻结；最终全量validate由主代理重新捕获sourceIdentity并执行，本代理不将旧全量失败记录或消息中的进度冒称最终通过。
