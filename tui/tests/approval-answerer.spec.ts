/**
 * RuntimeController answers `approval/request` for the live agent: claim,
 * FIFO, one-shot latch, abort cancellation, and host `'never'` / sandbox
 * ladder-top paths that never open ApprovalPane.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { ToolCallId, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
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

/** Mount registries, ApprovalService, and a scripted factory. */
async function bench(policy: 'ask' | 'never' = 'ask'): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(ApprovalService, { policy })
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

/** Wait until the composer slot claims the queued ask. */
async function whenOpen(controller: RuntimeController): Promise<void> {
  await vi.waitFor(() => {
    expect(controller.getApprovalPane().open).toBe(true)
  })
}

describe('live-agent approval answerer', () => {
  const fibers: Context[] = []

  afterEach(async () => {
    await Promise.all(fibers.splice(0).map(ctx => ctx.fiber.dispose()))
  })

  it('allows once with y and rejects with n for the live agent', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })

    const allowed = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need network',
    })
    await whenOpen(controller)
    expect(controller.getApprovalPane()).toMatchObject({
      open: true,
      toolName: 'bash',
      reason: 'need network',
      arguments: '',
      detailsOpen: false,
    })
    controller.dispatch({ kind: 'approval-allow' })
    await expect(allowed).resolves.toBe('allowed-once')
    expect(controller.getApprovalPane().open).toBe(false)

    const denied = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need root',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'approval-deny' })
    await expect(denied).resolves.toBe('rejected')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('calls next() for another agent and leaves the pane closed', async () => {
    const { ctx, controller } = await bench()
    fibers.push(ctx)
    const foreignSession = ctx.sessions.create(SessionId('foreign-approval'))
    foreignSession.append('turn/start', { turn: 1 })
    const foreign = scriptedAgent(ctx, foreignSession, () => {})
    await expect(ctx.approval.request({
      agent: foreign,
      toolName: 'bash',
      reason: 'other agent',
    })).resolves.toBe('unavailable')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('latches a second allow after settle and keeps a one-shot outcome', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'once',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'approval-allow' })
    controller.dispatch({ kind: 'approval-allow' })
    await expect(pending).resolves.toBe('allowed-once')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('shows only the FIFO head and never paints a queue count', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const first = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'first ask',
    })
    const second = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'second ask',
    })
    await whenOpen(controller)
    expect(controller.getApprovalPane().reason).toBe('first ask')
    expect(JSON.stringify(controller.getApprovalPane())).not.toContain('还有')
    controller.dispatch({ kind: 'approval-allow' })
    await expect(first).resolves.toBe('allowed-once')
    await whenOpen(controller)
    expect(controller.getApprovalPane().reason).toBe('second ask')
    expect(JSON.stringify(controller.getApprovalPane())).not.toContain('还有')
    controller.dispatch({ kind: 'approval-deny' })
    await expect(second).resolves.toBe('rejected')
  })

  it('toggles details and copies live tool-call arguments onto the pane', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    const callId = ToolCallId('call-live')
    liveAgent.session.append('turn/start', { turn: 1 })
    liveAgent.session.append('step/start', { turn: 1, step: 1 })
    liveAgent.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'bash',
      arguments: '{"command":"ls"}',
    })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      callId,
      reason: 'run ls',
    })
    await whenOpen(controller)
    expect(controller.getApprovalPane().arguments).toBe('{"command":"ls"}')
    controller.dispatch({ kind: 'approval-detail' })
    expect(controller.getApprovalPane().detailsOpen).toBe(true)
    controller.dispatch({ kind: 'approval-detail' })
    expect(controller.getApprovalPane().detailsOpen).toBe(false)
    controller.dispatch({ kind: 'approval-allow' })
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('looks up historical tool-call arguments after skipping user rows', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    const callId = ToolCallId('call-hist')
    liveAgent.session.append('turn/start', { turn: 1 })
    liveAgent.session.append('user/message', {
      id: 'hist-user' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'run it' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    liveAgent.session.append('step/start', { turn: 1, step: 1 })
    liveAgent.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId,
      name: 'bash',
      arguments: '{"command":"pwd"}',
    })
    liveAgent.session.append('step/end', { turn: 1, step: 1 })
    liveAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    liveAgent.session.append('turn/start', { turn: 2 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      callId,
    })
    await whenOpen(controller)
    expect(controller.getApprovalPane().reason).toBe('')
    expect(controller.getApprovalPane().arguments).toBe('{"command":"pwd"}')
    controller.dispatch({ kind: 'approval-deny' })
    await expect(pending).resolves.toBe('rejected')
  })

  it('uses empty arguments when history has no matching tool-call', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    liveAgent.session.append('user/message', {
      id: 'skip-user' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'user' },
    }, { surfaceOp: 'append' })
    liveAgent.session.append('step/start', { turn: 1, step: 1 })
    liveAgent.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'ok' }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
    liveAgent.session.append('step/end', { turn: 1, step: 1 })
    liveAgent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    liveAgent.session.append('turn/start', { turn: 2 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      callId: ToolCallId('missing-call'),
    })
    await whenOpen(controller)
    expect(controller.getApprovalPane().arguments).toBe('')
    controller.dispatch({ kind: 'approval-allow' })
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('resolves cancelled when the request signal aborts after the pane opens', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const abort = new AbortController()
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'abort me',
      signal: abort.signal,
    })
    await whenOpen(controller)
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('resolves cancelled without opening the pane when abort wins the dispatch race', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const abort = new AbortController()
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      signal: abort.signal,
    })
    abort.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('cancels a queued ask when the live session is replaced', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'switch away',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'new-session' })
    await expect(pending).resolves.toBe('cancelled')
    await vi.waitFor(() => {
      expect(controller.getApprovalPane().open).toBe(false)
    })
  })

  it('cancels a queued ask when the controller disposes', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'teardown',
    })
    await whenOpen(controller)
    await controller.dispose()
    await expect(pending).resolves.toBe('cancelled')
  })

  it('keeps the granted outcome when the signal aborts after allow', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const abort = new AbortController()
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      signal: abort.signal,
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'approval-allow' })
    await expect(pending).resolves.toBe('allowed-once')
    abort.abort()
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('calls next() before a live agent is bound', async () => {
    const ctx = new Context()
    fibers.push(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, {
      provider: 'test-provider',
      model: 'test-model',
    })
    await ctx.plugin(ApprovalService)
    ctx.agents.setFactory({
      createAgent: () => Promise.reject(new Error('not used')),
      resume: () => Promise.reject(new Error('not used')),
    })
    const io: TuiIo = {
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: () => {},
    }
    const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
    const session = ctx.sessions.create(SessionId('pre-start'))
    session.append('turn/start', { turn: 1 })
    const agent = scriptedAgent(ctx, session, () => {})
    await expect(ctx.approval.request({
      agent,
      toolName: 'bash',
    })).resolves.toBe('unavailable')
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('rejects policy never before the TUI listener and never opens the pane', async () => {
    const { ctx, controller, liveAgent } = await bench('never')
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const consulted = vi.fn()
    ctx.on('approval/request', (_req, next) => {
      consulted()
      return next()
    }, { prepend: true })
    await expect(ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'should not prompt',
    })).resolves.toBe('rejected')
    expect(consulted).not.toHaveBeenCalled()
    expect(controller.getApprovalPane().open).toBe(false)
    expect(liveAgent.session.events.filter(e => e.type === 'approval/asked')).toHaveLength(1)
    expect(liveAgent.session.events.filter(e => e.type === 'approval/decided')).toHaveLength(1)
  })

  it('does not prompt when danger-full-access has no wider sandbox mode', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    const request = vi.fn()
    await expect(approveEscalation(
      {
        requestedMode: 'danger-full-access',
        justification: 'need the top of the ladder',
        effectiveMode: 'danger-full-access',
        subject: 'command',
      },
      {
        approver: { request },
        agent: liveAgent,
        callId: ToolCallId('esc-1'),
        toolName: 'bash',
      },
    )).rejects.toThrow(/not strictly wider/)
    expect(request).not.toHaveBeenCalled()
    expect(controller.getApprovalPane().open).toBe(false)
  })

  it('ignores empty /permission while an approval is open (K2′)', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need write',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'command', query: 'permission' })
    expect(controller.getPermissionPane().open).toBe(false)
    expect(controller.getApprovalPane().open).toBe(true)
    controller.dispatch({ kind: 'approval-deny' })
    await expect(pending).resolves.toBe('rejected')
  })

  it('ignores empty /settings while an approval is open (K2′)', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need write',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().open).toBe(false)
    expect(controller.getApprovalPane().open).toBe(true)
    controller.dispatch({ kind: 'approval-deny' })
    await expect(pending).resolves.toBe('rejected')
  })

  it('ignores empty /resume while an approval is open (K2′)', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need write',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'command', query: 'resume' })
    expect(controller.getSessionPane().open).toBe(false)
    expect(controller.getApprovalPane().open).toBe(true)
    controller.dispatch({ kind: 'approval-deny' })
    await expect(pending).resolves.toBe('rejected')
  })

  it('refuses Agent Hub while an approval is open (K2′)', async () => {
    const { ctx, controller, liveAgent } = await bench()
    fibers.push(ctx)
    liveAgent.session.append('turn/start', { turn: 1 })
    const pending = ctx.approval.request({
      agent: liveAgent,
      toolName: 'bash',
      reason: 'need write',
    })
    await whenOpen(controller)
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane().open).toBe(false)
    expect(controller.getApprovalPane().open).toBe(true)
    controller.dispatch({ kind: 'approval-deny' })
    await expect(pending).resolves.toBe('rejected')
  })
})
