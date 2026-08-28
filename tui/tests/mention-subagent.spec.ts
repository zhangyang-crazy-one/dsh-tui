/**
 * RuntimeController.listMentions 子代理: running children only, insert
 * target `@label ` with a trailing space, and no throw when the service is
 * absent.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** Scripted agent whose followup resolves immediately and appends nothing. */
function scriptedAgent(ownerCtx: Context, session: Session): Agent {
  const agent = {} as Agent
  const agentCtx = ownerCtx.extend({ agent })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    status: 'idle',
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (_message: UserMessage) => {},
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  return agent
}

interface Bench {
  ctx: Context
  controller: RuntimeController
}

/** Mount core services and an optional `subagents` listChildren stub. */
async function bench(
  listChildren?: (parent: SessionId, signal?: AbortSignal) => Promise<SubagentListEntry[]>,
): Promise<Bench> {
  const root = await mkdtemp(`${tmpdir()}/dsh-tui-mention-subagent-`)
  roots.push(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  if (listChildren !== undefined) {
    ctx.provide('subagents', { listChildren } as never)
  }
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session)
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
  const controller = new RuntimeController(
    ctx,
    io,
    { task: '', cwd: root },
    () => {},
  )
  return { ctx, controller }
}

describe('listMentions subagent', () => {
  it('omits 子代理 candidates when the subagents service is not composed', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    const rows = await controller.listMentions(controller.getCwd(), 'explorer')
    expect(rows.some(row => row.kind === 'subagent')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('inserts `@label ` with a trailing space for a running continuable child', async () => {
    const { ctx, controller } = await bench(async () => [
      {
        kind: 'child',
        id: SessionId('child-1'),
        mode: 'continuable',
        label: 'explorer',
        activity: 'running',
        hasChildren: false,
      },
    ])
    await controller.start()
    await expect(controller.listMentions(controller.getCwd(), 'exp')).resolves.toEqual([
      { kind: 'subagent', name: 'explorer', target: '@explorer ' },
    ])
    await expect(controller.listMentions(controller.getCwd(), 'zzz')).resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps running children only and falls back one-shot label to id', async () => {
    const { ctx, controller } = await bench(async () => [
      {
        kind: 'child',
        id: SessionId('live'),
        mode: 'continuable',
        label: 'reviewer',
        activity: 'running',
        hasChildren: false,
      },
      {
        kind: 'child',
        id: SessionId('cold'),
        mode: 'continuable',
        label: 'archived',
        activity: 'inactive',
        hasChildren: false,
      },
      {
        kind: 'child',
        id: SessionId('oneshot-1'),
        mode: 'one-shot',
        activity: 'running',
        hasChildren: false,
      },
      {
        kind: 'diagnostic',
        id: SessionId('broken'),
        reason: 'corrupt',
      },
    ])
    await controller.start()
    const rows = await controller.listMentions(controller.getCwd(), '')
    expect(rows.filter(row => row.kind === 'subagent')).toEqual([
      { kind: 'subagent', name: 'reviewer', target: '@reviewer ' },
      { kind: 'subagent', name: 'oneshot-1', target: '@oneshot-1 ' },
    ])
    await ctx.fiber.dispose()
  })

  it('does not throw when listChildren rejects', async () => {
    const { ctx, controller } = await bench(async () => {
      throw new Error('backend listing failed')
    })
    await controller.start()
    await expect(controller.listMentions(controller.getCwd(), 'x')).resolves.toEqual([])
    await ctx.fiber.dispose()
  })
})
