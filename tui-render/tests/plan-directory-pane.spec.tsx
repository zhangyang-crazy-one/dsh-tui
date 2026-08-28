/**
 * PlanDirectoryPane chrome: 开启/关闭 rows, current marker, switch failure,
 * unreadable status, and CSI escaping. Composes OverlayShell.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { PlanDirectoryPane } from '../src/plan-directory-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'
import { EMPTY_PLAN_DIRECTORY_PANE } from '../src/plan-directory-pane.tsx'

afterEach(() => {
  applyTheme('truecolor')
})

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  scrollOffset: 0,
  reasoningExpanded: false,
  toolCardsExpanded: false,
}

function render(
  overrides: Partial<Parameters<typeof PlanDirectoryPane>[0]> = {},
): string {
  applyTheme('truecolor')
  return renderToString(createElement(PlanDirectoryPane, overrides))
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

const OPEN_DIRECTORY = {
  open: true,
  selectedIndex: 0,
  currentActive: true,
} as const

function stubController(
  directory: ReturnType<TuiController['getPlanDirectoryPane']>,
): TuiController {
  return {
    getModel: () => IDLE_MODEL,
    getInteraction: () => 'idle',
    getBadge: () => '',
    getTitle: () => '',
    getSessionPane: () => CLOSED_SESSION,
    getSearchPane: () => CLOSED_SEARCH,
    getTimelineOpen: () => false,
    getModelPane: () => CLOSED_MODEL,
    getHelpPane: () => CLOSED_HELP,
    getApprovalPane: () => EMPTY_APPROVAL_PANE,
    getAskUserPane: () => EMPTY_ASK_USER_PANE,
    getPermissionPane: () => EMPTY_PERMISSION_PANE,
    getSettingsPane: () => EMPTY_SETTINGS_PANE,
    getAgentHubPane: () => EMPTY_OVERLAY_PANE,
    getPlanDirectoryPane: () => directory,
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
    getCwd: () => '/',
    listMentions: async () => [],
  }
}

describe('PlanDirectoryPane', () => {
  it('paints title 计划, both rows, and the exact footnote', () => {
    const out = render({ selectedIndex: 0, currentActive: true })
    expect(out).toContain('计划')
    expect(out).toContain('开启 · 当前')
    expect(out).toContain('关闭')
    expect(out).toContain('j/k 选择 · Enter 切换 · Esc 关闭')
    expect(out).toContain('\x1b[1m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m计划')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('marks 关闭 · 当前 when plan mode is inactive', () => {
    const out = render({ selectedIndex: 1, currentActive: false })
    expect(out).toContain('关闭 · 当前')
    expect(out).not.toContain('开启 · 当前')
    expect(out).toContain('\x1b[38;2;77;107;254m› ')
  })

  it('paints switch failure with retry copy and keeps the rows', () => {
    const out = render({
      selectedIndex: 0,
      currentActive: true,
      switchError: 'sandbox refused',
    })
    expect(out).toContain('开启 · 当前')
    expect(out).toContain('✗ 切换计划失败：sandbox refused')
    expect(out).toContain('当前模式保持不变 · 可重试')
    expect(out).toContain('j/k 选择 · Enter 切换 · Esc 关闭')
  })

  it('paints unreadable status without the two rows', () => {
    const out = render({ statusError: '会话未绑定' })
    expect(out).toContain('计划')
    expect(out).toContain('✗ 无法读取计划状态：会话未绑定')
    expect(out).toContain('Esc 关闭 · 可重试')
    expect(out).not.toContain('开启')
    expect(out).not.toContain('j/k 选择')
  })

  it('escapes CSI in the switch-error reason', () => {
    const out = render({ switchError: 'bad\x1b[2J' })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b')
    expect(out).toContain('✗ 切换计划失败：')
  })
})

describe('TuiLoop plan directory', () => {
  it('replaces children with PlanDirectoryPane and leaves input null', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController(OPEN_DIRECTORY),
      }),
    )
    expect(out).toContain('计划')
    expect(out).toContain('开启 · 当前')
    expect(out).toContain('关闭')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })

  it('keeps StreamView when the directory snapshot is closed', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController(EMPTY_PLAN_DIRECTORY_PANE),
      }),
    )
    expect(out).not.toContain('j/k 选择 · Enter 切换 · Esc 关闭')
  })
})
