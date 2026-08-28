/**
 * Empty `/permission` opens PermissionPane from the host table (including
 * `read-only`); Enter executes through `ctx.commands.execute`; danger needs
 * a second Enter; confirm Esc leaves the preset unchanged. Parameterized
 * `/permission workspace-write` executes without opening the overlay.
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

const HOST_NAMES = ['read-only', 'workspace-write', 'danger-full-access'] as const

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
}

/** Mount registries, a command runtime, and a three-row host preset table. */
async function bench(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  ctx.provide('permissionPresets', {
    names: [...HOST_NAMES],
    current: () => 'workspace-write',
    optionOf: (name: string) => ({
      value: name,
      name,
      description: `${name} desc`,
    }),
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
    name: 'permission',
    description: 'Switch the permission preset',
    handler: ({ rawInput }) => {
      if (fail) {
        fail = false
        return { kind: 'error' as const, text: 'sandbox refused' }
      }
      return { kind: 'success' as const, text: `preset ${rawInput.trim()}` }
    },
  })
  const execute: unknown = vi.spyOn(ctx.commands, 'execute')
  return { ctx, controller, execute, failNext: () => { fail = true } }
}

describe('PermissionPane intercept', () => {
  it('opens the overlay from empty /permission with the host read-only row', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    const pane = controller.getPermissionPane()
    expect(pane.open).toBe(true)
    expect(pane.names).toEqual([...HOST_NAMES])
    expect(pane.names).toContain('read-only')
    expect(pane.currentName).toBe('workspace-write')
    expect(pane.selectedIndex).toBe(1)
    expect(pane.confirmDanger).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('opens the overlay from /permission with a trailing space', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission ' })
    expect(controller.getPermissionPane().open).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('executes workspace-write through commands.execute and closes the overlay', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-apply' })
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/permission workspace-write',
        [],
        expect.any(AbortSignal),
      )
      expect(controller.getPermissionPane().open).toBe(false)
    })
    await ctx.fiber.dispose()
  })

  it('requires a second Enter for danger-full-access; confirm Esc keeps the preset', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-jump', index: 2 })
    expect(controller.getPermissionPane().selectedIndex).toBe(2)
    controller.dispatch({ kind: 'permission-apply' })
    expect(controller.getPermissionPane().confirmDanger).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    controller.dispatch({ kind: 'permission-escape' })
    expect(controller.getPermissionPane()).toMatchObject({
      open: true,
      confirmDanger: false,
      selectedIndex: 2,
      currentName: 'workspace-write',
    })
    expect(execute).not.toHaveBeenCalled()
    controller.dispatch({ kind: 'permission-apply' })
    expect(controller.getPermissionPane().confirmDanger).toBe(true)
    controller.dispatch({ kind: 'permission-apply' })
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/permission danger-full-access',
        [],
        expect.any(AbortSignal),
      )
      expect(controller.getPermissionPane().open).toBe(false)
    })
    await ctx.fiber.dispose()
  })

  it('executes a parameterized /permission without opening the overlay', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission workspace-write' })
    expect(controller.getPermissionPane().open).toBe(false)
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith(
        expect.anything(),
        '/permission workspace-write',
        [],
        expect.any(AbortSignal),
      )
    })
    expect(controller.getPermissionPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('closes the overlay on Esc without executing', async () => {
    const { ctx, controller, execute } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-escape' })
    expect(controller.getPermissionPane().open).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('ignores move and jump while the danger confirm is showing', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-jump', index: 2 })
    controller.dispatch({ kind: 'permission-apply' })
    expect(controller.getPermissionPane().confirmDanger).toBe(true)
    controller.dispatch({ kind: 'permission-move', delta: -1 })
    controller.dispatch({ kind: 'permission-jump', index: 0 })
    expect(controller.getPermissionPane()).toMatchObject({
      confirmDanger: true,
      selectedIndex: 2,
    })
    await ctx.fiber.dispose()
  })

  it('ignores an out-of-range jump', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-jump', index: 9 })
    controller.dispatch({ kind: 'permission-jump', index: -1 })
    expect(controller.getPermissionPane().selectedIndex).toBe(1)
    controller.dispatch({ kind: 'permission-move', delta: -1 })
    expect(controller.getPermissionPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'permission-move', delta: -1 })
    expect(controller.getPermissionPane().selectedIndex).toBe(0)
    await ctx.fiber.dispose()
  })

  it('paints the overlay error pair when a switch fails and keeps the pane open', async () => {
    const { ctx, controller, failNext } = await bench()
    failNext()
    controller.dispatch({ kind: 'command', query: 'permission' })
    controller.dispatch({ kind: 'permission-apply' })
    await vi.waitFor(() => {
      expect(controller.getPermissionPane()).toMatchObject({
        open: true,
        switchError: 'sandbox refused',
        currentName: 'workspace-write',
      })
    })
    await ctx.fiber.dispose()
  })

  it('still opens title+error when the host table is missing', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentDefaultModelConfig, {
      provider: 'test-provider',
      model: 'test-model',
    })
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
    controller.dispatch({ kind: 'command', query: 'permission' })
    expect(controller.getPermissionPane()).toMatchObject({
      open: true,
      names: [],
    })
    controller.dispatch({ kind: 'permission-apply' })
    controller.dispatch({ kind: 'permission-move', delta: 1 })
    expect(controller.getPermissionPane().open).toBe(true)
    expect(controller.getPermissionPane().names).toEqual([])
    await ctx.fiber.dispose()
  })
})
