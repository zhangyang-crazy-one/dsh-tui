/**
 * RuntimeController feedback overlay: `g f` targets the last finalized
 * assistant message, `l`/`d` write through the CAS sidecar (first put uses
 * ifVersion null), conflicts refresh and paint the copy pair, and the sidecar
 * never becomes a session event (T-6-03). `/feedback` never opens the pane.
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
import type { Session } from '@deepseek-ai/dsh-session'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type {
  MessageFeedbackItem,
  MessageFeedbackListRequest,
  MessageFeedbackPutRequest,
  MessageFeedbackVersion,
} from '@deepseek-ai/dsh-message-feedback'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

interface FeedbackFake {
  readonly puts: MessageFeedbackPutRequest[]
  conflict: boolean
}

/** Provide a message-feedback fake; puts succeed unless `conflict` is set. */
function provideFeedback(
  ctx: Context,
  currentItem: () => MessageFeedbackItem | undefined,
): FeedbackFake {
  const fake: FeedbackFake = { puts: [], conflict: false }
  ctx.provide('messageFeedback', {
    list: (_request: MessageFeedbackListRequest) => {
      const item = currentItem()
      return Promise.resolve({ ok: true, value: { items: item === undefined ? [] : [item] } })
    },
    put: (request: MessageFeedbackPutRequest) => {
      fake.puts.push({ ...request })
      if (fake.conflict) {
        return Promise.resolve({
          ok: false,
          error: { code: 'version-conflict', current: currentItem() ?? null },
        })
      }
      return Promise.resolve({
        ok: true,
        value: {
          messageId: request.messageId,
          rating: request.rating,
          version: 'v1' as MessageFeedbackVersion,
          createdAt: 1,
          updatedAt: 2,
        },
      })
    },
  } as never)
  return fake
}

interface Bench {
  ctx: Context
  controller: RuntimeController
  session: Session
}

/** Mount the minimal registries plus a scripted factory with one live agent. */
async function bench(setup?: (ctx: Context) => void): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  let liveSession: Session | undefined
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      liveSession = session
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
  setup?.(ctx)
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
  await controller.start()
  if (liveSession === undefined) throw new Error('expected a live session')
  return { ctx, controller, session: liveSession }
}

/** Append one finalized assistant message so the overlay gains a target. */
function appendAssistant(session: Session, text: string): MessageId {
  const message = createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'test-provider', model: 'test-model' },
  })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message,
  }, { surfaceOp: 'append' })
  return message.id
}

