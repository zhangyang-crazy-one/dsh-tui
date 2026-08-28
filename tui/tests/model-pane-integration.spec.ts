/**
 * Model-panel integration: `/model` opens the selection panel, the llm
 * provider catalog loads concurrently (per-provider, seq-guarded), the filter
 * narrows rows, Enter persists through agentDefaultModel.saveSelection and
 * applies the pair live to the agent's mutable selection ref, the top-bar
 * badge updates, and the panel closes with `✓ 已切换模型`. Providers without
 * a catalog degrade to a `provider 当前默认` row; a failed load renders the
 * error state. K2 mutual exclusion closes the other overlay panels.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
  ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

/** One advertised model entry for the scripted adapters. */
function model(provider: string, id: string): LlmModelInfo {
  return { provider, id, name: id }
}

/**
 * Scripted adapter with a queue of per-call `listModels` behaviors; an empty
 * queue mimics a provider without `listModels` (the base class resolves []).
 */
class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly behaviors: Array<() => readonly LlmModelInfo[] | Promise<readonly LlmModelInfo[]>> = [],
  ) {
    super()
  }

  override listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const next = this.behaviors.shift()
    return next === undefined ? Promise.resolve([]) : Promise.resolve(next())
  }

  // The model panel only exercises the catalog surface; the stream contract
  // is stubbed the same way the llm package's own adapter tests do.
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('not exercised')
  }
}

/** Scripted agent whose followup resolves immediately and appends nothing. */
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
  saveSelection: ReturnType<typeof vi.fn>
}

/** Mount the services and a scripted agent factory over optional adapters. */
async function bench(
  adapters: Array<[provider: string, adapter: LlmAdapter]> = [],
  options: { mountLlm?: boolean } = {},
): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  if (options.mountLlm !== false) {
    await ctx.plugin(LlmRuntime)
    for (const [provider, adapter] of adapters) {
      ctx.llm.registerAdapter([provider], adapter)
    }
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
    { task: '' },
    () => {},
  )
  const defaultModel = ctx.get('agentDefaultModel')
  if (defaultModel === undefined) {
    throw new Error('agentDefaultModel service is unavailable')
  }
  const saveSelection = vi.spyOn(defaultModel, 'saveSelection')
  return { ctx, controller, saveSelection }
}

/** The controller's live mutable selection ref installed at agent creation. */
function liveRef(controller: RuntimeController): ModelSelectionRef | undefined {
  return (
    controller as unknown as { modelSelectionRef: ModelSelectionRef | undefined }
  ).modelSelectionRef
}

