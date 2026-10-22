/**
 * Empty `/settings` opens SettingsPane on the llm-deepseek baseURL field;
 * Enter apply calls `ctx.settings.update`; parameterized `/settings …` does
 * not open the overlay. Missing settings yields the empty-table copy.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const NS = 'llm-deepseek'

/** Scripted agent whose followup records the message and appends nothing. */
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

interface Stored {
  baseURL: string
}

interface Bench {
  ctx: Context
  controller: RuntimeController
  stored: Stored
  update: ReturnType<typeof vi.fn>
  setCredential: ReturnType<typeof vi.fn>
}

/** Mount registries and a stub settings service holding one DeepSeek section. */
async function bench(options?: {
  readonly settings?: boolean
  readonly rejectUpdate?: string
  readonly credentials?: { readonly configured: boolean }
  readonly registerTui?: boolean
  /** Stored `llm-pi-ai` section, so a provider's credential reference resolves. */
  readonly piAi?: unknown
}): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  const stored: Stored = { baseURL: 'https://api.deepseek.com' }
  const update = vi.fn(async (_ns: unknown, patch: Record<string, unknown>) => {
    if (options?.rejectUpdate !== undefined) {
      throw new Error(options.rejectUpdate)
    }
    Object.assign(stored, patch)
  })
  const setCredential = vi.fn(async () => {})
  if (options?.settings !== false) {
    const tuiSection = {
      submitOnEnter: false,
      colorTier: '16' as const,
      brandAnimation: 'off' as const,
      scrollbar: false,
    }
    const settingsService = {
      // 0.2 descriptors carry the volatile form values the pane lists.
      describe: (): { ns: unknown; value?: unknown }[] => [{ ns: NS, value: settingsService.get(NS) }],
      update,
      /** Test-only reader for the effective section the config editor exposes. */
      get: (ns: unknown): unknown => ns === NS ? stored : ns === 'llm-pi-ai' ? options?.piAi : undefined,
    }
    ctx.provide('settings', settingsService as never)
    // dsh 0.2 reads effective section values from the live Loader entries.
    ctx.provide('configEditor', {
      entries: () => [...new Set([
        ...settingsService.describe().map(({ ns }) => ns),
        ...options?.piAi === undefined ? [] : ['llm-pi-ai'],
      ])].map(ns => ({
        options: { id: ns },
        fiber: { config: settingsService.get(ns) },
      })),
    } as never)
    // The companion `tui` plugin publishes the TUI section; tests swap `get`.
    ctx.provide('tuiSettings', {
      get: () => options?.registerTui === true ? tuiSection : {},
    } as never)
  }
  if (options?.credentials !== undefined) {
    const credentials = options.credentials
    ctx.provide('credentials', {
      describe: async () => ({ configured: credentials.configured, writable: true }),
      set: setCredential,
    } as never)
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
      await options.setup?.(agent.ctx, agent)
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
  return { ctx, controller, stored, update, setCredential }
}

/** Browse the actual category and namespace before exercising field behavior. */
function openNamespace(controller: RuntimeController, name?: string): void {
  if (controller.getSettingsPane().rows.length === 0) return
  const pane = controller.getSettingsPane()
  const index = name === undefined ? 0 : pane.rows.findIndex(row => row.label === name)
  if (index < 0) throw new Error(`Missing namespace ${name}`)
  controller.dispatch({ kind: 'settings-move', delta: index - pane.selectedIndex })
  controller.dispatch({ kind: 'settings-edit' })
}

