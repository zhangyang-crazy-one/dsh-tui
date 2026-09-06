# tui-dsh-compatibility Specification

## MODIFIED Requirements

### Requirement: TUI 只消费 projection 的 client wire view
TUI SHALL 从 `SessionProjectionMap`/snapshot values 消费 client-visible view，MUST NOT 依赖 host fold state或持久 checkpoint 的内部字段。在 DSH 0.1.3-alpha.1 体系下，Agent Hub 与会话的 cold read SHALL 通过 `sessionPersistence.open(id, 'read', { signal })` 获取权威的只读 `SessionHandle`，从 `handle.header` 与 `handle.read()` 取得同一 lifecycle 的 `SessionHeader` 与完整有序 events，并调用同步 `coldSnapshot(meta, events)`；所有打开的 `SessionHandle` MUST 在异步作用域结束时通过 `await handle.close()` 或 `using` 声明释放。无效、过期或缺失 cache row SHALL refold 精确日志或呈现未知值省略，而不是虚构零值。

#### Scenario: cold cache state 校验失败
- **WHEN** projection cache 拒绝一个 identity/version 不匹配的 row
- **THEN** Agent Hub 用通过 `SessionHandle` 读取的 metadata 与完整日志 refold，或省略未知指标，不显示伪造数值

#### Scenario: cold observation 来自只读 SessionHandle
- **WHEN** Agent Hub 借用一个只读 `SessionHandle` 观察非活跃子代理会话
- **THEN** TUI 只读其 immutable meta 与 contiguous events，在 snapshot 计算结束后即时 `close()` 句柄，且不持有写锁或发布该 Session

### Requirement: 会话与高级入口在新 dsh 生命周期上保持可用
会话创建、切换、恢复、重命名、删除、搜索、导出，以及 permission、subagent、plan、goal、todo、workflow 和 workspace 入口 SHALL 在 0.1.3-alpha.1 合并后的 shipping composition 中保持可达并遵守最新 wire/default 语义。会话列表浏览 SHALL 消费 `sessionPersistence.list()` 返回的 `SessionPersistenceSnapshot` 集合（读取 `snapshot.header`）；冷会话删除与读取 SHALL 在基于 JSONL 文件锁租约的 Handle 模型生命周期内实现，不得依赖已废弃的 SQLite 后端或旧版 `SessionPersistenceCoordinator`。

#### Scenario: 合并后切换会话
- **WHEN** 用户从 TUI 切换到持久会话且目录刷新失败
- **THEN** 已提交的新绑定保持可用，TUI 显示失败反馈，运行时不回滚或退出

#### Scenario: 基于 SessionHandle 导出和恢复
- **WHEN** 用户触发 `/export` 或 `--resume` 恢复持久会话
- **THEN** TUI 通过只读 `SessionHandle` 完整读取历史有序事件流并完成导出或恢复，句柄在完成后正常关闭

#### Scenario: 高级入口组装验证
- **WHEN** advanced-entry PTY 场景在合并后 profile 上运行
- **THEN** 所有已组合入口仍可打开，缺失的 optional service 使用既有明确降级文案

## ADDED Requirements

### Requirement: 对齐上游 0.1.3-alpha.1 会话日志 Format v2
TUI 的投影器与 Markdown 增量渲染器 SHALL 消费 Format v2 会话流，正确处理内嵌的 assistant 流式响应增量（Embedded Assistant Stream），并在忽略淘汰字段（如 `startedTime`）的前提下维持无闪烁增量显示。

#### Scenario: 流式消费 Format v2 助手响应
- **WHEN** 0.1.3-alpha.1 内核分发 Format v2 结构的 assistant 增量事件
- **THEN** TUI 正确将其增量投影至当前活动 Turn，平滑更新页面而不引发格式解析异常
