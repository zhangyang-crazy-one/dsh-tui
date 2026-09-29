/**
 * End-to-end exercise of the TUI provider auto-discover pipeline: spin up a
 * local `GET /v1/models` server that returns OpenAI-compatible listings,
 * mount LlmRuntime + LlmPiAi + a stub credentials seam, and drive the
 * controller's settings overlay through the auto-discover apply path.
 *
 * The settings provider is stubbed via `MemorySettings` so the test can
 * inspect the persisted user layer without reading a YAML file; a separate
 * `e2e-provider-auto-discover.ts` script proves the same flow against a
 * YAML document (the FileSettingsProvider upstream).
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import { RuntimeController } from '../src/index.ts'

/** Scripted agent whose idle inbox accepts anything without dispatching. */
function scriptedAgent(ownerCtx: Context, session: Session): Agent {
  const agent = {} as Agent
  const agentCtx = ownerCtx.extend({ agent })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    status: 'idle',
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  return agent
}

interface ProbeServer {
  url: string
  /** Each path the server received, in order. */
  paths: string[]
  /** Each Authorization header (verbatim) the server received. */
  authorizations: Array<string | undefined>
  /** Mutate the next reply; defaults to a 200 with two models. */
  setNext: (behavior: { status?: number; body?: string }) => void
  close: () => Promise<void>
}

/**
 * Open a local HTTP server that answers `GET /v1/models` with the most recent
 * scripted behavior. The scriptable server keeps the test free of mocked
 * `fetch` calls; every assertion observes what the real adapter actually did.
 */
async function probeServer(): Promise<ProbeServer> {
  const paths: string[] = []
  const authorizations: Array<string | undefined> = []
  let behavior: { status: number; body: string } = {
    status: 200,
    body: JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }),
  }
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    authorizations.push(typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined)
    response.writeHead(behavior.status, { 'content-type': 'application/json' })
    response.end(behavior.body)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    paths,
    authorizations,
    setNext(next) {
      behavior = { status: next.status ?? 200, body: next.body ?? '{}' }
    },
    close: () => new Promise<void>(resolve => server.close(() => {
      resolve()
    })),
  }
}

/** In-memory settings seam with the same `describe`/`update` surface the tui reads. */
class MemorySettings {
  private readonly sections = new Map<string, Record<string, unknown>>()

  describe(): SettingsDescriptor[] {
    const descriptors: SettingsDescriptor[] = [...this.sections.entries()].map(([ns, user]) => ({
      ns: ns as SettingsNamespace,
      autoGenerate: true,
      schema: {},
      value: user,
      user,
      revision: 0,
      applies: 'live',
    }))
    // Always advertise the `llm-pi-ai` namespace so the tui settings pane can
    // surface its `providers` row. The real host publishes the section from
    // the live plugin's resolved Config; the stub just gives the row a home.
    if (!this.sections.has('llm-pi-ai')) {
      descriptors.push({
        ns: 'llm-pi-ai' as SettingsNamespace,
        autoGenerate: true,
        schema: {},
        value: { providers: {} },
        user: {},
        revision: 0,
        applies: 'live',
      })
    }
    return descriptors
  }

  async update(ns: string, patch: Record<string, unknown>): Promise<void> {
    const current = this.sections.get(ns) ?? {}
    this.sections.set(ns, { ...current, ...patch })
  }

  /** Inspect one namespace's stored section without going through the tui. */
  read(ns: string): Record<string, unknown> | undefined {
    const value = this.sections.get(ns)
    return value === undefined ? undefined : structuredClone(value)
  }
}

interface Harness {
  ctx: Context
  controller: RuntimeController
  server: ProbeServer
  /** Settings seam holding the user-layer section the controller writes to. */
  settings: MemorySettings
  cleanup: () => Promise<void>
}

/**
 * Mount the controller plus its required plugins. The credentials seam is a
 * minimal stub that remembers the values set via `/key` and exposes them on
 * `resolve`, so the auto-discover path can hand the configured key to the
 * adapter without standing up a credential store.
 */