describe('SettingsPane intercept', () => {
  it('queues one selection notification per burst and cancels stale callbacks', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as never as { describe: () => { ns: string; value: unknown }[] }
    settings.describe = () => [{ ns: NS, value: { a: 'one', b: 'two', c: 'three' } }]
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    await vi.waitFor(() => expect(listener).toHaveBeenCalled())
    listener.mockClear()
    const model = controller.getModel()
    const callbacks: (() => void)[] = []
    const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => { callbacks.push(callback) })
    try {
      controller.dispatch({ kind: 'settings-move', delta: 1 })
      controller.dispatch({ kind: 'settings-move', delta: 1 })
      controller.dispatch({ kind: 'settings-move', delta: -1 })
      expect(controller.getSettingsPane().selectedIndex).toBe(1)
      expect(controller.getModel()).toBe(model)
      expect(listener).not.toHaveBeenCalled()
      expect(callbacks).toHaveLength(1)
      callbacks.shift()!()
      expect(listener).toHaveBeenCalledTimes(1)
      // A normal mutation cancels the queued selection publication. A later
      // selection burst must not be published by the cancelled callback.
      controller.dispatch({ kind: 'settings-move', delta: 1 })
      const stale = callbacks.shift()!
      controller.dispatch({ kind: 'settings-edit' })
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
      controller.dispatch({ kind: 'settings-cancel-edit' })
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(3))
      controller.dispatch({ kind: 'settings-move', delta: -1 })
      stale()
      expect(listener).toHaveBeenCalledTimes(3)
      callbacks.shift()!()
      expect(listener).toHaveBeenCalledTimes(4)
    } finally {
      queue.mockRestore()
      unsubscribe()
      await ctx.fiber.dispose()
    }
  })

  it('starts quiet with thinking hidden and exposes each display command with its current state', async () => {
    const { ctx, controller } = await bench({ settings: false })
    try {
      expect(controller.getStatusDetails()).toBe(false)
      expect(controller.getModel().reasoningExpanded).toBe(false)
      expect(controller.getLocale()).toBe('zh-CN')
      expect(controller.commands.find(command => command.name === 'scrollbar')?.description).toContain('(开)')
      controller.dispatch({ kind: 'command', query: 'status' })
      controller.dispatch({ kind: 'command', query: 'scrollbar' })
      controller.dispatch({ kind: 'command', query: 'reasoning' })
      expect(controller.getStatusDetails()).toBe(true)
      expect(controller.getScrollbarVisible()).toBe(false)
      expect(controller.getModel().reasoningExpanded).toBe(true)
      expect(controller.commands.find(command => command.name === 'reasoning')?.description).toContain('(开)')
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('serializes rapid display changes and retains the latest visible choice until it is saved', async () => {
    const { ctx, controller } = await bench()
    const stored = { reasoning: false, scrollbar: true, statusDetails: false, locale: 'en-US' as const }
    const writes: { patch: object; resolve(): void }[] = []
    const settings = ctx.get('settings')!
    ctx.get('tuiSettings')!.get = () => stored
    settings.update = vi.fn((_ns: string, patch: Record<string, unknown>) => new Promise<void>((resolve) => {
      writes.push({ patch, resolve: () => { Object.assign(stored, patch); resolve() } })
    }))
    try {
      controller.dispatch({ kind: 'toggle-reasoning' })
      controller.dispatch({ kind: 'toggle-reasoning' })
      controller.dispatch({ kind: 'toggle-reasoning' })
      await vi.waitFor(() =>{  expect(writes).toHaveLength(1) })
      expect(controller.getModel().reasoningExpanded).toBe(true)
      writes[0]!.resolve()
      await vi.waitFor(() =>{  expect(writes).toHaveLength(2) })
      expect(controller.getModel().reasoningExpanded).toBe(true)
      writes[1]!.resolve()
      await vi.waitFor(() =>{  expect(writes).toHaveLength(3) })
      expect(controller.getModel().reasoningExpanded).toBe(true)
      writes[2]!.resolve()
      await controller.dispose()
      expect(writes.map(write => write.patch)).toEqual([{ reasoning: true }, { reasoning: false }, { reasoning: true }])
      expect(stored.reasoning).toBe(true)
      expect(controller.getLocale()).toBe('en-US')
      expect(controller.commands.find(command => command.name === 'reasoning')?.description).toContain('(on)')
    } finally {
      for (const write of writes) write.resolve()
      await ctx.fiber.dispose()
    }
  })

  it('restores the saved value when a display-setting write fails and permits the next toggle', async () => {
    const { ctx, controller } = await bench()
    const stored = { reasoning: false }
    const settings = ctx.get('settings')!
    ctx.get('tuiSettings')!.get = () => stored
    settings.update = vi.fn().mockRejectedValueOnce(new Error('read-only settings'))
      .mockImplementation(async (_ns, patch) => { Object.assign(stored, patch) })
    try {
      controller.dispatch({ kind: 'toggle-reasoning' })
      expect(controller.getModel().reasoningExpanded).toBe(true)
      await vi.waitFor(() =>{  expect(controller.getFeedback()).toContain('显示设置未保存') })
      expect(controller.getModel().reasoningExpanded).toBe(false)
      controller.dispatch({ kind: 'toggle-reasoning' })
      await vi.waitFor(() =>{  expect(stored.reasoning).toBe(true) })
      expect(controller.getModel().reasoningExpanded).toBe(true)
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  })

  it('opens the overlay from empty /settings with the host baseURL row', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      editing: false,
      selectedIndex: 0,
      rows: [{ namespace: 'llm-deepseek', field: 'baseURL', value: 'https://api.deepseek.com' }],
    })
    controller.dispatch({ kind: 'settings-apply', value: 'https://ignored.example' })
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getSettingsPane().editing).toBe(false)
    await ctx.fiber.dispose()
  })

  it('opens the overlay from /settings with a trailing space', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings ' })
    expect(controller.getSettingsPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('applies the draft through ctx.settings.update and then get() returns it', async () => {
    const { ctx, controller, stored, update } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-move', delta: -1 })
    expect(controller.getSettingsPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'settings-edit' })
    expect(controller.getSettingsPane().editing).toBe(true)
    controller.dispatch({ kind: 'settings-apply', value: 'https://next.example' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toMatch(/^✓ 已更新/u)
      expect(controller.getSettingsPane().open).toBe(true)
    })
    expect(update).toHaveBeenCalledWith(NS, { baseURL: 'https://next.example' })
    expect(stored.baseURL).toBe('https://next.example')
    expect(controller.getFeedback()).toBe('✓ 已更新 baseURL')
    await ctx.fiber.dispose()
  })

  it('keeps the overlay open and paints the failure pair when update rejects', async () => {
    const { ctx, controller, stored } = await bench({ rejectUpdate: 'unreadable' })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://bad.example' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane()).toMatchObject({
        open: true,
        editing: false,
        updateError: 'unreadable',
      })
    })
    expect(stored.baseURL).toBe('https://api.deepseek.com')
    await ctx.fiber.dispose()
  })

  it('cancels edit without writing', async () => {
    const { ctx, controller, update } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-cancel-edit' })
    expect(controller.getSettingsPane()).toMatchObject({ open: true, editing: false })
    expect(update).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('closes the overlay on escape from browse', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-escape' })
    expect(controller.getSettingsPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('does not open the overlay for a parameterized /settings line', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings foo' })
    expect(controller.getSettingsPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('shows the empty table when ctx.settings is missing', async () => {
    const { ctx, controller, update } = await bench({ settings: false })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      rows: [],
    })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    expect(controller.getSettingsPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    expect(controller.getSettingsPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'settings-apply', value: 'https://ignored.example' })
    expect(controller.getSettingsPane().updateError).toBe('无可用设置')
    expect(update).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('omits a namespace whose get() is not a plain object', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as never as { get: (ns: unknown) => unknown }
    settings.get = () => undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().rows).toEqual([])
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => ({ baseURL: 1 })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().rows[0]?.value).toBe('1')
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => null
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().rows).toEqual([])
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => []
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().rows).toEqual([])
    const internals = controller as unknown as {
      settingsRows: Array<{ namespace: string; field: string; value: string }>
      settingsOpen: boolean
      settingsEditing: boolean
      settingsSelectedIndex: number
    }
    internals.settingsRows = [{ namespace: 'llm-deepseek', field: 'baseURL', value: '' }]
    internals.settingsOpen = true
    internals.settingsEditing = true
    internals.settingsSelectedIndex = 0
    controller.dispatch({ kind: 'settings-apply', value: 'https://array.example' })
    expect(controller.getSettingsPane().updateError).toBeUndefined()
    const first = controller.getSettingsPane()
    const second = controller.getSettingsPane()
    expect(first).toBe(second)
    await ctx.fiber.dispose()
  })

  it('paints a non-Error update rejection', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as never as {
      update: (ns: unknown, patch: Record<string, unknown>) => Promise<void>
    }
    settings.update = async () => {
      throw 'unreadable-string'
    }
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://bad.example' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().updateError).toBe('unreadable-string')
    })
    await ctx.fiber.dispose()
  })

  it('ignores a settings write that settles after dispose', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as never as {
      update: (ns: unknown, patch: Record<string, unknown>) => Promise<void>
    }
    let settle!: (error?: Error) => void
    settings.update = () => new Promise((resolve, reject) => {
      settle = (error) => {
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://late.example' })
    const disposing = controller.dispose()
    await Promise.resolve()
    settle()
    await disposing
    expect(controller.getFeedback()).toBeUndefined()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getFeedback()).toBeUndefined()
    ;(controller as unknown as { setFeedback(text: string): void }).setFeedback('late')
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('reads submitOnEnter from the tui settings service', async () => {
    const { ctx, controller } = await bench()
    ctx.get('tuiSettings')!.get = () => ({ submitOnEnter: false })
    expect(controller.getSubmitOnEnter()).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reads scrollbar visibility from the tui settings service with visible as the default', async () => {
    const fallback = await bench()
    expect(fallback.controller.getScrollbarVisible()).toBe(true)
    const tui = fallback.ctx.get('tuiSettings')!
    tui.get = () => ({ scrollbar: false })
    expect(fallback.controller.getScrollbarVisible()).toBe(false)
    tui.get = () => ({ scrollbar: true })
    expect(fallback.controller.getScrollbarVisible()).toBe(true)
    const registered = await bench({ registerTui: true })
    expect(registered.controller.getScrollbarVisible()).toBe(false)
  })

  it('reads brandAnimation from the tui settings service with auto as the default', async () => {
    const fallback = await bench()
    expect(fallback.controller.getBrandAnimation()).toBe('auto')
    fallback.ctx.get('tuiSettings')!.get = () => ({ brandAnimation: 'on' })
    expect(fallback.controller.getBrandAnimation()).toBe('on')
    await fallback.ctx.fiber.dispose()

    const registered = await bench({ registerTui: true })
    expect(registered.controller.getBrandAnimation()).toBe('off')
    await registered.ctx.fiber.dispose()
  })

  it('omits missing/zero session stats and returns measured projections', async () => {
    const { ctx, controller } = await bench()
    expect(controller.getSessionStats()).toBeUndefined()
    let stats: unknown
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { sessionStats: stats } }),
    } as never)
    const refresh = () => { controller.dispatch({ kind: 'toggle-reasoning' }) }
    refresh()
    expect(controller.getSessionStats()).toBeUndefined()
    stats = { turns: 1, decodeTokens: 0, llmMs: 0 }
    refresh()
    expect(controller.getSessionStats()).toBeUndefined()
    stats = { turns: 2, decodeTokens: 30, llmMs: 40 }
    refresh()
    expect(controller.getSessionStats()).toEqual({ turns: 2, decodeTokens: 30, llmMs: 40 })
    await ctx.fiber.dispose()
  })

  it('ignores a settings write rejection that settles after dispose', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as never as {
      update: (ns: unknown, patch: Record<string, unknown>) => Promise<void>
    }
    let settle!: (error?: Error) => void
    settings.update = () => new Promise((resolve, reject) => {
      settle = (error) => {
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://late.example' })
    const disposing = controller.dispose()
    await Promise.resolve()
    settle(new Error('too late'))
    await disposing
    expect(controller.getSettingsPane().updateError).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('applies the selected row through that row\'s settings namespace', async () => {
    const openaiNs = 'llm-openai'
    const openaiStored = { baseURL: 'https://api.openai.com/v1' }
    const { ctx, controller, stored, update } = await bench()
    const settings = ctx.get('settings') as never as {
      describe: () => { ns: unknown; value?: unknown }[]
      get: (ns: unknown) => unknown
    }
    settings.describe = () => [NS, openaiNs].map(ns => ({ ns, value: settings.get(ns) }))
    settings.get = (ns: unknown) => ns === NS ? stored : ns === openaiNs ? openaiStored : undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    expect(controller.getSettingsPane().rows).toMatchObject([
      { namespace: 'llm-openai', field: 'baseURL', value: 'https://api.openai.com/v1' },
    ])
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://openai-next.example' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toMatch(/^✓ 已更新/u)
      expect(controller.getSettingsPane().open).toBe(true)
    })
    expect(update).toHaveBeenCalledWith(openaiNs, { baseURL: 'https://openai-next.example' })
    await ctx.fiber.dispose()
  })

  it('applies DeepSeek models JSON through the selected field', async () => {
    const stored = { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-flash' }] }
    const { ctx, controller, update } = await bench()
    const settings = ctx.get('settings') as never as { get: (ns: unknown) => unknown }
    settings.get = () => stored
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().rows.map(row => row.field)).toEqual(['baseURL', 'models'])
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({
      kind: 'settings-apply',
      value: '[{"id":"deepseek-v4-pro"}]',
    })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toMatch(/^✓ 已更新/u)
      expect(controller.getSettingsPane().open).toBe(true)
    })
    expect(update).toHaveBeenCalledWith(NS, { models: [{ id: 'deepseek-v4-pro' }] })
    expect(controller.getFeedback()).toBe('✓ 已更新 models')
    await ctx.fiber.dispose()
  })

  it('applies llm-pi-ai providers JSON through the selected field', async () => {
    const piNs = 'llm-pi-ai'
    const piStored = {
      providers: { acme: { api: 'openai-completions', baseURL: 'https://gw.example' } },
    }
    const { ctx, controller, stored, update } = await bench()
    const settings = ctx.get('settings') as never as {
      describe: () => { ns: unknown; value?: unknown }[]
      get: (ns: unknown) => unknown
    }
    settings.describe = () => [NS, piNs].map(ns => ({ ns, value: settings.get(ns) }))
    settings.get = (ns: unknown) => ns === NS ? stored : ns === piNs ? piStored : undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller, 'llm-pi-ai')
    expect(controller.getSettingsPane().rows[0]).toMatchObject({
      namespace: 'llm-pi-ai',
      field: 'providers',
    })
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({
      kind: 'settings-apply',
      value: '{"acme":{"api":"openai-completions","baseURL":"https://next.example"}}',
    })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toMatch(/^✓ 已更新/u)
      expect(controller.getSettingsPane().open).toBe(true)
    })
    expect(update).toHaveBeenCalledWith(piNs, {
      providers: { acme: { api: 'openai-completions', baseURL: 'https://next.example' } },
    })
    expect(controller.getFeedback()).toBe('✓ 已更新 providers')
    await ctx.fiber.dispose()
  })

  it('round-trips defaultInput JSON and retains comma input', async () => {
    const piNs = 'llm-pi-ai'
    const piStored = { providers: { acme: { api: 'openai-completions', baseURL: 'https://gw.example', defaultInput: ['text', 'image'] } } }
    const { ctx, controller, update } = await bench()
    const settings = ctx.get('settings') as never as { describe: () => { ns: unknown; value?: unknown }[]; get: (ns: unknown) => unknown }
    settings.describe = () => [{ ns: piNs, value: settings.get(piNs) }]
    settings.get = (ns: unknown) => ns === piNs ? piStored : undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller, 'llm-pi-ai')
    const descend = (label: string): void => {
      const index = controller.getSettingsPane().rows.findIndex(item => item.label === label)
      if (index < 0) throw new Error(`missing ${label}`)
      controller.dispatch({ kind: 'settings-move', delta: index - controller.getSettingsPane().selectedIndex })
      controller.dispatch({ kind: 'settings-edit' })
    }
    descend('providers')
    descend('acme')
    const row = controller.getSettingsPane().rows.findIndex(item => item.field.endsWith('defaultInput'))
    if (row < 0) throw new Error('missing defaultInput')
    controller.dispatch({ kind: 'settings-move', delta: row - controller.getSettingsPane().selectedIndex })
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({ kind: 'settings-apply', value: controller.getSettingsPane().rows[controller.getSettingsPane().selectedIndex]?.editValue ?? '' })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenLastCalledWith(piNs, { providers: { acme: { defaultInput: ['text', 'image'] } } })
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({ kind: 'settings-apply', value: '["text"]' })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update).toHaveBeenLastCalledWith(piNs, { providers: { acme: { defaultInput: ['text'] } } })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'text, image' })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(3))
    expect(update).toHaveBeenLastCalledWith(piNs, { providers: { acme: { defaultInput: ['text', 'image'] } } })
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({ kind: 'settings-apply', value: '["audio"]' })
    expect(controller.getSettingsPane().updateError).toContain('未知输入模态')
    expect(update).toHaveBeenCalledTimes(3)
    await ctx.fiber.dispose()
  })

  it('keeps the overlay open and reports invalid JSON', async () => {
    const stored = { models: [{ id: 'a' }] }
    const { ctx, controller, update } = await bench()
    const settings = ctx.get('settings') as never as { get: (ns: unknown) => unknown }
    settings.get = () => stored
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit-json' })
    controller.dispatch({ kind: 'settings-apply', value: '{' })
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      editing: false,
      updateError: 'JSON 无效',
    })
    expect(update).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('exports the settings document path without closing the overlay', async () => {
    const { ctx, controller } = await bench()
    const prepareDocument = vi.fn(async () => '/tmp/settings.yaml')
    Object.assign(ctx.get('settings') as object, { prepareDocument })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-export' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 设置文件 /tmp/settings.yaml')
    })
    expect(controller.getSettingsPane().open).toBe(true)
    expect(prepareDocument).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports a missing settings file on export', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-export' })
    expect(controller.getFeedback()).toBe('无可用设置文件')
    expect(controller.getSettingsPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('reloads overlay rows from the live host', async () => {
    const { ctx, controller, stored } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    stored.baseURL = 'https://reloaded.example'
    controller.dispatch({ kind: 'settings-reload' })
    expect(controller.getSettingsPane().rows[0]?.value).toBe('https://reloaded.example')
    expect(controller.getFeedback()).toBe('✓ 已重载设置')
    expect(controller.getSettingsPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('opens onboarding when the DeepSeek key is unconfigured', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: false },
    })
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      onboarding: true,
      editing: true,
      rows: [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }],
    })
    controller.dispatch({ kind: 'settings-apply', value: 'sk-onboard' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(setCredential).toHaveBeenCalled()
    expect(controller.getFeedback()).toBe('✓ 已保存 API key')
    expect(controller.getModelPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('stores a provider credential from its settings row without leaving the pane', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: true },
      piAi: { providers: { goat: { apiKeyEnv: 'GOAT_API_KEY', baseURL: 'https://goat.example/v1' } } },
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller, '凭据管理')
    const pane = controller.getSettingsPane()
    const index = pane.rows.findIndex(row => row.namespace === 'credentials' && row.field === 'GOAT_API_KEY')
    expect(pane.open).toBe(true)
    expect(index).toBeGreaterThanOrEqual(0)
    controller.dispatch({ kind: 'settings-move', delta: index })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'goat-secret' })
    await vi.waitFor(() => {
      expect(setCredential).toHaveBeenCalled()
    })
    expect(setCredential.mock.calls[0]?.[0]).toBe('GOAT_API_KEY')
    expect(setCredential.mock.calls[0]?.[1]).toBe('goat-secret')
    // The pane survives so the row can report its state instead of sending a
    // provider key's owner to the model list.
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getFeedback()).toBe('✓ 已保存 GOAT_API_KEY')
    await ctx.fiber.dispose()
  })

  it('does not open onboarding when the key is already configured', async () => {
    const { ctx, controller } = await bench({
      credentials: { configured: true },
    })
    expect(controller.getSettingsPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('skips onboarding when credentials.describe rejects', async () => {
    const { ctx } = await bench()
    ctx.provide('credentials', {
      describe: async () => {
        throw new Error('probe-down')
      },
      set: vi.fn(async () => {}),
    } as never)
    const io: TuiIo = {
      stdout: { write: () => true },
      stderr: { write: () => true },
      exit: () => {},
    }
    const controller = new RuntimeController(ctx, io, { task: '' }, () => {})
    await controller.start()
    expect(controller.getSettingsPane().open).toBe(false)
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects an empty onboarding key', async () => {
    const { ctx, controller } = await bench({
      credentials: { configured: false },
    })
    controller.dispatch({ kind: 'settings-apply', value: '' })
    expect(controller.getSettingsPane().updateError).toBe('需要非空 API key')
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getModelPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('skips onboarding from settings-cancel-edit', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: false },
    })
    controller.dispatch({ kind: 'settings-cancel-edit' })
    expect(controller.getSettingsPane().open).toBe(false)
    expect(controller.getFeedback()).toBe('✓ 已跳过引导')
    expect(controller.getModelPane().open).toBe(false)
    expect(setCredential).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('paints a credentials.set rejection', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: false },
    })
    setCredential.mockRejectedValueOnce(new Error('not writable'))
    controller.dispatch({ kind: 'settings-apply', value: 'sk-onboard' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().updateError).toBe('not writable')
    })
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getModelPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports an empty or rejected settings document export', async () => {
    const { ctx, controller } = await bench()
    const prepareDocument = vi.fn(async () => undefined)
    Object.assign(ctx.get('settings') as object, { prepareDocument })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-export' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('无可用设置文件')
    })
    prepareDocument.mockRejectedValueOnce(new Error('unreadable'))
    controller.dispatch({ kind: 'settings-export' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ unreadable')
    })
    expect(controller.getSettingsPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('ignores export and reload while editing', async () => {
    const { ctx, controller } = await bench()
    const prepareDocument = vi.fn(async () => '/tmp/settings.yaml')
    Object.assign(ctx.get('settings') as object, { prepareDocument })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-export' })
    controller.dispatch({ kind: 'settings-reload' })
    expect(prepareDocument).not.toHaveBeenCalled()
    expect(controller.getSettingsPane().editing).toBe(true)
    await ctx.fiber.dispose()
  })

  it('clamps selection when reload shrinks the row list', async () => {
    const { ctx, controller, stored } = await bench()
    const settings = ctx.get('settings') as never as { get: (ns: unknown) => unknown }
    settings.get = () => ({ ...stored, models: [] })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    expect(controller.getSettingsPane().selectedIndex).toBe(1)
    settings.get = () => stored
    controller.dispatch({ kind: 'settings-reload' })
    expect(controller.getSettingsPane().selectedIndex).toBe(0)
    expect(controller.getFeedback()).toBe('✓ 已重载设置')
    await ctx.fiber.dispose()
  })

  it('reads submitOnEnter from a registered tui section', async () => {
    const { ctx, controller } = await bench({ registerTui: true })
    expect(controller.getSubmitOnEnter()).toBe(false)
    await ctx.fiber.dispose()
  })

  it('skips onboarding on escape', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: false },
    })
    expect(controller.getSettingsPane().onboarding).toBe(true)
    controller.dispatch({ kind: 'settings-escape' })
    expect(controller.getSettingsPane().open).toBe(false)
    expect(controller.getFeedback()).toBe('✓ 已跳过引导')
    expect(controller.getModelPane().open).toBe(false)
    expect(setCredential).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('opens API key pane with /key and saves the key', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: true },
    })
    controller.dispatch({ kind: 'command', query: 'key' })
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      onboarding: true,
      editing: true,
      rows: [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }],
    })
    controller.dispatch({ kind: 'settings-apply', value: 'sk-direct-key' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(setCredential).toHaveBeenCalled()
    expect(controller.getFeedback()).toBe('✓ 已保存 API key')
    await ctx.fiber.dispose()
  })

  it('sets API key directly via /key <token> and auto-heals polluted apiKeyEnv', async () => {
    const { ctx, controller, setCredential, update, stored } = await bench({
      credentials: { configured: true },
    })
    const settings = ctx.get('settings') as never as { get: (ns: unknown) => unknown }
    settings.get = ns => ns === NS ? { ...stored, apiKeyEnv: 'sk-polluted-in-settings' } : undefined
    controller.dispatch({ kind: 'command', query: 'key sk-new-token' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已保存 API key')
    })
    expect(setCredential).toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(NS, { apiKeyEnv: 'DEEPSEEK_API_KEY' })
    await ctx.fiber.dispose()
  })

  it('sets arbitrary credential key via /key <KEY_NAME> <token>', async () => {
    const { ctx, controller, setCredential } = await bench({
      credentials: { configured: true },
    })
    controller.dispatch({ kind: 'command', query: 'key OPENAI_API_KEY sk-openai-test' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已保存 OPENAI_API_KEY')
    })
    expect(setCredential).toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('opens API key pane for specific key via /key <KEY_NAME>', async () => {
    const { ctx, controller } = await bench({
      credentials: { configured: true },
    })
    controller.dispatch({ kind: 'command', query: 'key OPENAI_API_KEY' })
    expect(controller.getSettingsPane()).toMatchObject({
      open: true,
      onboarding: true,
      editing: true,
      rows: [{ namespace: 'credentials', field: 'OPENAI_API_KEY', value: '' }],
    })
    await ctx.fiber.dispose()
  })

  it('toggles boolean and enumerable settings in place on settings-toggle without closing the overlay', async () => {
    const { ctx, controller, update } = await bench()
    const tuiStored = {
      reasoning: false,
      brandAnimation: 'auto',
      locale: 'zh-CN',
      colorTier: 'truecolor',
    }
    const settings = ctx.get('settings') as never as {
      describe: () => { ns: unknown; value?: unknown }[]
      get: (ns: unknown) => unknown
    }
    settings.describe = () => [{ ns: 'tui', value: tuiStored }]
    settings.get = (ns: unknown) => ns === 'tui' ? tuiStored : undefined
    update.mockImplementation(async (_ns: unknown, patch: Record<string, unknown>) => {
      Object.assign(tuiStored, patch)
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    expect(controller.getSettingsPane().open).toBe(true)
    controller.dispatch({ kind: 'settings-toggle' })
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('tui', { reasoning: true })
    })
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getSettingsPane().rows[0]?.value).toBe('true')
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-toggle' })
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith('tui', { brandAnimation: 'on' })
    })
    expect(controller.getSettingsPane().open).toBe(true)
    expect(controller.getSettingsPane().rows[1]?.value).toBe('开启')
    await ctx.fiber.dispose()
  })
})

