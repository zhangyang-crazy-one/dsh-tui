/**
 * TurnTail data contract: the files one frozen assistant turn produced,
 * derived from mutation cards' render intent — a diff card, or a generic card
 * whose host `kind` is `edit` — through their follow-along `locations`, never
 * from tool names or closing prose. Reads, deletes, and failed calls
 * contribute nothing; paths keep first-seen order and appear once. Copied
 * from dsh-client-ui-deliverables per D-12 without importing that package.
 * @module @deepseek-ai/dsh-tui-render/turn-tail
 */

import { formatCacheHitPercent } from '@deepseek-ai/dsh-token-meter/client'
import type { TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { ToolCardModel } from './tool-cards.ts'

/** Authoritative values that may contribute to one completed turn's stats row. */
export interface TurnTailStatsView {
  readonly turnOrdinal?: number | undefined
  readonly turnUsage?: TurnTokenUsage | undefined
  readonly legacyOutputTokens?: number | undefined
  readonly elapsedMs?: number | undefined
}

/**
 * Format one stable completed-turn accounting row. Exact turn usage wins over
 * the legacy last-step output field; cache hit appears only when both cache
 * buckets make its denominator explainable.
 * @param view - durable turn-local accounting and timing.
 * @returns the joined row, or undefined when no authoritative field exists.
 */
export function formatTurnTailStats(view: TurnTailStatsView): string | undefined {
  const parts: string[] = []
  if (view.turnOrdinal !== undefined) parts.push(`turn ${String(view.turnOrdinal)}`)
  const usage = view.turnUsage
  if (usage !== undefined) {
    const promptTokens = usage.totalTokens - usage.outputTokens
    parts.push(`↑${String(promptTokens)}`)
    parts.push(`↓${String(usage.outputTokens)}`)
  } else if (view.legacyOutputTokens !== undefined) {
    parts.push(`↓${String(view.legacyOutputTokens)}`)
  }
  if (view.elapsedMs !== undefined) parts.push(`${String(view.elapsedMs)} ms`)
  if (
    usage?.cacheReadTokens !== undefined
    && usage.cacheWriteTokens !== undefined
  ) {
    const promptTokens = usage.totalTokens - usage.outputTokens
    const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, promptTokens)
    if (cacheHit !== null) parts.push(`缓存命中 ${cacheHit}%`)
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/**
 * Files produced by one frozen turn's tool cards, in first-seen order.
 * @param cards - the turn's folded tool cards (callView attached).
 * @returns produced display paths; empty when the turn wrote nothing.
 */
export function producedPathsForTurn(cards: readonly ToolCardModel[]): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    if (card.status === 'error') continue
    const view = card.callView
    if (view === undefined) continue
    if (view.card !== 'diff' && !(view.card === 'generic' && view.kind === 'edit')) {
      continue
    }
    for (const location of view.locations ?? []) {
      if (seen.has(location.path)) continue
      seen.add(location.path)
      paths.push(location.path)
    }
  }
  return paths
}
