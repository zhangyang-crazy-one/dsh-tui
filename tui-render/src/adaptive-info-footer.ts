/** Pure width- and height-adaptive footer formatting for authoritative TUI status data. */

import { formatCacheHitPercent } from '@deepseek-ai/dsh-token-meter/client'
import { displayWidth, escapeContent } from './content.ts'
import { truncateDisplay } from './tool-cards.ts'
import type { StyleToken } from './theme.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'

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
  readonly locale?: TuiLocale
  readonly reasoningVisible?: boolean
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

/** One already-escaped footer run with its final semantic style. */
export interface AdaptiveInfoFooterRun {
  readonly text: string
  readonly token: StyleToken
}

/** One footer hierarchy row selected for the current terminal geometry. */
export interface AdaptiveInfoFooterRow {
  readonly kind: 'workspace' | 'metrics' | 'operations'
  readonly runs: readonly AdaptiveInfoFooterRun[]
}

interface Segment {
  readonly runs: readonly AdaptiveInfoFooterRun[]
}

function segment(text: string, token: StyleToken): Segment {
  return { runs: [{ text, token }] }
}

function segmentText(value: Segment): string {
  return value.runs.map(run => run.text).join('')
}

function segmentsText(values: readonly Segment[]): string {
  return values.map(segmentText).join(' · ')
}

function fitSegments(values: readonly Segment[], columns: number): Segment[] {
  const selected: Segment[] = []
  for (const value of values) {
    if (
      selected.length === 0
      || displayWidth(`${segmentsText(selected)} · ${segmentText(value)}`) <= columns
    ) {
      selected.push(value)
    }
  }
  return selected
}

function flattenSegments(
  values: readonly Segment[],
  columns: number,
): readonly AdaptiveInfoFooterRun[] {
  const runs: AdaptiveInfoFooterRun[] = []
  for (const [index, value] of values.entries()) {
    if (index > 0) runs.push({ text: ' · ', token: 'fgDim' })
    runs.push(...value.runs)
  }
  const text = runs.map(run => run.text).join('')
  if (displayWidth(text) <= columns) {
    return Object.freeze(runs.map(run => Object.freeze({ ...run })))
  }
  return Object.freeze([
    Object.freeze({ text: truncateDisplay(text, columns), token: 'fgDim' as const }),
  ])
}

function statusToken(status: string): StyleToken {
  if (status === '空闲' || status === 'idle') return 'fgDim'
  if (/失败|错误|error|failed/iu.test(status)) return 'error'
  if (/重试|retry/iu.test(status)) return 'warning'
  return 'accentText'
}

function retryText(retry: AdaptiveRetryView, locale?: TuiLocale): string {
  const attempt = retry.maxRetries === undefined
    ? String(retry.retry)
    : `${String(retry.retry)}/${String(retry.maxRetries)}`
  const seconds = Math.max(0, Math.ceil(retry.remainingMs / 1000))
  return `${tuiCopy('retry', locale)} ${attempt} · ${String(seconds)}s · ${escapeContent(retry.failureCode)}`
}

function workspaceSegments(view: AdaptiveInfoFooterView, columns: number): Segment[] {
  const status = escapeContent(view.status)
  const statusSegment = segment(`${tuiCopy('status', view.locale)} ${status}`, statusToken(status))
  let selected = [statusSegment]
  if (view.environment !== undefined) {
    const environment = segment(escapeContent(view.environment), 'fgSoft')
    if (displayWidth(segmentsText([environment, statusSegment])) <= columns) {
      selected = [environment, statusSegment]
    }
  }
  if (view.retry !== undefined) {
    const retry = segment(retryText(view.retry, view.locale), 'warning')
    if (displayWidth(segmentsText([...selected, retry])) <= columns) selected.push(retry)
  }
  if (view.provider !== '') {
    const provider = segment(escapeContent(view.provider), 'fgDim')
    if (displayWidth(segmentsText([...selected, provider])) <= columns) selected.push(provider)
  }
  if (displayWidth(segmentsText(selected)) <= columns) return selected
  return [segment(truncateDisplay(segmentText(statusSegment), columns), statusToken(status))]
}

