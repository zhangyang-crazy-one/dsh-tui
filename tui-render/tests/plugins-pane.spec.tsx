/** Plugins overlay rendering and keyboard admission preserve the chat draft. */
import { describe, expect, it, vi } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement } from 'react'
import { PluginsPane, EMPTY_PLUGINS_PANE } from '../src/plugins-pane.tsx'
import type { PluginsPaneState } from '../src/plugins-pane.tsx'
import { mapKeyEvent, TuiLoop } from '../src/loop.tsx'
import type { LoopInputState, TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_WORKSPACE_PANE } from '../src/workspace-pane.tsx'
import { EMPTY_FEEDBACK_PANE } from '../src/feedback-pane.tsx'
import { EMPTY_WORKFLOW_OVERLAY } from '../src/workflow-overlay.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'
import { visibleFrameSnapshot } from '../src/frame-snapshot.ts'
import { displayWidth } from '../src/content.ts'
import { stripTerminalControls, fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

const opened: PluginsPaneState = { ...EMPTY_PLUGINS_PANE, open: true, available: true, rows: [
  { id: 's', group: 'supplied', label: 'supplied · Selected', details: ['provided bundle', 'Not removable'], toggle: true, removable: false },
  { id: 'o', group: 'owned', label: 'owned · Not selected', details: [], toggle: true, removable: true },
] }
function output(state: PluginsPaneState, columns = 80, rows = 24, locale: 'zh-CN' | 'en-US' = 'en-US') {
  return stripTerminalControls(renderToString(createElement(PluginsPane, { state, locale, maxCols: columns, maxRows: rows }), { columns }))
}
const draft: LoopInputState = { text: 'draft-草稿', commandQuery: undefined, prefixG: false, renaming: false,
  mentionSelectedIndex: 0, mentionDismissed: false, caretIndex: 5 }
function key(state: PluginsPaneState | undefined, input: string, flags: Record<string, boolean> = {}, buffer = draft) {
  const info: Parameters<typeof mapKeyEvent>[2] = { upArrow: false, downArrow: false, leftArrow: false,
    rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false,
    escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false,
    meta: false, super: false, hyper: false, capsLock: false, numLock: false, ...flags }
  return mapKeyEvent(buffer, input, info, [{ name: 'plugins', description: 'Plugins' }],
    { open: false, selectedId: undefined }, { open: false, selectedId: undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, true,
    state === undefined ? {} : { plugins: state })
}

describe('PluginsPane', () => {
  it('uses OverlayShell, both inventory groups and profile-wide scope copy', () => {
    const text = output(opened)
    expect(text).toContain('Plugins')
    expect(text).toContain('Installation supplied')
    expect(text).toContain('Profile owned')
    expect(text).toContain('every session on this profile')
    expect(text).toContain('Not removable')
  })
  it('distinguishes unavailable, empty and closed states in both locales', () => {
    expect(output(EMPTY_PLUGINS_PANE)).toBe('')
    expect(output({ ...opened, available: false })).toContain('unavailable')
    expect(output({ ...opened, available: false })).not.toContain('No bundles')
    expect(output({ ...opened, available: false }, 80, 24, 'zh-CN')).toContain('服务未组合')
    expect(output({ ...opened, rows: [] })).toContain('No bundles')
  })
  it('shows inspection refusal and preserves the editable service spec', () => {
    const text = output({ ...opened, mode: 'input', spec: 'git+https://example.org/bundle.git', inspection: ['Not a bundle'] })
    expect(text).toContain('git+https://example.org/bundle.git')
    expect(text).toContain('Not a bundle')
    expect(text).toContain('Enter Inspect')
  })
  it('shows installation progress and separates explicit cancellation from close', () => {
    const text = output({ ...opened, busy: true, progress: 'Applying…', output: 'pnpm progress' })
    expect(text).toContain('Applying…')
    expect(text).toContain('pnpm progress')
    expect(text).toContain('installation continues')
    expect(text).not.toContain('bash-')
  })
  it('shows named removal and build approval text, including host permissions', () => {
    expect(output({ ...opened, mode: 'remove', confirmNames: ['bundle-to-remove'] })).toContain('bundle-to-remove')
    const text = output({ ...opened, mode: 'builds', confirmNames: ['native-one', '@scope/native-two'] }, 160)
    expect(text).toContain('native-one')
    expect(text).toContain('@scope/native-two')
    expect(text).toContain('host user’s permissions')
    expect(text).toContain('saved by package name')
  })
  it.each([39, 80, 120])('bounds escaped content and pane rows at %i columns', (columns) => {
    const state = { ...opened, rows: [{ ...opened.rows[0]!, label: 'wide 中文'.repeat(40) + '\n\x1b[2J', details: [] }] }
    const text = output(state, columns, 8)
    for (const line of text.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(columns)
    expect(text.split('\n').length).toBeLessThanOrEqual(8)
    expect(text).not.toContain('\x1b[2J')
  })
  it('scrolls a long named approval list without hiding names permanently', () => {
    const state = { ...opened, mode: 'builds' as const, confirmNames: Array.from({ length: 20 }, (_, i) => `native-${i}`) }
    expect(output(state, 100, 8)).toContain('native-0')
    expect(output({ ...state, detailOffset: 18 }, 100, 8)).toContain('native-19')
  })
})

describe('Plugins input', () => {
  it('restores a live terminal reading anchor and draft after install progress while hidden', async () => {
    let page = EMPTY_PLUGINS_PANE
    let model: ViewModel = { status: 'idle', activeTurn: undefined, reasoningExpanded: false, toolCardsExpanded: false,
      history: Array.from({ length: 80 }, (_, id) => ({ id, kind: 'user' as const, text: `message-${id}`, timestamp: id })) }
    const listeners = new Set<() => void>()
    const notify = () => { for (const listener of listeners) listener() }
    const sent: string[] = []
    const session = { open: false, rows: [], selectedIndex: 0, currentId: undefined, confirmDelete: false, deleteUnavailable: false }
    const search = { open: false, query: '', results: [], selectedIndex: 0, status: 'idle' as const }
    const modelPane = { open: false, filter: '', rows: [], selectedIndex: 0, status: 'idle' as const }
    const help = { open: false, lines: [] }
    const controller: TuiController = {
      getModel: () => model, getInteraction: () => 'idle', getBadge: () => '', getTitle: () => '',
      getSessionPane: () => session, getSearchPane: () => search, getModelPane: () => modelPane,
      getHelpPane: () => help, getTimelineOpen: () => false, getPluginsPane: () => page,
      getApprovalPane: () => EMPTY_APPROVAL_PANE, getAskUserPane: () => EMPTY_ASK_USER_PANE,
      getPermissionPane: () => EMPTY_PERMISSION_PANE, getSettingsPane: () => EMPTY_SETTINGS_PANE,
      getAgentHubPane: () => EMPTY_OVERLAY_PANE, getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
      getWorkspacePane: () => EMPTY_WORKSPACE_PANE, getFeedbackPane: () => EMPTY_FEEDBACK_PANE,
      getWorkflowOverlay: () => EMPTY_WORKFLOW_OVERLAY, getPlanReviewPane: () => EMPTY_OVERLAY_PANE,
      getComposerHud: () => undefined, getSubmitOnEnter: () => true, getFeedback: () => undefined,
      intakeClipboardImage: async () => ({ ok: false, reason: '' }), intakeImagePath: async () => ({ ok: false, reason: '' }),
      note: () => {}, noteUserActivity: () => {}, getCwd: () => '/test', listMentions: async () => [],
      commands: [{ name: 'plugins', description: 'Plugins' }],
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      dispatch: (action) => {
        if (action.kind === 'plugins-pane' || action.kind === 'command' && action.query === 'plugins') page = { ...opened }
        if (action.kind === 'plugins-input' && action.input.kind === 'close') page = { ...page, open: false }
        if (action.kind === 'send') sent.push(action.text)
        notify()
      },
    }
    const stdout = fakeTtyStdout(), stdin = fakeTtyStdin()
    Object.assign(stdout, { isTTY: true, rows: 24, columns: 80 })
    const instance = render(createElement(TuiLoop, { title: 'test', controller }), { stdout, stdin, patchConsole: false, exitOnCtrlC: false, interactive: true })
    const press = async (text: string) => {
      stdin.push(text)
      await new Promise(resolve => setTimeout(resolve, 20))
      await instance.waitUntilRenderFlush()
    }
    try {
      await instance.waitUntilRenderFlush()
      await press('\x1b[5~')
      await vi.waitFor(() => expect(visibleFrameSnapshot()?.rows.length).toBeGreaterThan(0))
      await new Promise(resolve => setTimeout(resolve, 180))
      const anchor = visibleFrameSnapshot()?.rows.find(row => row.line.text.includes('message-'))?.id
      expect(anchor).toBeDefined()
      await press('draft-草稿')
      controller.dispatch({ kind: 'plugins-pane' })
      await instance.waitUntilRenderFlush()
      page = { ...page, busy: false, result: ['Saved · restart required'] }
      model = { ...model, history: [...model.history, { id: 100, kind: 'user', text: 'new-while-hidden', timestamp: 100 }] }
      notify()
      await instance.waitUntilRenderFlush()
      await press('\x1b')
      await vi.waitFor(() => expect(page.open).toBe(false))
      await vi.waitFor(() => expect(visibleFrameSnapshot()?.rows.some(row => row.id === anchor)).toBe(true))
      await press('!'); await press('\r')
      expect(sent).toEqual(['draft-草稿!'])
    } finally { instance.unmount(); await instance.waitUntilExit() }
  })
  it('maps g p and /plugins Enter to the same controller page entry', () => {
    expect(key(undefined, 'p', {}, { ...draft, text: 'g', prefixG: true })).toMatchObject({ kind: 'dispatch', action: { kind: 'plugins-pane' }, text: '' })
    expect(key(undefined, '\r', { return: true }, { ...draft, text: '/plugins', commandQuery: 'plugins' })).toMatchObject({ kind: 'dispatch', action: { kind: 'command', query: 'plugins' } })
  })
  it('keeps composer text and caret through page typing and Esc', () => {
    const effect = key({ ...opened, mode: 'input', spec: 'file:' }, '/bundle')
    expect(effect).toMatchObject({ action: { kind: 'plugins-input', input: { kind: 'text', value: 'file:/bundle' } }, text: draft.text })
    const close = key({ ...opened, busy: true }, '', { escape: true })
    expect(close).toMatchObject({ action: { kind: 'plugins-input', input: { kind: 'close' } }, text: draft.text })
  })
  it('does not let Enter or retry implicitly approve named scripts', () => {
    const approval = { ...opened, mode: 'builds' as const, confirmNames: ['native'] }
    expect(key(approval, '\r', { return: true })).toEqual({ kind: 'none' })
    expect(key(approval, 'r')).toEqual({ kind: 'none' })
    expect(key(approval, 'y')).toMatchObject({ action: { input: { kind: 'confirm' } } })
    expect(key(approval, 'n')).toMatchObject({ action: { input: { kind: 'dismiss' } } })
  })
  it('captures shortcut keys and routes explicit cancellation only while busy', () => {
    expect(key(opened, 'n', { ctrl: true })).toEqual({ kind: 'none' })
    expect(key({ ...opened, busy: true }, 'c')).toMatchObject({ action: { input: { kind: 'cancel' } } })
    expect(key(opened, 'c')).toEqual({ kind: 'none' })
  })
})
