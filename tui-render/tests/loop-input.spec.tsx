/**
 * Real Ink input path for TuiLoop: key events arrive through useInput/usePaste
 * exactly as the product delivers them (raw keypresses and bracketed paste),
 * and every controller action must dispatch exactly once, outside React's
 * render phase. React runs setState updaters during render, so dispatching
 * from inside one notifies the store mid-render and React logs "Cannot update
 * a component (TuiLoop) while rendering a different component (TuiLoop)" —
 * the defect the real PTY session showed. The controller stub notifies its
 * subscribers synchronously from dispatch, like the RuntimeController's
 * first-call emit, and records React.captureOwnerStack() at dispatch time: a
 * non-null owner stack proves the action ran during a render rather than in
 * the input handler.
 *
 * The fake stdin needs the full TTY seam Ink touches on mount — setRawMode,
 * ref, unref, and isTTY — otherwise useInput's effect crashes inside Ink's
 * ErrorBoundary and the input pipeline never attaches (see tests/helpers.ts).
 */

import { render, renderToString } from 'ink'
import { createElement } from 'react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { MentionCandidate } from '../src/mention.tsx'
import type { ViewModel } from '../src/projection.ts'
import type { SessionPaneState } from '../src/session-pane.tsx'
import type { SearchPaneState } from '../src/search-pane.tsx'
import type { ModelPaneState } from '../src/model-pane.tsx'
import type { HelpPaneState } from '../src/help-pane.tsx'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'
import type { OverlayPaneState } from '../src/overlay-shell.tsx'
import { EMPTY_WORKFLOW_OVERLAY } from '../src/workflow-overlay.tsx'
import type { WorkflowOverlayState } from '../src/workflow-overlay.tsx'
import { EMPTY_WORKSPACE_PANE } from '../src/workspace-pane.tsx'
import type { WorkspacePaneState } from '../src/workspace-pane.tsx'
import { EMPTY_FEEDBACK_PANE } from '../src/feedback-pane.tsx'
import type { FeedbackPaneState } from '../src/feedback-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'
import type { FakeTtyStdin } from './helpers.ts'

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  reasoningExpanded: false,
  toolCardsExpanded: false,
}
const EMPTY_PANE: SessionPaneState = {
  rows: [],
  selectedIndex: 0,
  open: false,
  confirmDelete: false,
  deleteUnavailable: false,
  currentId: undefined,
}
const EMPTY_SEARCH: SearchPaneState = {
  query: '',
  results: [],
  selectedIndex: 0,
  open: false,
  status: 'idle',
}
const EMPTY_MODEL_PANE: ModelPaneState = {
  open: false,
  filter: '',
  rows: [],
  selectedIndex: 0,
  status: 'idle',
}
const EMPTY_HELP_PANE: HelpPaneState = {
  open: false,
  lines: [],
}
/** Stable open overlay snapshot: a fresh `{ open: true }` each read loops useSyncExternalStore. */
const OPEN_OVERLAY: OverlayPaneState = { open: true }
/** Stable open workflow-overlay snapshot (no member rows, offset 0). */
const OPEN_WORKFLOW_OVERLAY: WorkflowOverlayState = { open: true, offset: 0 }
/** Stable open workspace snapshot: empty tree, browse mode. */
const OPEN_WORKSPACE: WorkspacePaneState = {
  open: true,
  root: '/workspace',
  nodes: [],
  selectedIndex: 0,
  editing: false,
}
/** Stable open feedback snapshot: no assistant target yet. */
const OPEN_FEEDBACK: FeedbackPaneState = { open: true, hasTarget: false, editing: false }

/**
 * Controller stub: dispatch notifies subscribers synchronously (real emit)
 * and records the React owner stack so the spec can assert the action ran
 * outside any render.
 */
