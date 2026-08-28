import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createProjector } from '@deepseek-ai/dsh-tui-render'
import { RuntimeController } from '../src/index.ts'

interface Fixture {
  readonly ctx: Context
  readonly controller: RuntimeController
  readonly session: Session
  bind(session: Session): void
}

async function fixture(): Promise<Fixture> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const controller = new RuntimeController(
    ctx,
    { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
    { task: '' },
    () => {},
  )
  const state = controller as unknown as {
    readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' }
    commitCandidate(candidate: {
      handle: { agent: Agent; dispose(): Promise<void> }
      projector: ReturnType<typeof createProjector>
      modelSelectionRef: {
        current: { provider: string; model: string; reasoningEffort?: never }
        assembled: undefined
      }
      badge: string
    }): void
  }
  state.readTuiSettings = () => ({ notify: 'off' })
  const bind = (session: Session): void => {
    const projector = createProjector()
    projector.seed(session.events)
    const agent = {} as Agent
    Object.assign(agent, {
      id: session.id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, claimed: () => {}, discarded: () => {} }),
      status: 'running',
      ctx,
      cancel: () => {},
      whenIdle: () => Promise.resolve(),
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => {},
    } satisfies Partial<Agent>)
    state.commitCandidate({
      handle: { agent, dispose: () => Promise.resolve() },
      projector,
      modelSelectionRef: {
        current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
        assembled: undefined,
      },
      badge: 'deepseek-official · deepseek-v4-flash',
    })
  }
  const session = ctx.sessions.create(SessionId(`retry-footer-${randomUUID()}`))
  bind(session)
  return { ctx, controller, session, bind }
}

function openStep(session: Session): void {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    reason: 'initial',
  })
}

function appendRetry(session: Session, delayMs = 1500): ReturnType<typeof RetryId> {
  const retryId = RetryId(`retry-${randomUUID()}`)
  session.append('llm/retry', {
    retryId,
    turn: 1,
    step: 1,
    provider: 'deepseek-official',
    mode: 'normal',
    policyKey: 'normal-policy',
    retry: 2,
    maxRetries: 4,
    delayMs,
    failure: { message: 'provider busy', code: 'RATE_LIMIT', status: 429 },
  })
  return retryId
}

afterEach(() => {
  vi.useRealTimers()
})

describe('retry footer lifecycle', () => {
  it('counts down only between the durable retry event pair', async () => {
    vi.useFakeTimers({ now: 0 })
    const { controller, session } = await fixture()
    openStep(session)
    const retryId = appendRetry(session)
    expect(controller.getAdaptiveInfoFooter()?.retry).toEqual({
      retry: 2,
      maxRetries: 4,
      remainingMs: 1500,
      failureCode: 'RATE_LIMIT',
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(controller.getAdaptiveInfoFooter()?.retry?.remainingMs).toBe(1000)
    session.append('llm/retry-started', { retryId, turn: 1, step: 1, retry: 2 })
    await vi.advanceTimersByTimeAsync(25)
    expect(controller.getAdaptiveInfoFooter()?.retry).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores retry events from a non-live session', async () => {
    vi.useFakeTimers({ now: 0 })
    const { ctx, controller } = await fixture()
    const other = ctx.sessions.create(SessionId(`other-${randomUUID()}`))
    openStep(other)
    appendRetry(other)
    expect(controller.getAdaptiveInfoFooter()?.retry).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears timers on turn end, abort, and session replacement', async () => {
    vi.useFakeTimers({ now: 0 })
    const turn = await fixture()
    openStep(turn.session)
    appendRetry(turn.session)
    turn.session.append('step/end', { turn: 1, step: 1 })
    turn.session.append('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'provider busy', code: 'RATE_LIMIT' } },
    })
    await vi.advanceTimersByTimeAsync(25)
    expect(turn.controller.getAdaptiveInfoFooter()?.retry).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)

    const aborted = await fixture()
    openStep(aborted.session)
    appendRetry(aborted.session)
    aborted.controller.dispatch({ kind: 'sigint' })
    await vi.advanceTimersByTimeAsync(25)
    expect(aborted.controller.getAdaptiveInfoFooter()?.retry).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)

    const replaced = await fixture()
    openStep(replaced.session)
    appendRetry(replaced.session)
    replaced.bind(replaced.ctx.sessions.create(SessionId(`replacement-${randomUUID()}`)))
    await vi.advanceTimersByTimeAsync(25)
    expect(replaced.controller.getAdaptiveInfoFooter()?.retry).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the retry timer during controller disposal', async () => {
    vi.useFakeTimers({ now: 0 })
    const { controller, session } = await fixture()
    openStep(session)
    appendRetry(session)
    await controller.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
