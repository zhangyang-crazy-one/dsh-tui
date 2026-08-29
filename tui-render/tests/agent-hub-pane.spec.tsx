/**
 * AgentHubPane chrome: empty copy, child rows, missing-service error,
 * inspect failure, and CSI escaping. Composes OverlayShell; not PlanReview.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AgentHubPane } from '../src/agent-hub-pane.tsx'
import type { AgentHubRow } from '../src/agent-hub-pane.tsx'
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

const CHILD: AgentHubRow = {
  id: SessionId('child-1'),
  label: 'explorer',
  activity: 'running',
  hasChildren: false,
}

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  reasoningExpanded: false,
  toolCardsExpanded: false,
}

function render(
  overrides: Partial<Parameters<typeof AgentHubPane>[0]> = {},
): string {
  applyTheme('truecolor')
  return renderToString(createElement(AgentHubPane, overrides))
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

function stubController(
  hub: ReturnType<TuiController['getAgentHubPane']>,
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
    getAgentHubPane: () => hub,
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
    getCwd: () => '/',
    listMentions: async () => [],
  }
}

describe('AgentHubPane', () => {
  it('paints title 子代理 and empty copy when the list is empty', () => {
    const out = render()
    expect(out).toContain('子代理')
    expect(out).toContain('暂无子代理')
    expect(out).toContain('Esc 关闭 · 有运行中的子代理时再打开')
    expect(out).toContain('\x1b[1m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m子代理')
    expect(out).not.toContain('计划评审')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('paints an escaped running-child row and the table footnote', () => {
    const out = render({ rows: [CHILD], selectedIndex: 0 })
    expect(out).toContain('explorer · running')
    expect(out).toContain('子会话 ID · child-1')
    expect(out).toContain('j/k 选择 · Enter 查看 · Esc 关闭')
    expect(out).toContain('\x1b[38;2;77;107;254m› ')
  })

  it('renders the full child id independently from the label', () => {
    const out = render({
      rows: [{
        id: SessionId('child-2'),
        label: 'explorer',
        activity: 'running',
        hasChildren: false,
      }],
      selectedIndex: 0,
    })
    expect(out).toContain('子会话 ID · child-2')
    expect(out).not.toContain('子会话 ID · explorer')
  })

  it('renders unselected and selected rows including an empty activity', () => {
    const out = render({
      rows: [
        { ...CHILD, id: SessionId('child-a'), activity: '' },
        { ...CHILD, id: SessionId('child-b'), label: 'worker' },
      ],
      selectedIndex: 1,
    })
    expect(out).toContain('子会话 ID · child-a')
    expect(out).toContain('worker · running')
  })

  it('renders authoritative metrics and an omission-safe aggregate', () => {
    const out = render({
      rows: [
        {
          ...CHILD,
          contextPercent: 42,
          tokens: 18_200,
          durationMs: 12_000,
          model: 'deepseek-chat',
        },
        {
          ...CHILD,
          id: SessionId('child-2'),
          label: 'reviewer',
          activity: 'inactive',
          contextPercent: 18,
          tokens: 4_100,
          durationMs: 8_000,
        },
      ],
    })
    expect(out).toContain('explorer · running · ctx 42% · 18.2K tok · 12s · deepseek-chat')
    expect(out).toContain('Σ 子代理 2 · tokens 22.3K · 耗时 20s · 已知 2/2')
  })

  it('omits unknown metric segments without rendering zeroes', () => {
    const out = render({
      rows: [
        { ...CHILD, tokens: 1_200 },
        { ...CHILD, id: SessionId('child-2'), label: 'unknown' },
      ],
    })
    expect(out).toContain('Σ 子代理 2 · tokens 1.2K · 已知 1/2')
    expect(out).not.toContain('耗时 0s')
    expect(out).not.toContain('ctx 0%')
  })

  it('renders a filtered transcript and table-list failure', () => {
    const transcript = render({
      view: 'transcript',
      transcript: 'first\n\nsecond',
    })
    expect(transcript).toContain('first')
    expect(transcript).toContain('second')
    expect(transcript).toContain('Esc 返回')
    expect(render({ view: 'transcript' })).toContain('Esc 返回')

    const failed = render({ error: 'list failed' })
    expect(failed).toContain('✗ list failed')
    expect(failed).toContain('可重试')
  })

  it('paints inspect failure with Esc 返回列表', () => {
    const out = render({
      view: 'transcript',
      error: '无法读取子会话：gone',
    })
    expect(out).toContain('✗ 无法读取子会话：')
    expect(out).toContain('Esc 返回列表')
    expect(out).not.toContain('暂无子代理')
  })

  it('paints missing-service chrome', () => {
    const out = render({ missing: true })
    expect(out).toContain('✗ 子代理服务未组合')
    expect(out).toContain('Esc 关闭')
    expect(out).not.toContain('暂无子代理')
  })

  it('escapes CSI in the child label so it does not reach the terminal raw', () => {
    const out = render({
      rows: [{
        id: SessionId('child-\x1b[2J'),
        label: 'x\x1b[2J',
        activity: 'running',
        hasChildren: false,
      }],
    })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b')
    expect(out).toContain('子会话 ID · child-\\x1b[2J')
  })
})

describe('TuiLoop Agent Hub', () => {
  it('replaces children with AgentHubPane empty chrome, not PlanReview', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController({ open: true }),
      }),
    )
    expect(out).toContain('子代理')
    expect(out).toContain('暂无子代理')
    expect(out).not.toContain('计划评审')
    expect(out).not.toContain('\x1b[38;2;77;107;254m> ')
  })

  it('paints missing-service chrome from the Hub snapshot', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController({ open: true, missing: true }),
      }),
    )
    expect(out).toContain('✗ 子代理服务未组合')
  })
})
