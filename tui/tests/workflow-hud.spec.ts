/**
 * RuntimeController workflow HUD + overlay: the compact HUD follows the five
 * `workflow/*` events (observe-only; the engine is never started), the `g w`
 * overlay paints phase/member rows or the S19 error when the engine is not
 * composed, and j/k scrolling clamps to the member window.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRunInfo } from '@deepseek-ai/dsh-workflow'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const RUN: WorkflowRunInfo = {
  id: WorkflowRunId('run-1'),
  meta: { name: 'demo', description: '演示' },
}
const OTHER_RUN: WorkflowRunInfo = {
  id: WorkflowRunId('run-other'),
  meta: { name: 'other', description: '其他' },
}

interface Bench {
  ctx: Context
  controller: RuntimeController
}

/** Mount the minimal registries plus a scripted factory with one live agent. */
async function bench(): Promise<Bench> {
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
      const agent = {} as Agent
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
        ctx: ownerCtx.extend({ agent }),
        cancel: () => {},
        runMaintenance: () => Promise.reject(new Error('not used')),
        send: () => {},
        followup: () => {},
        steer: () => {},
        inject: () => {},
        whenIdle: () => Promise.resolve(),
      } satisfies Partial<Agent>)
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
  return { ctx, controller }
}

/** Start the run with one in-flight member under the given phase. */
function startRun(ctx: Context): void {
  ctx.emit('workflow/start', RUN)
  ctx.emit('workflow/phase', RUN, '设计')
  ctx.emit('workflow/agent-start', RUN, {
    seq: 1,
    label: '侦察',
    childId: SessionId('child-1'),
  })
}

describe('workflow HUD', () => {
  it('stays hidden without any workflow event', async () => {
    const { ctx, controller } = await bench()
    expect(controller.getWorkflowHud()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('follows start/phase/agent-start into the compact HUD', async () => {
    const { ctx, controller } = await bench()
    startRun(ctx)
    expect(controller.getWorkflowHud()).toEqual({
      phase: '设计',
      current: { seq: 1, label: '侦察' },
    })
    await ctx.fiber.dispose()
  })

  it('carries the host outcome key once the member settles', async () => {
    const { ctx, controller } = await bench()
    startRun(ctx)
    ctx.emit('workflow/agent-end', RUN, {
      seq: 1,
      label: '侦察',
      childId: SessionId('child-1'),
      outcome: 'completed',
    })
    expect(controller.getWorkflowHud()).toEqual({
      phase: '设计',
      current: { seq: 1, label: '侦察', outcome: 'completed' },
    })
    await ctx.fiber.dispose()
  })

  it('sorts multiple members before selecting the current HUD row', async () => {
    const { ctx, controller } = await bench()
    ctx.emit('workflow/start', RUN)
    ctx.emit('workflow/agent-start', RUN, {
      seq: 2, label: 'second', childId: SessionId('child-2'),
    })
    ctx.emit('workflow/agent-start', RUN, {
      seq: 1, label: 'first', childId: SessionId('child-1'),
    })
    expect(controller.getWorkflowHud()?.current).toEqual({ seq: 2, label: 'second' })
    await ctx.fiber.dispose()
  })

  it('hides again when the run ends', async () => {
    const { ctx, controller } = await bench()
    startRun(ctx)
    ctx.emit('workflow/end', RUN, {
      stopReason: 'completed',
      agentsStarted: 1,
    })
    expect(controller.getWorkflowHud()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('ignores phase, member, and end events for a different run id', async () => {
    const { ctx, controller } = await bench()
    startRun(ctx)
    ctx.emit('workflow/phase', OTHER_RUN, 'ignored')
    ctx.emit('workflow/agent-start', OTHER_RUN, {
      seq: 9, label: 'ignored', childId: SessionId('other-child'),
    })
    ctx.emit('workflow/agent-end', OTHER_RUN, {
      seq: 9, label: 'ignored', childId: SessionId('other-child'), outcome: 'failed',
    })
    ctx.emit('workflow/end', OTHER_RUN, { stopReason: 'completed', agentsStarted: 0 })
    expect(controller.getWorkflowHud()).toEqual({
      phase: '设计',
      current: { seq: 1, label: '侦察' },
    })
    await ctx.fiber.dispose()
  })
})

describe('workflow overlay', () => {
  it('paints the S19 error when the engine is not composed', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'workflow-overlay' })
    const overlay = controller.getWorkflowOverlay()
    expect(overlay.open).toBe(true)
    expect(overlay.error).toBe('工作流状态不可用：未组合')
    expect(overlay.run).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('paints the empty state without a live run', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('workflowEngine', {} as never)
    controller.dispatch({ kind: 'workflow-overlay' })
    const overlay = controller.getWorkflowOverlay()
    expect(overlay.open).toBe(true)
    expect(overlay.error).toBeUndefined()
    expect(overlay.run).toBeUndefined()
    expect(controller.getWorkflowOverlay()).toBe(overlay)
    controller.dispatch({ kind: 'workflow-overlay-scroll', delta: 10 })
    expect(controller.getWorkflowOverlay().offset).toBe(0)
    await ctx.fiber.dispose()
  })

  it('paints the live run and clamps j/k scrolling to the member window', async () => {
    const { ctx, controller } = await bench()
    ctx.provide('workflowEngine', {} as never)
    ctx.emit('workflow/start', RUN)
    for (let seq = 1; seq <= 9; seq += 1) {
      ctx.emit('workflow/agent-start', RUN, {
        seq,
        label: `成员${seq}`,
        childId: SessionId(`child-${seq}`),
      })
    }
    controller.dispatch({ kind: 'workflow-overlay' })
    const opened = controller.getWorkflowOverlay()
    expect(opened.run?.members.length).toBe(9)
    expect(opened.offset).toBe(0)
    controller.dispatch({ kind: 'workflow-overlay-scroll', delta: 100 })
    expect(controller.getWorkflowOverlay().offset).toBe(1)
    controller.dispatch({ kind: 'workflow-overlay-scroll', delta: -5 })
    expect(controller.getWorkflowOverlay().offset).toBe(0)
    controller.dispatch({ kind: 'workflow-overlay-escape' })
    expect(controller.getWorkflowOverlay().open).toBe(false)
    await ctx.fiber.dispose()
  })
})
