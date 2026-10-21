/** Input selection and blocking-help behavior through Ink's actual TTY parser. */
import { render } from 'ink'
import { createElement } from 'react'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PLAN_REVIEW_PANE } from '../src/plan-review-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_WORKSPACE_PANE } from '../src/workspace-pane.tsx'
import { EMPTY_FEEDBACK_PANE } from '../src/feedback-pane.tsx'
import { EMPTY_WORKFLOW_OVERLAY } from '../src/workflow-overlay.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'
import { disposeRenderer, fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

const LEFT = '\x1b[D'
const RIGHT = '\x1b[C'
const SHIFT_LEFT = '\x1b[1;2D'
const SHIFT_RIGHT = '\x1b[1;2C'
const SHIFT_HOME = '\x1b[1;2H'
const SHIFT_END = '\x1b[1;2F'
const COPY = '\x19'
const paste = (text: string): string => `\x1b[200~${text}\x1b[201~`
const IDLE_MODEL: ReturnType<TuiController['getModel']> = {
  history: [], activeTurn: undefined, status: 'idle', reasoningExpanded: false, toolCardsExpanded: false,
}

function fixture(draft: string) {
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  let approval = EMPTY_APPROVAL_PANE
  let question = EMPTY_ASK_USER_PANE
  let plan = EMPTY_PLAN_REVIEW_PANE
  const actions = vi.fn<TuiController['dispatch']>(action => {
    if (action.kind === 'ask-user-custom-edit') question = { ...question, customText: action.text, customCaretIndex: action.caretIndex }
    notify()
  })
  const copied = vi.fn<(text: string) => void>()
  const controller: TuiController = {
    getModel: () => IDLE_MODEL,
    getInteraction: () => 'idle', getBadge: () => 'fixture', getTitle: () => 'Selection',
    getComposerDraft: () => draft,
    getSessionPane: () => CLOSED_SESSION,
    getSearchPane: () => CLOSED_SEARCH,
    getTimelineOpen: () => false,
    getModelPane: () => CLOSED_MODEL,
    getHelpPane: () => CLOSED_HELP,
    getApprovalPane: () => approval, getAskUserPane: () => question, getPlanReviewPane: () => plan,
    getPermissionPane: () => EMPTY_PERMISSION_PANE, getSettingsPane: () => EMPTY_SETTINGS_PANE,
    getAgentHubPane: () => EMPTY_OVERLAY_PANE, getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
    getWorkspacePane: () => EMPTY_WORKSPACE_PANE, getFeedbackPane: () => EMPTY_FEEDBACK_PANE,
    getWorkflowOverlay: () => EMPTY_WORKFLOW_OVERLAY,
    getComposerHud: () => undefined, getFeedback: () => undefined,
    getSubmitOnEnter: () => true,
    copySelection: copied, noteUserActivity: () => {}, note: () => {},
    intakeClipboardImage: async () => ({ ok: false, reason: 'fixture' }),
    intakeImagePath: async () => ({ ok: false, reason: 'fixture' }),
    subscribe: listener => { listeners.add(listener);return () => { listeners.delete(listener) } },
    dispatch: actions, commands: [], getCwd: () => '/fixture', listMentions: async () => [],
  }
  const stdin = fakeTtyStdin()
  const stdout = fakeTtyStdout()
  stdout.isTTY = true
  stdout.columns = 100
  stdout.rows = 30
  let output = ''
  stdout.on('data', chunk => { output += String(chunk) })
  const instance = render(createElement(TuiLoop, { title: 'Selection', controller }), {
    stdin, stdout, interactive: true, exitOnCtrlC: false, patchConsole: false,
  })
  const press = async (chunk: string): Promise<void> => {
    stdin.push(chunk)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    await instance.waitUntilRenderFlush()
  }
  return {
    instance, press, actions, copied, controller,
    output: () => stripVTControlCharacters(output),
    clearOutput: () => { output = '' },
    approval: (next: typeof approval) => { approval = next;notify() },
    question: (next: typeof question) => { question = next;notify() },
    plan: (next: typeof plan) => { plan = next;notify() },
    questionState: () => question,
    closeDialogs: () => { approval = EMPTY_APPROVAL_PANE;question = EMPTY_ASK_USER_PANE;plan = EMPTY_PLAN_REVIEW_PANE;notify() },
  }
}

const CLOSED_SESSION = { rows: [], selectedIndex: 0, open: false, confirmDelete: false, deleteUnavailable: false, currentId: undefined }
const CLOSED_SEARCH = { query: '', results: [], selectedIndex: 0, open: false, status: 'idle' as const }
const CLOSED_MODEL = { open: false, filter: '', rows: [], selectedIndex: 0, status: 'idle' as const }
const CLOSED_HELP = { open: false, lines: [] }

describe('TuiLoop keyboard selections over TTY input', () => {
  it('copies whole emoji and combining graphemes with Shift arrows, then replaces the range', async () => {
    const f = fixture('中e\u0301🧑‍💻')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_LEFT)
      await f.press(COPY)
      expect(f.copied).toHaveBeenLastCalledWith('🧑‍💻')
      await f.press(SHIFT_LEFT)
      await f.press(COPY)
      expect(f.copied).toHaveBeenLastCalledWith('e\u0301🧑‍💻')
      await f.press(SHIFT_RIGHT)
      await f.press(COPY)
      expect(f.copied).toHaveBeenLastCalledWith('🧑‍💻')
      await f.press('한')
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: '中e\u0301한' })
      expect(f.actions).not.toHaveBeenCalledWith({ kind: 'copy-message' })
    } finally { await disposeRenderer(f.instance) }
  })

  it('selects Home/End within logical lines and replaces a cross-line range with bracketed paste', async () => {
    const f = fixture('中日\n한글')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_HOME)
      await f.press(COPY)
      expect(f.copied).toHaveBeenLastCalledWith('한글')
      await f.press(LEFT)
      await f.press(SHIFT_END)
      await f.press(COPY)
      expect(f.copied).toHaveBeenLastCalledWith('한글')
      await f.press(RIGHT)
      await f.press(SHIFT_LEFT)
      await f.press(SHIFT_LEFT)
      await f.press(SHIFT_LEFT)
      await f.press(paste('X\nY'))
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: '中日X\nY' })
    } finally { await disposeRenderer(f.instance) }
  })

  it.each(['\x7f', '\x1b[3~'])('deletes an active grapheme selection with %j', async key => {
    const f = fixture('a🧑‍💻中')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_LEFT)
      await f.press(SHIFT_LEFT)
      await f.press(key)
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'a' })
    } finally { await disposeRenderer(f.instance) }
  })

  it('clears a selection on an ordinary arrow and preserves normal insertion, deletion and copy-message', async () => {
    const f = fixture('abc')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_LEFT)
      await f.press(LEFT)
      await f.press('X')
      await f.press(RIGHT)
      await f.press('\x7f')
      await f.press(COPY)
      expect(f.copied).not.toHaveBeenCalled()
      expect(f.actions).toHaveBeenCalledWith({ kind: 'copy-message' })
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'abX' })
    } finally { await disposeRenderer(f.instance) }
  })

  it('blocks copying /key secrets rather than falling through to message-copy', async () => {
    const f = fixture('/key OPENAI_API_KEY sk-fixture-never-copy')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_HOME)
      await f.press(COPY)
      expect(f.copied).not.toHaveBeenCalled()
      expect(f.actions).not.toHaveBeenCalledWith({ kind: 'copy-message' })
      expect(f.output()).not.toContain('sk-fixture-never-copy')
    } finally { await disposeRenderer(f.instance) }
  })

  it.each([true, false])('replaces the selection when Enter inserts a newline, submitOnEnter=%s', async submitOnEnter => {
    const f = fixture('ab中')
    f.controller.getSubmitOnEnter = () => submitOnEnter
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_LEFT)
      await f.press(submitOnEnter ? '\x1b[13;2u' : '\r')
      await f.press(submitOnEnter ? '\r' : '\x1b[13;5u')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'ab\n' })
    } finally { await disposeRenderer(f.instance) }
  })

  it('keeps a root selection out of an active custom-answer editor', async () => {
    const f = fixture('Root draft')
    try {
      await f.instance.waitUntilRenderFlush()
      await f.press(SHIFT_HOME)
      f.question({ ...EMPTY_ASK_USER_PANE, open: true, editingCustom: true, header: 'Answer', customText: '前后', customCaretIndex: 1 })
      await f.press('X')
      await f.press(paste('中文'))
      expect(f.questionState().customText).toBe('前X中文后')
      expect(f.actions).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'send' }))
      f.closeDialogs()
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'Root draft' })
    } finally { await disposeRenderer(f.instance) }
  })
})