describe('model panel', () => {
  it('opens from /model, loads the catalog, and marks the current row', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter([
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
      ])],
    ])
    await controller.start()
    expect(controller.getBadge()).toBe('test-provider · test-model')

    controller.dispatch({ kind: 'command', query: 'model' })
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getModelPane().status).toBe('loading')
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })
    const pane = controller.getModelPane()
    expect(pane.rows).toHaveLength(2)
    expect(pane.rows[0]).toMatchObject({
      id: 'test-provider:test-model',
      provider: 'test-provider',
      model: 'test-model',
      current: true,
      fallback: false,
    })
    expect(pane.rows[1]).toMatchObject({ model: 'model-b', current: false })
    expect(pane.selectedIndex).toBe(0)
    await ctx.fiber.dispose()
  })

  it('filters the catalog by provider/model/name and moves the highlight', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter([
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })

    controller.dispatch({ kind: 'model-filter', query: 'model-b' })
    expect(controller.getModelPane().rows.map(row => row.model)).toEqual(['model-b'])
    expect(controller.getModelPane().selectedIndex).toBe(0)

    controller.dispatch({ kind: 'model-filter', query: 'zzz' })
    expect(controller.getModelPane().rows).toEqual([])

    controller.dispatch({ kind: 'model-filter', query: '' })
    controller.dispatch({ kind: 'model-move', delta: 1 })
    expect(controller.getModelPane().selectedIndex).toBe(1)
    controller.dispatch({ kind: 'model-move', delta: -2 })
    expect(controller.getModelPane().selectedIndex).toBe(0)
    controller.dispatch({ kind: 'model-move', delta: 99 })
    expect(controller.getModelPane().selectedIndex).toBe(1)
    await ctx.fiber.dispose()
  })

  it('selects the model: saveSelection, live ref, badge, feedback, pane closed', async () => {
    const { ctx, controller, saveSelection } = await bench([
      ['test-provider', new CatalogAdapter([
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })

    controller.dispatch({ kind: 'select-model', id: 'test-provider:model-b' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().open).toBe(false)
    })
    expect(saveSelection).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'model-b',
    })
    // The ref the agent's installModelSelection listens on now carries the
    // new pair, so the next step's prompt assembly routes through it.
    expect(liveRef(controller)?.current).toEqual({
      provider: 'test-provider',
      model: 'model-b',
    })
    expect(controller.getBadge()).toBe('test-provider · model-b')
    expect(controller.getFeedback()).toBe('✓ 已切换模型')
    await ctx.fiber.dispose()
  })

  it('keeps the current selection when the persist fails (K8)', async () => {
    const { ctx, controller, saveSelection } = await bench([
      ['test-provider', new CatalogAdapter([
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })
    saveSelection.mockRejectedValueOnce(new Error('settings down'))

    controller.dispatch({ kind: 'select-model', id: 'test-provider:model-b' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('✗ 切换失败：settings down')
    })
    expect(controller.getFeedback()).toContain('（当前保持）')
    // The pane stays open, the badge and the live ref stay untouched.
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getBadge()).toBe('test-provider · test-model')
    expect(liveRef(controller)?.current).toEqual({
      provider: 'test-provider',
      model: 'test-model',
    })
    await ctx.fiber.dispose()
  })

  it('closes the other overlay panels when it opens (K2 mutual exclusion)', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter()],
    ])
    await controller.start()
    controller.dispatch({ kind: 'session-pane' })
    expect(controller.getSessionPane().open).toBe(true)
    controller.dispatch({ kind: 'command', query: 'model' })
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getSessionPane().open).toBe(false)

    controller.dispatch({ kind: 'search-pane' })
    expect(controller.getSearchPane().open).toBe(true)
    expect(controller.getModelPane().open).toBe(false)
    expect(controller.getSearchPane().query).toBe('')

    controller.dispatch({ kind: 'toggle-timeline' })
    expect(controller.getTimelineOpen()).toBe(true)
    expect(controller.getSearchPane().open).toBe(false)

    controller.dispatch({ kind: 'command', query: 'model' })
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getTimelineOpen()).toBe(false)
    expect(controller.getHelpPane().open).toBe(false)
    await ctx.fiber.dispose()
  })

  it('degrades an empty or throwing catalog to the provider default row', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter()],
      ['alpha', new CatalogAdapter([
        () => [model('alpha', 'alpha-1')],
      ])],
      ['beta', new CatalogAdapter([
        () => {
          throw new Error('catalog down')
        },
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })
    const rows = controller.getModelPane().rows
    expect(rows).toHaveLength(3)
    // The current provider without a catalog carries its live default.
    expect(rows[0]).toMatchObject({
      id: 'default:test-provider',
      provider: 'test-provider',
      model: 'test-model',
      name: 'test-model',
      fallback: true,
      current: true,
    })
    // A provider with a catalog lists its models.
    expect(rows[1]).toMatchObject({
      provider: 'alpha',
      model: 'alpha-1',
      fallback: false,
      current: false,
    })
    // A throwing catalog degrades to the provider's default row, never error.
    expect(rows[2]).toMatchObject({
      id: 'default:beta',
      provider: 'beta',
      fallback: true,
    })
    expect(controller.getModelPane().status).toBe('idle')
    await ctx.fiber.dispose()
  })

  it('renders the error state when the llm service is unavailable', async () => {
    const { ctx, controller } = await bench([], { mountLlm: false })
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getModelPane().status).toBe('error')
    expect(controller.getModelPane().error).toBe('模型服务不可用')
    await ctx.fiber.dispose()
  })

  it('lands only the newest catalog when loads overlap (K7/S1)', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter([
        // Open #1 resolves slowly with a stale catalog…
        () => new Promise<readonly LlmModelInfo[]>((resolve) => {
          setTimeout(() => {
            resolve([model('test-provider', 'stale')])
          }, 50)
        }),
        // …open #2 resolves fast; the stale response must not clobber it.
        () => [model('test-provider', 'fresh')],
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'model-pane' })
    controller.dispatch({ kind: 'model-pane' })
    controller.dispatch({ kind: 'model-pane' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().rows.map(row => row.model)).toEqual(['fresh'])
    })
    await new Promise<void>(resolve => setTimeout(resolve, 80))
    expect(controller.getModelPane().rows.map(row => row.model)).toEqual(['fresh'])
    await ctx.fiber.dispose()
  })

  it('reopens with the panel transients reset', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter([
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
        () => [model('test-provider', 'test-model'), model('test-provider', 'model-b')],
      ])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'model' })
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })
    controller.dispatch({ kind: 'model-filter', query: 'model-b' })
    controller.dispatch({ kind: 'model-move', delta: 1 })
    controller.dispatch({ kind: 'model-pane' })
    expect(controller.getModelPane().open).toBe(false)
    expect(controller.getModelPane().filter).toBe('')
    controller.dispatch({ kind: 'model-pane' })
    expect(controller.getModelPane().open).toBe(true)
    await vi.waitFor(() => {
      expect(controller.getModelPane().status).toBe('idle')
    })
    expect(controller.getModelPane().filter).toBe('')
    expect(controller.getModelPane().selectedIndex).toBe(0)
    await ctx.fiber.dispose()
  })

  it('clamps a stale selected index when a shorter catalog lands', async () => {
    const catalog = Promise.withResolvers<readonly LlmModelInfo[]>()
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter([() => catalog.promise])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'model-pane' })
    ;(controller as unknown as { modelSelectedIndex: number }).modelSelectedIndex = 99
    catalog.resolve([model('test-provider', 'only')])
    await vi.waitFor(() => { expect(controller.getModelPane().status).toBe('idle') })
    expect(controller.getModelPane().selectedIndex).toBe(0)
    await ctx.fiber.dispose()
  })

  it('renders a non-Error top-level catalog failure', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter()],
    ])
    await controller.start()
    const llm = ctx.get('llm') as { listProviders: () => unknown }
    llm.listProviders = () => { throw 'catalog-string-failure' }
    controller.dispatch({ kind: 'model-pane' })
    await vi.waitFor(() => {
      expect(controller.getModelPane()).toMatchObject({
        status: 'error', error: 'catalog-string-failure', rows: [],
      })
    })
    await ctx.fiber.dispose()
  })

  it('drops a stale top-level catalog error and renders a current Error', async () => {
    const { ctx, controller } = await bench([
      ['test-provider', new CatalogAdapter()],
    ])
    await controller.start()
    const llm = ctx.get('llm') as { listProviders: () => unknown }
    let reads = 0
    llm.listProviders = () => [{
      get id() {
        reads += 1
        if (reads % 2 === 0) throw new Error('catalog-error')
        return 'missing-provider'
      },
      name: 'Missing provider',
    }]
    const state = controller as unknown as {
      modelSeq: number
      loadModelCatalog(): Promise<void>
    }
    const stale = state.loadModelCatalog()
    state.modelSeq += 1
    await stale
    expect(controller.getModelPane().error).toBeUndefined()
    reads = 0
    await state.loadModelCatalog()
    expect(controller.getModelPane()).toMatchObject({
      status: 'error', error: 'catalog-error', rows: [],
    })
    await ctx.fiber.dispose()
  })

  it('keeps invalid selection requests inert and formats non-Error save failures', async () => {
    const { ctx, controller, saveSelection } = await bench([
      ['test-provider', new CatalogAdapter([() => [model('test-provider', 'model-b')]])],
    ])
    await controller.start()
    controller.dispatch({ kind: 'model-pane' })
    await vi.waitFor(() => { expect(controller.getModelPane().status).toBe('idle') })
    controller.dispatch({ kind: 'select-model', id: 'missing:model' })
    expect(saveSelection).not.toHaveBeenCalled()
    saveSelection.mockRejectedValueOnce('save-string-failure')
    controller.dispatch({ kind: 'select-model', id: 'test-provider:model-b' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('save-string-failure')
    })
    await ctx.fiber.dispose()
  })
})
