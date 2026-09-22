/** Locale-owned copy for terminal presentation settings and their entry points. */

/** Supported terminal presentation-copy locales. */
export type TuiLocale = 'zh-CN' | 'en-US'

const zh = {
  hudPlan: '任务计划',
  hudJobs: '后台执行',
  hudTodo: '待办',
  hudProgress: '进行中',
  hudRunning: '运行中',
  hudStopping: '停止中',
  hudWorkflow: '工作流',
  hudPhase: '阶段',
  hudMore: '未显示',
  pluginsBrowseHint: '↑↓ 选择',
  pluginsToggleHint: 'Space 启停',
  pluginsRemoveHint: 'd 移除',
  pluginsInstallHint: 'i 安装',
  pluginsCloseHint: 'Esc 关闭',
  pluginsBuildHeading: '审批以下包的构建脚本',
  pluginsBuildPersist: '按包名持久保存在此 profile',
  pluginsBuildHost: '这些脚本以宿主用户权限执行',
  pluginsTitle: '插件',
  pluginsCommand: '管理当前 profile 的插件 · g p',
  pluginsSupplied: '安装供给',
  pluginsOwned: 'Profile 自有',
  pluginsScope: '变更影响此 profile 的所有会话',
  pluginsUnavailable: '插件管理服务未组合',
  pluginsEmpty: '没有 bundle',
  pluginsLoading: '正在读取清单…',
  pluginsSelected: '已选中',
  pluginsUnselected: '未选中',
  pluginsEnabled: '已启用',
  pluginsDisabled: '已禁用',
  pluginsDeclared: '仅声明 · 无运行条目',
  pluginsOptional: '可选',
  pluginsNotRemovable: '不可移除',
  pluginsOverrides: '覆盖行',
  pluginsHint: '↑↓ 选择 · Space 启停 · i 安装 · d 移除 · Esc 关闭',
  pluginsInputHint: '输入安装 spec · Enter 预检 · Esc 关闭',
  pluginsPreviewHint: 'Enter 安装 · i 修改 spec · Esc 关闭',
  pluginsBusyHint: 'c 显式取消安装 · Esc 关闭（继续安装）',
  pluginsConfirmHint: 'y 确认所列名称 · n 返回 · Esc 关闭',
  pluginsRetryHint: 'r 重试 · i 修改 spec · Esc 关闭',
  pluginsApprovalHint: 'a 审批构建脚本 · i 修改 spec · Esc 关闭',
  pluginsReloadHint: 'R 重启应用（/reload）',
  pluginsRemoveConfirm: '确认移除此 bundle？',
  pluginsBuildConfirm: '审批下列包的构建脚本：按包名持久化在此 profile，并以宿主用户权限执行',
  pluginsPendingBuilds: '待审批构建脚本',
  pluginsInspecting: '正在预检…',
  pluginsInstalling: '正在安装…',
  pluginsCancelling: '正在取消…',
  pluginsApplying: '正在应用…',
  pluginsApplied: '已应用',
  pluginsRestart: '已保存 · 需要重启',
  pluginsUnchangedRestart: '未保存新的变更 · 运行状态未更新',
  pluginsOverridden: '被更高优先级配置覆盖',
  pluginsCancelled: '已确认取消并恢复文件',
  pluginsTooLate: '已进入应用阶段，无法取消；继续等待结果',
  pluginsNotRunning: '没有正在运行的安装；核对当前结果',
  pluginsBundleYes: '声明 bundle',
  pluginsBundleNo: '未声明 bundle',
  pluginsBundleUnknown: '获取包后核对 bundle 声明',
  pluginsManagementRequired: '只读：需要独立管理进程',
  pluginsUnaddressable: '只读：没有可寻址控制项',
  pluginsUnknownPlugin: '插件条目不存在',
  pluginsInvalidSpec: '安装 spec 无效',
  pluginsAmbiguousInstall: '无法唯一确定安装的包',
  pluginsNotBundle: '该包不是 bundle',
  pluginsStopProfile: '必须先停止此 profile 才能移除',
  pluginsBundleInUse: '此 bundle 正在被使用',
  pluginsStaleApproval: '待审批包已变化，请重新核对',
  pluginsOperationError: '插件操作失败',
  pluginsAlreadyInstalled: '该包已安装',
  pluginsNotFound: '找不到该包',
  pluginsNotPackage: '目标不是有效的包',
  pluginsNetwork: '网络请求失败',
  pluginsUnknown: '未知原因；查看诊断输出',
  pluginsPnpmMissing: '未找到 pnpm',
  pluginsTimeout: '包操作超时',
  pluginsNoVersion: '找不到匹配版本',
  pluginsDiskFull: '磁盘空间不足',
  pluginsPermission: '文件访问权限不足',
  pluginsBuildBlocked: '构建脚本被阻止，需具名审批',
  pluginsIntegrity: '包完整性校验失败',
  on: '开',
  off: '关',
  reasoning: '思考',
  scrollbar: '轨道',
  statusDetails: '指标详情',
  locale: '界面语言',
  metrics: '指标',
  mode: '模式',
  tools: '工具',
  context: '上下文',
  status: '状态',
  effort: '强度',
  cacheHit: '缓存命中',
  retry: '重试',
  commandStatus: '显示/隐藏完整状态指标',
  commandReasoning: '显示/隐藏全文思考 · Ctrl+O',
  commandScrollbar: '显示/隐藏滚动轨道',
  settingsSaveFailed: '✗ 显示设置未保存 · 请重试',
  inputHint: '输入消息',
  sendHint: 'Enter 发送',
  arguments: '参数',
  result: '结果',
  diagnostics: '诊断元数据',
  processStatus: '进程状态',
  running: '运行中',
  failed: '失败',
  remaining: '剩余源行',
  toolDetails: '/tools 详情',
  commandTools: '逐项查看工具参数、完整结果与诊断',
  noTools: '当前会话没有工具调用',
  toolListHint: '↑↓ 选择 · Enter 详情 · Esc 关闭',
  toolPageHint: '←→ 翻页 · d 诊断 · y 复制 · e 导出 · Esc 返回',
  toolCopied: '✓ 已复制完整工具原文',
  toolExported: '✓ 工具原文已导出',
  toolCopyFailed: '✗ 工具原文复制失败',
  toolExportFailed: '✗ 工具原文导出失败',
  toolExportAction: '导出完整原文',
  processing: '正在处理…',
  thinking: '思考中…',
} as const

