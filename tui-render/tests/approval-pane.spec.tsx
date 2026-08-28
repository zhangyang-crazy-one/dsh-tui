/**
 * ApprovalPane copy, details body, delivery failure, and CSI escaping.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ApprovalPane } from '../src/approval-pane.tsx'
import { applyTheme } from '../src/theme.ts'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import type { ViewModel } from '../src/projection.ts'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'

afterEach(() => {
  applyTheme('truecolor')
})

function render(
  overrides: Partial<Parameters<typeof ApprovalPane>[0]> = {},
): string {
  return renderToString(
    createElement(ApprovalPane, {
      toolName: 'bash',
      reason: 'escalate sandbox to workspace-write: push',
      arguments: '{"command":"git push"}',
      detailsOpen: false,
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
const OPEN_APPROVAL = {
  ...EMPTY_APPROVAL_PANE,
  open: true,
  toolName: 'bash',
  reason: 'need write',
  arguments: '{"command":"git push"}',
}

describe('ApprovalPane', () => {
  it('renders the waiting heading, tool name, and exact footnote', () => {
    const out = render()
    expect(out).toContain('等待审批')
    expect(out).toContain('bash')
    expect(out).toContain('允许一次')
    expect(out).toContain('拒绝')
    expect(out).toContain('详情')
    expect(out).toContain('y 允许一次 · n 拒绝 · i 详情')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('git push')
  })

  it('styles the heading bold fg rather than accent', () => {
    const out = render()
    expect(out).toContain('\x1b[1m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m等待审批')
  })

  it('opens details with the escaped reason and bash command', () => {
    const out = render({ detailsOpen: true })
    expect(out).toContain('escalate sandbox to workspace-write: push')
    expect(out).toContain('git push')
    expect(out).not.toContain('{"command":"git push"}')
  })

  it('falls back to the escaped raw arguments when JSON parse fails', () => {
    const out = render({
      detailsOpen: true,
      arguments: 'not-json',
    })
    expect(out).toContain('not-json')
  })

  it('omits an extra arguments line when JSON has no string command', () => {
    const object = render({
      detailsOpen: true,
      arguments: '{"path":"README.md"}',
    })
    expect(object).not.toContain('README.md')
    expect(object).toContain('escalate sandbox to workspace-write: push')
    const numeric = render({
      detailsOpen: true,
      arguments: '{"command":1}',
    })
    expect(numeric).not.toContain('"command":1')
    const jsonNull = render({
      detailsOpen: true,
      arguments: 'null',
    })
    expect(jsonNull).not.toContain('null')
    expect(jsonNull).toContain('escalate sandbox to workspace-write: push')
  })

  it('paints the delivery-failure pair and skips details', () => {
    const out = render({
      detailsOpen: true,
      deliveryError: 'timeout',
    })
    expect(out).toContain('✗ 审批未能送达：timeout')
    expect(out).toContain('当前工具未执行 · 可重试该轮')
    expect(out).not.toContain('escalate sandbox')
    expect(out).not.toContain('git push')
  })

  it('escapes CSI in name, reason, arguments, and delivery error', () => {
    const injected = render({
      toolName: '\x1b[2Jevil',
      reason: 'why\x1b[2J',
      arguments: '\x1b[2Jnot-json',
      detailsOpen: true,
    })
    expect(injected).not.toContain('\x1b[2J')
    expect(injected).toContain('\\x1b[2Jevil')
    expect(injected).toContain('why\\x1b[2J')
    expect(injected).toContain('\\x1b[2Jnot-json')
    const failed = render({
      deliveryError: 'boom\x1b[2J',
    })
    expect(failed).not.toContain('\x1b[2J')
    expect(failed).toContain('boom\\x1b[2J')
  })
})

describe('TuiLoop approval slot', () => {
  it('replaces the composer with ApprovalPane and keeps StreamView in children', () => {
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
      getApprovalPane: () => OPEN_APPROVAL,
      getAskUserPane: () => EMPTY_ASK_USER_PANE,
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
    expect(out).toContain('等待审批')
    expect(out).toContain('y 允许一次 · n 拒绝 · i 详情')
    expect(out).toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })
})
