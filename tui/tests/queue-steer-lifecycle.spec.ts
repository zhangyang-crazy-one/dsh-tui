import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createProjector } from '@deepseek-ai/dsh-tui-render'
import { RuntimeController } from '../src/index.ts'

interface Fixture {
  ctx: Context
  controller: RuntimeController
  agent: Agent
  session: Session
  inbox: Inbox
  followup: ReturnType<typeof vi.fn>
  steer: ReturnType<typeof vi.fn>
  dispose(): Promise<void>
}

async function fixture(): Promise<Fixture> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create(SessionId(`queue-${randomUUID()}`))
  const followup = vi.fn()
  const steer = vi.fn()
  const agent = {} as Agent
  const inbox = new Inbox(session, {
    inserted: (message) => { ctx.emit('agent/inbox/inserted', { agent, message }) },
    claimed: (message, turn) => { ctx.emit('agent/inbox/claimed', { agent, message, turn }) },
    discarded: (message) => { ctx.emit('agent/inbox/discarded', { agent, message }) },
  })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox,
    status: 'running',
    ctx,
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (message: ReturnType<typeof createUserMessage>) => {
      followup(message)
      inbox.append('next-turn', message)
    },
    steer: (message: ReturnType<typeof createUserMessage>) => {
      steer(message)
      inbox.append('next-step', message)
    },
    inject: () => {},
  } satisfies Partial<Agent>)
  const controller = new RuntimeController(
    ctx,
    { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
    { task: '' },
    () => {},
  )
  const state = controller as unknown as {
    commitCandidate(candidate: {
      handle: { agent: Agent; dispose(): Promise<void> }
      projector: ReturnType<typeof createProjector>
      modelSelectionRef: {
        current: { provider: string; model: string }
        assembled: undefined
      }
      badge: string
    }): void
    machine: 'generating'
  }
  state.commitCandidate({
    handle: { agent, dispose: () => Promise.resolve() },
    projector: createProjector(),
    modelSelectionRef: {
      current: { provider: 'test-provider', model: 'test-model' },
      assembled: undefined,
    },
    badge: 'test-provider · test-model',
  })
  state.machine = 'generating'
  return {
    ctx,
    controller,
    agent,
    session,
    inbox,
    followup,
    steer,
    dispose: async () => {
      await controller.dispose()
      await ctx.fiber.dispose()
    },
  }
}

function text(message: ReturnType<typeof createUserMessage>): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('RuntimeController steer lifecycle', () => {
  it('tracks insert/claim/durable adoption and drains one FIFO draft at turn end', async () => {
    const test = await fixture()
    test.controller.dispatch({ kind: 'send', text: 'current steer' })
    test.controller.dispatch({ kind: 'send', text: 'next turn' })
    const steered = test.steer.mock.calls[0]?.[0] as ReturnType<typeof createUserMessage>
    expect(test.controller.getDraftQueue().currentTurn?.state).toBe('inserted')
    test.session.append('turn/start', { turn: 1 })
    expect(test.inbox.claim('next-step', 1)).toEqual([steered])
    expect(test.controller.getDraftQueue().currentTurn?.state).toBe('claimed')
    test.session.append('user/message', steered, { surfaceOp: 'append' })
    test.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(test.followup).not.toHaveBeenCalled()
    test.ctx.emit('agent/status', { agent: test.agent, status: 'idle' })
    expect(test.controller.getDraftQueue()).toEqual({ fifo: [] })
    expect(test.followup).toHaveBeenCalledOnce()
    expect(text(test.followup.mock.calls[0]?.[0] as ReturnType<typeof createUserMessage>)).toBe(
      'next turn',
    )
    expect(test.inbox.nextTurn).toHaveLength(1)
    await test.dispose()
  })

  it('uses discard and unadopted turn settlement as authoritative cleanup', async () => {
    const discarded = await fixture()
    discarded.controller.dispatch({ kind: 'send', text: 'discard me' })
    const discardedMessage = discarded.steer.mock.calls[0]?.[0] as ReturnType<typeof createUserMessage>
    expect(discarded.inbox.remove(discardedMessage.id)).toBe(true)
    expect(discarded.controller.getDraftQueue().currentTurn).toBeUndefined()
    expect(discarded.controller.getFeedback()).toBe('当前回合草稿已取消')
    await discarded.dispose()

    const unadopted = await fixture()
    unadopted.controller.dispatch({ kind: 'send', text: 'claim without transcript' })
    unadopted.session.append('turn/start', { turn: 1 })
    unadopted.inbox.claim('next-step', 1)
    unadopted.session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } })
    expect(unadopted.controller.getDraftQueue().currentTurn).toBeUndefined()
    expect(unadopted.controller.getFeedback()).toBe('当前回合未采纳草稿')
    await unadopted.dispose()
  })

  it('ignores other agent and message identities', async () => {
    const test = await fixture()
    test.ctx.emit('agent/status', { agent: test.agent, status: 'idle' })
    test.controller.dispatch({ kind: 'send', text: 'identity-bound' })
    const before = test.controller.getDraftQueue()
    const otherMessage = createUserMessage({
      content: [{ type: 'text', text: 'other' }],
      source: { kind: 'user' },
    })
    test.ctx.emit('agent/inbox/claimed', {
      agent: { ...test.agent, id: SessionId('other-agent') },
      message: otherMessage,
      turn: 1,
    })
    test.ctx.emit('agent/inbox/claimed', {
      agent: test.agent,
      message: otherMessage,
      turn: 1,
    })
    test.ctx.emit('agent/inbox/inserted', {
      agent: { ...test.agent, id: SessionId('other-insert-agent') },
      message: otherMessage,
    })
    test.ctx.emit('agent/inbox/discarded', {
      agent: test.agent,
      message: otherMessage,
    })
    test.ctx.emit('agent/inbox/discarded', {
      agent: { ...test.agent, id: SessionId('other-discard-agent') },
      message: otherMessage,
    })
    test.ctx.emit('agent/status', { agent: test.agent, status: 'running' })
    test.ctx.emit('agent/status', {
      agent: { ...test.agent, id: SessionId('other-status-agent') },
      status: 'idle',
    })
    expect(test.controller.getDraftQueue()).toEqual(before)
    await test.dispose()
  })
})