/** Typed presentation-copy keys shared by the runtime and renderer. */
export type TuiCopyKey = keyof typeof zh

const en: Readonly<Record<TuiCopyKey, string>> = {
  hudPlan: 'Plan',
  hudJobs: 'Background',
  hudTodo: 'Pending',
  hudProgress: 'In progress',
  hudRunning: 'Running',
  hudStopping: 'Stopping',
  hudWorkflow: 'Workflow',
  hudPhase: 'Phase',
  hudMore: 'hidden',
  pluginsBrowseHint: '↑↓ Select',
  pluginsToggleHint: 'Space Toggle',
  pluginsRemoveHint: 'd Remove',
  pluginsInstallHint: 'i Install',
  pluginsCloseHint: 'Esc Close',
  pluginsBuildHeading: 'Approve scripts for these named packages',
  pluginsBuildPersist: 'Approval is saved by package name on this profile',
  pluginsBuildHost: 'Scripts run with the host user’s permissions',
  pluginsTitle: 'Plugins',
  pluginsCommand: 'Manage profile plugins · g p',
  pluginsSupplied: 'Installation supplied',
  pluginsOwned: 'Profile owned',
  pluginsScope: 'Changes affect every session on this profile',
  pluginsUnavailable: 'Plugin management is unavailable',
  pluginsEmpty: 'No bundles',
  pluginsLoading: 'Loading inventory…',
  pluginsSelected: 'Selected',
  pluginsUnselected: 'Not selected',
  pluginsEnabled: 'Enabled',
  pluginsDisabled: 'Disabled',
  pluginsDeclared: 'Declaration only · no live entry',
  pluginsOptional: 'Optional',
  pluginsNotRemovable: 'Not removable',
  pluginsOverrides: 'Overrides',
  pluginsHint: '↑↓ Select · Space Toggle · i Install · d Remove · Esc Close',
  pluginsInputHint: 'Enter installation spec · Enter Inspect · Esc Close',
  pluginsPreviewHint: 'Enter Install · i Edit spec · Esc Close',
  pluginsBusyHint: 'c Cancel installation · Esc Close (installation continues)',
  pluginsConfirmHint: 'y Confirm listed names · n Back · Esc Close',
  pluginsRetryHint: 'r Retry · i Edit spec · Esc Close',
  pluginsApprovalHint: 'a Review build approvals · i Edit spec · Esc Close',
  pluginsReloadHint: 'R Restart to apply (/reload)',
  pluginsRemoveConfirm: 'Remove this named bundle?',
  pluginsBuildConfirm: 'Approve scripts for these named packages: saved by package name on this profile and run with the host user’s permissions',
  pluginsPendingBuilds: 'Build scripts awaiting approval',
  pluginsInspecting: 'Inspecting…',
  pluginsInstalling: 'Installing…',
  pluginsCancelling: 'Cancelling…',
  pluginsApplying: 'Applying…',
  pluginsApplied: 'Applied',
  pluginsRestart: 'Saved · restart required',
  pluginsUnchangedRestart: 'No new change saved · runtime unchanged',
  pluginsOverridden: 'Overridden by higher-priority configuration',
  pluginsCancelled: 'Cancellation confirmed; files restored',
  pluginsTooLate: 'Too late to cancel; waiting for the result',
  pluginsNotRunning: 'No running installation; checking the tracked result',
  pluginsBundleYes: 'Declares a bundle',
  pluginsBundleNo: 'Does not declare a bundle',
  pluginsBundleUnknown: 'Bundle declaration checked after retrieval',
  pluginsManagementRequired: 'Read-only: requires a separate management process',
  pluginsUnaddressable: 'Read-only: no addressable control',
  pluginsUnknownPlugin: 'Plugin entry not found',
  pluginsInvalidSpec: 'Invalid installation spec',
  pluginsAmbiguousInstall: 'Installed package is ambiguous',
  pluginsNotBundle: 'Package is not a bundle',
  pluginsStopProfile: 'Stop this profile before removing the bundle',
  pluginsBundleInUse: 'Bundle is in use',
  pluginsStaleApproval: 'Pending packages changed; review approval again',
  pluginsOperationError: 'Plugin operation failed',
  pluginsAlreadyInstalled: 'Package already installed',
  pluginsNotFound: 'Package not found',
  pluginsNotPackage: 'Target is not a valid package',
  pluginsNetwork: 'Network request failed',
  pluginsUnknown: 'Unknown cause; inspect diagnostics',
  pluginsPnpmMissing: 'pnpm is missing',
  pluginsTimeout: 'Package operation timed out',
  pluginsNoVersion: 'No matching version',
  pluginsDiskFull: 'Disk is full',
  pluginsPermission: 'File access denied',
  pluginsBuildBlocked: 'Build scripts blocked; named approval required',
  pluginsIntegrity: 'Package integrity check failed',
  on: 'on',
  off: 'off',
  reasoning: 'Thinking',
  scrollbar: 'Rail',
  statusDetails: 'Status details',
  locale: 'UI language',
  metrics: 'Metrics',
  mode: 'Mode',
  tools: 'Tools',
  context: 'Context',
  status: 'Status',
  effort: 'Effort',
  cacheHit: 'Cache hit',
  retry: 'Retry',
  commandStatus: 'Show/hide full status metrics',
  commandReasoning: 'Show/hide full thinking text · Ctrl+O',
  commandScrollbar: 'Show/hide the scroll rail',
  settingsSaveFailed: '✗ Display setting was not saved · Retry',
  inputHint: 'Type a message',
  sendHint: 'Enter to send',
  arguments: 'Arguments',
  result: 'Result',
  diagnostics: 'Diagnostic metadata',
  processStatus: 'Process status',
  running: 'Running',
  failed: 'Failed',
  remaining: 'source lines remaining',
  toolDetails: '/tools details',
  commandTools: 'Inspect individual tool arguments, full results, and diagnostics',
  noTools: 'No tool calls in this session',
  toolListHint: '↑↓ Select · Enter Details · Esc Close',
  toolPageHint: '←→ Pages · d Diagnostics · y Copy · e Export · Esc Back',
  toolCopied: '✓ Full tool source copied',
  toolExported: '✓ Tool source exported',
  toolCopyFailed: '✗ Tool source copy failed',
  toolExportFailed: '✗ Tool source export failed',
  toolExportAction: 'Export full source',
  processing: 'Processing…',
  thinking: 'Thinking…',
}

