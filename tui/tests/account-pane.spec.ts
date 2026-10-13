/** DeepSeek account page: `/login` routing, browser sign-in, cancellation, sign-out, and account events. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { AccountView, SignInAttemptId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountPaneInput } from '@deepseek-ai/dsh-tui-render'
import { RuntimeController, internals } from '../src/index.ts'

const links = { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/top_up' }
const signedOut: AccountView = { status: 'signed-out', links, attempt: null }
const attemptId = 'attempt-1' as SignInAttemptId
const waiting: AccountView = { status: 'signed-out', links,
  attempt: { id: attemptId, phase: 'waiting-browser', authorizeUrl: 'https://platform.example/authorize?state=abc' } }
const signedIn: AccountView = { status: 'credential-stored', links, attempt: { id: attemptId, phase: 'succeeded' } }

/** Fake only the external account service; snapshots are pushed through its watch stream. */
function accountService() {
  let view = signedOut
  const listeners = new Set<() => void>()
  const publish = (next: AccountView) => { view = next; for (const listener of listeners) listener() }
  return {
    publish,
    getState: vi.fn(async () => view),
    getProfile: vi.fn(async () => ({ status: 'ready' as const, value: { id: null, name: 'Ada', contact: 'a***@example.com' } })),
    getBalance: vi.fn(async () => ({ status: 'ready' as const, value: [{ currency: 'CNY' as const, balance: '12.30' }], bonusWallets: [] })),
    startSignIn: vi.fn(async () => { publish(waiting); return waiting }),
    cancelSignIn: vi.fn(async () => { const next: AccountView = { status: 'signed-out', links, attempt: { id: attemptId, phase: 'cancelled' } }; publish(next); return next }),
    signOut: vi.fn(async () => { publish(signedOut); return signedOut }),
    async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
      let wake: (() => void) | undefined
      const listener = () => wake?.()
      listeners.add(listener)
      signal.addEventListener('abort', listener)
      try {
        while (!signal.aborted) {
          yield view
          await new Promise<void>((resolve) => { wake = resolve })
        }
      } finally { listeners.delete(listener) }
    },
  }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function bench(options: { account?: boolean; webServer?: boolean; remote?: boolean } = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test', model: 'test' })
  ctx.agents.setFactory({
    async createAgent(owner, createOptions) {
      const session = ctx.sessions.create(createOptions.sessionId)
      const agent = {} as Agent
      Object.assign(agent, { id: session.id, options: {}, session, inbox: createInboxStub(), status: 'idle',
        ctx: owner.extend({ agent }), cancel: () => {}, send: () => {}, followup: () => {}, steer: () => {}, inject: () => {},
        runMaintenance: () => Promise.reject(new Error('unused')), whenIdle: () => Promise.resolve() } satisfies Partial<Agent>)
      await createOptions.setup?.(agent.ctx, agent)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('unused')),
  })
  const account = accountService()
  if (options.account !== false) ctx.provide('deepseekAccount', account as unknown as Context['deepseekAccount'])
  if (options.webServer !== false) {
    ctx.provide('webServer', { host: '127.0.0.1', port: 43123, protocol: 'http:' } as unknown as Context['webServer'])
  }
  const opened: string[] = []
  const saved = { openUrl: internals.openUrl, accountEnvironment: internals.accountEnvironment }
  internals.openUrl = (href) => { opened.push(href) }
  internals.accountEnvironment = options.remote === true ? { SSH_CONNECTION: '10.0.0.2 1 10.0.0.1 22' } : {}
  const controller = new RuntimeController(ctx, { stdout: { write: () => true }, stderr: { write: () => true }, exit: vi.fn() }, { task: '' }, vi.fn(), vi.fn())
  await controller.start()
  cleanups.push(async () => {
    Object.assign(internals, saved)
    await controller.dispose()
    await ctx.fiber.dispose()
  })
  const input = (value: AccountPaneInput['kind']) => controller.dispatch({ kind: 'account-input', input: { kind: value } })
  return { ctx, controller, account, opened, input }
}

