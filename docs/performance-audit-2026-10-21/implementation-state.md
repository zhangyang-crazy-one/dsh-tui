# 修复状态

基线：`7952c5f`；分支：`fix/tui-rendering-scroll-settings`。

用户已授权修复审计发现，滚动场景为鼠标滚轮/触控板；流式错绘在无操作时也发生。运行中的用户会话不重启、不干扰。

## 验收目标

- TTY 聊天内容只由物理帧绘制；无输入流式 Markdown、结算、尺寸变化逐帧与 canonical snapshot 相符，输入框和 footer 不被覆盖。
- 滚轮到达最新目标，不逐行追赶；反向、边界、连续输入不丢行。对照审计 PTY 基准检查延迟、写入量、React commit。
- settings 支持分类、namespace、Provider/对象、数组/model 的真实逐级导航、搜索和返回；保存后保留所在层级。40/80/120 列值及操作可见，使用官方 describe/update/credentials。
- transcript store 预算统计不再每次遍历所有行；淘汰、重建、active 生命周期统计一致。
- 针对性回归、完整离线测试、构建、严格类型检查、打包检查通过；实际终端证据与模拟明确区分。

## 分工

- 主代理：StreamView 单一绘制、滚轮调度、集成、PTY 对照、最终验证与文档。
- settings_hierarchy：设置导航、编辑和布局及测试。
- transcript_cache：line store 增量预算统计及测试。
- frame_cursor：stdout 光标锚点、Ink 清屏后的 snapshot 重绘及测试。

## 当前证据

- 修复前结果见 `analysis.md`、`evidence/results.json` 与 `evidence/stream-frames-*.json`。
- 修复前无输入流式检查：1399 个完成帧中 21 帧与 canonical transcript 不符。截图所示完全相同的 composer 串行尚未复现。
- 修复前单次滚轮 3 行需要 3 个运动帧；60Hz 连续输入停止后仍有约 141ms 追赶。

## 已验证

全部实现与离线验收已完成，见 [fix-verification.md](fix-verification.md)。最终 173 文件 / 2299 测试、46 launcher 测试、4 个严格类型检查项目、构建及打包检查通过。2928 个完成 PTY 帧无正文越界；2812 个具有当前快照的帧、77558 行比较无不一致。

## 未验证

用户已运行的旧进程未重启；真实触控板/GPU呈现、联网模型认证仍未以合成 fixture 代替验收。源码与本地 bundle 已更新，npm 未发布新版本。

## 阻塞

无。后续如需发布，使用本分支已验证构建及 Unreleased changelog 准备新的版本。