function contextSegments(
  pressure: AdaptiveContextPressure | undefined,
  locale?: TuiLocale,
): readonly Segment[] {
  const label = tuiCopy('context', locale)
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (used === undefined) return []
  const contextWindow = pressure?.contextWindow
  if (contextWindow === undefined || contextWindow <= 0) {
    return [segment(`${label} ${String(used)}`, 'fg')]
  }
  const percent = Math.max(0, Math.min(100, Math.round((used / contextWindow) * 100)))
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return [
    {
      runs: [
        { text: `${label} [`, token: 'fg' },
        { text: '█'.repeat(filled), token: 'accentText' },
        { text: '░'.repeat(10 - filled), token: 'fgDim' },
        { text: `] ${String(percent)}%`, token: 'fg' },
      ],
    },
    segment(`${label} ${String(percent)}%`, 'fg'),
    segment(`${label} ${String(used)}/${String(contextWindow)}`, 'fg'),
  ]
}

function promptTokenCount(usage: AdaptiveTokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

function cacheHitSegment(view: AdaptiveInfoFooterView): Segment | undefined {
  const usage = view.tokenUsage
  if (usage === undefined) return undefined
  const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, promptTokenCount(usage))
  return cacheHit === null ? undefined : {
    runs: [
      { text: `${tuiCopy('cacheHit', view.locale)} `, token: 'fgDim' },
      { text: `${cacheHit}%`, token: 'fgSoft' },
    ],
  }
}

function usageSegments(view: AdaptiveInfoFooterView): Segment[] {
  const usage = view.tokenUsage
  if (usage === undefined) return []
  const cacheHit = cacheHitSegment(view)
  return [
    segment(`↑${String(promptTokenCount(usage))}`, 'fgDim'),
    segment(`↓${String(usage.outputTokens)}`, 'fgDim'),
    ...(cacheHit === undefined ? [] : [cacheHit]),
  ]
}

function metricsSegments(view: AdaptiveInfoFooterView, columns: number): Segment[] {
  const effort = view.effort === undefined
    ? undefined
    : segment(`${tuiCopy('effort', view.locale)} ${escapeContent(view.effort)}`, 'fgDim')
  const usage = usageSegments(view)
  const contextVariants = contextSegments(view.contextPressure, view.locale)
  const fixed = effort === undefined ? [] : [effort]
  if (contextVariants.length === 0) {
    return fitSegments([...fixed, ...usage], columns)
  }
  for (const context of contextVariants) {
    const candidate = [context, ...usage, ...fixed]
    if (displayWidth(segmentsText(candidate)) <= columns) return candidate
  }
  const context = contextVariants.find(value => displayWidth(segmentText(value)) <= columns)
  return fitSegments([...(context === undefined ? contextVariants.slice(-1) : [context]), ...usage, ...fixed], columns)
}

function freezeRow(
  kind: AdaptiveInfoFooterRow['kind'],
  values: readonly Segment[],
  columns: number,
): AdaptiveInfoFooterRow {
  return Object.freeze({ kind, runs: flattenSegments(values, columns) })
}

/**
 * Format at most `maxRows` semantic footer rows. Three rows retain the
 * workspace, metrics, and operation hierarchy; constrained heights remove
 * complete lower-priority rows. Dynamic content is escaped before the final
 * renderer applies the returned style tokens.
 * @param view - authoritative footer values.
 * @param columns - available display columns.
 * @param maxRows - available footer rows, clamped to 1–3.
 * @returns frozen semantic rows in display order.
 */
export function formatAdaptiveInfoFooterRows(
  view: AdaptiveInfoFooterView,
  columns: number,
  maxRows = 3,
): readonly AdaptiveInfoFooterRow[] {
  const width = Math.max(1, columns)
  const budget = Math.max(1, Math.min(3, Math.floor(maxRows)))
  const rows: AdaptiveInfoFooterRow[] = [
    freezeRow('workspace', workspaceSegments(view, width), width),
  ]
  if (budget >= 2) {
    const metrics = metricsSegments(view, width)
    if (metrics.length > 0) rows.push(freezeRow('metrics', metrics, width))
  }
  const tip = view.tip === undefined ? '' : escapeContent(view.tip)
  if (budget >= 3 && tip !== '') {
    rows.push(freezeRow('operations', [segment(truncateDisplay(tip, width), 'fgDim')], width))
  }
  return Object.freeze(rows)
}

/**
 * Project semantic footer rows to plain text for non-styled consumers.
 * @param view - authoritative footer values.
 * @param columns - available display columns.
 * @param maxRows - available footer rows, clamped to 1–3.
 * @returns frozen non-empty lines in priority order.
 */
