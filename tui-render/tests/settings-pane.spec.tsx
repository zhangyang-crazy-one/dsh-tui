/**
 * SettingsPane copy: heading, host field row, footnotes, empty table,
 * update failure, and CSI escaping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToString, useWindowSize } from 'ink'
import { createElement } from 'react'
import {
  EMPTY_SETTINGS_PANE,
  SettingsPane,
} from '../src/settings-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'

vi.mock('ink', async importOriginal => ({
  ...await importOriginal<typeof import('ink')>(),
  useWindowSize: vi.fn(() => ({ columns: 80, rows: 24 })),
}))

afterEach(() => {
  applyTheme('truecolor')
})

const DEEPSEEK_ROW = {
  namespace: 'llm-deepseek',
  field: 'baseURL',
  value: 'https://api.deepseek.com',
}

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
const OPEN_SETTINGS = {
  open: true,
  rows: [DEEPSEEK_ROW],
  selectedIndex: 0,
  editing: false,
}
const OPEN_SETTINGS_EDITING = {
  ...OPEN_SETTINGS,
  editing: true,
}

function render(
  overrides: Partial<Parameters<typeof SettingsPane>[0]> = {},
): string {
  return renderToString(
    createElement(SettingsPane, {
      rows: [DEEPSEEK_ROW],
      selectedIndex: 0,
      editing: false,
      ...overrides,
    }),
  )
}

describe('SettingsPane', () => {
  it('renders the heading, host field row, and exact browse footnote', () => {
    const out = render()
    expect(out).toContain('设置')
    expect(out).toContain('llm-deepseek · baseURL')
    expect(out).toContain('https://api.deepseek.com')
    expect(out).toContain('↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭')
    expect(out).toContain('\x1b[38;2;77;107;254m› ')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('renders first-run copy in onboarding mode', () => {
    const out = render({
      onboarding: true,
      editing: true,
      rows: [{ namespace: 'credentials', field: 'DEEPSEEK_API_KEY', value: '' }],
    })
    expect(out).toContain('首次设置')
    expect(out).toContain('credentials · DEEPSEEK_API_KEY')
    expect(out).toContain('Enter 保存 · Esc 跳过')
    expect(out).not.toContain('↑↓/jk 选择')
  })

  it('windows long catalogs around the selected row', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      namespace: 'llm-deepseek',
      field: `field${String(index)}`,
      value: `value-${String(index)}`,
    }))
    const out = render({ rows, selectedIndex: 0 })
    expect(out).toContain('llm-deepseek · field0')
    expect(out).toContain('llm-deepseek · field7')
    expect(out).not.toContain('llm-deepseek · field8')
    expect(out).toContain('… 还有 4 项')
    const scrolled = render({
      rows: [
        ...rows,
        { namespace: 'llm-deepseek', field: 'long', value: 'x'.repeat(90) },
      ],
      selectedIndex: 12,
    })
    expect(scrolled).toContain('… 还有 5 项')
    expect(scrolled).toContain('llm-deepseek · long')
    expect(scrolled).toContain('xxxxx')
    expect(scrolled).not.toContain('x'.repeat(90))
    expect(scrolled).not.toContain('llm-deepseek · field0')
  })

  it('marks only the selected row with the accent prefix', () => {
    const out = render({
      rows: [
        DEEPSEEK_ROW,
        { namespace: 'llm-deepseek', field: 'models', value: '[]' },
      ],
      selectedIndex: 1,
    })
    expect(out).toContain('llm-deepseek · models')
    expect(out).toContain('\x1b[38;2;77;107;254m› ')
  })

  it('switches the footnote while editing', () => {
    const out = render({ editing: true })
    expect(out).toContain('Enter 应用 · Esc 取消')
    expect(out).not.toContain('↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭')
  })

  it('paints the empty-table reason when no rows exist', () => {
    const out = render({ rows: [] })
    expect(out).toContain('无可用设置')
    expect(out).not.toContain('✗ 更新失败')
  })

  it('paints the update-failure pair', () => {
    const out = render({ updateError: 'unreadable' })
    expect(out).toContain('✗ 更新失败：unreadable')
    expect(out).toContain('当前值保持不变 · 可重试')
  })

  it('escapes CSI in the field value and failure reason', () => {
    const out = render({
      rows: [{ namespace: 'llm-deepseek', field: 'baseURL', value: 'https://x\x1b[2J' }],
      updateError: 'boom\x1b[2J',
    })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('https://x')
    expect(out).toContain('boom')
  })

  it('handles fallback, zero-value, and ellipsis-only width budgets', () => {
    vi.mocked(useWindowSize).mockReturnValueOnce({ columns: 0, rows: 24 })
    expect(render()).toContain('https://api.deepseek.com')

    vi.mocked(useWindowSize).mockReturnValueOnce({ columns: 10, rows: 24 })
    const zeroBudget = render()
    expect(zeroBudget).toContain('llm-deepseek · baseURL')
    expect(zeroBudget).not.toContain('https://api.deepseek.com')

    vi.mocked(useWindowSize).mockReturnValueOnce({ columns: 27, rows: 24 })
    expect(render()).toContain('…')
  })
})

describe('TuiLoop settings overlay', () => {
  it('replaces children with SettingsPane and leaves the composer empty', () => {
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
      getPermissionPane: () => EMPTY_PERMISSION_PANE,
      getSettingsPane: () => OPEN_SETTINGS,
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
    expect(out).toContain('设置')
    expect(out).toContain('llm-deepseek · baseURL')
    expect(out).toContain('↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭')
    expect(out).not.toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
    expect(EMPTY_SETTINGS_PANE.open).toBe(false)
  })

  it('keeps the composer while editing a settings field', () => {
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
      getPermissionPane: () => EMPTY_PERMISSION_PANE,
      getSettingsPane: () => OPEN_SETTINGS_EDITING,
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
    expect(out).toContain('设置')
    expect(out).toContain('Enter 应用 · Esc 取消')
    expect(out).toContain('\x1b[38;2;77;107;254m> ')
    expect(out).not.toContain('有什么可以帮忙的')
  })
})