describe('DeepSeek account page', () => {
  it('routes /login to the API-key pane when the account service is absent', async () => {
    const b = await bench({ account: false })
    b.controller.dispatch({ kind: 'command', query: 'login' })
    expect(b.controller.getAccountPane().open).toBe(false)
    expect(b.controller.getSettingsPane().onboarding).toBe(true)
  })

  it('signs in through the loopback callback, opens the link once, and loads profile and balance', async () => {
    const b = await bench()
    b.controller.dispatch({ kind: 'command', query: 'login' })
    await vi.waitFor(() => expect(b.controller.getAccountPane()).toMatchObject({ open: true, available: true, status: 'signed-out' }))
    b.input('sign-in')
    await vi.waitFor(() => expect(b.controller.getAccountPane().phase).toBe('waiting-browser'))
    expect(b.account.startSignIn).toHaveBeenCalledWith(expect.objectContaining({ locale: 'zh-CN' }), 'http://127.0.0.1:43123/', 'web')
    expect(b.controller.getAccountPane().authorizeUrl).toBe(waiting.attempt?.authorizeUrl)
    expect(b.opened).toEqual([waiting.attempt?.authorizeUrl])
    b.account.publish(signedIn)
    await vi.waitFor(() => expect(b.controller.getAccountPane()).toMatchObject({
      status: 'credential-stored', phase: 'succeeded', profile: 'Ada · a***@example.com', balance: 'CNY 12.30',
    }))
    expect(b.opened).toHaveLength(1)
  })

  it('shows a port-forward command instead of opening a browser in a remote terminal', async () => {
    const b = await bench({ remote: true })
    b.controller.dispatch({ kind: 'command', query: 'login' })
    await vi.waitFor(() => expect(b.controller.getAccountPane().status).toBe('signed-out'))
    b.input('sign-in')
    await vi.waitFor(() => expect(b.controller.getAccountPane().phase).toBe('waiting-browser'))
    expect(b.controller.getAccountPane().forward).toBe('ssh -L 43123:127.0.0.1:43123 <host>')
    expect(b.opened).toEqual([])
    b.input('open-url')
    expect(b.opened).toEqual([waiting.attempt?.authorizeUrl])
  })

  it('reports a missing callback server and cancels only the running attempt', async () => {
    const missing = await bench({ webServer: false })
    missing.controller.dispatch({ kind: 'command', query: 'login' })
    await vi.waitFor(() => expect(missing.controller.getAccountPane().status).toBe('signed-out'))
    missing.input('sign-in')
    await vi.waitFor(() => expect(missing.controller.getAccountPane().error).toBe('登录回调服务未启动（缺少 webserver 行）'))
    expect(missing.account.startSignIn).not.toHaveBeenCalled()

    const b = await bench()
    b.controller.dispatch({ kind: 'command', query: 'login' })
    await vi.waitFor(() => expect(b.controller.getAccountPane().status).toBe('signed-out'))
    b.input('cancel')
    expect(b.account.cancelSignIn).not.toHaveBeenCalled()
    b.input('sign-in')
    await vi.waitFor(() => expect(b.controller.getAccountPane().phase).toBe('waiting-browser'))
    b.input('cancel')
    await vi.waitFor(() => expect(b.controller.getAccountPane().phase).toBe('cancelled'))
    expect(b.account.cancelSignIn).toHaveBeenCalledWith(attemptId)
  })

  it('signs out only after confirmation from /logout and stops watching on close', async () => {
    const b = await bench()
    b.account.publish(signedIn)
    b.controller.dispatch({ kind: 'command', query: 'logout' })
    await vi.waitFor(() => expect(b.controller.getAccountPane()).toMatchObject({ status: 'credential-stored', confirmSignOut: true }))
    b.input('dismiss')
    expect(b.controller.getAccountPane().confirmSignOut).toBe(false)
    expect(b.account.signOut).not.toHaveBeenCalled()
    b.input('sign-out')
    b.input('confirm')
    await vi.waitFor(() => expect(b.controller.getAccountPane().status).toBe('signed-out'))
    expect(b.controller.getFeedback()).toBe('✓ 已退出 DeepSeek 账号')
    b.input('close')
    expect(b.controller.getAccountPane().open).toBe(false)
    b.account.publish(signedIn)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(b.controller.getAccountPane().status).toBe('signed-out')
  })

  it('surfaces account sign-in-required and expiry events in the status row', async () => {
    const b = await bench()
    b.ctx.emit('deepseek-account/model-sign-in-required')
    expect(b.controller.getFeedback()).toBe('✗ 需要登录 DeepSeek 账号 · /login')
    b.ctx.emit('deepseek-account/session-expired')
    expect(b.controller.getFeedback()).toBe('✗ DeepSeek 账号登录已失效 · /login')
  })
})
