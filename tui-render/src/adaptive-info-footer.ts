/** Pure width-adaptive footer formatting for authoritative TUI status data. */

import { formatCacheHitPercent } from '@deepseek-ai/dsh-token-meter/client'
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

function workspaceLine(view: AdaptiveInfoFooterView, columns: number): string {
  const environment = view.environment === undefined
    ? undefined
    : escapeContent(view.environment)
  const status = `状态 ${escapeContent(view.status)}`
  let core = environment === undefined ? status : join([environment, status])
  if (displayWidth(core) > columns && environment !== undefined) {
    const statusWidth = displayWidth(` · ${status}`)
    core = statusWidth < columns
      ? `${truncateDisplay(environment, columns - statusWidth)} · ${status}`
      : truncateDisplay(status, columns)
  }
  const retry = view.retry === undefined ? undefined : retryText(view.retry)
  for (const segment of [retry, view.tip === undefined ? undefined : escapeContent(view.tip)]) {
    if (segment !== undefined && segment !== '' && displayWidth(`${core} · ${segment}`) <= columns) {
      core = `${core} · ${segment}`
    }
  }
  return truncateDisplay(core, columns)
}

function identityMetricsLine(view: AdaptiveInfoFooterView, columns: number): string {
  const identity = `${escapeContent(view.provider)}/${escapeContent(view.model)}`
  const effort = view.effort === undefined ? undefined : `强度 ${escapeContent(view.effort)}`
  const pressure = view.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const context = used === undefined
    ? undefined
    : pressure?.contextWindow === undefined
      ? `上下文 ${String(used)}`
      : `上下文 ${String(used)}/${String(pressure.contextWindow)}`
  const usage = view.tokenUsage
  const promptTokens = usage === undefined
    ? 0
    : usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const input = usage === undefined ? undefined : `↑${String(promptTokens)}`
  const output = usage === undefined ? undefined : `↓${String(usage.outputTokens)}`
  const cacheHit = usage === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, promptTokens)
  const cache = cacheHit === null ? undefined : `缓存命中 ${cacheHit}%`
  let line = truncateDisplay(identity, columns)
  for (const segment of [effort, context, input, output, cache]) {
    if (segment !== undefined && displayWidth(`${line} · ${segment}`) <= columns) {
      line = `${line} · ${segment}`
    }
  }
  return line
}

function retryText(retry: AdaptiveRetryView): string {
  const attempt = retry.maxRetries === undefined
    ? String(retry.retry)
    : `${String(retry.retry)}/${String(retry.maxRetries)}`
  const seconds = Math.max(0, Math.ceil(retry.remainingMs / 1000))
  return `重试 ${attempt} · ${String(seconds)}s · ${escapeContent(retry.failureCode)}`
}

/**
 * Format at most two physical footer lines. Whole low-priority segments
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
    workspaceLine(view, width),
    identityMetricsLine(view, width),
  ].filter(line => line !== '')
  return Object.freeze(lines)
}
