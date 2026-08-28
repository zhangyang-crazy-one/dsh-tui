/**
 * Empty `/settings` opens SettingsPane on the llm-deepseek baseURL field;
 * Enter apply calls `ctx.settings.update`; parameterized `/settings …` does
 * not open the overlay. Missing settings yields the empty-table copy.
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
import type { Session } from '@deepseek-ai/dsh-session'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const NS = settingsNamespace('llm-deepseek')

/** Scripted agent whose followup records the message and appends nothing. */
function scriptedAgent(ownerCtx: Context, session: Session): Agent {
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
  const update = vi.fn(async (_ns: unknown, patch: object) => {
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
    }
    ctx.provide('settings', {
      describe: () => [{ ns: NS }],
      get: (ns: unknown) => ns === NS ? stored : undefined,
      update,
      ...(options?.registerTui === true
        ? {
          register: () => ({
            get: () => tuiSection,
            watch: () => () => {},
            update: async () => {},
            replace: async () => {},
          }),
        }
        : {}),
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
  return { ctx, controller, stored, update, setCredential }
}

describe('SettingsPane intercept', () => {
  it('opens the overlay from empty /settings with the host baseURL row', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-move', delta: -1 })
    expect(controller.getSettingsPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'settings-edit' })
    expect(controller.getSettingsPane().editing).toBe(true)
    controller.dispatch({ kind: 'settings-apply', value: 'https://next.example' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(update).toHaveBeenCalledWith(NS, { baseURL: 'https://next.example' })
    expect(stored.baseURL).toBe('https://next.example')
    expect(controller.getFeedback()).toBe('✓ 已更新 baseURL')
    await ctx.fiber.dispose()
  })

  it('keeps the overlay open and paints the failure pair when update rejects', async () => {
    const { ctx, controller, stored } = await bench({ rejectUpdate: 'unreadable' })
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-cancel-edit' })
    expect(controller.getSettingsPane()).toMatchObject({ open: true, editing: false })
    expect(update).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('closes the overlay on escape from browse', async () => {
    const { ctx, controller } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    const settings = ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows).toEqual([])
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => ({ baseURL: 1 })
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows[0]?.value).toBe('1')
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => null
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows).toEqual([])
    controller.dispatch({ kind: 'settings-escape' })
    settings.get = () => []
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    const settings = ctx.get('settings') as {
      update: (ns: unknown, patch: object) => Promise<void>
    }
    settings.update = async () => {
      throw 'unreadable-string'
    }
    controller.dispatch({ kind: 'command', query: 'settings' })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://bad.example' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().updateError).toBe('unreadable-string')
    })
    await ctx.fiber.dispose()
  })

  it('ignores a settings write that settles after dispose', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as {
      update: (ns: unknown, patch: object) => Promise<void>
    }
    let settle!: (error?: Error) => void
    settings.update = () => new Promise((resolve, reject) => {
      settle = (error) => {
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://late.example' })
    const disposing = controller.dispose()
    await Promise.resolve()
    settle()
    await disposing
    expect(controller.getFeedback()).toBeUndefined()
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getFeedback()).toBeUndefined()
    ;(controller as unknown as { setFeedback(text: string): void }).setFeedback('late')
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('reads submitOnEnter from the global settings fallback', async () => {
    const { ctx, controller } = await bench()
    const settings = ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => ({ submitOnEnter: false })
    expect(controller.getSubmitOnEnter()).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reads brandAnimation from global and registered tui settings with auto as the default', async () => {
    const fallback = await bench()
    expect(fallback.controller.getBrandAnimation()).toBe('auto')
    const settings = fallback.ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => ({ brandAnimation: 'on' })
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
    const settings = ctx.get('settings') as {
      update: (ns: unknown, patch: object) => Promise<void>
    }
    let settle!: (error?: Error) => void
    settings.update = () => new Promise((resolve, reject) => {
      settle = (error) => {
        if (error === undefined) resolve()
        else reject(error)
      }
    })
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    const openaiNs = settingsNamespace('llm-openai')
    const openaiStored = { baseURL: 'https://api.openai.com/v1' }
    const { ctx, controller, stored, update } = await bench()
    const settings = ctx.get('settings') as {
      describe: () => { ns: unknown }[]
      get: (ns: unknown) => unknown
    }
    settings.describe = () => [{ ns: NS }, { ns: openaiNs }]
    settings.get = (ns: unknown) => ns === NS ? stored : ns === openaiNs ? openaiStored : undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows).toEqual([
      { namespace: 'llm-deepseek', field: 'baseURL', value: 'https://api.deepseek.com' },
      { namespace: 'llm-openai', field: 'baseURL', value: 'https://api.openai.com/v1' },
    ])
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-apply', value: 'https://openai-next.example' })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(update).toHaveBeenCalledWith(openaiNs, { baseURL: 'https://openai-next.example' })
    await ctx.fiber.dispose()
  })

  it('applies DeepSeek models JSON through the selected field', async () => {
    const stored = { baseURL: 'https://api.deepseek.com', models: [{ id: 'deepseek-v4-flash' }] }
    const { ctx, controller, update } = await bench()
    const settings = ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => stored
    controller.dispatch({ kind: 'command', query: 'settings' })
    expect(controller.getSettingsPane().rows.map(row => row.field)).toEqual(['baseURL', 'models'])
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({
      kind: 'settings-apply',
      value: '[{"id":"deepseek-v4-pro"}]',
    })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(update).toHaveBeenCalledWith(NS, { models: [{ id: 'deepseek-v4-pro' }] })
    expect(controller.getFeedback()).toBe('✓ 已更新 models')
    await ctx.fiber.dispose()
  })

  it('applies llm-pi-ai providers JSON through the selected field', async () => {
    const piNs = settingsNamespace('llm-pi-ai')
    const piStored = {
      providers: { acme: { api: 'openai-completions', baseURL: 'https://gw.example' } },
    }
    const { ctx, controller, stored, update } = await bench()
    const settings = ctx.get('settings') as {
      describe: () => { ns: unknown }[]
      get: (ns: unknown) => unknown
    }
    settings.describe = () => [{ ns: NS }, { ns: piNs }]
    settings.get = (ns: unknown) => ns === NS ? stored : ns === piNs ? piStored : undefined
    controller.dispatch({ kind: 'command', query: 'settings' })
    controller.dispatch({ kind: 'settings-move', delta: 1 })
    expect(controller.getSettingsPane().rows[1]).toMatchObject({
      namespace: 'llm-pi-ai',
      field: 'providers',
    })
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({
      kind: 'settings-apply',
      value: '{"acme":{"api":"openai-completions","baseURL":"https://next.example"}}',
    })
    await vi.waitFor(() => {
      expect(controller.getSettingsPane().open).toBe(false)
    })
    expect(update).toHaveBeenCalledWith(piNs, {
      providers: { acme: { api: 'openai-completions', baseURL: 'https://next.example' } },
    })
    expect(controller.getFeedback()).toBe('✓ 已更新 providers')
    await ctx.fiber.dispose()
  })

  it('keeps the overlay open and reports invalid JSON', async () => {
    const stored = { models: [{ id: 'a' }] }
    const { ctx, controller, update } = await bench()
    const settings = ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => stored
    controller.dispatch({ kind: 'command', query: 'settings' })
    controller.dispatch({ kind: 'settings-edit' })
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
    controller.dispatch({ kind: 'settings-export' })
    expect(controller.getFeedback()).toBe('无可用设置文件')
    expect(controller.getSettingsPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('reloads overlay rows from the live host', async () => {
    const { ctx, controller, stored } = await bench()
    controller.dispatch({ kind: 'command', query: 'settings' })
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
    controller.dispatch({ kind: 'settings-edit' })
    controller.dispatch({ kind: 'settings-export' })
    controller.dispatch({ kind: 'settings-reload' })
    expect(prepareDocument).not.toHaveBeenCalled()
    expect(controller.getSettingsPane().editing).toBe(true)
    await ctx.fiber.dispose()
  })

  it('clamps selection when reload shrinks the row list', async () => {
    const { ctx, controller, stored } = await bench()
    const settings = ctx.get('settings') as { get: (ns: unknown) => unknown }
    settings.get = () => ({ ...stored, models: [] })
    controller.dispatch({ kind: 'command', query: 'settings' })
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
})
