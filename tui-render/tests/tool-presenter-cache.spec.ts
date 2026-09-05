/** Presenter views follow canonical revisions and registry identity, not UI toggles. */
import { expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolPresenterCache } from '../src/tool-presenter-cache.ts'
import type { ToolCardModel, ToolPresenterLookup } from '../src/tool-cards.ts'

it('reuses a pure presenter until the call, result, or registration changes', () => {
  const cache = new ToolPresenterCache(2)
  const presentCall = vi.fn(() => ({ card: 'generic' as const, title: 'Read' }))
  let definition: ReturnType<ToolPresenterLookup['get']> = { presentCall }
  const registry = { get: () => definition }
  const card: ToolCardModel = { callId: ToolCallId('a'), name: 'read', arguments: '{}', status: 'running' }
  const first = cache.present(registry, card)
  expect(cache.present(registry, { ...card })).toBe(first)
  expect(presentCall).toHaveBeenCalledTimes(1)
  expect(cache.present(registry, { ...card, status: 'ok', resultText: 'result' })).not.toBe(first)
  definition = { presentCall }
  cache.present(registry, card)
  expect(presentCall).toHaveBeenCalledTimes(3)
  definition = undefined
  expect(cache.present(registry, card).callView).toBeUndefined()
})

it('evicts old presenter results and releases all derived views on clear', () => {
  const cache = new ToolPresenterCache(1)
  const presentCall = vi.fn(() => ({ card: 'generic' as const, title: 'Read' }))
  const definition = { presentCall }
  const registry = { get: () => definition }
  const card: ToolCardModel = { callId: ToolCallId('a'), name: 'read', arguments: '{}', status: 'ok', resultText: 'full result' }
  cache.present(registry, card)
  cache.present(registry, { ...card, callId: ToolCallId('b') })
  cache.present(registry, card)
  expect(presentCall).toHaveBeenCalledTimes(3)
  cache.clear()
  expect(cache.present(registry, card).resultText).toBe('full result')
  expect(presentCall).toHaveBeenCalledTimes(4)
})
