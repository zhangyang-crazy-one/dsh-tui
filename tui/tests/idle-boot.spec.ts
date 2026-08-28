/**
 * Zero-arg Pi-style boot seam: an empty task creates a fresh session and
 * leaves the loop idle (no followup), an empty or whitespace-only send is a
 * no-op in front of the model request, and a non-empty task positional seeds
 * the first followup. Drives RuntimeController directly — the same seam the
 * render loop dispatches into.
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
  followup: ReturnType<typeof vi.fn>
}

/** Mount the registries and a scripted factory, then hand back the controller. */
async function bench(task: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  const followup = vi.fn()
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session, (message) => {
        followup(message)
      })
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
  const controller = new RuntimeController(ctx, io, { task }, () => {})
  return { ctx, controller, followup }
}

/** The plain-text content of one recorded followup message. */
function textOf(message: UserMessage): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('zero-arg idle boot', () => {
  it('starts a fresh session idle: no followup, empty history', async () => {
    const { ctx, controller, followup } = await bench('')
    await controller.start()
    expect(followup).not.toHaveBeenCalled()
    expect(controller.session).toBeDefined()
    expect(controller.getModel().history).toEqual([])
    expect(controller.getInteraction()).toBe('idle')
    await ctx.fiber.dispose()
  })

  it('keeps an empty or whitespace-only send a no-op before any model request', async () => {
    const { ctx, controller, followup } = await bench('')
    await controller.start()
    controller.dispatch({ kind: 'send', text: '' })
    controller.dispatch({ kind: 'send', text: '   ' })
    expect(followup).not.toHaveBeenCalled()
    expect(controller.getInteraction()).toBe('idle')
    // The guard swallows only empty text: a real send still flows.
    controller.dispatch({ kind: 'send', text: 'hi' })
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0] as UserMessage
    expect(textOf(message)).toBe('hi')
    expect(controller.getInteraction()).toBe('generating')
    await ctx.fiber.dispose()
  })

  it('seeds the first followup from an optional task positional', async () => {
    const { ctx, controller, followup } = await bench('说 hi')
    await controller.start()
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0] as UserMessage
    expect(textOf(message)).toBe('说 hi')
    expect(controller.getInteraction()).toBe('generating')
    await ctx.fiber.dispose()
  })

  it('keeps the approval slot closed and ignores allow/deny/detail when the queue is empty', async () => {
    const { ctx, controller } = await bench('')
    await controller.start()
    expect(controller.getApprovalPane().open).toBe(false)
    controller.dispatch({ kind: 'approval-allow' })
    controller.dispatch({ kind: 'approval-deny' })
    controller.dispatch({ kind: 'approval-detail' })
    controller.dispatch({ kind: 'permission-escape' })
    controller.dispatch({ kind: 'permission-move', delta: 1 })
    controller.dispatch({ kind: 'permission-jump', index: 0 })
    controller.dispatch({ kind: 'permission-apply' })
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-cancel-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://example.test' })
    controller.dispatch({ kind: 'ask-user-digit', index: 0 })
    controller.dispatch({ kind: 'ask-user-move', delta: 1 })
    controller.dispatch({ kind: 'ask-user-submit' })
    controller.dispatch({ kind: 'ask-user-cancel' })
    controller.dispatch({ kind: 'toggle-tool-cards' })
    expect(controller.getApprovalPane().open).toBe(false)
    expect(controller.getPermissionPane().open).toBe(false)
    expect(controller.getSettingsPane().open).toBe(false)
    expect(controller.getModel().toolCardsExpanded).toBe(true)
    await ctx.fiber.dispose()
  })

  it('opens Agent Hub on agent-hub, closes competing overlays, and leaves approval closed', async () => {
    const { ctx, controller } = await bench('')
    await controller.start()
    controller.dispatch({ kind: 'help-pane' })
    expect(controller.getHelpPane().open).toBe(true)
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane().open).toBe(true)
    expect(controller.getHelpPane().open).toBe(false)
    expect(controller.getApprovalPane().open).toBe(false)
    controller.dispatch({ kind: 'agent-hub' })
    expect(controller.getAgentHubPane().open).toBe(false)
    controller.dispatch({ kind: 'workspace-pane' })
    expect(controller.getWorkspacePane().open).toBe(true)
    controller.dispatch({ kind: 'workspace-escape' })
    expect(controller.getWorkspacePane().open).toBe(false)
    controller.dispatch({ kind: 'feedback-pane' })
    expect(controller.getFeedbackPane().open).toBe(true)
    controller.dispatch({ kind: 'feedback-escape' })
    expect(controller.getFeedbackPane().open).toBe(false)
    controller.dispatch({ kind: 'workflow-overlay' })
    expect(controller.getWorkflowOverlay().open).toBe(true)
    controller.dispatch({ kind: 'workflow-overlay-escape' })
    expect(controller.getWorkflowOverlay().open).toBe(false)
    controller.dispatch({ kind: 'agent-hub' })
    controller.dispatch({ kind: 'agent-hub-escape' })
    expect(controller.getAgentHubPane().open).toBe(false)
    controller.dispatch({ kind: 'plan-directory' })
    controller.dispatch({ kind: 'plan-directory-escape' })
    expect(controller.getPlanDirectoryPane().open).toBe(false)
    expect(controller.getPlanReviewPane().open).toBe(false)
    expect(controller.getComposerHud()).toBeUndefined()
    expect(controller.getToolPresenters()).toBeUndefined()
    controller.dispatch({ kind: 'agent-hub-escape' })
    controller.dispatch({ kind: 'workspace-escape' })
    controller.dispatch({ kind: 'feedback-escape' })
    controller.dispatch({ kind: 'workflow-overlay-escape' })
    await ctx.fiber.dispose()
  })
})
