/**
 * PlanReviewPane chrome: 计划评审, empty body, delivery failure, footnote,
 * CSI escaping, and no OverlayShell wrap. y/n labels stay host-side.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { PlanReviewPane, EMPTY_PLAN_REVIEW_PANE } from '../src/plan-review-pane.tsx'
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
  overrides: Partial<Parameters<typeof PlanReviewPane>[0]> = {},
): string {
  applyTheme('truecolor')
  return renderToString(createElement(PlanReviewPane, overrides))
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

const OPEN_REVIEW = {
  open: true,
  plan: '# 实现步骤\n1. 占用互斥',
} as const

function stubController(
  review: ReturnType<TuiController['getPlanReviewPane']>,
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
    getPlanDirectoryPane: () => EMPTY_PLAN_DIRECTORY_PANE,
    getWorkspacePane: () => EMPTY_OVERLAY_PANE,
    getFeedbackPane: () => EMPTY_OVERLAY_PANE,
    getWorkflowOverlay: () => EMPTY_OVERLAY_PANE,
    getPlanReviewPane: () => review,
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

describe('PlanReviewPane', () => {
  it('paints title 计划评审 and the exact footnote', () => {
    const out = render({ plan: '# 实现步骤\n1. 占用互斥' })
    expect(out).toContain('计划评审')
    expect(out).toContain('实现步骤')
    expect(out).toContain('批准')
    expect(out).toContain('继续规划')
    expect(out).toContain('y 批准 · n 继续规划 · Esc 取消')
    expect(out).toContain('\x1b[1m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m计划评审')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('paints 计划正文为空 when the plan has no body', () => {
    const out = render({ plan: '   ' })
    expect(out).toContain('计划评审')
    expect(out).toContain('计划正文为空')
    expect(out).toContain('y 批准 · n 继续规划 · Esc 取消')
  })

  it('paints delivery failure with retry copy', () => {
    const out = render({
      plan: '# x',
      deliveryError: 'channel closed',
    })
    expect(out).toContain('✗ 计划评审未能送达：channel closed')
    expect(out).toContain('当前计划未批准 · 可重试该轮')
    expect(out).not.toContain('实现步骤')
  })

  it('escapes CSI in the plan markdown so it does not reach the terminal raw', () => {
    const out = render({ plan: '# inject\x1b[2J' })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b')
  })
})

describe('TuiLoop plan-review', () => {
  it('occupies input with PlanReviewPane and keeps StreamView', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController(OPEN_REVIEW),
      }),
    )
    expect(out).toContain('计划评审')
    expect(out).toContain('y 批准 · n 继续规划 · Esc 取消')
    expect(out).toContain('有什么可以帮忙的')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })

  it('keeps the composer when the review snapshot is closed', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController(EMPTY_PLAN_REVIEW_PANE),
      }),
    )
    expect(out).not.toContain('y 批准 · n 继续规划 · Esc 取消')
    expect(out).toContain('\x1b[38;2;77;107;254m> ')
  })
})
