/**
 * Agent-scoped plan-review batches paint PlanReviewPane. y answers Approve,
 * n answers Keep planning, and Esc is ASK_ABORTED.
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
import SessionStore from '@deepseek-ai/dsh-session'
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
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
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
  return { ctx, controller, liveAgent }
}

const PLAN_REVIEW_QUESTION = {
  id: 'plan-review',
  header: 'Plan review',
  question: 'Approve this plan and leave plan mode?',
  detail: '# 实现步骤\n1. 占用互斥',
  options: [
    { label: 'Approve', description: 'Leave plan mode' },
    { label: 'Keep planning', description: 'Stay in plan mode' },
  ],
  intent: { kind: 'plan-review' as const, approve: 'Approve' },
}

describe('PlanReviewPane listener branch', () => {
  it('delegates an unscoped plan-review request', async () => {
    const { ctx, controller } = await bench()
    const dispose = ctx.on('user-questions/request', request => Promise.resolve({
      answers: request.questions.map(question => ({
        id: question.id,
        selected: ['Keep planning'],
      })),
    }))
    await expect(ctx.userQuestions.ask({ questions: [PLAN_REVIEW_QUESTION] }))
      .resolves.toEqual({
        answers: [{ id: 'plan-review', selected: ['Keep planning'] }],
      })
    expect(controller.getPlanReviewPane().open).toBe(false)
    dispose()
    await ctx.fiber.dispose()
  })

  it('paints PlanReviewPane for a plan-review batch and y answers Approve', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [PLAN_REVIEW_QUESTION],
    })
    await vi.waitFor(() => {
      expect(controller.getPlanReviewPane()).toMatchObject({
        open: true,
        plan: '# 实现步骤\n1. 占用互斥',
      })
    })
    expect(controller.getAskUserPane().open).toBe(false)
    controller.dispatch({ kind: 'ask-user-submit' })
    expect(controller.getPlanReviewPane().open).toBe(true)
    controller.dispatch({ kind: 'plan-review-approve' })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Approve'] }],
    })
    expect(controller.getPlanReviewPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('answers Keep planning on n and ASK_ABORTED on Esc, never chrome labels', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const kept = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [PLAN_REVIEW_QUESTION],
    })
    await vi.waitFor(() => {
      expect(controller.getPlanReviewPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'plan-review-keep' })
    await expect(kept).resolves.toEqual({
      answers: [{ id: 'plan-review', selected: ['Keep planning'] }],
    })
    const cancelled = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [PLAN_REVIEW_QUESTION],
    })
    await vi.waitFor(() => {
      expect(controller.getPlanReviewPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(cancelled).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(controller.getPlanReviewPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('keeps AskUserPane for a non-plan-review question', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        id: 'q1',
        question: '选择发布策略',
        header: '选择发布策略',
        options: [{ label: '仅 patch' }, { label: 'minor' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getAskUserPane().open).toBe(true)
    })
    expect(controller.getPlanReviewPane().open).toBe(false)
    controller.dispatch({ kind: 'ask-user-submit' })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'q1', selected: ['仅 patch'] }],
    })
    await ctx.fiber.dispose()
  })

  it('paints delivery error when the host Keep planning option is missing', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [{
        ...PLAN_REVIEW_QUESTION,
        options: [{ label: 'Approve' }],
      }],
    })
    await vi.waitFor(() => {
      expect(controller.getPlanReviewPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'plan-review-keep' })
    expect(controller.getPlanReviewPane()).toMatchObject({
      open: true,
      deliveryError: '选项缺失',
    })
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(asked).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await ctx.fiber.dispose()
  })

  it('refuses Hub while plan-review occupies the dialog (K2′)', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const asked = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [PLAN_REVIEW_QUESTION],
    })
    await vi.waitFor(() => {
      expect(controller.getPlanReviewPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane().open).toBe(false)
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(asked).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await ctx.fiber.dispose()
  })

  it('keeps multi-question batches in AskUserPane', async () => {
    const { ctx, controller, liveAgent } = await bench()
    const multiple = ctx.userQuestions.ask({
      agent: liveAgent,
      questions: [
        { id: 'a', question: 'first', options: [{ label: 'yes' }] },
        { id: 'b', question: 'second', options: [{ label: 'yes' }] },
      ],
    })
    await vi.waitFor(() => { expect(controller.getAskUserPane().open).toBe(true) })
    expect(controller.getPlanReviewPane().open).toBe(false)
    controller.dispatch({ kind: 'ask-user-cancel' })
    await expect(multiple).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    await ctx.fiber.dispose()
  })
})
