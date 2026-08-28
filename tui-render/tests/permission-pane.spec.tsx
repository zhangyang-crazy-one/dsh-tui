/**
 * PermissionPane copy: three host rows, current marker, danger confirm, empty
 * table, switch failure, and CSI escaping.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import {
  PermissionPane,
} from '../src/permission-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'

afterEach(() => {
  applyTheme('truecolor')
})

const HOST_NAMES = ['read-only', 'workspace-write', 'danger-full-access'] as const

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  scrollOffset: 0,
  reasoningExpanded: false,
  toolCardsExpanded: false,
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
const OPEN_PERMISSION = {
  open: true,
  names: [...HOST_NAMES],
  selectedIndex: 1,
  currentName: 'workspace-write',
  confirmDanger: false,
}

function render(
  overrides: Partial<Parameters<typeof PermissionPane>[0]> = {},
): string {
  return renderToString(
    createElement(PermissionPane, {
      names: HOST_NAMES,
      selectedIndex: 1,
      currentName: 'workspace-write',
      confirmDanger: false,
      ...overrides,
    }),
  )
}

describe('PermissionPane', () => {
  it('renders the heading, three host keys including read-only, and exact footnote', () => {
    const out = render()
    expect(out).toContain('权限预设')
    expect(out).toContain('read-only')
    expect(out).toContain('workspace-write · 当前')
    expect(out).toContain('danger-full-access')
    expect(out).toContain('↑↓/jk 选择 · 1-3 直达 · Enter 应用 · Esc 关闭')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
    expect(out).not.toContain('Submit')
  })

  it('styles the heading bold fg rather than accent', () => {
    const out = render()
    expect(out).toContain('\x1b[1m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m权限预设')
  })

  it('marks the selected row with an accent prefix', () => {
    const out = render({ selectedIndex: 2, currentName: 'read-only' })
    expect(out).toContain('› ')
    expect(out).toContain('\x1b[38;2;77;107;254m')
    expect(out).toContain('danger-full-access')
  })

  it('replaces the list with the exact danger confirm copy', () => {
    const out = render({ confirmDanger: true })
    expect(out).toContain('确认切换到 danger-full-access？')
    expect(out).toContain('再按 Enter 确认 · Esc 取消')
    expect(out).not.toContain('权限预设')
    expect(out).not.toContain('↑↓/jk 选择')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
  })

  it('paints title and error when the host table is empty', () => {
    const out = render({ names: [], selectedIndex: 0, currentName: '' })
    expect(out).toContain('权限预设')
    expect(out).toContain('✗ 切换权限失败：无可用预设')
    expect(out).toContain('当前预设保持不变 · 可重试')
    expect(out).not.toContain('DeepSeek')
    expect(out).not.toContain('有什么可以帮忙的')
  })

  it('escapes CSI in descriptions and switch-failure reasons', () => {
    const out = render({
      descriptions: ['safe', 'inject \x1b[2J bad', undefined],
      switchError: 'fail \x1b[2J',
    })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('✗ 切换权限失败：fail')
    expect(out).toContain('当前预设保持不变 · 可重试')
  })
})

describe('TuiLoop permission overlay', () => {
  it('replaces children with PermissionPane and leaves the composer empty', () => {
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
      getAskUserPane: () => EMPTY_ASK_USER_PANE,
      getPermissionPane: () => OPEN_PERMISSION,
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
    expect(out).toContain('权限预设')
    expect(out).toContain('read-only')
    expect(out).toContain('workspace-write · 当前')
    expect(out).toContain('↑↓/jk 选择 · 1-3 直达 · Enter 应用 · Esc 关闭')
    expect(out).not.toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })
})
