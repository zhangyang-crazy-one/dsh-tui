/** Bounded presenter results keyed by the logged call revision and registered presenter. */
import { attachPresenterViews, type ToolCardModel, type ToolPresenterLookup } from './tool-cards.ts'

/** Reuse pure presenter views across unrelated disclosure, caret, and viewport updates. */
export class ToolPresenterCache {
  private readonly entries = new Map<string, { input: ToolCardModel; output: ToolCardModel; definition: ReturnType<ToolPresenterLookup['get']> }>()

  /** @param capacity - maximum retained tool revisions, validated by the host. */
  constructor(private readonly capacity: number) {}

  /**
   * Attach views once for an unchanged call/result and presenter registration.
   * @param lookup - current tool registry.
   * @param card - canonical paired tool data.
   * @returns presenter-enriched data, or the generic fallback.
   */
  present(lookup: ToolPresenterLookup | undefined, card: ToolCardModel): ToolCardModel {
    const definition = lookup?.get(card.name)
    const cached = this.entries.get(card.callId)
    if (cached !== undefined && cached.definition === definition
      && cached.input.name === card.name && cached.input.arguments === card.arguments
      && cached.input.resultText === card.resultText && cached.input.status === card.status
      && cached.input.meta === card.meta && cached.input.error === card.error) {
      this.entries.delete(card.callId)
      this.entries.set(card.callId, cached)
      return cached.output
    }
    const output = attachPresenterViews(definition === undefined ? undefined : { get: () => definition }, card)
    this.entries.delete(card.callId)
    this.entries.set(card.callId, { input: card, output, definition })
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value as string)
    return output
  }

  /** Release presenter-derived data when the transcript owner unmounts. */
  clear(): void { this.entries.clear() }
}