const dictionaries: Readonly<Record<TuiLocale, Readonly<Record<TuiCopyKey, string>>>> = { 'zh-CN': zh, 'en-US': en }

/**
 * Resolve terminal UI copy from the selected dictionary.
 * @param key - typed presentation-copy key.
 * @param locale - validated locale; Chinese is the product default.
 * @returns the dictionary text, without terminal styling.
 */
export function tuiCopy(key: TuiCopyKey, locale: TuiLocale = 'zh-CN'): string {
  return dictionaries[locale][key]
}

/**
 * Standard 10-frame braille spinner animation.
 * Each frame is exactly 1 column wide with zero jitter.
 */
export const BRAILLE_SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
] as const

/**
 * Returns the active frame for the braille spinner animation.
 * 100ms per frame, 1000ms per full cycle.
 * @param liveMs - elapsed time in milliseconds.
 * @returns 1-column wide string containing the braille spinner frame.
 */
export function getBrailleSpinnerFrame(liveMs: number | undefined): string {
  const index = Math.floor(Math.max(0, liveMs ?? 0) / 100) % BRAILLE_SPINNER_FRAMES.length
  return BRAILLE_SPINNER_FRAMES[index] ?? BRAILLE_SPINNER_FRAMES[0]
}

/** Backward-compatible alias for BRAILLE_SPINNER_FRAMES. */
export const SWIMMING_FISH_FRAMES = BRAILLE_SPINNER_FRAMES