describe('blocking-dialog read-only help over TTY input', () => {
  it.each(['approval', 'question', 'plan'] as const)('returns from %s help with Esc without answering or changing the draft', async pane => {
    const f = fixture('Original draft')
    try {
      await f.instance.waitUntilRenderFlush()
      if (pane === 'approval') f.approval({ ...EMPTY_APPROVAL_PANE, open: true, toolName: 'bash' })
      if (pane === 'question') f.question({ ...EMPTY_ASK_USER_PANE, open: true, header: 'Choose', options: ['One', 'Two'] })
      if (pane === 'plan') f.plan({ open: true, plan: '# Plan' })
      await f.press(pane === 'question' ? '?' : '\x1bh')
      expect(f.output()).toContain('对话只读帮助')
      for (const key of ['\r', 'y', 'n', SHIFT_LEFT, paste('must not edit')]) await f.press(key)
      await f.press('\x1b')
      expect(f.actions).not.toHaveBeenCalled()
      f.clearOutput()
      f.closeDialogs()
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'Original draft' })
    } finally { await disposeRenderer(f.instance) }
  })

  it('opens read-only help with legacy Alt+H during custom-answer editing', async () => {
    const f = fixture('Original draft')
    try {
      await f.instance.waitUntilRenderFlush()
      f.question({ ...EMPTY_ASK_USER_PANE, open: true, editingCustom: true, header: 'Answer', customText: 'before', customCaretIndex: 6 })
      await f.press('\x1bh')
      expect(f.questionState().customText).toBe('before')
      expect(f.output()).toContain('对话只读帮助')
      expect(f.actions).not.toHaveBeenCalled()
    } finally { await disposeRenderer(f.instance) }
  })

  it('treats a plain question mark as text and preserves the custom answer in Alt+H help', async () => {
    const f = fixture('Original draft')
    try {
      await f.instance.waitUntilRenderFlush()
      f.question({ ...EMPTY_ASK_USER_PANE, open: true, editingCustom: true, header: 'Answer', customText: 'before', customCaretIndex: 6 })
      await f.press('?')
      expect(f.questionState().customText).toBe('before?')
      f.actions.mockClear()
      await f.press('\x1bh')
      expect(f.output()).toContain('对话只读帮助')
      await f.press(paste('must not edit'))
      await f.press('\r')
      await f.press('\x1b')
      expect(f.questionState().customText).toBe('before?')
      expect(f.actions).not.toHaveBeenCalled()
      f.closeDialogs()
      await f.press('\r')
      expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'Original draft' })
    } finally { await disposeRenderer(f.instance) }
  })
})

it('inserts a newline at the caret without an active selection and uses rebound composer actions', async () => {
  const f = fixture('ab中')
  try {
    await f.instance.waitUntilRenderFlush()
    await f.press(LEFT)
    await f.press('\x1b[13;2u')
    await f.press('\r')
    expect(f.actions).toHaveBeenCalledWith({ kind: 'send', text: 'ab\n中' })
    f.actions.mockClear()
    f.controller.getKeybindings = () => ({ 'toggle-reasoning': 'Ctrl+R' })
    await f.press('\x0f')
    expect(f.actions).not.toHaveBeenCalled()
    await f.press('\x12')
    expect(f.actions).toHaveBeenCalledWith({ kind: 'toggle-reasoning' })
  } finally { await disposeRenderer(f.instance) }
})
