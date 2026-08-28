import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { RuntimeController, type StructuredDraft } from '../src/index.ts'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import { createProjector } from '@deepseek-ai/dsh-tui-render'

type UserMessage = ReturnType<typeof createUserMessage>

type ControllerState = {
  machine: 'idle' | 'generating' | 'stopped' | 'exit-armed'
  agentHandle: {
    followup(message: UserMessage): void
    steer(message: UserMessage): void
    cancel(): void
  }
  messageFromDraft(draft: StructuredDraft): UserMessage
}

function bench(): {
  ctx: Context
  controller: RuntimeController
  followup: ReturnType<typeof vi.fn<(message: UserMessage) => void>>
  steer: ReturnType<typeof vi.fn<(message: UserMessage) => void>>
  state: ControllerState
} {
  const ctx = new Context()
  const controller = new RuntimeController(
    ctx,
    { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
    { task: '' },
    () => {},
  )
  const followup = vi.fn<(message: UserMessage) => void>()
  const steer = vi.fn<(message: UserMessage) => void>()
  const state = controller as unknown as ControllerState
  state.agentHandle = { followup, steer, cancel: () => {} }
  return { ctx, controller, followup, steer, state }
}

function draftText(draft: StructuredDraft): string {
  return draft.segments
    .filter(segment => segment.kind === 'text')
    .map(segment => segment.text)
    .join('')
}

describe('RuntimeController structured draft submit', () => {
  it('materializes an idle submission as an ordinary follow-up', async () => {
    const { ctx, controller, followup, steer } = bench()
    controller.dispatch({ kind: 'send', text: 'ordinary draft' })
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0].content).toEqual([
      { type: 'text', text: 'ordinary draft' },
    ])
    expect(steer).not.toHaveBeenCalled()
    expect(controller.getInteraction()).toBe('generating')
    expect(controller.getDraftQueue()).toEqual({ fifo: [] })
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('hands off one running-turn steer and freezes later drafts in FIFO order', async () => {
    const { ctx, controller, followup, steer, state } = bench()
    state.machine = 'generating'
    controller.dispatch({ kind: 'send', text: 'steer now' })
    expect(controller.getFeedback()).toBe('已引导当前回合')
    controller.dispatch({ kind: 'send', text: 'later one' })
    controller.dispatch({ kind: 'send', text: 'later two' })
    expect(steer).toHaveBeenCalledOnce()
    expect(steer.mock.calls[0]?.[0].content).toEqual([
      { type: 'text', text: 'steer now' },
    ])
    expect(followup).not.toHaveBeenCalled()
    const queue = controller.getDraftQueue()
    expect(queue.currentTurn).toMatchObject({
      draft: { draftId: 1 }, state: 'handoff',
    })
    expect(queue.fifo.map(draftText)).toEqual(['later one', 'later two'])
    expect(queue.fifo.map(draft => draft.draftId)).toEqual([2, 3])
    expect(Object.isFrozen(queue)).toBe(true)
    expect(Object.isFrozen(queue.fifo)).toBe(true)
    expect(Object.isFrozen(queue.fifo[0])).toBe(true)
    expect(Object.isFrozen(queue.fifo[0]?.segments)).toBe(true)
    expect(() => {
      ;(queue.fifo as StructuredDraft[]).push(queue.fifo[0]!)
    }).toThrow()
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('keeps whitespace-only submission outside every draft lane', async () => {
    const { ctx, controller, followup, steer, state } = bench()
    state.machine = 'generating'
    controller.dispatch({ kind: 'send', text: '   ' })
    expect(followup).not.toHaveBeenCalled()
    expect(steer).not.toHaveBeenCalled()
    expect(controller.getDraftQueue()).toEqual({ fifo: [] })
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('materializes future image segments without reordering text or refs', async () => {
    const { ctx, controller, state } = bench()
    const attachment = {
      attachmentId: 'attachment-1',
      mediaType: 'image/png',
      bytes: 4,
      width: 1,
      height: 1,
      name: 'fixture.png',
    } as Extract<ContentBlock, { type: 'image' }>['attachment']
    const draft: StructuredDraft = Object.freeze({
      draftId: 99,
      segments: Object.freeze([
        Object.freeze({ kind: 'text' as const, text: 'before' }),
        Object.freeze({ kind: 'image' as const, ref: attachment, name: 'fixture.png' }),
        Object.freeze({ kind: 'text' as const, text: 'after' }),
      ]),
    })
    expect(state.messageFromDraft(draft).content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'image', attachment },
      { type: 'text', text: 'after' },
    ])
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('takes back the FIFO head intact and toggles only the latest compaction divider', async () => {
    const { ctx, controller, state } = bench()
    controller.dispatch({ kind: 'take-queued-draft' })
    controller.dispatch({ kind: 'toggle-compaction-divider' })
    expect(controller.getComposerDraft()).toBe('')
    expect(controller.getModel().expandedCompactionId).toBeUndefined()
    state.machine = 'generating'
    controller.dispatch({ kind: 'send', text: 'steer' })
    controller.dispatch({ kind: 'send', text: 'oldest' })
    controller.dispatch({ kind: 'send', text: 'newest' })
    expect(controller.getQueuedDraftCount()).toBe(2)
    expect(controller.getQueuedDraftText()).toBe('oldest')
    const oldest = controller.getDraftQueue().fifo[0]
    controller.dispatch({ kind: 'take-queued-draft' })
    expect(controller.getComposerDraft()).toBe('oldest')
    expect(controller.getComposerStructuredDraft()).toBe(oldest)
    expect(controller.getQueuedDraftCount()).toBe(1)
    expect(controller.getQueuedDraftText()).toBe('newest')
    controller.dispatch({ kind: 'take-queued-draft' })
    expect(controller.getQueuedDraftCount()).toBe(0)
    expect(controller.getComposerDraft()).toBe('newest')

    const projector = createProjector()
    projector.push({
      type: 'compaction/start', seq: 1, time: 1,
      data: { compactionId: CompactionId('first'), turn: null },
    })
    projector.push({
      type: 'compaction/start', seq: 2, time: 2,
      data: { compactionId: CompactionId('latest'), turn: null },
    })
    ;(state as unknown as { projector: ReturnType<typeof createProjector> }).projector = projector
    controller.dispatch({ kind: 'toggle-compaction-divider' })
    expect(controller.getModel().expandedCompactionId).toBe('latest')
    controller.dispatch({ kind: 'toggle-compaction-divider' })
    expect(controller.getModel().expandedCompactionId).toBeUndefined()
    await controller.dispose()
    await ctx.fiber.dispose()
  })
})
