/**
 * AgentHubPane chrome: empty copy, child rows, missing-service error,
 * inspect failure, and CSI escaping. Composes OverlayShell; not PlanReview.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render as renderInk, renderToString } from 'ink'
import { createElement } from 'react'
import { fakeTtyStdin, fakeTtyStdout, disposeRenderer } from './helpers.ts'
import { ScreenAtlas } from '../src/screen-atlas.ts'
import { wrapStdoutForFrameBg } from '../src/frame-fill.ts'
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
import { EMPTY_WORKSPACE_PANE } from '../src/workspace-pane.tsx'
import { EMPTY_FEEDBACK_PANE } from '../src/feedback-pane.tsx'
import { EMPTY_WORKFLOW_OVERLAY } from '../src/workflow-overlay.tsx'

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
    getWorkspacePane: () => EMPTY_WORKSPACE_PANE,
    getFeedbackPane: () => EMPTY_FEEDBACK_PANE,
    getWorkflowOverlay: () => EMPTY_WORKFLOW_OVERLAY,
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
    intakeClipboardImage: async () => ({ ok: false as const, reason: 'unsupported' }),
    intakeImagePath: async () => ({ ok: false as const, reason: 'unsupported' }),
    note: () => {},
    noteUserActivity: () => {},
  }
}

describe('AgentHubPane', () => {
  it('advertises human controls only for catalog rows with an explicit direct parent', () => {
    const out = render({ rows: [{ ...CHILD, mode: 'continuable', parentSessionId: SessionId('parent') }] })
    expect(out).toContain('c 续聊')
    expect(out).toContain('s 请求停止')
    expect(out).toContain('v 并排')
    expect(render({ rows: [CHILD] })).not.toContain('c 续聊')
  })

  it('shows the continuation draft and acceptance controls without exposing it as a sent message', () => {
    const out = render({ rows: [{ ...CHILD, mode: 'continuable', parentSessionId: SessionId('parent') }],
      prompt: '继续审查', caretIndex: 2, busy: true, notice: '等待回执', split: true })
    expect(out).toContain('继续审查')
    expect(out).toContain('发送中')
    expect(out).toContain('Enter 排队')
    expect(out).toContain('Ctrl+Enter 引导')
    expect(out).toContain('等待回执')
  })

  it('wraps transcript lines inside explicit half-width and height bounds', () => {
    const onViewportChange = vi.fn()
    const out = render({ rows: [CHILD], view: 'transcript', transcript: '中'.repeat(60),
      maxCols: 30, maxRows: 20, onViewportChange })
    expect(onViewportChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxOffset: expect.any(Number) }))
    const viewport = onViewportChange.mock.calls.at(-1)?.[0] as { maxOffset: number; pageRows: number }
    expect(viewport.maxOffset + viewport.pageRows).toBeGreaterThanOrEqual(5)
    const plain = out.replace(/\x1b\[[0-9;:?]*[A-Za-z]/gu, '')
    expect(plain.split('\n').some(line => line.includes('中'.repeat(20)))).toBe(false)
  })

  it('keeps a rejected continuation draft visible for correction', () => {
    const out = render({ rows: [{ ...CHILD, mode: 'continuable', parentSessionId: SessionId('parent') }],
      prompt: 'preserved draft', caretIndex: 3, error: 'parent unavailable' })
    expect(out).toContain('parent unavailable')
    expect(out).toContain('preserved draft')
    expect(out).toContain('Enter 排队')
  })

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
    expect(out).toContain('j/k 选择 · Enter 查看')
    expect(out).toContain('→ 子任务')
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
  it('renders a rich execution modal with header metrics, step trace, and scroll info', () => {
    const trace = [
      '> Read project files',
      '▸ glob {"pattern":"**/*.ts"}',
      '  └─ 3 files',
      '● Analysis complete',
    ].join('\n')
    const out = render({
      view: 'transcript',
      rows: [{ ...CHILD, tokens: 450, durationMs: 12_000, model: 'deepseek-flash' }],
      selectedIndex: 0,
      transcript: trace,
    })
    expect(out).toContain('[子代理] explorer')
    expect(out).toContain('状态: running')
    expect(out).toContain('子会话 ID · child-1')
    expect(out).toContain('─── 执行情况 ───')
    expect(out).toContain('Read project files')
    expect(out).toContain('glob')
    expect(out).toContain('3 files')
    expect(out).toContain('Analysis complete')
    expect(out).toContain('Esc 返回')
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

  it('paints live/max/depth and 已达上限 without replacing the child table', () => {
    const out = render({
      rows: [CHILD],
      selectedIndex: 0,
      liveContinuable: 8,
      maxActiveSubagents: 8,
      maxDepth: 1,
    })
    expect(out).toContain('explorer · running')
    expect(out).toContain('可继续 8/8 live · 深度 1 · 已达上限')
    expect(out).toContain('j/k 选择 · Enter 查看')
    expect(out).not.toContain('✗')
  })

  it('keeps empty chrome when limits are present', () => {
    const out = render({
      liveContinuable: 0,
      maxActiveSubagents: 8,
      maxDepth: 1,
    })
    expect(out).toContain('暂无子代理')
    expect(out).toContain('可继续 0/8 live · 深度 1')
    expect(out).toContain('Esc 关闭')
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

  it('passes continuable limits through the Hub snapshot', () => {
    applyTheme('truecolor')
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController({
          open: true,
          rows: [CHILD],
          selectedIndex: 0,
          liveContinuable: 8,
          maxActiveSubagents: 8,
          maxDepth: 1,
        }),
      }),
    )
    expect(out).toContain('可继续 8/8 live · 深度 1 · 已达上限')
    expect(out).toContain('explorer · running')
  })
})