async function harness(options: {
  readonly apiKey?: string
  /**
   * Whether to pre-seed the credentials stub with `MY_GW_API_KEY`. The default
   * is true so the success-path test can prove the bearer header reaches the
   * endpoint; the 401 prompt test passes `false` to exercise the missing-key
   * path.
   */
  readonly presetCredential?: boolean
  /** Pre-seed one namespace's section (for the re-interrogate test). */
  readonly seed?: { readonly ns: string; readonly value: Record<string, unknown> }
} = {}): Promise<Harness> {
  const server = await probeServer()
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(LlmRuntime)
  const settings = new MemorySettings()
  if (options.seed !== undefined) {
    await settings.update(options.seed.ns, options.seed.value)
  }
  ctx.provide('settings', settings as never)
  await ctx.plugin(LlmPiAi, {})
  void options

  const stored = new Map<string, string>()
  // Pre-seed the credential the auto-discover path will resolve. Using
  // `applyOnboardingKey` would route through the ONBOARDING_KEY (DEEPSEEK_API_KEY)
  // seam, so the test seeds directly through the seam to keep each scenario
  // self-contained.
  if (options.presetCredential !== false) {
    stored.set('MY_GW_API_KEY', 'MY_GW_API_KEY')
  }
  ctx.provide('credentials', {
    describe: async () => ({ configured: true, writable: true }),
    set: async (ref: ReturnType<typeof credentialRef>, value: string) => {
      stored.set(ref, value)
    },
    resolve: async (ref: ReturnType<typeof credentialRef>) => {
      const value = stored.get(ref)
      return value === undefined ? undefined : { value, source: 'test' }
    },
  } as never)

  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, createOptions: CreateAgentOptions): Promise<AgentHandle> {
      const session = ctx.sessions.create(createOptions.sessionId)
      const agent = scriptedAgent(ownerCtx, session)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })

  const controller = new RuntimeController(
    ctx,
    {
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: () => {},
    },
    { task: '' },
    () => {},
  )
  await controller.start()

  return {
    ctx,
    controller,
    server,
    settings,
    cleanup: async () => {
      await controller.dispose()
      await ctx.fiber.dispose()
      await server.close()
    },
  }
}

beforeEach(() => {
  // `LlmPiAi` reads `PI_TEST_KEY` etc. from the environment; keep the suite
  // hermetic by ensuring no stale keys leak from the host.
  delete process.env['PI_TEST_KEY']
})

afterEach(() => {
  delete process.env['PI_TEST_KEY']
})

