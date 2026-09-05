/**
 * TurnTail 产物 contract: diff cards and generic `kind: 'edit'` cards yield
 * their follow-along locations in first-seen order; reads, deletes, failed
 * calls, and missing views contribute nothing (D-12).
 */

import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { formatTurnTailStats, producedPathsForTurn } from '../src/turn-tail.ts'
import type { ToolCardModel } from '../src/tool-cards.ts'

/** A card fixture with the given call view and status. */
function card(
  callView: ToolCardModel['callView'],
  status: ToolCardModel['status'] = 'ok',
): ToolCardModel {
  return {
    callId: ToolCallId(`call-${Math.random()}`),
    name: 'edit',
    arguments: '{}',
    status,
    callView,
  }
}

describe('producedPathsForTurn', () => {
  it('collects diff-card locations in first-seen order, deduped', () => {
    const cards = [
      card({
        card: 'diff',
        title: 'Write a.ts',
        diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }],
        locations: [{ path: 'a.ts' }],
      }),
      card({
        card: 'diff',
        title: 'Edit a.ts and b.ts',
        diffs: [
          { path: 'a.ts', oldText: 'x', newText: 'y' },
          { path: 'b.ts', oldText: null, newText: 'z' },
        ],
        locations: [{ path: 'a.ts' }, { path: 'b.ts' }],
      }),
    ]
    expect(producedPathsForTurn(cards)).toEqual(['a.ts', 'b.ts'])
  })

  it('collects generic edit-kind locations', () => {
    const cards = [
      card({
        card: 'generic',
        title: 'Insert into c.ts',
        kind: 'edit',
        locations: [{ path: 'c.ts' }],
      }),
    ]
    expect(producedPathsForTurn(cards)).toEqual(['c.ts'])
    expect(producedPathsForTurn([
      card({ card: 'generic', title: 'Edit without locations', kind: 'edit' }),
    ])).toEqual([])
  })

  it('skips failed calls, reads, and missing views', () => {
    const cards = [
      card(
        {
          card: 'diff',
          title: 'Edit a.ts',
          diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }],
          locations: [{ path: 'a.ts' }],
        },
        'error',
      ),
      card({ card: 'generic', title: 'Read d.ts', kind: 'read', locations: [{ path: 'd.ts' }] }),
      card(undefined),
    ]
    expect(producedPathsForTurn(cards)).toEqual([])
  })
})

describe('formatTurnTailStats', () => {
  it('formats exact turn input, output, timing, and one cache suffix', () => {
    const stats = formatTurnTailStats({
      turnOrdinal: 3,
      turnUsage: {
        uncachedInputTokens: 30,
        outputTokens: 7,
        totalTokens: 50,
        cacheReadTokens: 13,
        cacheWriteTokens: 0,
      },
      elapsedMs: 340,
    })
    expect(stats).toBe('turn 3 · ↑43 · ↓7 · 340 ms · 缓存命中 30%')
    expect(stats?.match(/%/gu)).toHaveLength(1)
  })

  it('omits cache hit without complete buckets and retains legacy output', () => {
    expect(formatTurnTailStats({
      turnOrdinal: 1,
      turnUsage: {
        uncachedInputTokens: 10,
        outputTokens: 2,
        totalTokens: 20,
      },
    })).toBe('turn 1 · ↑18 · ↓2')
    expect(formatTurnTailStats({
      legacyOutputTokens: 4,
      elapsedMs: 8,
    })).toBe('↓4 · 8 ms')
  })
})