it('shows bounded child task/progress rows around the current selection', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: SessionId(`bounded-child-${index}`), label: `Worker ${index}`, activity: 'running', hasChildren: false,
    task: 'Audit providers', summary: 'Reading package metadata', execution: '生成中',
  }))
  const out = render({ rows, selectedIndex: 20 })
  expect(out).toContain('Worker 20 · 生成中')
  expect(out).toContain('任务 · Audit providers')
  expect(out).toContain('当前 · Reading package metadata')
  expect(out).not.toContain('Worker 0 ·')
  expect(out.match(/子会话 ID/g)?.length).toBeLessThanOrEqual(5)
})

it('follows the live child tail, pages by visible rows, and pauses following while reading', async () => {
  let hub = { open: true, view: 'transcript', rows: [CHILD], selectedIndex: 0, scrollOffset: Number.MAX_SAFE_INTEGER,
    transcript: Array.from({ length: 1000 }, (_, i) => `PAGE_${String(i).padStart(4, '0')}`).join('\n'),
  } satisfies ReturnType<TuiController['getAgentHubPane']>
  const listeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const controller = stubController(hub)
  controller.getAgentHubPane = () => hub
  controller.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener) } }
  const dispatch = vi.fn((action: Parameters<TuiController['dispatch']>[0]) => {
    if (action.kind !== 'agent-hub-move') return
    hub = { ...hub, scrollOffset: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, hub.scrollOffset + action.delta)) }
    notify()
  })
  controller.dispatch = dispatch
  const stdout = Object.assign(fakeTtyStdout(), { isTTY: true, columns: 80, rows: 24 })
  const stdin = fakeTtyStdin()
  const atlas = new ScreenAtlas(80, 24)
  stdout.on('data', chunk => { atlas.feed(String(chunk)) })
  const screen = () => atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
  const visibleRows = () => [...screen().matchAll(/PAGE_(\d+)/g)].map(match => Number(match[1]))
  const instance = renderInk(createElement(TuiLoop, { title: 'Agent viewport', controller }), {
    stdout: wrapStdoutForFrameBg(stdout), stdin, exitOnCtrlC: false, patchConsole: false,
    interactive: true, alternateScreen: true, incrementalRendering: true,
  })
  try {
    await vi.waitFor(() => expect(screen()).toContain('PAGE_0999'))
    stdin.push('\x1b[1~')
    await vi.waitFor(() => expect(screen()).toContain('PAGE_0000'))
    const pageRows = visibleRows().length
    stdin.push('\x1b[6~')
    await vi.waitFor(() => expect(visibleRows()[0]).toBe(pageRows))
    stdin.push('\x1b[4~')
    await vi.waitFor(() => expect(hub.scrollOffset).toBe(Number.MAX_SAFE_INTEGER))
    hub = { ...hub, transcript: hub.transcript + '\nPAGE_1000' }
    notify()
    await vi.waitFor(() => expect(screen()).toContain('PAGE_1000'))
    stdin.push('\x1b[A')
    await vi.waitFor(() => expect(screen()).not.toContain('PAGE_1000'))
    expect(screen()).toContain('PAGE_0999')
    const readingStart = visibleRows()[0]
    hub = { ...hub, transcript: hub.transcript + '\nPAGE_1001' }
    notify()
    await vi.waitFor(() => expect(visibleRows()[0]).toBe(readingStart))
    expect(screen()).toContain('Esc 返回')
    expect(controller.getModel()).toBe(IDLE_MODEL)
    expect(dispatch.mock.calls.every(([action]) => action.kind === 'agent-hub-move')).toBe(true)
  } finally { await disposeRenderer(instance) }
})