describe('feedback overlay', () => {
  it('paints the S19 error when the service is not composed', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'feedback-pane' })
    expect(controller.getFeedbackPane().error).toBe('反馈服务未组合')
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    controller.dispatch({ kind: 'feedback-note-edit' })
    controller.dispatch({ kind: 'feedback-note-cancel' })
    await ctx.fiber.dispose()
  })

  it('opens the empty state without an assistant message', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFeedback(ctx, () => undefined)
    })
    controller.dispatch({ kind: 'feedback-pane' })
    const pane = controller.getFeedbackPane()
    expect(pane.hasTarget).toBe(false)
    expect(pane.error).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('writes positive with ifVersion null on the first put', async () => {
    let fake: FeedbackFake | undefined
    const { ctx, controller, session } = await bench((ctx) => {
      fake = provideFeedback(ctx, () => undefined)
    })
    appendAssistant(session, '第一段回答')
    controller.dispatch({ kind: 'feedback-pane' })
    expect(controller.getFeedbackPane().hasTarget).toBe(true)
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => {
      expect(fake?.puts.length).toBe(1)
    })
    const put = fake?.puts[0]
    expect(put?.rating).toBe('positive')
    expect(put?.ifVersion).toBeNull()
    expect(controller.getFeedbackPane().rating).toBe('positive')
    await ctx.fiber.dispose()
  })

  it('paints the version-conflict copy and refreshes the current item', async () => {
    let fake: FeedbackFake | undefined
    const appended: { current?: MessageId } = {}
    const currentOf = (): MessageFeedbackItem => {
      if (appended.current === undefined) throw new Error('expected a target message')
      return {
        messageId: appended.current,
        rating: 'negative',
        version: 'v7' as MessageFeedbackVersion,
        createdAt: 1,
        updatedAt: 2,
      }
    }
    const { ctx, controller, session } = await bench((ctx) => {
      fake = provideFeedback(ctx, currentOf)
    })
    appended.current = appendAssistant(session, '第二段回答')
    controller.dispatch({ kind: 'feedback-pane' })
    await vi.waitFor(() => {
      expect(controller.getFeedbackPane().rating).toBe('negative')
    })
    if (fake !== undefined) fake.conflict = true
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => {
      expect(controller.getFeedbackPane().writeError).toBe('version-conflict')
    })
    expect(controller.getFeedbackPane().rating).toBe('negative')
    await ctx.fiber.dispose()
  })

  it('keeps the sidecar out of the session event stream', async () => {
    let fake: FeedbackFake | undefined
    const { ctx, controller, session } = await bench((ctx) => {
      fake = provideFeedback(ctx, () => undefined)
    })
    appendAssistant(session, '回答')
    const before = session.events.map(event => event.type)
    controller.dispatch({ kind: 'feedback-pane' })
    controller.dispatch({ kind: 'feedback-rate', rating: 'negative' })
    await vi.waitFor(() => {
      expect(fake?.puts.length).toBe(1)
    })
    expect(session.events.map(event => event.type)).toEqual(before)
    await ctx.fiber.dispose()
  })

  it('writes the note draft through feedback-note-apply', async () => {
    let fake: FeedbackFake | undefined
    const { ctx, controller, session } = await bench((ctx) => {
      fake = provideFeedback(ctx, () => undefined)
    })
    appendAssistant(session, '回答')
    controller.dispatch({ kind: 'feedback-pane' })
    controller.dispatch({ kind: 'feedback-note-edit' })
    expect(controller.getFeedbackPane().editing).toBe(true)
    controller.dispatch({ kind: 'feedback-note-apply', value: '清屏\x1b[2J' })
    await vi.waitFor(() => {
      expect(fake?.puts.length).toBe(1)
    })
    expect(fake?.puts[0]?.note).toBe('清屏\x1b[2J')
    expect(controller.getFeedbackPane().editing).toBe(false)
    await ctx.fiber.dispose()
  })

  it('does not open the pane through /feedback', async () => {
    const { ctx, controller } = await bench((ctx) => {
      provideFeedback(ctx, () => undefined)
    })
    controller.dispatch({ kind: 'command', query: 'feedback' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(controller.getFeedbackPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('surfaces list failure before a write', async () => {
    const { ctx, controller, session } = await bench((ctx) => {
      ctx.provide('messageFeedback', {
        list: () => Promise.resolve({ ok: false, error: { code: 'list-failed' } }),
        put: () => Promise.reject(new Error('must not put')),
      } as never)
    })
    appendAssistant(session, '回答')
    controller.dispatch({ kind: 'feedback-pane' })
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => {
      expect(controller.getFeedbackPane()).toMatchObject({
        writeError: 'write-failure', writeErrorReason: 'list-failed',
      })
    })
    await ctx.fiber.dispose()
  })

  it('tolerates a refresh list rejection and drops a stale write list', async () => {
    const rejected = await bench((ctx) => {
      ctx.provide('messageFeedback', {
        list: () => Promise.reject(new Error('refresh unavailable')),
        put: () => Promise.reject(new Error('unused')),
      } as never)
    })
    appendAssistant(rejected.session, '回答')
    rejected.controller.dispatch({ kind: 'feedback-pane' })
    await Promise.resolve()
    expect(rejected.controller.getFeedbackPane().open).toBe(true)
    await rejected.ctx.fiber.dispose()

    const gate = Promise.withResolvers<never>()
    let calls = 0
    const stale = await bench((ctx) => {
      ctx.provide('messageFeedback', {
        list: () => ++calls === 1
          ? Promise.resolve({ ok: true, value: { items: [] } })
          : gate.promise,
        put: () => Promise.reject(new Error('must not put')),
      } as never)
    })
    appendAssistant(stale.session, '回答')
    stale.controller.dispatch({ kind: 'feedback-pane' })
    await vi.waitFor(() => { expect(calls).toBe(1) })
    stale.controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => { expect(calls).toBe(2) })
    stale.controller.dispatch({ kind: 'feedback-escape' })
    gate.resolve({ ok: true, value: { items: [] } } as never)
    await Promise.resolve()
    expect(stale.controller.getFeedbackPane().open).toBe(false)
    await stale.ctx.fiber.dispose()
  })

  it.each([
    ['note-too-large', 'note-too-large'],
    ['provider-failed', 'write-failure'],
    ['throw', 'write-failure'],
  ] as const)('surfaces %s put failure', async (failure, expected) => {
    const { ctx, controller, session } = await bench((ctx) => {
      ctx.provide('messageFeedback', {
        list: () => Promise.resolve({ ok: true, value: { items: [] } }),
        put: () => failure === 'throw'
          ? Promise.reject(new Error('put exploded'))
          : Promise.resolve({ ok: false, error: { code: failure } }),
      } as never)
    })
    appendAssistant(session, '回答')
    controller.dispatch({ kind: 'feedback-pane' })
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => {
      expect(controller.getFeedbackPane().writeError).toBe(expected)
    })
    if (failure === 'throw') {
      expect(controller.getFeedbackPane().writeErrorReason).toBe('put exploded')
    }
    await ctx.fiber.dispose()
  })

  it('handles a null conflict current and closes note editing', async () => {
    const { ctx, controller, session } = await bench((ctx) => {
      ctx.provide('messageFeedback', {
        list: () => Promise.resolve({ ok: true, value: { items: [] } }),
        put: () => Promise.resolve({
          ok: false,
          error: { code: 'version-conflict', current: null },
        }),
      } as never)
    })
    appendAssistant(session, '回答')
    controller.dispatch({ kind: 'feedback-pane' })
    controller.dispatch({ kind: 'feedback-note-edit' })
    controller.dispatch({ kind: 'feedback-note-cancel' })
    expect(controller.getFeedbackPane().editing).toBe(false)
    controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
    await vi.waitFor(() => {
      expect(controller.getFeedbackPane().writeError).toBe('version-conflict')
    })
    expect(controller.getFeedbackPane().rating).toBeUndefined()
    controller.dispatch({ kind: 'feedback-pane' })
    expect(controller.getFeedbackPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('drops stale list, put, and rejected put results after close', async () => {
    for (const mode of ['list', 'put', 'reject'] as const) {
      const listGate = Promise.withResolvers<never>()
      const putGate = Promise.withResolvers<never>()
      const listStarted = Promise.withResolvers<undefined>()
      const putStarted = Promise.withResolvers<undefined>()
      const fixture = await bench((ctx) => {
        ctx.provide('messageFeedback', {
          list: () => {
            listStarted.resolve(undefined)
            return mode === 'list'
              ? listGate.promise
              : Promise.resolve({ ok: true, value: { items: [] } })
          },
          put: () => {
            putStarted.resolve(undefined)
            return putGate.promise
          },
        } as never)
      })
      appendAssistant(fixture.session, '回答')
      fixture.controller.dispatch({ kind: 'feedback-pane' })
      if (mode !== 'list') fixture.controller.dispatch({ kind: 'feedback-rate', rating: 'positive' })
      if (mode === 'list') await listStarted.promise
      else await putStarted.promise
      fixture.controller.dispatch({ kind: 'feedback-escape' })
      if (mode === 'list') {
        listGate.resolve({ ok: true, value: { items: [] } } as never)
      } else if (mode === 'put') {
        putGate.resolve({
          ok: true,
          value: { messageId: 'late', rating: 'positive', version: 'v', createdAt: 1, updatedAt: 1 },
        } as never)
      } else {
        putGate.reject(new Error('late put failure'))
      }
      await Promise.resolve()
      expect(fixture.controller.getFeedbackPane().open).toBe(false)
      await fixture.ctx.fiber.dispose()
    }
  })
})
