/**
 * Agent-scoped user-question listener: delegation, FIFO with approval,
 * digit+Enter labels, and ASK_ABORTED cancellation.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

/** Scripted agent whose followup records the message and appends nothing. */
function scriptedAgent(
  ownerCtx: Context,
  session: Session,
  followup: (message: UserMessage) => void,
): Agent {
  const agent = {} as Agent
  const agentCtx = ownerCtx.extend({ agent })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, {
      inserted: () => {},
      discarded: () => {},
      claimed: () => {},
    }),
    status: 'idle',
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup,
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  return agent
}

interface Bench {
  ctx: Context
  controller: RuntimeController
  liveAgent: Agent
  createdAgents: Agent[]
}

/** Mount registries, UserQuestionService, and a scripted factory. */
async function bench(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(UserQuestionService)
  let liveAgent: Agent | undefined
  const createdAgents: Agent[] = []
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session, () => {})
      liveAgent = agent
      createdAgents.push(agent)
      await options.setup?.(agent.ctx)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: async () => {
          unregister()
        },
      }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  await controller.start()
  if (liveAgent === undefined) throw new Error('expected a live agent')
  return { ctx, controller, liveAgent, createdAgents }
}

describe('userQuestions listener', () => {
  it('delegates an unscoped request without occupying the TUI queue', async () => {
    const { ctx, controller } = await bench()
    const dispose = ctx.on('user-questions/request', request => Promise.resolve({
      answers: request.questions.map(question => ({
        id: question.id,
        selected: ['delegated'],
      })),
    }))
    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'global', question: 'handled elsewhere?' }],
    })).resolves.toEqual({
      answers: [{ id: 'global', selected: ['delegated'] }],
    })
    expect(controller.getAskUserPane().open).toBe(false)
    dispose()
    await ctx.fiber.dispose()
  })

  it('delegates another live root and rejects an owned child without notifying', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const notify = vi.spyOn(
      controller as unknown as { notifyAttention(input: unknown): void },
      'notifyAttention',
    )
    const foreign = scriptedAgent(
      ctx,
      ctx.sessions.create(SessionId('session-foreign-root')),
      () => {},
    )
    const disposeForeign = ctx.agents.register(foreign)
    const disposeAnswerer = ctx.on('user-questions/request', (request, next) => {
      if (request.agent !== foreign) return next()
      return Promise.resolve({
        answers: request.questions.map(question => ({
          id: question.id,
          selected: ['foreign'],
        })),
      })
    })
    await expect(ctx.userQuestions.ask({
      agent: foreign,
      questions: [{ id: 'foreign', question: 'foreign root?' }],
    })).resolves.toEqual({
      answers: [{ id: 'foreign', selected: ['foreign'] }],
    })

    const child = scriptedAgent(
      ctx,
      ctx.sessions.create(SessionId('session-owned-child')),
      () => {},
    )
    const detachChild = ctx.agents.enter(child, liveAgent)
    await expect(ctx.userQuestions.ask({
      agent: child,
      questions: [{ id: 'child', question: 'owned child?' }],
    })).rejects.toMatchObject({ code: 'DELEGATED_CALLER' })
    expect(controller.getAskUserPane().open).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    detachChild()
    disposeAnswerer()
    disposeForeign()
    await ctx.fiber.dispose()
  })

  it('does not enqueue or notify a pre-aborted request', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const notify = vi.spyOn(
      controller as unknown as { notifyAttention(input: unknown): void },
      'notifyAttention',
    )
    const abort = new AbortController()
    abort.abort()
    await expect(ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{ id: 'cancelled', question: 'too late?' }],
      signal: abort.signal,
    })).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(controller.getAskUserPane().open).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('cancels a waiting request when the controller disposes', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'dispose',
        question: 'still there?',
        options: [{ label: 'yes' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    await controller.dispose()
    await expect(asked).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(controller.getAskUserPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('tears down the old listener and pending request when the root Agent changes', async () => {
    const { ctx, controller, liveAgent, createdAgents } = await bench()
    const oldRequest = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'old-root',
        question: 'old root?',
        options: [{ label: 'yes' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })

    controller.dispatch({ kind: 'new-session' })
    await expect(oldRequest).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await vi.waitFor(() => {
      expect(createdAgents).toHaveLength(2)
      expect(controller.getAskUserPane().open).toBe(false)
    })

    const replacement = createdAgents[1]
    if (replacement === undefined) throw new Error('expected replacement agent')
    const nextRequest = ctx.userQuestions.ask({
      agent: replacement,
      questions: [{
        id: 'new-root',
        question: 'new root?',
        options: [{ label: 'yes' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'ask-user-submit' })
    await expect(nextRequest).resolves.toEqual({
      answers: [{ id: 'new-root', selected: ['yes'] }],
    })
    await ctx.fiber.dispose()
  })

  it('returns the original label on digit then Enter', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const notify = vi.spyOn(
      controller as unknown as { notifyAttention(input: unknown): void },
      'notifyAttention',
    )
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'q1',
        question: '选择发布策略',
        header: '选择发布策略',
        options: [
          { label: '仅 patch' },
          { label: 'minor' },
          { label: '取消发布' },
        ],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    expect(controller.getAskUserPane()).toMatchObject({
      header: '选择发布策略',
      options: ['仅 patch', 'minor', '取消发布'],
      selectedIndex: 0,
    })
    expect(controller.getApprovalPane().open).toBe(false)
    expect(notify).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledWith({
      kind: 'ask-user',
      questionText: '选择发布策略',
    })
    controller.dispatch({ kind: 'ask-user-digit', index: -1 })
    controller.dispatch({ kind: 'ask-user-digit', index: 99 })
    expect(controller.getAskUserPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'ask-user-digit', index: 1 })
    expect(controller.getAskUserPane().selectedIndex).toBe(1)
    controller.dispatch({ kind: 'ask-user-move', delta: -1 })
    expect(controller.getAskUserPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'ask-user-move', delta: 1 })
    expect(controller.getAskUserPane().selectedIndex).toBe(1)
    controller.dispatch({ kind: 'ask-user-submit' })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['minor'] }],
    })
    expect(controller.getAskUserPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('rejects ASK_ABORTED on Esc and on abort', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'q1',
        question: 'continue?',
        options: [{ label: 'yes' }, { label: 'no' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(asked).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(controller.getAskUserPane().open).toBe(false)

    const abort = new AbortController()
    const pending = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'q2',
        question: 'again?',
        options: [{ label: 'ok' }],
      }],
      signal: abort.signal,
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(controller.getAskUserPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('keeps one composer slot: a later approval waits behind an open question', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'q1',
        question: 'first',
        options: [{ label: 'a' }, { label: 'b' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    expect(JSON.stringify(controller.getAskUserPane())).not.toContain('还有')
    expect(JSON.stringify(controller.getApprovalPane())).not.toContain('还有')
    controller.dispatch({ kind: 'ask-user-submit' })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['a'] }],
    })
    await ctx.fiber.dispose()
  })

  it('keeps movement inert for a question without options', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{ id: 'empty', question: 'informational' }],
    })
    await vi.waitFor(() => { expect(controller.getAskUserPane().open).toBe(true) })
    controller.dispatch({ kind: 'ask-user-move', delta: 1 })
    controller.dispatch({ kind: 'ask-user-submit' })
    expect(controller.getAskUserPane().open).toBe(true)
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(asked).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await ctx.fiber.dispose()
  })
})