it('suggests current provider credential names without duplicates or literal secrets, including newly added providers', async () => {
  const providers: Record<string, { apiKeyEnv: string }> = {
    goat: { apiKeyEnv: 'GOAT_API_KEY' },
    shared: { apiKeyEnv: 'GOAT_API_KEY' },
    invalid: { apiKeyEnv: 'sk-not-a-reference' },
  }
  const { ctx, controller, setCredential } = await bench({ credentials: { configured: true }, piAi: { providers } })
  try {
    const names = () => controller.commands.filter(item => item.name.startsWith('key ')).map(item => item.name)
    expect(names()).toEqual(['key DEEPSEEK_API_KEY', 'key GOAT_API_KEY'])
    providers['other'] = { apiKeyEnv: 'OTHER_API_KEY' }
    expect(names()).toContain('key OTHER_API_KEY')
    expect(setCredential).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('lets /key select a configured provider reference before entering its secret', async () => {
  const { ctx, controller, setCredential } = await bench({
    credentials: { configured: true },
    piAi: { providers: { goat: { apiKeyEnv: 'GOAT_API_KEY' } } },
  })
  try {
    controller.dispatch({ kind: 'command', query: 'key' })
    expect(controller.getSettingsPane()).toMatchObject({ onboarding: true, editing: false, selectedIndex: 0 })
    expect(controller.getSettingsPane().rows.map(row => row.field)).toEqual(['DEEPSEEK_API_KEY', 'GOAT_API_KEY'])
    expect(controller.getSettingsPane().rows.every(row => row.editValue === '')).toBe(true)
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    expect(controller.getSettingsPane()).toMatchObject({ selectedIndex: 1, editing: true })
    controller.dispatch({ kind: 'settings-apply', value: 'synthetic-provider-key' })
    await vi.waitFor(() => expect(setCredential).toHaveBeenCalledWith(credentialRef('GOAT_API_KEY'), 'synthetic-provider-key'))
  } finally { await ctx.fiber.dispose() }
})

it('validates and persists composer keybinding edits without dropping other overrides', async () => {
  const { ctx, controller, update } = await bench()
  const live = { keybindings: {} as Record<string, string> }
  ctx.tuiSettings.get = () => live
  update.mockImplementation(async (_ns: unknown, patch: object) => { Object.assign(live, patch) })
  try {
    controller.dispatch({ kind: 'command', query: 'bind toggle-reasoning Ctrl+R' })
    await vi.waitFor(() => expect(live.keybindings['toggle-reasoning']).toBe('Ctrl+R'))
    controller.dispatch({ kind: 'command', query: 'bind copy-message Ctrl+R' })
    expect(update).toHaveBeenCalledTimes(1)
    controller.dispatch({ kind: 'command', query: 'unbind copy-message' })
    await vi.waitFor(() => expect(live.keybindings['copy-message']).toBe('none'))
    expect(controller.getKeybindings()).toEqual({ 'toggle-reasoning': 'Ctrl+R', 'copy-message': 'none' })
  } finally { await controller.dispose();await ctx.fiber.dispose() }
})

it('browses providers and model details, saves nested arrays in place, and retains unknown model fields', async () => {
  const { ctx, controller, update } = await bench()
  const profile = {
    baseURL: 'https://gateway.example/v1',
    models: Array.from({ length: 65 }, (_, index) => ({ id: `model-${String(index)}`, contextWindow: 32768, extension: { costs: [1, 2], untouched: 'keep' } })),
    unknownProviderField: { enabled: true },
  }
  const live = { providers: { long_provider_name: profile } }
  ctx.settings.describe = () => [{ ns: 'llm-pi-ai', value: live, schema: {} }] as never
  update.mockImplementation(async (_ns: unknown, patch: { providers: { long_provider_name: Partial<typeof profile> } }) => { Object.assign(live.providers.long_provider_name, patch.providers.long_provider_name) })
  const enter = (label: string) => {
    const pane = controller.getSettingsPane()
    const index = pane.rows.findIndex(row => row.label === label)
    expect(index).toBeGreaterThanOrEqual(0)
    controller.dispatch({ kind: 'settings-move', delta: index - pane.selectedIndex })
    controller.dispatch({ kind: 'settings-edit' })
  }
  try {
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows.map(row => row.label)).toEqual(['llm-pi-ai'])
    enter('llm-pi-ai'); enter('providers'); enter('long_provider_name'); enter('models')
    expect(controller.getSettingsPane().rows).toHaveLength(65)
    enter('model-32')
    expect(controller.getSettingsPane().rows.map(row => row.label)).toEqual(['id', 'contextWindow', 'extension'])
    enter('extension'); enter('costs')
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: '9' })
    await vi.waitFor(() => expect(controller.getFeedback()).toBe('✓ 已更新 providers.long_provider_name.models.32.extension.costs.1'))
    expect(controller.getSettingsPane()).toMatchObject({ open: true, editing: false, selectedIndex: 1 })
    expect(controller.getSettingsPane().rows[1]?.value).toBe('9')
    expect(live.providers.long_provider_name.models[32]).toMatchObject({ contextWindow: 32768, extension: { costs: [1, 9], untouched: 'keep' } })
    expect(live.providers.long_provider_name.unknownProviderField).toEqual({ enabled: true })
    expect(live.providers.long_provider_name.models[33]?.extension.costs).toEqual([1, 2])
    controller.dispatch({ kind: 'settings-escape' })
    expect(controller.getSettingsPane().rows[controller.getSettingsPane().selectedIndex]?.label).toBe('costs')
    controller.dispatch({ kind: 'settings-search', query: 'model-64', active: false })
    expect(controller.getSettingsPane().rows.some(row => row.value === 'model-64')).toBe(true)
    controller.dispatch({ kind: 'settings-search', query: '', active: false })
    expect(controller.getSettingsPane().rows[controller.getSettingsPane().selectedIndex]?.label).toBe('costs')
  } finally { await controller.dispose(); await ctx.fiber.dispose() }
})


