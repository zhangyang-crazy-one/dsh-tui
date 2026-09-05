import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, internals, RuntimeController } from '../src/index.ts'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { FsTargetKey } from '@deepseek-ai/dsh-fs'
import { createFrameProbe } from '@deepseek-ai/dsh-tui-render'

type ControllerInternals = {
  ownWork(work: Promise<unknown>, label: string): void
  flushOnTurnEnd(): void
  exportLive(): Promise<void>
  allocateCandidate(request: { intent: 'create' }): Promise<unknown>
  flushSession(session: Session | undefined): Promise<void>
  requestReload(): void
  readPlanStatus(): { active: boolean } | { error: string }
  openPermissionPane(): void
  applySettingsValue(value: string): void
  applyOnboardingKey(field: string, value: string): void
  exportSettingsDocument(): void
  installTuiSettings(): void
  maybeOpenOnboarding(): Promise<void>
  rowFor(id: SessionId): Promise<{ id: SessionId; title: string; updatedAt: number }>
  rowForLiveSession(session: Session): { id: SessionId; title: string; updatedAt: number }
  runSearch(query: string, seq: number): Promise<void>
  candidateFor(hit: unknown): Promise<{ id: SessionId; title: string; snippet: string }>
  blockingHead(): { kind: 'approval' | 'ask-user'; entry: unknown } | undefined
  submitPlanReview(label: 'Approve' | 'Keep planning'): void
  answerAskUserHead(head: unknown, label: string): void
  finishAskUser(entry: unknown, settlement: { answer: unknown } | { error: Error }): void
  cancelQueuedAskUsers(): void
  emit(): void
  commandAbort?: { abort(): void }
  agentHandle?: { cancel(): void }
  transitionInFlight?: Promise<void>
  liveHandle?: { agent: never; dispose(): Promise<void> }
  session: Session | undefined
  config: { task: string; cwd?: string }
  machine: 'idle' | 'generating' | 'stopped' | 'exit-armed'
  closed: boolean
  settingsOpen: boolean
  settingsEditing: boolean
  settingsOnboarding: boolean
  settingsRows: Array<{ namespace: string; field: string; value: string }>
  settingsSelectedIndex: number
  searchOpen: boolean
  searchQuery: string
  searchSeq: number
  searchResults: unknown[]
  searchSelectedIndex: number
  approvalQueue: unknown[]
  askUserQueue: unknown[]
  emitLastRun: number
  emitPending: boolean
}

async function bareController(): Promise<{ ctx: Context; controller: RuntimeController }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
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
  return { ctx, controller }
}