export function formatAdaptiveInfoFooter(
  view: AdaptiveInfoFooterView,
  columns: number,
  maxRows = 3,
): readonly string[] {
  return Object.freeze(formatAdaptiveInfoFooterRows(view, columns, maxRows).map(row =>
    row.runs.map(run => run.text).join('')))
}

/**
 * Format compact token counts, such as 28K or 1.2M.
 * @param count - token count to display.
 * @returns a decimal count with a K or M suffix when applicable.
 */
export function formatCompactTokens(count: number): string {
  if (count >= 1_000_000) {
    const val = count / 1_000_000
    return `${val >= 10 || count % 1_000_000 === 0 ? Math.round(val) : val.toFixed(1)}M`
  }
  if (count >= 1_000) {
    const val = count / 1_000
    return `${val >= 10 || count % 1_000 === 0 ? Math.round(val) : val.toFixed(1)}K`
  }
  return String(count)
}

/**
 * Format a single quiet status row:
 * Left: thinking visibility and the metrics entry, or an interaction tip.
 * Right: context meter, cache hit, and status. Optional fields are omitted
 * whole when space is limited; errors and retries take precedence.
 * @param view - authoritative footer values.
 * @param columns - available terminal columns.
 * @returns single quiet status row.
 */
export function formatQuietStatusRow(
  view: AdaptiveInfoFooterView,
  columns: number,
): AdaptiveInfoFooterRow {
  const width = Math.max(1, columns)
  const join = view.locale === 'en-US' ? ' ' : ''
  const leftCompact = `Ctrl+O ${tuiCopy('reasoning', view.locale)}${join}${tuiCopy(view.reasoningVisible === true ? 'on' : 'off', view.locale)}`
  const leftDefault = `${leftCompact} · /status ${tuiCopy('metrics', view.locale)}`
  const leftText = view.tip && view.tip !== '' ? escapeContent(view.tip) : leftDefault
  const critical: Segment[] = []
  const status = escapeContent(view.status)
  if (status !== '') critical.push(segment(status, statusToken(status)))
  if (view.retry !== undefined) critical.push(segment(retryText(view.retry, view.locale), 'warning'))
  const contexts = [...contextSegments(view.contextPressure, view.locale)]
  const pressure = view.contextPressure
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  const meter = contexts[0]
  if (used !== undefined && contextWindow !== undefined && contextWindow > 0 && meter !== undefined) {
    contexts.unshift({ runs: [
      ...meter.runs,
      { text: ` ${formatCompactTokens(used)}/${formatCompactTokens(contextWindow)}`, token: 'fgDim' },
    ] })
  }
  const cache = cacheHitSegment(view)
  const reservedLeft = width >= 80 ? displayWidth(leftCompact) + 1 : 0
  const rightBudget = Math.max(displayWidth(segmentsText(critical)), width - reservedLeft)
  let selected = critical
  const candidates = (cache === undefined ? [undefined] : [cache, undefined]).flatMap(hit =>
    [...contexts, undefined].map(context => [
      ...(context === undefined ? [] : [context]),
      ...(hit === undefined ? [] : [hit]),
      ...critical,
    ]))
  for (const candidate of candidates) {
    if (displayWidth(segmentsText(candidate)) <= rightBudget) {
      selected = candidate
      break
    }
  }
  const rightParts = flattenSegments(selected, width)
  const rightText = rightParts.map(r => r.text).join('')
  const rightWidth = displayWidth(rightText)

  if (rightWidth >= width) {
    return Object.freeze({
      kind: 'workspace',
      runs: Object.freeze([
        Object.freeze({ text: truncateDisplay(rightText, width), token: 'fgDim' as const }),
      ]),
    })
  }

  const availableForLeft = width - rightWidth - 1
  if (availableForLeft >= 10) {
    const fittedLeft = view.tip && view.tip !== ''
      ? truncateDisplay(leftText, availableForLeft)
      : [leftDefault, leftCompact].find(text => displayWidth(text) <= availableForLeft) ?? ''
    const spaces = Math.max(1, width - displayWidth(fittedLeft) - rightWidth)
    return Object.freeze({
      kind: 'workspace',
      runs: Object.freeze([
        Object.freeze({ text: fittedLeft, token: 'fgDim' as const }),
        Object.freeze({ text: ' '.repeat(spaces), token: 'fgDim' as const }),
        ...rightParts.map(r => Object.freeze({ ...r })),
      ]),
    })
  }

  return Object.freeze({
    kind: 'workspace',
    runs: Object.freeze(rightParts.map(r => Object.freeze({ ...r }))),
  })
}