it('opens visible category tabs, clears search on category changes and restores deep positions', async () => {
  const { ctx, controller } = await bench()
  ctx.settings.describe = () => [
    { ns: NS, value: { nested: { enabled: true, other: false } } },
    { ns: 'tui', value: { theme: 'dark' } },
  ] as never
  try {
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane()).toMatchObject({
      categories: [
        { id: 'group:providers', label: '模型与凭据', count: 1 },
        { id: 'group:appearance', label: '外观与输入', count: 1 },
      ], activeCategory: 'group:providers', rows: [{ label: NS }],
    })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-search', query: 'true', active: true })
    controller.dispatch({ kind: 'settings-group', delta: 1 })
    expect(controller.getSettingsPane()).toMatchObject({ activeCategory: 'group:appearance', searching: false, filter: '', rows: [{ label: 'tui' }] })
    controller.dispatch({ kind: 'settings-group', delta: -1 })
    expect(controller.getSettingsPane()).toMatchObject({ breadcrumb: ['设置', '模型与凭据', NS, 'nested'], selectedIndex: 1 })
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-escape' })
    expect(controller.getSettingsPane().open).toBe(true)
    controller.dispatch({ kind: 'settings-escape' })
    expect(controller.getSettingsPane().open).toBe(false)
  } finally { await controller.dispose(); await ctx.fiber.dispose() }
})