describe('TUI provider auto-discover apply path', () => {
  it('writes discovered models into the user-layer providers dict when models= is empty', async () => {
    const { controller, server, settings, cleanup } = await harness()
    try {
      // Open the providers overlay; the [+ 添加 Provider] row carries the
      // seeded multi-line template, which is what the user types into.
      controller.dispatch({ kind: 'command', query: 'settings' })

      // The form leaves models= blank and supplies name + baseURL + api.
      const draft = [
        'name=my-gw',
        `baseURL=${server.url}/v1`,
        'models=',
        'api=openai-completions',
        'apiKeyEnv=MY_GW_API_KEY',
      ].join('\n')
      // The leading tui rows come before the providers row; walk down to it.
      const providersRowIndex = controller.getSettingsPane().rows
        .findIndex(row => row.field === 'providers')
      for (let i = 0; i < providersRowIndex; i++) {
        controller.dispatch({ kind: 'settings-move', delta: 1 })
      }
      controller.dispatch({ kind: 'settings-edit' })
      expect(controller.getSettingsPane().editing).toBe(true)
      controller.dispatch({ kind: 'settings-apply', value: draft })

      await waitFor(() => !controller.getSettingsPane().open, 2_000)
      expect(controller.getSettingsPane().updateError).toBeUndefined()

      // The user-layer providers dict now carries the discovered profile,
      // and the schema-defaulted fields (compat, defaultContextWindow, etc.)
      // are not materialized — only the fields the parser emitted.
      const llmPiAi = settings.read('llm-pi-ai') as {
        providers?: Record<string, {
          api?: string
          baseURL?: string
          apiKeyEnv?: string
          displayName?: string
          models?: Array<{ id: string }>
          compat?: unknown
          defaultContextWindow?: unknown
        }>
      }
      const profile = llmPiAi.providers?.['my-gw']
      expect(profile?.apiKeyEnv).toBe('MY_GW_API_KEY')
      expect(profile?.displayName).toBe('my-gw')
      expect(profile?.models?.map(model => model.id)).toEqual(['alpha', 'beta'])
      expect(profile?.compat).toBeUndefined()
      expect(profile?.defaultContextWindow).toBeUndefined()
      // No schema-default fields were persisted on the profile.

      // The probe server saw exactly one discovery call, signed with the
      // stored key, against the expected URL.
      expect(server.paths).toEqual(['/v1/models'])
      expect(server.authorizations[0]).toBe('Bearer MY_GW_API_KEY')
    } finally {
      await cleanup()
    }
  })

  it('surfaces the endpoint refusal on the overlay and writes nothing to settings', async () => {
    const { controller, server, settings, cleanup } = await harness()
    try {
      server.setNext({ status: 500, body: JSON.stringify({ error: 'upstream down' }) })

      controller.dispatch({ kind: 'command', query: 'settings' })
      const draft = [
        'name=my-gw',
        `baseURL=${server.url}/v1`,
        'models=',
        'api=openai-completions',
      ].join('\n')
      const providersRowIndex = controller.getSettingsPane().rows
        .findIndex(row => row.field === 'providers')
      for (let i = 0; i < providersRowIndex; i++) {
        controller.dispatch({ kind: 'settings-move', delta: 1 })
      }
      controller.dispatch({ kind: 'settings-edit' })
      controller.dispatch({ kind: 'settings-apply', value: draft })

      // The overlay stays open and paints the failure reason on the ✗ pair.
      await waitFor(() => controller.getSettingsPane().updateError !== undefined, 2_000)
      expect(controller.getSettingsPane().open).toBe(true)
      expect(controller.getSettingsPane().updateError).toMatch(/500/)

      // Nothing was persisted.
      expect(settings.read('llm-pi-ai')).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('treats a 401 with no stored credential as a missing-key prompt', async () => {
    const { controller, server, settings, cleanup } = await harness({
      presetCredential: false,
    })
    try {
      server.setNext({ status: 401, body: '{}' })

      controller.dispatch({ kind: 'command', query: 'settings' })
      const draft = [
        'name=my-gw',
        `baseURL=${server.url}/v1`,
        'models=',
        'api=openai-completions',
      ].join('\n')
      const providersRowIndex = controller.getSettingsPane().rows
        .findIndex(row => row.field === 'providers')
      for (let i = 0; i < providersRowIndex; i++) {
        controller.dispatch({ kind: 'settings-move', delta: 1 })
      }
      controller.dispatch({ kind: 'settings-edit' })
      controller.dispatch({ kind: 'settings-apply', value: draft })

      await waitFor(() => controller.getSettingsPane().updateError !== undefined, 2_000)
      expect(controller.getSettingsPane().updateError).toMatch(/401/)
      expect(controller.getSettingsPane().updateError).toMatch(/\/key/)
      expect(settings.read('llm-pi-ai')).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('refuses to write when the endpoint returns an empty model list', async () => {
    const { controller, server, settings, cleanup } = await harness()
    try {
      server.setNext({ status: 200, body: JSON.stringify({ data: [] }) })

      controller.dispatch({ kind: 'command', query: 'settings' })
      const draft = [
        'name=my-gw',
        `baseURL=${server.url}/v1`,
        'models=',
        'api=openai-completions',
      ].join('\n')
      const providersRowIndex = controller.getSettingsPane().rows
        .findIndex(row => row.field === 'providers')
      for (let i = 0; i < providersRowIndex; i++) {
        controller.dispatch({ kind: 'settings-move', delta: 1 })
      }
      controller.dispatch({ kind: 'settings-edit' })
      controller.dispatch({ kind: 'settings-apply', value: draft })

      await waitFor(() => controller.getSettingsPane().updateError !== undefined, 2_000)
      expect(controller.getSettingsPane().updateError).toMatch(/未返回任何模型/)
      expect(settings.read('llm-pi-ai')).toBeUndefined()
    } finally {
      await cleanup()
    }
  })

  it('re-interrogates the endpoint when the providers.<route>.models row is set to auto', async () => {
    // Mount the controller with a pre-seeded profile so the auto-rebuild
    // path lands on the existing route rather than starting from an empty
    // providers dict.
    const server = await probeServer()
    const seed = {
      ns: 'llm-pi-ai',
      value: {
        providers: {
          'my-gw': {
            api: 'openai-completions',
            baseURL: `${server.url}/v1`,
            apiKeyEnv: 'MY_GW_API_KEY',
            displayName: 'my-gw',
            models: [{ id: 'stale' }],
          },
        },
      },
    }
    const { controller, cleanup, ctx } = await harness({ seed })
    try {
      server.setNext({ status: 200, body: JSON.stringify({ data: [{ id: 'gamma' }, { id: 'delta' }] }) })

      controller.dispatch({ kind: 'command', query: 'settings' })
      const pane = controller.getSettingsPane()
      const modelsRowIndex = pane.rows.findIndex(row => row.field === 'providers.my-gw.models')
      // Walk down to the `providers.my-gw.models` row to enter edit mode there.
      for (let i = 0; i < modelsRowIndex; i++) {
        controller.dispatch({ kind: 'settings-move', delta: 1 })
      }
      controller.dispatch({ kind: 'settings-edit' })
      controller.dispatch({ kind: 'settings-apply', value: 'auto' })

      await waitFor(() => !controller.getSettingsPane().open, 2_000)
      const llmPiAi = ctx.get('settings')?.describe().find((d: SettingsDescriptor) => d.ns === 'llm-pi-ai')?.value as {
        providers?: Record<string, { models?: Array<{ id: string }> }>
      }
      expect(llmPiAi.providers?.['my-gw']?.models?.map(model => model.id)).toEqual(['gamma', 'delta'])
    } finally {
      await cleanup()
    }
  })
})

/** Poll for a condition up to a deadline so the test is not flaky on slow hosts. */
function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const tick = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error('waitFor timeout'))
        return
      }
      setTimeout(tick, 10)
    }
    tick()
  })
}