describe('RuntimeController defensive lifecycle paths', () => {
  it('uses the default spawn adapter for a child process', async () => {
    const child = internals.spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'inherit',
      env: process.env,
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('close', (exitCode) => { resolve(exitCode) })
      child.on('error', reject)
    })
    expect(code).toBe(0)
  })
  it('contains an owned-work rejection and executes default no-op owners', async () => {
    const { ctx, controller } = await bareController()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const internals = controller as unknown as ControllerInternals
    internals.requestReload()
    internals.flushOnTurnEnd()
    await internals.exportLive()
    internals.ownWork(Promise.reject(new Error('owned failed')), 'coverage work')
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('coverage work failed: owned failed')
    })
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('contains subscriber failure and coalesces repeated emissions', async () => {
    const { ctx, controller } = await bareController()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const internals = controller as unknown as ControllerInternals
    internals.agentHandle = { cancel: () => {} }
    controller.subscribe(() => { throw new Error('subscriber failed') })
    let notifications = 0
    controller.subscribe(() => { notifications += 1 })
    controller.dispatch({ kind: 'toggle-reasoning' })
    controller.dispatch({ kind: 'toggle-tool-cards' })
    expect(notifications).toBe(0)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith('TUI subscriber failed: subscriber failed')
      expect(notifications).toBe(1)
    })
    internals.machine = 'stopped'
    expect(controller.getModel().status).toBe('stopped')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('warns yet reaches quiescence when every teardown owner fails', async () => {
    const { ctx, controller } = await bareController()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const disposeHandle = vi.fn(async () => {})
    const transition = Promise.reject(new Error('transition failed'))
    void transition.catch(() => {})
    const internals = controller as unknown as ControllerInternals
    internals.commandAbort = { abort: () => { throw new Error('command abort failed') } }
    internals.agentHandle = { cancel: () => { throw new Error('agent cancel failed') } }
    internals.transitionInFlight = transition
    internals.liveHandle = { agent: undefined as never, dispose: disposeHandle }

    await controller.dispose()
    expect(disposeHandle).toHaveBeenCalledOnce()
    expect(warn.mock.calls.flat().join('\n')).toContain('command cancellation during TUI unload failed')
    expect(warn.mock.calls.flat().join('\n')).toContain('agent cancellation during TUI unload failed')
    expect(warn.mock.calls.flat().join('\n')).toContain('session transition during TUI unload failed')
    await ctx.fiber.dispose()
  })

  it('ignores exit and actions after close', async () => {
    const { ctx, controller } = await bareController()
    await controller.dispose()
    controller.dispatchExit()
    controller.dispatch({ kind: 'toggle-reasoning' })
    expect(controller.getModel().reasoningExpanded).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails start without core services and skips a flush without SessionStore', async () => {
    const withSessions = await bareController()
    await expect(withSessions.controller.start()).rejects.toThrow('core services are unavailable')
    await withSessions.controller.dispose()
    await withSessions.ctx.fiber.dispose()

    const ctx = new Context()
    const controller = new RuntimeController(
      ctx,
      { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
      { task: '' },
      () => {},
    )
    const internals = controller as unknown as ControllerInternals
    internals.flushOnTurnEnd()
    await internals.flushSession(Session.create(SessionId('unowned-flush')))
    await expect(internals.allocateCandidate({ intent: 'create' })).rejects.toThrow(
      'core services are unavailable',
    )
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('exports through process cwd fallback and contains export write failure', async () => {
    const { ctx, controller } = await bareController()
    const internals = controller as unknown as ControllerInternals
    const originalCwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), 'dsh-controller-export-'))
    try {
      process.chdir(directory)
      internals.session = ctx.sessions.create(SessionId('export-fallback'))
      await internals.exportLive()
      internals.config.cwd = join(directory, 'blocked')
      await writeFile(internals.config.cwd, 'file')
      await internals.exportLive()
    } finally {
      process.chdir(originalCwd)
      await controller.dispose()
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('folds plan and permission state without a bound agent', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    expect(state.readPlanStatus()).toEqual({ error: '计划服务未组合' })
    const removePlan = ctx.provide('planMode', { get: () => ({ active: true }) } as never)
    expect(state.readPlanStatus()).toEqual({ error: '会话未绑定' })
    const removeProjections = ctx.provide('sessionProjections', {
      stateOf: () => ({ active: false }),
    } as never)
    state.session = ctx.sessions.create(SessionId('plan-fallback'))
    expect(state.readPlanStatus()).toEqual({ active: false })
    removeProjections()
    removePlan()

    const current = vi.fn(() => 'missing')
    const removePresets = ctx.provide('permissionPresets', {
      names: ['safe'],
      current,
      optionOf: () => ({ description: 'Safe preset' }),
    } as never)
    state.session = undefined
    state.openPermissionPane()
    expect(current).not.toHaveBeenCalled()
    expect(controller.getPermissionPane()).toMatchObject({
      open: true,
      selectedIndex: 0,
      currentName: '',
      descriptions: ['Safe preset'],
    })
    removePresets()
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('reports settings and credential providers that detach before apply', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    state.settingsOpen = true
    state.settingsEditing = true
    state.settingsRows = [{ namespace: 'detached', field: 'value', value: '' }]
    state.settingsSelectedIndex = 0
    state.applySettingsValue('next')
    expect(controller.getSettingsPane().updateError).toBe('无可用设置')

    state.settingsOpen = true
    state.settingsEditing = true
    state.settingsRows = [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }]
    state.applySettingsValue('sk-detached')
    expect(controller.getSettingsPane().updateError).toBe('无可用设置')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('accepts a registered TUI settings section without a color override', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    ctx.provide('settings', {
      register: () => ({
        get: () => ({}),
        watch: () => () => {},
        update: async () => {},
        replace: async () => {},
      }),
    } as never)
    state.installTuiSettings()
    await Promise.resolve()
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('drops settings, credential, and export settlements after close', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    const updates: Array<ReturnType<typeof Promise.withResolvers<undefined>>> = []
    const credentials: Array<ReturnType<typeof Promise.withResolvers<undefined>>> = []
    const exports: Array<ReturnType<typeof Promise.withResolvers<string | undefined>>> = []
    ctx.provide('settings', {
      describe: () => [],
      get: () => ({ value: '' }),
      update: () => {
        const gate = Promise.withResolvers<undefined>()
        updates.push(gate)
        return gate.promise
      },
      prepareDocument: () => {
        const gate = Promise.withResolvers<string | undefined>()
        exports.push(gate)
        return gate.promise
      },
    } as never)
    ctx.provide('credentials', {
      describe: async () => ({ configured: true, writable: true }),
      set: () => {
        const gate = Promise.withResolvers<undefined>()
        credentials.push(gate)
        return gate.promise
      },
    } as never)

    const primeSettings = (): void => {
      state.settingsOpen = true
      state.settingsEditing = true
      state.settingsOnboarding = false
      state.settingsRows = [{ namespace: 'detached', field: 'value', value: '' }]
      state.settingsSelectedIndex = 0
    }
    primeSettings()
    state.applySettingsValue('success')
    state.closed = true
    updates.shift()!.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    primeSettings()
    state.applySettingsValue('failure')
    state.closed = true
    updates.shift()!.reject(new Error('late settings failure'))
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    state.settingsOpen = true
    state.settingsEditing = true
    state.settingsOnboarding = true
    state.settingsRows = [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }]
    state.applySettingsValue('sk-success')
    state.closed = true
    credentials.shift()!.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    state.settingsOpen = true
    state.settingsEditing = true
    state.settingsOnboarding = true
    state.settingsRows = [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }]
    state.applySettingsValue('sk-failure')
    state.closed = true
    credentials.shift()!.reject(new Error('late credential failure'))
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    state.settingsOpen = true
    state.settingsEditing = false
    state.settingsOnboarding = false
    state.exportSettingsDocument()
    state.closed = true
    exports.shift()!.resolve('/tmp/late-settings.yaml')
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    state.exportSettingsDocument()
    state.closed = true
    exports.shift()!.reject(new Error('late export failure'))
    await Promise.resolve()
    await Promise.resolve()
    state.closed = false

    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('skips onboarding before and after the asynchronous credential probe', async () => {
    const first = await bareController()
    const firstState = first.controller as unknown as ControllerInternals
    firstState.closed = true
    await firstState.maybeOpenOnboarding()
    firstState.closed = false
    const originalApproval = first.controller.getApprovalPane.bind(first.controller)
    first.controller.getApprovalPane = () => ({ ...originalApproval(), open: true })
    await firstState.maybeOpenOnboarding()
    await first.controller.dispose()
    await first.ctx.fiber.dispose()

    for (const obstruction of ['closed', 'approval'] as const) {
      const { ctx, controller } = await bareController()
      const state = controller as unknown as ControllerInternals
      const gate = Promise.withResolvers<{ configured: boolean; writable: boolean }>()
      ctx.provide('credentials', {
        describe: () => gate.promise,
        set: async () => {},
      } as never)
      const opening = state.maybeOpenOnboarding()
      await Promise.resolve()
      let disposal: Promise<void> | undefined
      if (obstruction === 'closed') {
        disposal = controller.dispose()
      } else {
        const approval = controller.getApprovalPane.bind(controller)
        controller.getApprovalPane = () => ({ ...approval(), open: true })
      }
      gate.resolve({ configured: false, writable: true })
      await opening
      expect(controller.getSettingsPane().open).toBe(false)
      if (disposal === undefined) await controller.dispose()
      else await disposal
      await ctx.fiber.dispose()
    }
  })

  it('degrades corrupt and untitled session rows without inventing titles', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    const removePersistence = ctx.provide('sessionPersistence', {
      inspect: async () => { throw new Error('corrupt log') },
    } as never)
    await expect(state.rowFor(SessionId('corrupt-row'))).resolves.toMatchObject({
      id: 'corrupt-row', title: 'corrupt-row',
    })
    removePersistence()
    const untitled = ctx.sessions.create(SessionId('untitled-row'))
    untitled.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '   ' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(state.rowForLiveSession(untitled).title).toBe('未命名会话')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('joins multi-block user content with a single space when folding the fallback title', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    const session = ctx.sessions.create(SessionId('multi-block'))
    // Two text blocks plus an image-like block between them — the fallback
    // title must come from BOTH text blocks (proving the single-pass join
    // emits a ' ' separator and not an empty join that would lose the break).
    session.append('user/message', createUserMessage({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', data: 'ignored', mimeType: 'image/png' } as never,
        { type: 'text', text: 'world' },
      ],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(state.rowForLiveSession(session).title).toBe('hello world')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('contains mention backend failures and skips special filesystem entries', async () => {
    const { ctx, controller } = await bareController()
    const warn = vi.spyOn(ctx.logger, 'warn')
    const signal = new AbortController().signal
    let failFs = false
    let failSkills = false
    ctx.provide('fs', {
      resolve: async () => {
        if (failFs) throw new Error('fs failed')
        return { targetKey: FsTargetKey('/workspace'), displayPath: '/workspace' }
      },
      listDir: async () => [{
        name: 'socket',
        type: 'other',
        target: { targetKey: FsTargetKey('/workspace/socket'), displayPath: '/workspace/socket' },
      }],
    } as never)
    ctx.provide('skills', {
      list: async () => {
        if (failSkills) throw new Error('skills failed')
        return []
      },
    } as never)
    await expect(controller.listMentions('/workspace', '', signal)).resolves.toEqual([])
    failFs = true
    failSkills = true
    await expect(controller.listMentions('/workspace', '', signal)).resolves.toEqual([])
    const warnings = warn.mock.calls.flat().join('\n')
    expect(warnings).toContain('@ mention directory listing failed: Error: fs failed')
    expect(warnings).toContain('@ mention skill listing failed: Error: skills failed')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('drops stale search entry, page, candidate, and error settlements', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    state.searchOpen = false
    state.searchQuery = 'entry'
    state.searchSeq = 1
    await state.runSearch('entry', 1)

    const page = Promise.withResolvers<{ items: unknown[] }>()
    const removeQuery = ctx.provide('sessionQuery', {
      searchSessions: () => page.promise,
    } as never)
    state.searchOpen = true
    state.searchQuery = 'page'
    state.searchSeq = 2
    const stalePage = state.runSearch('page', 2)
    state.searchSeq = 3
    page.resolve({ items: [] })
    await stalePage

    const inspection = Promise.withResolvers<{ events: never[]; meta: { createdAt: number } }>()
    const removePersistence = ctx.provide('sessionPersistence', {
      inspect: () => inspection.promise,
    } as never)
    removeQuery()
    const removeCandidateQuery = ctx.provide('sessionQuery', {
      searchSessions: async () => ({
        items: [{
          header: { id: SessionId('candidate-stale') },
          bestMatch: { snippet: 'candidate' },
        }],
      }),
    } as never)
    state.searchQuery = 'candidate'
    state.searchSeq = 4
    const staleCandidate = state.runSearch('candidate', 4)
    await Promise.resolve()
    state.searchSeq = 5
    inspection.resolve({ events: [], meta: { createdAt: 0 } })
    await staleCandidate
    removePersistence()

    const rejection = Promise.withResolvers<{ items: unknown[] }>()
    removeCandidateQuery()
    ctx.provide('sessionQuery', { searchSessions: () => rejection.promise } as never)
    state.searchQuery = 'failure'
    state.searchSeq = 6
    const staleFailure = state.runSearch('failure', 6)
    state.searchSeq = 7
    rejection.reject(new Error('stale failure'))
    await staleFailure

    await expect(state.candidateFor({
      header: { id: SessionId('no-persistence') },
      bestMatch: { snippet: 'plain' },
    })).resolves.toEqual({ id: 'no-persistence', title: 'no-persistence', snippet: 'plain' })
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('orders mixed blocking queues and keeps one-shot settlement idempotent', async () => {
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    const resolve = vi.fn()
    const reject = vi.fn()
    const removeEventListener = vi.fn()
    const ask = {
      request: {
        questions: [{ id: 'ordinary', question: 'Choose', options: [{ label: 'yes' }] }],
        signal: { removeEventListener },
      },
      resolve,
      reject,
      seq: 2,
      settled: false,
      selectedIndex: 0,
      onAbort: () => {},
    }
    const approval = { seq: 1 }
    state.askUserQueue = [ask]
    state.approvalQueue = [approval]
    expect(state.blockingHead()?.kind).toBe('approval')
    approval.seq = 3
    expect(state.blockingHead()?.kind).toBe('ask-user')
    state.submitPlanReview('Approve')

    ask.settled = true
    state.answerAskUserHead(ask, 'yes')
    state.finishAskUser(ask, { error: new Error('already settled') })
    expect(resolve).not.toHaveBeenCalled()
    expect(reject).not.toHaveBeenCalled()

    const pending = { ...ask, settled: false, seq: 4, reject: vi.fn() }
    state.approvalQueue = []
    state.askUserQueue = [pending]
    state.cancelQueuedAskUsers()
    expect(pending.reject).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalled()
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('suppresses a delayed emit after close', async () => {
    vi.useFakeTimers()
    const { ctx, controller } = await bareController()
    const state = controller as unknown as ControllerInternals
    state.emitLastRun = Date.now()
    state.emit()
    state.closed = true
    await vi.advanceTimersByTimeAsync(20)
    expect(state.emitPending).toBe(true)
    state.closed = false
    await controller.dispose()
    await ctx.fiber.dispose()
    vi.useRealTimers()
  })

  it('validates an existing frame-stats file and reports a write failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-frame-coverage-'))
    const target = join(directory, 'frames.json')
    await writeFile(target, '{}\n')
    const stderr: string[] = []
    const exits: number[] = []
    const ctx = new Context()
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    const previous = {
      environment: internals.environment,
      stderr: internals.stderr,
      stdout: internals.stdout,
    }
    internals.environment = { isTTY: true, term: 'xterm' }
    internals.stderr = { write: (chunk) => { stderr.push(chunk); return true } }
    internals.stdout = { write: () => true }
    try {
      apply(ctx, { task: '', frameStats: target })
      await vi.waitFor(() => { expect(exits).toContain(1) })
      await internals.writeFrameStatsFile(directory, createFrameProbe(), {
        stdout: { write: () => true },
        stderr: { write: (chunk) => { stderr.push(chunk); return true } },
        exit: () => {},
      })
      expect(stderr.join('')).toContain('--frame-stats write failed')
    } finally {
      Object.assign(internals, previous)
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails apply without appExit and reports Error and non-Error startup failures', async () => {
    expect(() => { apply(new Context(), { task: '' }) }).toThrow('launcher must provide ctx.appExit')

    for (const failure of [new Error('loader error'), 'loader string'] as const) {
      const ctx = new Context()
      const stderr: string[] = []
      const exits: number[] = []
      ctx.provide('appExit', (code: number) => { exits.push(code) })
      ctx.provide('loader', {
        await: () => new Promise<never>((_resolve, reject) => {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercise the non-Error startup failure path.
          reject(failure)
        }),
      } as never)
      const previous = {
        environment: internals.environment,
        stderr: internals.stderr,
        stdout: internals.stdout,
      }
      internals.environment = { isTTY: true, term: 'xterm' }
      internals.stderr = { write: (chunk) => { stderr.push(chunk); return true } }
      internals.stdout = { write: () => true }
      try {
        apply(ctx, { task: '' })
        await vi.waitFor(() => { expect(exits).toContain(1) })
        expect(stderr.join('')).toContain(failure instanceof Error ? failure.message : failure)
      } finally {
        Object.assign(internals, previous)
        await ctx.fiber.dispose()
      }
    }
  })

  it('waits for launcher readiness before joining Loader settlement', async () => {
    const ctx = new Context()
    const stderr: string[] = []
    const exits: number[] = []
    const cancelReady = vi.fn()
    const awaitLoader = vi.fn(() => Promise.reject(new Error('settled loader failure')))
    let announceReady: (() => void) | undefined
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    ctx.provide('appReady', {
      onReady(listener: () => void) {
        announceReady = listener
        return cancelReady
      },
    })
    ctx.provide('loader', { await: awaitLoader } as never)
    const previous = {
      environment: internals.environment,
      stderr: internals.stderr,
      stdout: internals.stdout,
    }
    internals.environment = { isTTY: true, term: 'xterm' }
    internals.stderr = { write: (chunk) => { stderr.push(chunk); return true } }
    internals.stdout = { write: () => true }
    try {
      apply(ctx, { task: '' })
      await Promise.resolve()
      expect(awaitLoader).not.toHaveBeenCalled()
      expect(exits).toEqual([])
      announceReady?.()
      await vi.waitFor(() => { expect(exits).toContain(1) })
      expect(awaitLoader).toHaveBeenCalledOnce()
      expect(stderr.join('')).toContain('settled loader failure')
    } finally {
      Object.assign(internals, previous)
      await ctx.fiber.dispose()
    }
    expect(cancelReady).toHaveBeenCalledOnce()
  })

  it('reports missing sessions after loader settlement and invokes terminal decline exit', async () => {
    const ctx = new Context()
    const exits: number[] = []
    const stderr: string[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    const previous = {
      environment: internals.environment,
      stderr: internals.stderr,
      stdout: internals.stdout,
    }
    internals.environment = { isTTY: false, term: 'dumb' }
    internals.stderr = { write: (chunk) => { stderr.push(chunk); return true } }
    internals.stdout = { write: () => true }
    try {
      apply(ctx, { task: '' })
      await vi.waitFor(() => { expect(exits).toContain(0) })
      await vi.waitFor(() => { expect(exits).toContain(1) })
      expect(stderr.join('')).toContain('session store is unavailable')
    } finally {
      Object.assign(internals, previous)
      await ctx.fiber.dispose()
    }
  })

  it('cleans up a mounted runtime when controller startup fails', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const exits: number[] = []
    const unmount = vi.fn()
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    const previous = {
      environment: internals.environment,
      stderr: internals.stderr,
      stdout: internals.stdout,
      mountLoop: internals.mountLoop,
    }
    internals.environment = { isTTY: true, term: 'xterm' }
    internals.stderr = { write: () => true }
    internals.stdout = { write: () => true }
    internals.mountLoop = () => unmount
    try {
      apply(ctx, { task: '' })
      await vi.waitFor(() => { expect(exits).toContain(1) })
      expect(unmount).toHaveBeenCalledOnce()
    } finally {
      Object.assign(internals, previous)
      await ctx.fiber.dispose()
    }
  })
})
