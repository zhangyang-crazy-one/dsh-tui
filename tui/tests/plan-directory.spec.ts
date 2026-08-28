/**
 * Empty `/plan` opens PlanDirectoryPane; Enter runs `/plan` or `/plan off`
 * through `ctx.commands.execute`. Parameterized `/plan off` does not open.
 * Approval occupancy refuses the empty opener (K2′).
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
import CommandRuntime from '@deepseek-ai/dsh-commands'
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
  execute: unknown
  failNext: () => void
  setActive: (active: boolean) => void
}

/** Mount registries, a command runtime, and a stub planMode.get(). */
async function bench(options: {
  planModeGet?: () => { active: boolean }
} = {}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  let active = false
  ctx.provide('planMode', {
    get: options.planModeGet ?? (() => ({ active })),
  } as never)
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session, () => {})
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
  let fail = false
  ctx.commands.register({
    name: 'plan',
    description: 'Enter or leave plan mode',
    handler: ({ rawInput }) => {
      if (fail) {
        fail = false
        return { kind: 'error' as const, text: 'sandbox refused' }
      }
      const off = rawInput.trim() === 'off'
      active = !off
      return {
        kind: 'success' as const,
        text: off ? 'Plan mode off.' : 'Plan mode on.',
      }
    },
  })
  const execute: unknown = vi.spyOn(ctx.commands, 'execute')
  return {
    ctx,
    controller,
    execute,
    failNext: () => { fail = true },
    setActive: (next) => { active = next },
  }
}

describe('PlanDirectoryPane intercept', () => {
  it('opens the overlay from empty /plan with 关闭 · 当前 when inactive', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'plan' })
    expect(controller.getPlanDirectoryPane()).toMatchObject({
      open: true,
      selectedIndex: 1,
      currentActive: false,
    })
    expect(controller.getPlanDirectoryPane()).toBe(controller.getPlanDirectoryPane())
    expect(execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('opens the overlay from /plan with a trailing space', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'plan ' })
    expect(controller.getPlanDirectoryPane().open).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('selects 开启 · 当前 when the host mode is active', async () => {
    const { ctx, controller, setActive } = await bench()
    setActive(true)
    controller.dispatch({ kind: 'command', query: 'plan' })
    expect(controller.getPlanDirectoryPane()).toMatchObject({
      open: true,
      selectedIndex: 0,
      currentActive: true,
    })
    await ctx.fiber.dispose()
  })

  it('executes /plan on 开启 and /plan off on 关闭 through commands.execute', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'plan' })
    controller.dispatch({ kind: 'plan-directory-move', delta: -1 })
    expect(controller.getPlanDirectoryPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'plan-directory-apply' })
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/plan',
        [],
        expect.any(AbortSignal),
      )
      expect(controller.getPlanDirectoryPane().open).toBe(false)
    })
    controller.dispatch({ kind: 'command', query: 'plan' })
    expect(controller.getPlanDirectoryPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'plan-directory-move', delta: 1 })
    controller.dispatch({ kind: 'plan-directory-apply' })
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/plan off',
        [],
        expect.any(AbortSignal),
      )
      expect(controller.getPlanDirectoryPane().open).toBe(false)
    })
    await ctx.fiber.dispose()
  })

  it('executes parameterized /plan off without opening the overlay', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'plan off' })
    expect(controller.getPlanDirectoryPane().open).toBe(false)
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/plan off',
        [],
        expect.any(AbortSignal),
      )
    })
    await ctx.fiber.dispose()
  })

  it('refuses to open while approval is queued (K2′)', async () => {
    const { ctx, controller } = await bench()
    const original = controller.getApprovalPane.bind(controller)
    controller.getApprovalPane = () => ({ ...original(), open: true })
    controller.dispatch({ kind: 'command', query: 'plan' })
    expect(controller.getPlanDirectoryPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('paints the overlay error pair when a switch fails and keeps the pane open', async () => {
    const { ctx, controller, failNext } = await bench()
    failNext()
    controller.dispatch({ kind: 'command', query: 'plan' })
    controller.dispatch({ kind: 'plan-directory-apply' })
    await vi.waitFor(() => {
      expect(controller.getPlanDirectoryPane()).toMatchObject({
        open: true,
        switchError: 'sandbox refused',
      })
    })
    await ctx.fiber.dispose()
  })

  it('closes on Esc', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'plan' })
    controller.dispatch({ kind: 'plan-directory-escape' })
    expect(controller.getPlanDirectoryPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('paints unreadable status when planMode.get throws', async () => {
    const { ctx, controller } = await bench({
      planModeGet: () => {
        throw new Error('projection failed')
      },
    })
    controller.dispatch({ kind: 'command', query: 'plan' })
    expect(controller.getPlanDirectoryPane()).toMatchObject({
      open: true,
      statusError: 'projection failed',
    })
    await ctx.fiber.dispose()
  })
})
