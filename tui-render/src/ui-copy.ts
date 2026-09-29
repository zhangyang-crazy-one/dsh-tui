/** Locale-owned copy for terminal presentation settings and their entry points. */

/** Supported terminal presentation-copy locales. */
export type TuiLocale = 'zh-CN' | 'en-US'

const zh = {
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
