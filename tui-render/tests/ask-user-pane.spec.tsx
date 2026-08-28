/**
 * AskUserPane copy: numbered labels, focus prefix, zero-option error, CSI
 * escaping, and TuiLoop composer occupancy.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { AskUserPane, EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'

afterEach(() => {
  applyTheme('truecolor')
})

const LABELS = ['仅 patch', 'minor', '取消发布'] as const

function render(
  overrides: Partial<Parameters<typeof AskUserPane>[0]> = {},
): string {
  return renderToString(
    createElement(AskUserPane, {
      header: '选择发布策略',
      options: [...LABELS],
      selectedIndex: 0,
      ...overrides,
    }),
  )
}

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  scrollOffset: 0,
  reasoningExpanded: false,
  toolCardsExpanded: false,
}
const GENERATING_MODEL: ViewModel = {
  ...IDLE_MODEL,
  status: 'generating',
}
const CLOSED_SESSION = {
  rows: [] as const,
  selectedIndex: 0,
  open: false,
  confirmDelete: false,
  deleteUnavailable: false,
  currentId: undefined,
}
const CLOSED_SEARCH = {
  query: '',
  results: [] as const,
  selectedIndex: 0,
  open: false,
  status: 'idle' as const,
}
const CLOSED_MODEL = {
  open: false,
  filter: '',
  rows: [] as const,
  selectedIndex: 0,
  status: 'idle' as const,
}
const CLOSED_HELP = { open: false, lines: [] as const }
const OPEN_ASK = {
  open: true,
  header: '选择发布策略',
  options: [...LABELS],
  selectedIndex: 0,
}

describe('AskUserPane', () => {
  it('omits an empty optional header while retaining options', () => {
    const out = render({ header: '', options: ['A'], selectedIndex: 0 })
    expect(out).toContain('1 A')
  })
  it('renders the header, numbered labels, focus prefix, and exact footnote', () => {
    const out = render()
    expect(out).toContain('选择发布策略')
    expect(out).toContain('1 仅 patch')
    expect(out).toContain('2 minor')
    expect(out).toContain('3 取消发布')
    expect(out).toContain('› ')
    expect(out).toContain('\x1b[38;2;77;107;254m')
    expect(out).toContain('↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Submit')
  })

  it('keeps numbered rows past nine with the same footnote', () => {
    const options = Array.from({ length: 10 }, (_, index) => `opt-${index + 1}`)
    const out = render({ options, selectedIndex: 0 })
    expect(out).toContain('↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问')
    expect(out).toContain('10 opt-10')
  })

  it('paints the invalid heading instead of an empty list', () => {
    const out = render({ header: 'ignored', options: [], selectedIndex: 0 })
    expect(out).toContain('✗ 提问无效')
    expect(out).toContain('Esc 取消')
    expect(out).not.toContain('ignored')
    expect(out).not.toContain('1-9 选择')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
  })

  it('escapes CSI in the header and labels', () => {
    const out = render({
      header: 'ask \x1b[2J',
      options: ['safe', 'inject \x1b[2J bad'],
      selectedIndex: 1,
    })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('ask')
    expect(out).toContain('2 inject')
  })
})

describe('TuiLoop ask-user slot', () => {
  it('replaces the composer with AskUserPane and keeps StreamView in children', () => {
    const controller: TuiController = {
      getModel: () => IDLE_MODEL,
      getInteraction: () => 'idle',
      getBadge: () => 'provider',
      getTitle: () => '会话',
      getSessionPane: () => CLOSED_SESSION,
      getSearchPane: () => CLOSED_SEARCH,
      getTimelineOpen: () => false,
      getModelPane: () => CLOSED_MODEL,
      getHelpPane: () => CLOSED_HELP,
      getApprovalPane: () => EMPTY_APPROVAL_PANE,
      getAskUserPane: () => OPEN_ASK,
      getPermissionPane: () => EMPTY_PERMISSION_PANE,
      getSettingsPane: () => EMPTY_SETTINGS_PANE,
      getAgentHubPane: () => EMPTY_OVERLAY_PANE,
      getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
      getWorkspacePane: () => EMPTY_OVERLAY_PANE,
      getFeedbackPane: () => EMPTY_OVERLAY_PANE,
      getWorkflowOverlay: () => EMPTY_OVERLAY_PANE,
      getPlanReviewPane: () => EMPTY_OVERLAY_PANE,
      getComposerHud: () => undefined,
      getToolPresenters: () => undefined,
      getSubmitOnEnter: () => true,
      getFeedback: () => undefined,
      subscribe: () => () => {},
      dispatch: () => {},
      commands: [],
      getCwd: () => '/workspace',
      listMentions: async () => [],
    }
    const out = renderToString(
      createElement(TuiLoop, { title: 't', controller }),
    )
    expect(out).toContain('选择发布策略')
    expect(out).toContain('1 仅 patch')
    expect(out).toContain('↑↓/jk 移动 · 1-9 选择 · Enter 作答 · Esc 取消提问')
    expect(out).toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
    expect(EMPTY_ASK_USER_PANE.open).toBe(false)
  })

  it('omits the generating / @ hint while AskUserPane occupies the composer', () => {
    const controller: TuiController = {
      getModel: () => GENERATING_MODEL,
      getInteraction: () => 'generating',
      getBadge: () => 'provider',
      getTitle: () => '会话',
      getSessionPane: () => CLOSED_SESSION,
      getSearchPane: () => CLOSED_SEARCH,
      getTimelineOpen: () => false,
      getModelPane: () => CLOSED_MODEL,
      getHelpPane: () => CLOSED_HELP,
      getApprovalPane: () => EMPTY_APPROVAL_PANE,
      getAskUserPane: () => OPEN_ASK,
      getPermissionPane: () => EMPTY_PERMISSION_PANE,
      getSettingsPane: () => EMPTY_SETTINGS_PANE,
      getAgentHubPane: () => EMPTY_OVERLAY_PANE,
      getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
      getWorkspacePane: () => EMPTY_OVERLAY_PANE,
      getFeedbackPane: () => EMPTY_OVERLAY_PANE,
      getWorkflowOverlay: () => EMPTY_OVERLAY_PANE,
      getPlanReviewPane: () => EMPTY_OVERLAY_PANE,
      getComposerHud: () => undefined,
      getSubmitOnEnter: () => true,
      getFeedback: () => undefined,
      subscribe: () => () => {},
      dispatch: () => {},
      commands: [],
      getCwd: () => '/workspace',
      listMentions: async () => [],
    }
    const out = renderToString(
      createElement(TuiLoop, { title: 't', controller }),
    )
    expect(out).toContain('⏹ Ctrl+C 停止')
    expect(out).not.toContain('/ 命令')
    expect(out).not.toContain('@ 提及')
    expect(out).toContain('↑↓/jk 移动')
  })
})