it.each([
  { reject: false, edit: false }, { reject: true, edit: false },
  { reject: false, edit: true }, { reject: true, edit: true },
])('blocks overlapping setting writes and releases busy after $reject rejection with editor=$edit', async ({ reject, edit }) => {
  const { ctx, controller, update } = await bench()
  const live = { enabled: false }
  ctx.settings.describe = () => [{ ns: NS, value: live }] as never
  const pending: (() => void)[] = []
  update.mockImplementation((_ns: unknown, patch: object) => new Promise<void>((resolve, rejectWrite) => {
    pending.push(() => { if (reject) rejectWrite(new Error('write failed')); else { Object.assign(live, patch); resolve() } })
  }))
  try {
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    if (edit) {
      controller.dispatch({ kind: 'settings-edit' })
      controller.dispatch({ kind: 'settings-apply', value: 'true' })
    } else controller.dispatch({ kind: 'settings-toggle' })
    controller.dispatch({ kind: 'settings-toggle' })
    expect(update).toHaveBeenCalledTimes(1)
    expect(controller.getSettingsPane().busy).toBe(true)
    controller.dispatch({ kind: 'settings-escape' })
    controller.dispatch({ kind: 'settings-cancel-edit' })
    expect(controller.getSettingsPane()).toMatchObject({ open: true, busy: true, editing: false, breadcrumb: ['设置', '模型与凭据', NS] })
    controller.dispatch({ kind: 'settings-toggle' })
    expect(update).toHaveBeenCalledTimes(1)
    pending[0]!()
    await vi.waitFor(() => expect(controller.getSettingsPane().busy).not.toBe(true))
    expect(controller.getSettingsPane().rows[0]?.value).toBe(reject ? 'false' : 'true')
    expect(controller.getSettingsPane().updateError).toBe(reject ? 'write failed' : undefined)
  } finally { for (const settle of pending) settle(); await controller.dispose(); await ctx.fiber.dispose() }
})

