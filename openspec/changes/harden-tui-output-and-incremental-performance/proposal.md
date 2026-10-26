## Why

持续生成或自动续跑、用户不输入时出现 `1;22;24m` 残留；2026-10-23 审查已在背景色输出包装器的控制序列分块边界复现同样字符，但用户现场的实际调用来源仍未确认。审查还发现 CI 测试目录错误，以及生成动画、长草稿、长历史和多层缓存的额外开销，需要以可复现验证为基础分阶段改进。

## What Changes

- 保护跨写入块的控制序列与文本编码完整性，协调帧、光标、选区和通知输出；增加有界诊断和全屏终端回放验收。
- 建立 CI 与发布共用的验证链，在隔离 DSH 工作区测试当前源码并核对 bundle 来源，禁止零测试和未经验证产物通过门禁。
- 隔离生成动画的刷新，按状态依赖失效缓存，保留无关快照对象身份。
- 为长草稿建立有限可见窗口与可复用的行/字素索引，完整保留编辑、复制和发送内容。
- 分离 settled 历史与 active 回合更新，按变化块更新派生数据，在展示计算前合并过时展示请求，并优化首次可交互帧。
- 为派生缓存明确生命周期和统计边界，验证慢输出时的待写帧上限与恢复行为。
- 所有新任务保持未勾选；审查中已通过的测试仅作为基线，不代表优化已经实现。

## Capabilities

### New Capabilities

- `tui-output-integrity`: 跨块输出完整性、输出协调、有界诊断、全屏 oracle 与慢 sink 恢复。
- `tui-build-verification`: 隔离构建、当前源码测试、非零测试门禁和产物来源核对。
- `tui-scoped-render-updates`: 动画局部更新和依赖范围内的状态通知。
- `tui-composer-viewport`: 长草稿可见窗口、索引复用与无损编辑。
- `tui-incremental-transcript`: 活跃回合增量更新、可交互首屏、派生缓存回收与计量。

### Modified Capabilities

无。本仓库 `openspec/specs/` 当前没有已归档的主规范；相关约束仍位于历史 change 中。本变更以独立新增能力补充它们，不把未归档 delta 当作可直接 MODIFIED 的主规范，也不改写旧任务状态。保留 `fix-live-transcript-and-settings-navigation` 的正文单一绘制 owner，以及 `refine-tui-scroll-expand-and-visual-hierarchy` 的滚动、工具展开、overscan 与现有延迟要求。

## Impact

- 主要范围：`tui-render/src/frame-fill.ts`、`mouse-io.ts`、`loop.tsx`、`input-bar.tsx`、`composer-cursor.ts`、`stream-view.tsx`、缓存/调度/指标模块，`tui/src/index.ts` 的通知与快照管理。
- 工程范围：`scripts/build.js`、`dev-setup.js`、类型与测试入口、`.github/workflows/ci.yml`、`publish.yml`、离线与 PTY 回放测试。
- 不改变 launcher/plugin 职责、canonical 会话事件、认证服务或 DSH 兼容范围；不新增模型依赖，不重新设计 UI，不包含推送或发布授权。
- 证据基线：[`docs/optimization-audit-2026-10-23/analysis.md`](../../../docs/optimization-audit-2026-10-23/analysis.md)，提交 `1d25152831ede97cd2f706967020dd23f1053f1d`、版本 `0.1.0-alpha.54`。合成性能数据不作为真实按键延迟或现场根因证明。