/**
 * Backward-compatible alias for getBrailleSpinnerFrame.
 * @param liveMs - elapsed time in milliseconds.
 * @returns spinner frame string.
 */
export function getSwimmingFishFrame(liveMs: number | undefined): string {
  return getBrailleSpinnerFrame(liveMs)
}

/**
 * Rotating tips during generation / tool execution.
 * Guides users on shortcuts (Ctrl+E tool preview, Ctrl+O reasoning toggle, /tools full output, etc.).
 */
export const GENERATION_TIPS_ZH = [
  '提示：Ctrl+E 展开工具卡 · /tools 查看完整输出',
  '提示：Ctrl+O 展开/收起思考过程 · 随时跟进推理',
  '提示：Shift+Tab 切换多行输入 · ↑/↓ 浏览历史消息',
  '提示：输入 / 打开快捷命令 · 输入 @ 提及文件与上下文',
  '提示：Ctrl+C 中断当前生成 · 随时安全停止',
] as const

/** English rotating tips during generation / tool execution. */
export const GENERATION_TIPS_EN = [
  'Tip: Ctrl+E to expand tool cards · /tools for full output',
  'Tip: Ctrl+O to toggle thinking process · follow reasoning',
  'Tip: Shift+Tab for multiline input · ↑/↓ browse history',
  'Tip: Type / for slash commands · type @ to mention context',
  'Tip: Ctrl+C to stop generation safely at any time',
] as const

/**
 * Returns a rotating tip based on elapsed time and locale.
 * Rotates every 4 seconds.
 * @param liveMs - elapsed time in milliseconds.
 * @param locale - active UI locale.
 * @returns the formatted tip string.
 */
export function getBilingualTip(liveMs: number | undefined, locale: TuiLocale = 'zh-CN'): string {
  const tips = locale === 'en-US' ? GENERATION_TIPS_EN : GENERATION_TIPS_ZH
  const index = Math.floor(Math.max(0, liveMs ?? 0) / 4000) % tips.length
  return tips[index] ?? tips[0]
}