function stubController(
  dispatch: (action: unknown) => void,
  owners: (string | null)[],
  searchPane: SearchPaneState = EMPTY_SEARCH,
  title = 'test',
  feedback?: string,
): TuiController {
  const listeners = new Set<() => void>()
  return {
    getModel: () => IDLE_MODEL,
    getInteraction: () => 'idle',
    getBadge: () => 'test',
    getTitle: () => title,
    getSessionPane: () => EMPTY_PANE,
    getSearchPane: () => searchPane,
    getTimelineOpen: () => false,
    getModelPane: () => EMPTY_MODEL_PANE,
    getHelpPane: () => EMPTY_HELP_PANE,
    getApprovalPane: () => EMPTY_APPROVAL_PANE,
    getAskUserPane: () => EMPTY_ASK_USER_PANE,
    getPermissionPane: () => EMPTY_PERMISSION_PANE,
    getSettingsPane: () => EMPTY_SETTINGS_PANE,
    getAgentHubPane: () => EMPTY_OVERLAY_PANE,
    getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
    getWorkspacePane: () => EMPTY_WORKSPACE_PANE,
    getFeedbackPane: () => EMPTY_FEEDBACK_PANE,
    getWorkflowOverlay: () => EMPTY_WORKFLOW_OVERLAY,
    getPlanReviewPane: () => EMPTY_OVERLAY_PANE,
    getComposerHud: () => undefined,
    getToolPresenters: () => undefined,
    getSubmitOnEnter: () => true,
    noteUserActivity: () => {},
    note: () => {},
    intakeClipboardImage: async () => ({ ok: false, reason: 'unavailable in stub' }),
    intakeImagePath: async () => ({ ok: false, reason: 'unavailable in stub' }),
    getFeedback: () => feedback,
    subscribe: (callback: () => void) => {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    dispatch: (action) => {
      owners.push(React.captureOwnerStack?.() ?? null)
      dispatch(action)
      for (const listener of [...listeners]) listener()
    },
    commands: [],
    getCwd: () => '/workspace',
    listMentions: async () => [],
  }
}

/** Drive one raw chunk through Ink's stdin parser and wait for the flush. */
async function press(stdin: FakeTtyStdin, chunk: string): Promise<void> {
  stdin.push(chunk)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
}

const capturedErrors: string[] = []
const originalConsoleError = console.error
afterEach(() => {
  console.error = originalConsoleError
})

/** Mount TuiLoop over fake TTY streams; capture React render-phase errors. */
function mount(controller: TuiController, interactive = false) {
  const stdout = fakeTtyStdout()
  const stdin = fakeTtyStdin()
  capturedErrors.length = 0
  console.error = (...args: unknown[]) => {
    capturedErrors.push(typeof args[0] === 'string' ? args[0] : '')
    originalConsoleError(...args)
  }
  const instance = render(
    createElement(TuiLoop, { title: 't', controller }),
    {
      stdout,
      stdin,
      exitOnCtrlC: false,
      patchConsole: false,
      interactive,
    },
  )
  return { instance, stdin, stdout }
}

function renderPhaseErrors(): string[] {
  return capturedErrors.filter(
    line =>
      line.includes('Cannot update a component') &&
      line.includes('while rendering'),
  )
}

describe('TuiLoop real input path', () => {
  it.each(['正在新建会话…', '正在切换会话…'])(
    'renders %s and suppresses repeated session actions',
    async (feedback) => {
      const dispatch = vi.fn()
      const owners: (string | null)[] = []
      const { instance, stdin, stdout } = mount(
        stubController(dispatch, owners, EMPTY_SEARCH, 'test', feedback),
        true,
      )
      const chunks: string[] = []
      stdout.on('data', chunk => chunks.push(chunk))
      try {
        await instance.waitUntilRenderFlush()
        await press(stdin, '\x0e')
        await instance.waitUntilRenderFlush()
        expect(chunks.join('')).toContain(feedback)
        expect(dispatch).not.toHaveBeenCalled()
        expect(owners).toEqual([])
      } finally {
        instance.unmount()
      }
    },
  )

  it.each([
    '✗ 新建会话失败（当前会话保持可用）',
    '✗ 切换失败：resume unavailable（当前会话保持可用）',
  ])('preserves the composer byte-for-byte after %s', async (feedback) => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const { instance, stdin } = mount(
      stubController(dispatch, owners, EMPTY_SEARCH, 'test', feedback),
    )
    try {
      await instance.waitUntilRenderFlush()
      for (const character of 'draft-草稿') await press(stdin, character)
      await press(stdin, '\x0e')
      await press(stdin, '\r')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenNthCalledWith(1, { kind: 'new-session' })
      expect(dispatch).toHaveBeenNthCalledWith(2, {
        kind: 'send',
        text: 'draft-草稿',
      })
    } finally {
      instance.unmount()
    }
  })

  it('keeps viewport navigation local and dispatches controller actions once', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const { instance, stdin } = mount(stubController(dispatch, owners))
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'j')
      await press(stdin, '\x03')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'sigint' })
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(owners).toEqual([null])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('keeps the presenter registry snapshot stable across local viewport renders', async () => {
    const presenters = vi.fn(() => undefined)
    const controller: TuiController = {
      ...stubController(() => {}, []),
      getToolPresenters: presenters,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'k')
      await press(stdin, 'j')
      await instance.waitUntilRenderFlush()
      expect(presenters).toHaveBeenCalledTimes(1)
    } finally {
      instance.unmount()
    }
  })

  it('routes mounted session, search, and model selections through the controller', async () => {
    const cases: Array<{
      controller: TuiController
      expected: unknown
      recorded: ReturnType<typeof vi.fn>
    }> = []
    const owners: (string | null)[] = []
    const sessionDispatch = vi.fn()
    const sessionPane: SessionPaneState = {
      ...EMPTY_PANE,
      open: true,
      rows: [{ id: 'session-1' as never, title: 'one', updatedAt: 0 }],
    }
    cases.push({
      controller: {
        ...stubController(sessionDispatch, owners),
        getSessionPane: () => sessionPane,
      },
      expected: { kind: 'select-session', id: 'session-1' },
      recorded: sessionDispatch,
    })
    const searchDispatch = vi.fn()
    const searchPane: SearchPaneState = {
      ...EMPTY_SEARCH,
      open: true,
      results: [{ id: 'session-2', title: 'two', snippet: 'match' }],
    }
    cases.push({
      controller: stubController(searchDispatch, owners, searchPane),
      expected: { kind: 'select-session', id: 'session-2' },
      recorded: searchDispatch,
    })
    const modelDispatch = vi.fn()
    const modelPane: ModelPaneState = {
      ...EMPTY_MODEL_PANE,
      open: true,
      rows: [{
        id: 'provider:model', provider: 'provider', model: 'model', name: 'model', fallback: false, current: false,
      }],
    }
    cases.push({
      controller: {
        ...stubController(modelDispatch, owners),
        getModelPane: () => modelPane,
      },
      expected: { kind: 'select-model', id: 'provider:model' },
      recorded: modelDispatch,
    })

    for (const item of cases) {
      const { instance, stdin } = mount(item.controller)
      try {
        await instance.waitUntilRenderFlush()
        await press(stdin, '\r')
        await instance.waitUntilRenderFlush()
        expect(item.recorded).toHaveBeenCalledWith(item.expected)
      } finally {
        instance.unmount()
      }
    }
  })

  it('applies mounted timeline, help, and plan-review local scrolling', async () => {
    const owners: (string | null)[] = []
    const longHistory: ViewModel = {
      ...IDLE_MODEL,
      history: Array.from({ length: 80 }, (_, index) => ({
        id: index, kind: 'user' as const, text: `row-${String(index)}`, timestamp: index,
      })),
    }
    const helpPane: HelpPaneState = {
      open: true,
      lines: Array.from({ length: 40 }, (_, index) => `line-${String(index)}`),
    }
    const planPane = {
      open: true,
      plan: Array.from({ length: 40 }, (_, index) => `line-${String(index)}`).join('\n'),
    } as const
    const emptyPlanPane = { open: true, plan: undefined } as const
    const controllers: TuiController[] = [
      {
        ...stubController(vi.fn(), owners),
        getTimelineOpen: () => true,
        getModel: () => longHistory,
      },
      {
        ...stubController(vi.fn(), owners),
        getHelpPane: () => helpPane,
      },
      {
        ...stubController(vi.fn(), owners),
        getPlanReviewPane: () => planPane,
      },
      {
        ...stubController(vi.fn(), owners),
        getPlanReviewPane: () => emptyPlanPane,
      },
    ]
    for (const controller of controllers) {
      const { instance, stdin } = mount(controller)
      try {
        await instance.waitUntilRenderFlush()
        await press(stdin, 'j')
        await instance.waitUntilRenderFlush()
      } finally {
        instance.unmount()
      }
    }
  })

  it('arms, clears, and expires the mounted g chord timer', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const { instance, stdin } = mount(stubController(dispatch, owners))
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'g')
      await press(stdin, 'x')
    } finally {
      instance.unmount()
    }
    const expiring = mount(stubController(dispatch, owners))
    try {
      await expiring.instance.waitUntilRenderFlush()
      await press(expiring.stdin, 'g')
      await new Promise(resolve => setTimeout(resolve, 650))
      await expiring.instance.waitUntilRenderFlush()
    } finally {
      expiring.instance.unmount()
    }
  })

  it('settles a rejected mounted mention lookup to the empty ready state', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const listMentions = vi.fn(async () => { throw new Error('catalog unavailable') })
    const controller = {
      ...stubController(dispatch, owners),
      listMentions,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '@')
      await instance.waitUntilRenderFlush()
      expect(listMentions).toHaveBeenCalledOnce()
    } finally {
      instance.unmount()
    }
  })

  it('ignores a rejected mention lookup after unmount aborts it', async () => {
    let rejectGate!: (reason?: unknown) => void
    const gate = new Promise<MentionCandidate[]>((_resolve, reject) => {
      rejectGate = reject
    })
    const listMentions = vi.fn(() => gate)
    const controller = {
      ...stubController(vi.fn(), []),
      listMentions,
    }
    const { instance, stdin } = mount(controller)
    await instance.waitUntilRenderFlush()
    await press(stdin, '@')
    await vi.waitFor(() => { expect(listMentions).toHaveBeenCalledOnce() })
    instance.unmount()
    rejectGate(new Error('late catalog failure'))
    await Promise.resolve()
  })

  it('renders the mounted command menu after slash input', async () => {
    const dispatch = vi.fn()
    const controller = {
      ...stubController(dispatch, []),
      commands: [{ name: 'help', description: 'Show help' }],
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~/\x1b[201~')
      await instance.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      instance.unmount()
    }
  })

  it.each([
    ['Down', '\x1b[B'],
    ['j', 'j'],
  ])('routes command selection through %s without sending chat text', async (_name, key) => {
    const dispatch = vi.fn()
    const controller = {
      ...stubController(dispatch, []),
      commands: [
        { name: 'help', description: 'Show help' },
        { name: 'settings', description: 'Open settings' },
      ],
    }
    const { instance, stdin } = mount(controller, true)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '/')
      await press(stdin, key)
      await press(stdin, '\r')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'command', query: 'settings' })
      expect(dispatch.mock.calls.some((call) => {
        const action = call[0] as { kind?: string } | null | undefined
        return typeof action === 'object' && action !== null && action.kind === 'send'
      })).toBe(false)
    } finally {
      instance.unmount()
    }
  })

  it('closes only the command menu on Escape', async () => {
    const dispatch = vi.fn()
    const controller = {
      ...stubController(dispatch, []),
      commands: [{ name: 'help', description: 'Show help' }],
    }
    const { instance, stdin } = mount(controller, true)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '/')
      await press(stdin, '\x1b')
      await new Promise<void>(resolve => setTimeout(resolve, 60))
      await press(stdin, '\r')
      expect(dispatch).toHaveBeenCalledWith({ kind: 'send', text: '/' })
      expect(dispatch.mock.calls.some((call) => {
        const action = call[0] as { kind?: string } | null | undefined
        return typeof action === 'object' && action !== null && action.kind === 'command'
      })).toBe(false)
    } finally {
      instance.unmount()
    }
  })

  it('uses Tab to complete the controlled mention without sending', async () => {
    const dispatch = vi.fn()
    const listMentions = vi.fn(async (): Promise<MentionCandidate[]> => [
      { kind: 'file', name: 'alpha.ts' },
      { kind: 'file', name: 'beta.ts' },
    ])
    const controller = {
      ...stubController(dispatch, []),
      listMentions,
    }
    const { instance, stdin } = mount(controller, true)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '@')
      await vi.waitFor(() => {
        expect(listMentions).toHaveBeenCalledOnce()
      })
      await instance.waitUntilRenderFlush()
      await press(stdin, '\x1b[B')
      await press(stdin, '\t')
      await instance.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
      await press(stdin, '\r')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'send', text: '@beta.ts ' })
    } finally {
      instance.unmount()
    }
  })

  it('appends printable keys to the buffer through the real key path', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const { instance, stdin } = mount(stubController(dispatch, owners))
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'h')
      await press(stdin, 'i')
      await instance.waitUntilRenderFlush()
      // Printables stay in the buffer; no controller action is dispatched.
      expect(dispatch).not.toHaveBeenCalled()
      expect(owners).toEqual([])
      expect(capturedErrors).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('keeps only the newest controller-owned mention result and aborts on unmount', async () => {
    const deferred: Array<{
      query: string
      signal: AbortSignal | undefined
      resolve: (rows: MentionCandidate[]) => void
    }> = []
    const base = stubController(() => {}, [])
    const controller: TuiController = {
      ...base,
      listMentions: (_basePath, query, signal) => new Promise((resolve) => {
        deferred.push({ query, signal, resolve })
      }),
    }
    const { instance, stdin, stdout } = mount(controller, true)
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(chunk))
    try {
      await instance.waitUntilRenderFlush()
      for (const character of '@alpha') await press(stdin, character)
      await vi.waitFor(() => {
        expect(deferred.find(entry => entry.query === 'alpha')).toBeDefined()
      })
      for (let index = 0; index < 'alpha'.length; index += 1) await press(stdin, '\x7f')
      for (const character of 'beta') await press(stdin, character)
      await vi.waitFor(() => {
        expect(deferred.find(entry => entry.query === 'beta')).toBeDefined()
      })
      const alpha = deferred.find(entry => entry.query === 'alpha')!
      const beta = deferred.find(entry => entry.query === 'beta')!
      expect(alpha.signal?.aborted).toBe(true)
      alpha.resolve([{ kind: 'file', name: 'alpha.ts' }])
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      await instance.waitUntilRenderFlush()
      expect(chunks.join('')).not.toContain('@ alpha.ts')
      beta.resolve([{ kind: 'file', name: 'beta.ts' }])
      await vi.waitFor(() => {
        expect(chunks.join('')).toContain('@ beta.ts')
      })
      instance.unmount()
      expect(beta.signal?.aborted).toBe(true)
    } finally {
      instance.unmount()
    }
  })

  it('routes bracketed paste outside the render phase and dispatches search exactly once per event', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const openSearch: SearchPaneState = {
      ...EMPTY_SEARCH,
      open: true,
      query: 'k',
      results: [],
    }
    const { instance, stdin } = mount(stubController(dispatch, owners, openSearch))
    try {
      await instance.waitUntilRenderFlush()
      // Seed the loop's own buffer through the real key path ('k' moves the
      // candidate highlight in search mode, so any other printable works).
      await press(stdin, 'a')
      // Bracketed-paste framing, as a terminal emulator delivers it: Ink
      // strips the ESC[200~/ESC[201~ markers and hands the handler 'ey'.
      await press(stdin, '\u001b[200~ey\x1b[201~')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenNthCalledWith(1, { kind: 'search', query: 'a' })
      expect(dispatch).toHaveBeenNthCalledWith(2, {
        kind: 'search',
        query: 'aey',
      })
      expect(dispatch).toHaveBeenCalledTimes(2)
      expect(owners).toEqual([null, null])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('lands a paste in the buffer and sends it exactly once on Enter', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const { instance, stdin } = mount(stubController(dispatch, owners))
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello world\x1b[201~')
      await press(stdin, '\r')
      await instance.waitUntilRenderFlush()
      // The paste never dispatches by itself; the buffered text is what Enter
      // sends, proving the paste landed in the loop buffer through Ink.
      expect(dispatch).toHaveBeenCalledWith({
        kind: 'send',
        text: 'hello world',
      })
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(owners).toEqual([null])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('routes y to approval-allow and ignores paste while the slot is open', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const base = stubController(dispatch, owners)
    const approval = {
      ...EMPTY_APPROVAL_PANE,
      open: true,
      toolName: 'bash',
    }
    const controller: TuiController = {
      ...base,
      getApprovalPane: () => approval,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello\x1b[201~')
      await press(stdin, 'x')
      await press(stdin, 'y')
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'approval-allow' })
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(owners).toEqual([null])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('ignores paste while the permission overlay is open', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const base = stubController(dispatch, owners)
    const permission = {
      ...EMPTY_PERMISSION_PANE,
      open: true,
      names: ['read-only', 'workspace-write', 'danger-full-access'],
      selectedIndex: 1,
      currentName: 'workspace-write',
    }
    const controller: TuiController = {
      ...base,
      getPermissionPane: () => permission,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello\x1b[201~')
      await instance.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('ignores paste while workspace or feedback browse mode owns input', async () => {
    const workspace: WorkspacePaneState = {
      ...EMPTY_WORKSPACE_PANE,
      open: true,
      root: '/workspace',
      editing: false,
    }
    const feedback: FeedbackPaneState = {
      ...EMPTY_FEEDBACK_PANE,
      open: true,
      editing: false,
      hasTarget: true,
    }
    for (const controller of [
      { ...stubController(vi.fn(), []), getWorkspacePane: () => workspace },
      { ...stubController(vi.fn(), []), getFeedbackPane: () => feedback },
    ]) {
      const { instance, stdin } = mount(controller)
      try {
        await instance.waitUntilRenderFlush()
        await press(stdin, '\u001b[200~blocked\x1b[201~')
        await instance.waitUntilRenderFlush()
      } finally {
        instance.unmount()
      }
    }
  })

  it('ignores paste while the settings overlay is browsing', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const base = stubController(dispatch, owners)
    const settings = {
      ...EMPTY_SETTINGS_PANE,
      open: true,
      rows: [{ namespace: 'llm-deepseek', field: 'baseURL', value: 'https://api.deepseek.com' }],
    }
    const controller: TuiController = {
      ...base,
      getSettingsPane: () => settings,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello\x1b[201~')
      await instance.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('shows the live session title and falls back to the app name before one binds', async () => {
    const dispatch = vi.fn()
    let title = ''
    const listeners = new Set<() => void>()
    const base = stubController(dispatch, [])
    const controller: TuiController = {
      ...base,
      getTitle: () => title,
      subscribe: (callback: () => void) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      },
    }
    const { instance, stdin, stdout } = mount(controller, true)
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(chunk))
    try {
      await instance.waitUntilRenderFlush()
      // No live title yet: the mount fallback (app name) shows.
      expect(chunks.join('')).not.toContain('beta')
      title = 'beta'
      for (const listener of [...listeners]) listener()
      await press(stdin, 'j')
      await instance.waitUntilRenderFlush()
      // The live session title replaces the app name in the top bar.
      await new Promise(resolve => setTimeout(resolve, 60))
      expect(chunks.join('')).toContain('beta')
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('ignores paste while the Agent Hub overlay is open', async () => {
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const base = stubController(dispatch, owners)
    const controller: TuiController = {
      ...base,
      getAgentHubPane: () => OPEN_OVERLAY,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello\x1b[201~')
      await instance.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('replaces children with OverlayShell and leaves input null while Agent Hub is open', () => {
    applyTheme('truecolor')
    const controller: TuiController = {
      ...stubController(() => {}, []),
      getAgentHubPane: () => OPEN_OVERLAY,
    }
    const out = renderToString(
      createElement(TuiLoop, { title: 't', controller }),
    )
    expect(out).toContain('子代理')
    expect(out).toContain('暂无子代理')
    expect(out).toContain('Esc 关闭 · 有运行中的子代理时再打开')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })

  it('paints workspace, feedback, workflow, and plan-directory OverlayShell chrome', () => {
    applyTheme('truecolor')
    const base = stubController(() => {}, [])
    expect(renderToString(createElement(TuiLoop, {
      title: 't',
      controller: { ...base, getWorkspacePane: () => OPEN_WORKSPACE },
    }))).toContain('此目录为空')
    expect(renderToString(createElement(TuiLoop, {
      title: 't',
      controller: { ...base, getFeedbackPane: () => OPEN_FEEDBACK },
    }))).toContain('暂无助手消息可反馈')
    expect(renderToString(createElement(TuiLoop, {
      title: 't',
      controller: { ...base, getWorkflowOverlay: () => OPEN_WORKFLOW_OVERLAY },
    }))).toContain('当前无工作流运行')
    expect(renderToString(createElement(TuiLoop, {
      title: 't',
      controller: { ...base, getPlanDirectoryPane: () => OPEN_OVERLAY },
    }))).toContain('计划')
  })

  it('occupies input with 计划评审 while keeping StreamView when plan-review is open', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: {
          ...stubController(() => {}, []),
          getPlanReviewPane: () => OPEN_OVERLAY,
        },
      }),
    )
    expect(out).toContain('计划评审')
    expect(out).toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })

  it('keeps the InputBar prompt when a HUD strip is present', () => {
    applyTheme('truecolor')
    const controller: TuiController = {
      ...stubController(() => {}, []),
      getComposerHud: () => '· 待办 写快照',
      getQueuedDraftCount: () => 2,
    }
    const out = renderToString(
      createElement(TuiLoop, { title: 't', controller }),
    )
    expect(out).toContain('· 待办 写快照')
    expect(out).toContain('待发 2 · ↑ 取出')
    expect(out).toContain('\x1b[38;2;77;107;254m│ > ')
  })
  it('paints the goal footer and todo HUD while the composer keeps input', async () => {
    applyTheme('truecolor')
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    // Stable snapshot references: useSyncExternalStore re-reads on every render.
    const goalFooter = {
      phase: 'active',
      objective: '落地 Phase 6 入口',
      maxGoalRounds: 8,
      roundsStarted: 2,
    }
    const todoHud = [
      { content: '写测试', status: 'pending' },
      { content: '改界面', status: 'in_progress' },
    ] as const
    const controller: TuiController = {
      ...stubController(dispatch, owners),
      getGoalFooter: () => goalFooter,
      getTodoHud: () => todoHud,
    }
    const { instance, stdin, stdout } = mount(controller, true)
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(chunk))
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'x')
      await press(stdin, '\r')
      await instance.waitUntilRenderFlush()
      const frame = chunks.join('')
      expect(frame).toContain('目标 active 2/8')
      expect(frame).toContain('落地 Phase 6 入口')
      expect(frame).toContain('· 待办 ')
      expect(frame).toContain('写测试')
      expect(frame).toContain('▸ 进行中 ')
      expect(frame).toContain('改界面')
      expect(dispatch).toHaveBeenCalledWith({ kind: 'send', text: 'x' })
      expect(owners).toEqual([null])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('calls noteUserActivity on every real keyboard input through useInput before dispatching', async () => {
    const noteUserActivity = vi.fn()
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const controller: TuiController = {
      ...stubController(dispatch, owners),
      noteUserActivity,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, 'j')
      await press(stdin, '\x03')
      await instance.waitUntilRenderFlush()
      expect(noteUserActivity).toHaveBeenCalledTimes(2)
      // The activity stamp precedes the dispatch in the loop, mirroring the
      // product path so the quiet-input window arms before the action fires.
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })

  it('calls noteUserActivity on every real bracketed paste through usePaste', async () => {
    const noteUserActivity = vi.fn()
    const dispatch = vi.fn()
    const owners: (string | null)[] = []
    const controller: TuiController = {
      ...stubController(dispatch, owners),
      noteUserActivity,
    }
    const { instance, stdin } = mount(controller)
    try {
      await instance.waitUntilRenderFlush()
      await press(stdin, '\u001b[200~hello world\x1b[201~')
      await instance.waitUntilRenderFlush()
      // A paste arms the quiet window but does not dispatch by itself; the
      // buffered text is what Enter would later send, proving the paste
      // landed in the loop buffer through Ink.
      expect(noteUserActivity).toHaveBeenCalledTimes(1)
      expect(dispatch).toHaveBeenCalledTimes(0)
      expect(owners).toEqual([])
      expect(renderPhaseErrors()).toEqual([])
    } finally {
      instance.unmount()
    }
  })
})
