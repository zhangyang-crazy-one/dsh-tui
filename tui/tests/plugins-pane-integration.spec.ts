/** Plugins controller inventory, permissions and asynchronous install lifecycle. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import type PluginManager from '@deepseek-ai/dsh-plugin-manager'
import type { BundleInfo, ChangeResult, PluginEntryId, PluginInfo, PluginInstallRequestId, PluginSpecInspection, ManagementError, PluginInstallFailureKind } from '@deepseek-ai/dsh-plugin-manager/types'
import type { PluginsPaneInput } from '@deepseek-ai/dsh-tui-render'
import { RuntimeController } from '../src/index.ts'

const bundle = (patch: Partial<BundleInfo> = {}): BundleInfo => ({ name: 'sample', enabled: true,
  installed: true, optional: false, removable: true, rows: [], overrides: [], ...patch })
const result = (patch: Partial<ChangeResult> = {}): ChangeResult => ({ changed: true,
  application: 'restart-required', stage: 'enable', target: 'sample', ...patch })
const accepted: PluginSpecInspection = { status: 'accepted', kind: 'registry', name: 'sample', version: '1.0.0', description: 'a bundle', bundle: true }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
function service() {
  return {
    listBundles: vi.fn(async (): Promise<BundleInfo[]> => [bundle()]),
    listPlugins: vi.fn(async (): Promise<PluginInfo[]> => []),
    inspect: vi.fn(async (): Promise<PluginSpecInspection> => accepted),
    installBundle: vi.fn<PluginManager['installBundle']>(async () => result({ stage: 'install' })),
    cancelInstall: vi.fn<PluginManager['cancelInstall']>(async () => ({ status: 'not-running' })),
    setBundleEnabled: vi.fn<PluginManager['setBundleEnabled']>(async () => result()),
    setPluginEnabled: vi.fn<PluginManager['setPluginEnabled']>(async () => result()),
    removeBundle: vi.fn<PluginManager['removeBundle']>(async () => result({ stage: 'remove' })),
  }
}
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function bench(manager = service(), present = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test', model: 'test' })
  ctx.agents.setFactory({
    async createAgent(owner, options) {
      const session = ctx.sessions.create(options.sessionId)
      const agent = {} as Agent
      Object.assign(agent, { id: session.id, options: {}, session, inbox: createInboxStub(), status: 'idle',
        ctx: owner.extend({ agent }), cancel: () => {}, send: () => {}, followup: () => {}, steer: () => {}, inject: () => {},
        runMaintenance: () => Promise.reject(new Error('unused')), whenIdle: () => Promise.resolve() } satisfies Partial<Agent>)
      await options.setup?.(agent.ctx, agent)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('unused')),
  })
  // Fake only the external management service; controller subscriptions/dispatch are real.
  if (present) ctx.provide('pluginManager', manager as unknown as PluginManager)
  const reload = vi.fn()
  const controller = new RuntimeController(ctx, { stdout: { write: () => true }, stderr: { write: () => true }, exit: vi.fn() }, { task: '' }, vi.fn(), reload)
  await controller.start()
  cleanups.push(async () => { await controller.dispose(); await ctx.fiber.dispose() })
  const input = (input: PluginsPaneInput) => controller.dispatch({ kind: 'plugins-input', input })
  const open = async () => { controller.dispatch({ kind: 'plugins-pane' }); await vi.waitFor(() => expect(controller.getPluginsPane().loading).toBe(false)) }
  const preview = async (spec = 'sample@latest') => {
    input({ kind: 'edit' }); input({ kind: 'text', value: spec }); input({ kind: 'inspect' })
    await vi.waitFor(() => expect(controller.getPluginsPane().inspecting).toBe(false))
  }
  return { ctx, controller, manager, reload, input, open, preview }
}

describe('Plugins inventory and controls', () => {
  it('opens an unavailable page through the command and keeps close usable', async () => {
    const b = await bench(undefined, false)
    b.controller.dispatch({ kind: 'command', query: 'plugins' })
    expect(b.controller.getPluginsPane()).toMatchObject({ open: true, available: false, rows: [] })
    b.input({ kind: 'edit' }); b.input({ kind: 'toggle' }); b.input({ kind: 'close' })
    expect(b.controller.getPluginsPane().open).toBe(false)
    await b.open()
    expect(b.controller.getPluginsPane().available).toBe(false)
  })

  it('groups inventory, distinguishes declaration-only rows, and blocks read-only row mutations', async () => {
    const b = await bench()
    const id = 'entry' as PluginEntryId
    b.manager.listBundles.mockResolvedValue([bundle({ name: 'own', overrides: ['base'], rows: [
      { rowId: 'declared', moduleName: 'declared-module' }, { rowId: 'live', moduleName: 'live-module', entryId: id },
    ] }), bundle({ name: 'supplied', installed: false, optional: true, removable: false, description: 'provided' })])
    b.manager.listPlugins.mockResolvedValue([{ entryId: id, moduleName: 'live-module', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' }])
    await b.open()
    const rows = b.controller.getPluginsPane().rows
    expect(rows.map(row => row.id)).toEqual(['bundle:supplied', 'bundle:own', 'row:own:declared', 'row:own:live'])
    expect(rows[0]).toMatchObject({ toggle: true, removable: false, group: 'supplied' })
    expect(rows[1]?.details.join(' ')).toContain('base')
    expect(rows[2]).toMatchObject({ toggle: false })
    expect(rows[2]?.label).toContain('仅声明')
    expect(rows[3]?.details.join(' ')).toContain('需要独立管理进程')
    b.input({ kind: 'move', delta: 2 }); b.input({ kind: 'toggle' })
    b.input({ kind: 'move', delta: 1 }); b.input({ kind: 'toggle' })
    expect(b.manager.setPluginEnabled).not.toHaveBeenCalled()
  })

  it('toggles optional non-removable bundles and live rows with addressable controls', async () => {
    const b = await bench()
    const id = 'row' as PluginEntryId
    b.manager.listBundles.mockResolvedValue([bundle({ optional: true, removable: false, rows: [{ rowId: 'r', moduleName: 'm', entryId: id }] })])
    b.manager.listPlugins.mockResolvedValue([{ entryId: id, moduleName: 'm', enabled: false, fiberPhase: null, patchId: 'r' }])
    await b.open()
    b.input({ kind: 'remove' }); b.input({ kind: 'confirm' })
    expect(b.manager.removeBundle).not.toHaveBeenCalled()
    b.input({ kind: 'toggle' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().busy).toBe(false))
    expect(b.manager.setBundleEnabled).toHaveBeenCalledWith('sample', false)
    b.input({ kind: 'move', delta: 1 }); b.input({ kind: 'toggle' })
    await vi.waitFor(() => expect(b.manager.setPluginEnabled).toHaveBeenCalledWith(id, true))
  })

  it.each(['applied', 'restart-required', 'overridden', 'failed', 'cancelled'] as const)('preserves %s outcomes and gates reload', async (application) => {
    const b = await bench()
    b.manager.setBundleEnabled.mockResolvedValue(result({ application }))
    await b.open(); b.input({ kind: 'toggle' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().busy).toBe(false))
    expect(b.controller.getPluginsPane().restartRequired).toBe(application === 'restart-required')
    expect(b.controller.getPluginsPane().result.length).toBeGreaterThan(0)
    b.input({ kind: 'reload' })
    expect(b.reload).toHaveBeenCalledTimes(application === 'restart-required' ? 1 : 0)
  })

  it.each(['stop-profile', 'bundle-in-use', 'not-removable', 'stale-approval', 'invalid-spec', 'ambiguous-install'] satisfies ManagementError['code'][])('keeps named removal refusal %s visible', async (code) => {
    const b = await bench()
    b.manager.removeBundle.mockResolvedValue(result({ changed: false, application: 'failed', error: { code } }))
    await b.open(); b.input({ kind: 'remove' })
    expect(b.controller.getPluginsPane().confirmNames).toEqual(['sample'])
    expect(b.manager.removeBundle).not.toHaveBeenCalled()
    b.input({ kind: 'confirm' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().busy).toBe(false))
    expect(b.controller.getPluginsPane().result).toHaveLength(2)
    expect(b.controller.getPluginsPane().rows[0]?.id).toBe('bundle:sample')
    expect(b.reload).not.toHaveBeenCalled()
  })

  it('cancels a named removal via n or Esc and rereads inventory after success', async () => {
    const b = await bench(); await b.open()
    b.input({ kind: 'remove' }); b.input({ kind: 'dismiss' }); b.input({ kind: 'confirm' })
    b.input({ kind: 'remove' }); b.input({ kind: 'close' }); await b.open(); b.input({ kind: 'confirm' })
    expect(b.manager.removeBundle).not.toHaveBeenCalled()
    b.input({ kind: 'remove' })
    b.manager.removeBundle.mockImplementation(async () => { b.manager.listBundles.mockResolvedValue([]); return result({ stage: 'remove' }) })
    b.input({ kind: 'confirm' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().rows).toEqual([]))
    expect(b.manager.removeBundle).toHaveBeenCalledWith('sample')
  })

  it('refreshes on manager changes and reopen after external edits without events', async () => {
    const b = await bench(); await b.open()
    b.manager.listBundles.mockResolvedValue([bundle({ name: 'changed' })])
    b.ctx.emit('plugin-manager/changed', { reason: 'bundle' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().rows[0]?.id).toBe('bundle:changed'))
    b.input({ kind: 'close' }); b.manager.listBundles.mockResolvedValue([bundle({ name: 'external' })]); await b.open()
    expect(b.controller.getPluginsPane().rows[0]?.id).toBe('bundle:external')
  })
})

describe('Plugins installation', () => {
  it.each(['not-a-bundle', 'not-found'] as const)('retains spec on inspect %s and refuses installation', async (problem) => {
    const b = await bench(); b.manager.inspect.mockResolvedValue({ status: 'refused', problem, reason: 'fixture refusal' })
    await b.open(); await b.preview('file:/tmp/example'); b.input({ kind: 'install' }); b.input({ kind: 'retry' })
    expect(b.controller.getPluginsPane()).toMatchObject({ mode: 'input', spec: 'file:/tmp/example' })
    expect(b.controller.getPluginsPane().inspection.join(' ')).toContain('fixture refusal')
    expect(b.manager.installBundle).not.toHaveBeenCalled()
  })

  it('keeps a single request alive through close/reopen and admits only correlated events', async () => {
    const b = await bench(); const pending = deferred<ChangeResult>(); b.manager.installBundle.mockReturnValue(pending.promise)
    await b.open(); await b.preview(); b.input({ kind: 'install' })
    await vi.waitFor(() => expect(b.manager.installBundle).toHaveBeenCalledTimes(1))
    const requestId = b.manager.installBundle.mock.calls[0]![1]!.requestId!
    const chunk = { jobId: 'pnpm-1', argv: ['install'], cwd: '/profile', stream: 'stdout' as const, text: 'current output' }
    b.ctx.emit('plugin-manager/install-log', chunk)
    b.ctx.emit('plugin-manager/install-log', { ...chunk, requestId: 'other' as PluginInstallRequestId })
    expect(b.controller.getPluginsPane().output).toBe('')
    b.input({ kind: 'close' })
    b.ctx.emit('plugin-manager/install-log', { ...chunk, requestId })
    b.ctx.emit('plugin-manager/install-state', { requestId, phase: 'applying' })
    await b.open(); b.input({ kind: 'install' }); b.input({ kind: 'edit' })
    expect(b.controller.getPluginsPane()).toMatchObject({ busy: true, output: 'current output', progress: '正在应用…' })
    expect(b.manager.installBundle).toHaveBeenCalledTimes(1)
    expect(b.manager.cancelInstall).not.toHaveBeenCalled()
    pending.resolve(result({ stage: 'install' }))
    await vi.waitFor(() => expect(b.controller.getPluginsPane().busy).toBe(false))
    expect(b.controller.getPluginsPane().restartRequired).toBe(true)
  })

  it.each(['cancelled', 'too-late', 'not-running'] as const)('reports cancellation %s only after service confirmation', async (status) => {
    const b = await bench(); const installation = deferred<ChangeResult>(); const cancellation = deferred<{ status: typeof status }>()
    b.manager.installBundle.mockReturnValue(installation.promise); b.manager.cancelInstall.mockReturnValue(cancellation.promise)
    await b.open(); await b.preview(); b.input({ kind: 'install' })
    await vi.waitFor(() => expect(b.manager.installBundle).toHaveBeenCalledTimes(1))
    b.input({ kind: 'cancel' }); expect(b.controller.getPluginsPane().cancellation).toBeUndefined()
    cancellation.resolve({ status })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().cancellation).toBeDefined())
    expect(b.controller.getPluginsPane().cancellation?.includes('已确认取消')).toBe(status === 'cancelled')
    installation.resolve(result({ stage: 'install', application: status === 'cancelled' ? 'cancelled' : 'restart-required' }))
    await vi.waitFor(() => expect(b.controller.getPluginsPane().busy).toBe(false))
  })

  it.each(['network', 'build-blocked'] satisfies PluginInstallFailureKind[])('classifies %s failure and requires exact named script approval', async (kind) => {
    const b = await bench()
    b.manager.installBundle.mockResolvedValueOnce(result({ changed: false, application: 'failed', stage: 'install',
      packageResult: { exitCode: 1, output: 'diagnostic', truncated: false, logPath: '/log', kind }, pendingBuilds: ['native-a', '@scope/native-b'] }))
    await b.open(); await b.preview(); b.input({ kind: 'install' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().pendingBuilds).toHaveLength(2))
    b.input({ kind: 'retry' }); b.input({ kind: 'confirm' })
    expect(b.manager.installBundle).toHaveBeenCalledTimes(1)
    b.input({ kind: 'approve' }); expect(b.controller.getPluginsPane().confirmNames).toEqual(['native-a', '@scope/native-b'])
    b.input({ kind: 'dismiss' }); b.input({ kind: 'confirm' })
    expect(b.manager.installBundle).toHaveBeenCalledTimes(1)
    b.input({ kind: 'approve' }); b.input({ kind: 'confirm' })
    await vi.waitFor(() => expect(b.manager.installBundle).toHaveBeenCalledTimes(2))
    expect(b.manager.installBundle.mock.calls[1]![1]?.approvedBuilds).toEqual(['native-a', '@scope/native-b'])
    expect(b.manager.installBundle.mock.calls[0]![1]?.approvedBuilds).toBeUndefined()
  })

  it('reinspects retry and rejects late events from the previous attempt', async () => {
    const b = await bench(); b.manager.installBundle.mockResolvedValueOnce(result({ application: 'failed', changed: false, stage: 'install' }))
    await b.open(); await b.preview(); b.input({ kind: 'install' })
    await vi.waitFor(() => expect(b.controller.getPluginsPane().retry).toBe(true))
    const firstId = b.manager.installBundle.mock.calls[0]![1]!.requestId!
    const next = deferred<ChangeResult>(); b.manager.installBundle.mockReturnValueOnce(next.promise)
    b.input({ kind: 'retry' })
    await vi.waitFor(() => expect(b.manager.installBundle).toHaveBeenCalledTimes(2))
    const nextId = b.manager.installBundle.mock.calls[1]![1]!.requestId!
    expect(nextId).not.toBe(firstId)
    b.ctx.emit('plugin-manager/install-state', { requestId: firstId, phase: 'cancelling' })
    expect(b.controller.getPluginsPane().progress).toBe('正在安装…')
    expect(b.manager.inspect).toHaveBeenCalledTimes(3)
    next.resolve(result())
  })
})
