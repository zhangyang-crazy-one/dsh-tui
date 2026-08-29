import { describe, expect, it } from 'vitest'
import { createProjector, EMPTY_VIEW } from '../src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

describe('createProjector', () => {
  it('ignores orphan lifecycle events and merge-extensible content blocks', () => {
    const projector = createProjector()
    projector.seed([
      event(1, 'step/start', { turn: 1, step: 1 }),
      event(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'orphan' } }),
      event(3, 'assistant/message', { turn: 1, step: 1, message: { content: [] } }),
      event(4, 'tool/call', { turn: 1, step: 1, callId: 'orphan', name: 'read', arguments: '{}' }),
      event(5, 'tool/result', { turn: 1, step: 1, message: { content: [] } }),
      event(6, 'step/end', { turn: 1, step: 1 }),
      event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event(8, 'future/event', {}),
    ])
    expect(projector.snapshot()).toEqual(EMPTY_VIEW)

    projector.push(event(9, 'turn/start', { turn: 2 }))
    projector.push(event(10, 'turn/end', { turn: 2, reason: { kind: 'completed' } }))
    expect(projector.snapshot().history).toEqual([])

    projector.push(event(20, 'turn/start', { turn: 3 }))
    projector.push(event(21, 'step/start', { turn: 3, step: 1 }))
    projector.push(event(25, 'assistant/message', {
      turn: 3,
      step: 1,
      message: {
        id: 'with-image',
        role: 'assistant',
        source: { kind: 'model', provider: 'test', model: 'test' },
        content: [
          { type: 'image', data: 'ignored', mimeType: 'image/png' },
          { type: 'text', text: 'visible' },
        ],
      },
      usage: { inputTokens: 3, outputTokens: 7 },
    }))
    projector.push(event(26, 'turn/end', { turn: 3, reason: { kind: 'completed' } }))
    expect(projector.snapshot().history).toEqual([
      expect.objectContaining({
        text: 'visible',
        usageOutputTokens: 7,
        stepWallMs: 4,
      }),
    ])
  })

  it('assembles streamed text deltas into the active turn', () => {
    const projector = createProjector()
    projector.push(event(1, 'turn/start', { turn: 1 }))
    projector.push(
      event(2, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
    )
    projector.push(
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'hi ' },
      }),
    )
    projector.push(
      event(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'there' },
      }),
    )
    projector.push(
      event(5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'hi there' },
        },
      }),
    )
    const model = projector.snapshot()
    expect(model.activeTurn?.assistantText).toBe('hi there')
    expect(model.status).toBe('generating')
  })

  it('freezes the turn into history on turn/end and goes idle', () => {
    const projector = createProjector()
    projector.push(event(1, 'turn/start', { turn: 1 }))
    projector.push(
      event(2, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
    )
    projector.push(
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'done' },
      }),
    )
    projector.push(
      event(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: 'done' },
        },
      }),
    )
    projector.push(
      event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    )
    const model = projector.snapshot()
    expect(model.activeTurn).toBeUndefined()
    expect(model.status).toBe('idle')
    expect(model.history).toEqual([
      {
        id: 5,
        kind: 'assistant',
        text: 'done',
        reasoningText: '',
        reasoningDurationMs: 4,
        content: [{ kind: 'text', text: 'done' }],
        timestamp: 5,
        turnOrdinal: 1,
      },
    ])
  })

  it('keeps historical messages frozen across later pushes', () => {
    const projector = createProjector()
    projector.push(event(1, 'turn/start', { turn: 1 }))
    projector.push(
      event(2, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
    )
    projector.push(
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'first' },
      }),
    )
    projector.push(
      event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    )
    const before = projector.snapshot().history
    projector.push(event(5, 'turn/start', { turn: 2 }))
    projector.push(
      event(6, 'assistant/chunk', {
        turn: 2,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
    )
    const after = projector.snapshot().history
    expect(after).toBe(before)
    expect(after).toHaveLength(1)
  })

  it('projects only direct human input as user transcript rows', () => {
    const projector = createProjector()
    projector.push(event(1, 'user/message', {
      content: [{ type: 'text', text: 'internal instructions' }],
      source: { kind: 'plugin', plugin: 'test', form: 'instructions' },
    }))
    projector.push(event(2, 'user/message', {
      content: [
        { type: 'text', text: 'human prompt ' },
        {
          type: 'image',
          attachment: {
            attachmentId: `sha256:${'a'.repeat(64)}`,
            mediaType: 'image/png',
            bytes: 1,
            width: 1,
            height: 1,
            name: 'pixel.png',
          },
        },
        { type: 'text', text: ' then ' },
        {
          type: 'image',
          attachment: {
            attachmentId: `sha256:${'b'.repeat(64)}`,
            mediaType: 'image/jpeg',
            bytes: 2,
            width: 2,
            height: 1,
          },
        },
      ],
      source: { kind: 'user' },
    }))
    projector.push(event(3, 'user/message', {
      content: [{ type: 'text', text: 'skill catalog' }],
      source: { kind: 'skill-catalog' },
    }))

    expect(projector.snapshot().history).toEqual([
      {
        id: 2,
        kind: 'user',
        text: 'human prompt [图片 #1 · pixel.png] then [图片 #2]',
        timestamp: 2,
      },
    ])
    expect(projector.snapshot().history[0]?.text).not.toContain('sha256:')
  })

  it('retains ordered reasoning, tool records, and later-step text in one completed turn', () => {
    const events = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
      }),
      event(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'inspect first' },
      }),
      event(5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 1, blockType: 'tool-call' },
      }),
      event(6, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'tool-call-delta',
          index: 1,
          id: 'call-1',
          name: 'read_file',
          argumentsDelta: '{"path":"a.ts"}',
        },
      }),
      event(7, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-step-1',
          role: 'assistant',
          source: { kind: 'model', provider: 'test', model: 'test' },
          content: [
            { type: 'reasoning', text: 'inspect first' },
            {
              type: 'tool-call',
              id: 'call-1',
              name: 'read_file',
              arguments: '{"path":"a.ts"}',
            },
          ],
        },
      }),
      event(8, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'call-1',
        name: 'read_file',
        arguments: '{"path":"a.ts"}',
      }),
      event(9, 'tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'tool-message-1',
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1',
            content: [{ type: 'text', text: 'file contents' }],
            isError: false,
          }],
        },
        error: { name: 'ToolWarning', code: 'PARTIAL' },
        meta: { presentation: 'diff' },
      }),
      event(10, 'step/end', { turn: 1, step: 1 }),
      event(11, 'step/start', { turn: 1, step: 2 }),
      event(12, 'assistant/chunk', {
        turn: 1,
        step: 2,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
      event(13, 'assistant/chunk', {
        turn: 1,
        step: 2,
        chunk: { type: 'text-delta', index: 0, text: 'final answer' },
      }),
      event(14, 'assistant/message', {
        turn: 1,
        step: 2,
        message: {
          id: 'assistant-step-2',
          role: 'assistant',
          source: { kind: 'model', provider: 'test', model: 'test' },
          content: [{ type: 'text', text: 'final answer' }],
        },
      }),
      event(15, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]

    const projector = createProjector()
    projector.seed(events)
    const message = projector.snapshot().history[0]
    expect(message).toMatchObject({
      id: 15,
      kind: 'assistant',
      text: 'final answer',
      reasoningText: 'inspect first',
    })
    // The run spans the reasoning block-start (time 3) to the tool/call that
    // ends it (time 8).
    expect(message?.content?.[0]).toEqual({
      kind: 'reasoning',
      text: 'inspect first',
      durationMs: 5,
    })
    expect(message?.content?.slice(1)).toEqual([
      {
        kind: 'tool-call',
        callId: 'call-1',
        name: 'read_file',
        arguments: '{"path":"a.ts"}',
      },
      {
        kind: 'tool-result',
        callId: 'call-1',
        text: 'file contents',
        isError: false,
        error: { name: 'ToolWarning', code: 'PARTIAL' },
        meta: { presentation: 'diff' },
      },
      { kind: 'text', text: 'final answer' },
    ])

    const replay = createProjector()
    replay.seed(events)
    expect(replay.snapshot().history[0]?.id).toBe(message?.id)
    expect(replay.snapshot().history[0]?.content).toEqual(message?.content)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message?.content)).toBe(true)
  })

  it('tracks reasoning deltas and tool calls', () => {
    const projector = createProjector()
    projector.push(event(1, 'turn/start', { turn: 1 }))
    projector.push(
      event(2, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
      }),
    )
    projector.push(
      event(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'thinking…' },
      }),
    )
    projector.push(
      event(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'block-end',
          index: 0,
          block: { type: 'reasoning', text: 'thinking…' },
        },
      }),
    )
    projector.push(
      event(5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 1, blockType: 'tool-call' },
      }),
    )
    projector.push(
      event(6, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'tool-call-delta',
          index: 1,
          id: 'c1',
          name: 'bash',
          argumentsDelta: '{"cmd":"ls"}',
        },
      }),
    )
    projector.push(
      event(7, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'block-end',
          index: 1,
          block: {
            type: 'tool-call',
            id: 'c1',
            name: 'bash',
            arguments: '{"cmd":"ls"}',
          },
        },
      }),
    )
    const model = projector.snapshot()
    expect(model.activeTurn?.reasoningText).toBe('thinking…')
    expect(model.activeTurn?.toolCalls).toEqual([
      { callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' },
    ])
  })

  it('stamps a distinct duration on each reasoning run', () => {
    const projector = createProjector()
    projector.push(event(10, 'turn/start', { turn: 1 }))
    projector.push(event(12, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }))
    projector.push(event(20, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'first' },
    }))
    projector.push(event(30, 'tool/call', {
      turn: 1,
      step: 1,
      callId: 'c1',
      name: 'bash',
      arguments: '{}',
    }))
    projector.push(event(40, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'tool-1',
        role: 'user',
        source: { kind: 'tool', callId: 'c1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'c1',
          content: [{ type: 'text', text: 'ok' }],
        }],
      },
    }))
    projector.push(event(45, 'step/end', { turn: 1, step: 1 }))
    projector.push(event(46, 'step/start', { turn: 1, step: 2 }))
    projector.push(event(50, 'assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }))
    projector.push(event(55, 'assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'reasoning-delta', index: 0, text: 'second' },
    }))
    const content = projector.snapshot().activeTurn?.content ?? []
    const reasoning = content.filter(
      (item): item is Extract<typeof item, { kind: 'reasoning' }> =>
        item.kind === 'reasoning',
    )
    expect(reasoning.map(item => item.text)).toEqual(['first', 'second'])
    expect(reasoning[0]?.durationMs).toBe(18)
    expect(reasoning[1]?.durationMs).toBe(5)
    expect(reasoning[0]?.durationMs).not.toBe(reasoning[1]?.durationMs)
  })

  it('freezes per-run reasoning durations into history at turn/end', () => {
    const projector = createProjector()
    projector.push(event(10, 'turn/start', { turn: 1 }))
    projector.push(event(12, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }))
    projector.push(event(20, 'assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', index: 0, text: 'first' },
    }))
    projector.push(event(30, 'tool/call', {
      turn: 1,
      step: 1,
      callId: 'c1',
      name: 'bash',
      arguments: '{}',
    }))
    projector.push(event(40, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'tool-1',
        role: 'user',
        source: { kind: 'tool', callId: 'c1' },
        content: [{
          type: 'tool-result',
          toolCallId: 'c1',
          content: [{ type: 'text', text: 'ok' }],
        }],
      },
    }))
    projector.push(event(45, 'step/end', { turn: 1, step: 1 }))
    projector.push(event(46, 'step/start', { turn: 1, step: 2 }))
    projector.push(event(50, 'assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'block-start', index: 0, blockType: 'reasoning' },
    }))
    projector.push(event(55, 'assistant/chunk', {
      turn: 1,
      step: 2,
      chunk: { type: 'reasoning-delta', index: 0, text: 'second' },
    }))
    projector.push(event(60, 'turn/end', {
      turn: 1,
      reason: { kind: 'completed' },
    }))
    const model = projector.snapshot()
    expect(model.activeTurn).toBeUndefined()
    const frozen = model.history.at(-1)
    const reasoning = (frozen?.content ?? []).filter(
      (item): item is Extract<typeof item, { kind: 'reasoning' }> =>
        item.kind === 'reasoning',
    )
    expect(reasoning.map(item => item.text)).toEqual(['first', 'second'])
    expect(reasoning[0]?.durationMs).toBe(18)
    expect(reasoning[1]?.durationMs).toBe(10)
  })

  it('freezes the previous reasoning run when a second run starts in the same fold', () => {
    const projector = createProjector()
    projector.push(event(1, 'turn/start', { turn: 1 }))
    projector.push(event(5, 'assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'a1',
        role: 'assistant',
        source: { kind: 'model', provider: 'test', model: 'test' },
        content: [
          { type: 'reasoning', text: 'alpha' },
          { type: 'reasoning', text: 'beta' },
        ],
      },
    }))
    const reasoning = (projector.snapshot().activeTurn?.content ?? []).filter(
      (item): item is Extract<typeof item, { kind: 'reasoning' }> =>
        item.kind === 'reasoning',
    )
    expect(reasoning.map(item => item.text)).toEqual(['alpha', 'beta'])
    expect(reasoning[0]?.durationMs).toBe(0)
    expect(reasoning[1]?.durationMs).toBe(0)
  })

  it('starts from the empty model', () => {
    const projector = createProjector()
    expect(projector.snapshot()).toEqual(EMPTY_VIEW)
  })
})
