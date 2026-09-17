/**
 * Sticky transcript labels for the AppShell top divider.
 *
 * The transcript viewport already owns physical-row coordinates. When the
 * top visible row sits inside an expanded reasoning or tool body, or the
 * latest user prompt has scrolled fully off, the shell reuses the existing
 * divider row instead of inserting another chrome line.
 * @module @deepseek-ai/dsh-tui-render/sticky-header
 */

/** One expanded reasoning span in transcript physical-row coordinates. */
export interface StickyReasoningRange {
  /** Inclusive first physical row of the reasoning block (the header). */
  readonly start: number
  /** Exclusive end physical row of the reasoning block. */
  readonly end: number
  /** 1-based assistant-turn ordinal painted as `第 N 轮`. */
  readonly turnOrdinal: number
  /** Thinking duration in milliseconds. */
  readonly durationMs: number
}

/** One tool-card span whose heading has left the viewport. */
export interface StickyToolRange {
  /** Inclusive first physical row of the card (the heading). */
  readonly start: number
  /** Exclusive end physical row of the card. */
  readonly end: number
  /** Presenter title or tool name shown after `▸`. */
  readonly title: string
}

/** One user-message span used once the prompt has left the viewport. */
export interface StickyUserRange {
  /** Inclusive first physical row of the user block. */
  readonly start: number
  /** Exclusive end physical row of the user block. */
  readonly end: number
  /** Raw user prompt text; whitespace is collapsed at format time. */
  readonly text: string
}

/** Ranges the divider resolver inspects in priority order. */
export interface StickyTranscriptRanges {
  /** Expanded reasoning bodies; first containing the top row wins. */
  readonly reasoning?: readonly StickyReasoningRange[]
  /** Multi-line tool cards; first containing the top row wins. */
  readonly tools?: readonly StickyToolRange[]
  /** User prompts in transcript order; only the latest can pin the divider. */
  readonly users?: readonly StickyUserRange[]
}

/**
 * Collapse prompt/title text to a single divider-safe run.
 * @param text - raw user or tool copy.
 * @returns trimmed single-line text.
 */
function collapseStickyText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Format the divider label for one sticky reasoning range.
 * @param range - turn ordinal and duration for the active thinking block.
 * @returns the unpadded label the shell wraps with `───` gutters.
 */
export function formatStickyThinkingLabel(
  range: Pick<StickyReasoningRange, 'turnOrdinal' | 'durationMs'>,
): string {
  return `💭 思考中 (第 ${String(range.turnOrdinal)} 轮 · ${(range.durationMs / 1000).toFixed(1)}s) · [Ctrl+O 折叠]`
}

/**
 * Format the divider label for one sticky tool card.
 * @param range - presenter title or tool name.
 * @returns the unpadded label the shell wraps with `───` gutters.
 */
export function formatStickyToolLabel(range: Pick<StickyToolRange, 'title'>): string {
  const title = collapseStickyText(range.title)
  return title === '' ? '▸' : `▸ ${title}`
}

/**
 * Format the divider label for the latest scrolled-off user prompt.
 * @param range - raw user prompt text.
 * @returns the unpadded label the shell wraps with `───` gutters.
 */
export function formatStickyUserLabel(range: Pick<StickyUserRange, 'text'>): string {
  const text = collapseStickyText(range.text)
  return text === '' ? '>' : `> ${text}`
}

/**
 * Resolve the sticky thinking label for the current viewport top.
 *
 * The header row (`range.start`) staying visible is enough orientation, so
 * the divider only switches when the top row is strictly inside the body.
 * @param viewportTop - zero-based physical row at the top of the viewport.
 * @param ranges - expanded reasoning spans in the same coordinate system.
 * @returns the divider label, or undefined when the top row is not in a body.
 */
export function resolveStickyThinkingHeader(
  viewportTop: number,
  ranges: readonly StickyReasoningRange[],
): string | undefined {
  for (const range of ranges) {
    if (viewportTop > range.start && viewportTop < range.end) {
      return formatStickyThinkingLabel(range)
    }
  }
  return undefined
}

/**
 * Resolve the divider label for the current viewport top.
 *
 * Priority is reasoning body, then tool body, then the latest user prompt
 * once that prompt has fully left the viewport. A 1-line running tool never
 * has a body, so the user prompt is what keeps conversation context on
 * screen while follow mode tracks the live edge.
 * @param viewportTop - zero-based physical row at the top of the viewport.
 * @param ranges - reasoning, tool, and user spans in the same coordinates.
 * @returns the divider label, or undefined when no sticky context applies.
 */
export function resolveStickyTranscriptHeader(
  viewportTop: number,
  ranges: StickyTranscriptRanges,
): string | undefined {
  const thinking = resolveStickyThinkingHeader(viewportTop, ranges.reasoning ?? [])
  if (thinking !== undefined) return thinking
  for (const range of ranges.tools ?? []) {
    if (viewportTop > range.start && viewportTop < range.end) {
      return formatStickyToolLabel(range)
    }
  }
  const latestUser = ranges.users?.at(-1)
  if (latestUser !== undefined && viewportTop >= latestUser.end) {
    return formatStickyUserLabel(latestUser)
  }
  return undefined
}
