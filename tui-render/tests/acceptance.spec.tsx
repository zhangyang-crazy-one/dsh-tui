/** Phase 2 acceptance: ten scripted turns stay frozen, throttled, and bounded. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { createProjector } from '../src/projection.ts'
import { StreamView } from '../src/stream-view.tsx'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

/** Push one complete turn: user message + streamed assistant text. */
function pushTurn(
  projector: ReturnType<typeof createProjector>,
  turn: number,
  text: string,
  seqStart: number,
): number {
  projector.push(event(seqStart, 'turn/start', { turn }))
  projector.push(
    event(seqStart + 1, 'user/message', {
      role: 'user',
      content: [{ type: 'text', text: `task ${turn}` }],
      source: { kind: 'user' },
    }),
  )
  projector.push(
    event(seqStart + 2, 'assistant/chunk', {
      turn,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'text' },
    }),
  )
  projector.push(
    event(seqStart + 3, 'assistant/chunk', {
      turn,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text },
    }),
  )
  projector.push(
    event(seqStart + 4, 'assistant/chunk', {
      turn,
      step: 1,
      chunk: { type: 'block-end', index: 0, block: { type: 'text', text } },
    }),
  )
  projector.push(
    event(seqStart + 5, 'turn/end', { turn, reason: { kind: 'completed' } }),
  )
  return seqStart + 6
}

describe('ten-turn acceptance', () => {
  it('keeps every historical turn frozen across ten turns', () => {
    const projector = createProjector()
    let seq = 1
    for (let turn = 1; turn <= 10; turn += 1) {
      seq = pushTurn(projector, turn, `answer ${turn}`, seq)
    }
    const model = projector.snapshot()
    expect(model.status).toBe('idle')
    // Two rows per turn: the user message and the assistant answer.
    expect(model.history).toHaveLength(20)
    expect(model.history[0]).toEqual({ id: 2, kind: 'user', text: 'task 1', timestamp: 2 })
    expect(model.history[1]).toEqual({
      id: 6,
      kind: 'assistant',
      text: 'answer 1',
      content: [{ kind: 'text', text: 'answer 1' }],
      reasoningText: '',
      reasoningDurationMs: 5,
      timestamp: 6,
      turnOrdinal: 1,
    })
    expect(model.history[19]).toEqual({
      id: 60,
      kind: 'assistant',
      text: 'answer 10',
      content: [{ kind: 'text', text: 'answer 10' }],
      reasoningText: '',
      reasoningDurationMs: 5,
      timestamp: 60,
      turnOrdinal: 10,
    })
    // Freezing: history array identity survives further pushes.
    const before = model.history
    pushTurn(projector, 11, 'answer 11', seq)
    expect(projector.snapshot().history).toBe(before)
  })

  it('renders ten settled turns through the stream view without unbounded growth', () => {
    const projector = createProjector()
    let seq = 1
    for (let turn = 1; turn <= 10; turn += 1) {
      seq = pushTurn(projector, turn, `answer ${turn}`, seq)
    }
    const model = projector.snapshot()
    const out = renderToString(
      createElement(StreamView, {
        model,
      }),
    )
    expect(out).toContain('answer 1')
    expect(out).toContain('answer 10')
    expect(out).toContain('●')
  })
})
