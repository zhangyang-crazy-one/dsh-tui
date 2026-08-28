/** Pure width-adaptive footer formatting for authoritative TUI status data. */

import { displayWidth, escapeContent } from './content.ts'
import { truncateDisplay } from './tool-cards.ts'

/** Durable token buckets projected from the complete session log. */
export interface AdaptiveTokenUsage {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Provider-anchored context occupancy. */
export interface AdaptiveContextPressure {
  readonly pressureTokens?: number | undefined
  readonly projectedTokens?: number | undefined
  readonly contextWindow?: number | undefined
}

/** One visible retry wait derived from the durable retry event pair. */
export interface AdaptiveRetryView {
  readonly retry: number
  readonly maxRetries?: number | undefined
  readonly remainingMs: number
  readonly failureCode: string
}

/** Authoritative values available to the footer formatter. */
export interface AdaptiveInfoFooterView {
  readonly provider: string
  readonly model: string
  readonly status: string
  readonly effort?: string | undefined
  readonly environment?: string | undefined
  readonly tip?: string | undefined
  readonly tokenUsage?: AdaptiveTokenUsage | undefined
  readonly contextPressure?: AdaptiveContextPressure | undefined
  readonly retry?: AdaptiveRetryView | undefined
}

function join(parts: readonly string[]): string {
  return parts.join(' · ')
}

function fitSegments(parts: readonly string[], columns: number): string | undefined {
  const kept = [...parts]
  while (kept.length > 0 && displayWidth(join(kept)) > columns) kept.pop()
  return kept.length === 0 ? undefined : join(kept)
}

function primaryLine(view: AdaptiveInfoFooterView, columns: number): string {
  const identity = `${escapeContent(view.provider)}/${escapeContent(view.model)}`
  const status = `状态 ${escapeContent(view.status)}`
  const effort = view.effort === undefined ? undefined : `强度 ${escapeContent(view.effort)}`
  const complete = join([identity, status, ...(effort === undefined ? [] : [effort])])
  if (displayWidth(complete) <= columns) return complete
  const core = join([identity, status])
  if (displayWidth(core) <= columns) return core
  const statusWidth = displayWidth(` · ${status}`)
  if (statusWidth < columns) {
    return `${truncateDisplay(identity, columns - statusWidth)} · ${status}`
  }
  return truncateDisplay(core, columns)
}

function metricLine(view: AdaptiveInfoFooterView, columns: number): string | undefined {
  const pressure = view.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const context = used === undefined
    ? undefined
    : pressure?.contextWindow === undefined
      ? `上下文 ${String(used)}`
      : `上下文 ${String(used)}/${String(pressure.contextWindow)}`
  const usage = view.tokenUsage
  const tokens = usage === undefined
    ? undefined
    : `tokens ${String(usage.uncachedInputTokens + usage.outputTokens)}`
  const cache = usage === undefined
    ? undefined
    : `cache ${String(usage.cacheReadTokens + usage.cacheWriteTokens)}`
  return fitSegments(
    [context, tokens, cache].filter((value): value is string => value !== undefined),
    columns,
  )
}

function tertiaryLine(view: AdaptiveInfoFooterView, columns: number): string | undefined {
  if (view.retry !== undefined) {
    const retry = view.retry
    const attempt = retry.maxRetries === undefined
      ? String(retry.retry)
      : `${String(retry.retry)}/${String(retry.maxRetries)}`
    const seconds = Math.max(0, Math.ceil(retry.remainingMs / 1000))
    return truncateDisplay(
      `重试 ${attempt} · ${String(seconds)}s · ${escapeContent(retry.failureCode)}`,
      columns,
    )
  }
  return fitSegments(
    [view.environment, view.tip]
      .filter((value): value is string => value !== undefined)
      .map(escapeContent),
    columns,
  )
}

/**
 * Format at most three physical footer lines. Whole low-priority segments
 * disappear before core provider/model/status data is truncated; no cost
 * field exists because the runtime has no authoritative billing projection.
 * @param view - authoritative footer values.
 * @param columns - available display columns.
 * @returns frozen non-empty lines in priority order.
 */
export function formatAdaptiveInfoFooter(
  view: AdaptiveInfoFooterView,
  columns: number,
): readonly string[] {
  const width = Math.max(1, columns)
  const lines = [
    primaryLine(view, width),
    metricLine(view, width),
    tertiaryLine(view, width),
  ].filter((line): line is string => line !== undefined && line !== '')
  return Object.freeze(lines)
}