it('does not quick-toggle a read-only boolean row', async () => {
  const { ctx, controller, update } = await bench()
  try {
    controller.dispatch({ kind: 'command', query: 'settings' })
    const internals = controller as unknown as { settingsRows: { namespace: string; field: string; value: string; editable: boolean }[] }
    internals.settingsRows = [{ namespace: NS, field: 'enabled', value: 'false', editable: false }]
    controller.dispatch({ kind: 'settings-toggle' })
    await Promise.resolve()
    expect(update).not.toHaveBeenCalled()
  } finally { await controller.dispose(); await ctx.fiber.dispose() }
})


it('retains the chosen search result when Enter completes search input', async () => {
  const { ctx, controller } = await bench()
  ctx.settings.describe = () => [{ ns: NS, value: { first: false, second: false } }] as never
  try {
    controller.dispatch({ kind: 'command', query: 'settings' })
    openNamespace(controller)
    controller.dispatch({ kind: 'settings-search', query: 'false', active: true })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    expect(controller.getSettingsPane().rows[controller.getSettingsPane().selectedIndex]?.field).toBe('second')
    controller.dispatch({ kind: 'settings-search', query: 'false', active: false })
    expect(controller.getSettingsPane()).toMatchObject({ searching: false, filter: 'false', selectedIndex: 1 })
    expect(controller.getSettingsPane().rows[controller.getSettingsPane().selectedIndex]?.field).toBe('second')
  } finally { await controller.dispose(); await ctx.fiber.dispose() }
})
