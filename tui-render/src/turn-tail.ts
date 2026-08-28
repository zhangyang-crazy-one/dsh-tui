/**
 * TurnTail data contract: the files one frozen assistant turn produced,
 * derived from mutation cards' render intent — a diff card, or a generic card
 * whose host `kind` is `edit` — through their follow-along `locations`, never
 * from tool names or closing prose. Reads, deletes, and failed calls
 * contribute nothing; paths keep first-seen order and appear once. Copied
 * from dsh-client-ui-deliverables per D-12 without importing that package.
 * @module @deepseek-ai/dsh-tui-render/turn-tail
 */

import type { ToolCardModel } from './tool-cards.ts'

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
