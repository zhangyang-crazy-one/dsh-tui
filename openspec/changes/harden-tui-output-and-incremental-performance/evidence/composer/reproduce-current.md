# 重建与实际命令

本轮运行 cwd `/home/zhangyangrui/my_programes/dsh-tui`，临时工作目录 `/tmp/dsh-composer-phase5`。`vitest.config.mjs` 和 runtime tsconfig 已随证据归档。Vitest 使用 upstream `vitest.shared.ts` 的 `standardDecoratorPlugin`、upstream `tsconfig.base.json` 的 paths 和 tsconfigPaths；runtime/render 均有精确的当前源码 alias。配置不触及 upstream checkout 的源码或 lib。

实际执行命令（结果分别见同名日志/acceptance-current.md；初次运行 composer 在新增失败回归之前）：

```sh
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui-render/tests/composer-cursor.spec.ts tui-render/tests/composer-index.spec.ts tui-render/tests/composer-tokens.spec.ts tui-render/tests/input-bar.spec.tsx tui-render/tests/input-bar-window.spec.tsx tui-render/tests/input-selection.spec.ts tui-render/tests/loop-keys.spec.tsx tui-render/tests/loop-input.spec.tsx tui-render/tests/loop-mouse.spec.tsx tui-render/tests/loop-selection.spec.tsx tui-render/tests/viewport-command-interleaving.spec.tsx
node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/dsh-composer-phase5/benchmark-current.json
COMPOSER_SOURCE_ROOT=/tmp/dsh-composer-phase5/scoped-baseline/tui-render/src node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/dsh-composer-phase5/benchmark-baseline.json
node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui-render/tests/input-selection.spec.ts tui-render/tests/input-bar-window.spec.tsx -t 'stale editor offset|whole CRLF grapheme'
node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p /tmp/dsh-composer-phase5/runtime-tsconfig.json
```

基线重建：`git archive HEAD tui tui-render` 解包至 `/tmp/dsh-composer-phase5/scoped-baseline`；其 root/node_modules 链接当前 root/node_modules，每个 package/node_modules 分别链接当前对应 package/node_modules（不能都链接根目录，否则 ink 无法解析）。仅用当前 `tui-render/tests/loop-input.spec.tsx` 替换基线同名测试。spinner A/B 的 after 从相同 archive 建立，仅替换 loop.tsx 并加入 generating-spinner.tsx、composer-index.ts；因此 A/B 的旧 stream-view、input-bar 哈希相同，排除了阶段5/6主体优化混入。基准只筛选 `records scoped animation`。

临时基线初次收集失败是 package/node_modules 错链到 root/node_modules，报 Cannot find package ink / no tests；修正为对应 package 的依赖链接后两组 CPU benchmark 均成功。没有把零测试计为通过。临时目录内容筛选复制：仅原始结果、日志、配置、身份与小型 probe；不复制 dependency symlink、Vite cache、临时全源码副本。

最终修复后的实际命令：

```sh
# cwd /tmp/dsh-tui-validation-aN6rfv/dsh；修复前原配置复现：4 failed / 21 passed，退出1
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/vitest/vitest.mjs run packages/tui/tui-render/tests/input-bar-window.spec.tsx packages/tui/tui-render/tests/input-selection.spec.ts --maxWorkers 2 --passWithNoTests=false
# 以下 cwd /home/zhangyangrui/my_programes/dsh-tui；当前源码alias，修复后25通过，退出0
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui-render/tests/input-bar-window.spec.tsx tui-render/tests/input-selection.spec.ts
# 扩大到授权的composer/loop/runtime针对性回归：23文件448通过/1可选CPU benchmark跳过，退出0
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/vitest/vitest.mjs run --config /tmp/dsh-composer-phase5/vitest.config.mjs tui-render/tests/composer-cursor.spec.ts tui-render/tests/composer-index.spec.ts tui-render/tests/composer-tokens.spec.ts tui-render/tests/input-bar.spec.tsx tui-render/tests/input-bar-window.spec.tsx tui-render/tests/input-selection.spec.ts tui-render/tests/loop-keys.spec.tsx tui-render/tests/loop-input.spec.tsx tui-render/tests/loop-mouse.spec.tsx tui-render/tests/loop-selection.spec.tsx tui-render/tests/viewport-command-interleaving.spec.tsx tui/tests/snapshot-identity.spec.ts tui/tests/settings-pane-integration.spec.ts tui/tests/approval-answerer.spec.ts tui/tests/ask-user-provider.spec.ts tui/tests/plan-review.spec.ts tui/tests/jobs-hud.spec.ts tui/tests/workflow-hud.spec.ts tui/tests/retry-footer.spec.ts tui/tests/goal-footer.spec.ts tui/tests/model-pane-integration.spec.ts tui/tests/permission-pane-integration.spec.ts tui/tests/workspace-pane-integration.spec.ts
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/typescript/bin/tsc --noEmit -p tui-render/tests/tsconfig.json
/home/zhangyangrui/.nvm/versions/node/v24.13.0/bin/node node_modules/typescript/bin/tsc --noEmit -p /tmp/dsh-composer-phase5/runtime-tsconfig.json
# Node22.23.1，与本轮独立HEAD baseline保持相同Node；最终源码重跑
node_modules/.bin/tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs /tmp/dsh-composer-phase5/benchmark-current-final.json
```

`segmenter-node-comparison.json` 是两个独立Node进程对同一UTF-16输入的实测结果；与跨版本红测一致，不将差异归因于Node24。失败工作区只读复现，未把当前源码覆盖进该已失败的隔离workspace；最终绿色针对测试读取当前源，主代理另起最终全量validate保证其独立来源链。
