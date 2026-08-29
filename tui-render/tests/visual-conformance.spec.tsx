/**
 * Visual conformance (03-10 W3-T7): renderToString assertions over the
 * shipped DeepSeek visual contract — the thin separator and the dynamic title
 * hierarchy, the centered bounded conversation column with its 2/1 blank-row
 * rhythm and the PITFALLS L1 narrow-screen full-width fallback, the
 * four-tier theme mapping with the `none` fallback, the frame bg/fg wiring
 * (every shell row painted through the bg token, body text on fg, the
 * accent bold/普通/accentDim brightness matrix on the current turn), the
 * semantic accent/success/error SGR with A3 glyph+copy redundancy and
 * escaped user content, markdown tier mapping, and the status hint/copy.
 * Assertions target the contract (tier SGR bytes, locked copy, glyphs, row
 * rhythm) rather than absolute spacing that would depend on the terminal
 * width; the windowed render structure and frame-stats semantics are not
 * part of this surface (SC4 owns them).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { Text } from 'ink'
import { AppShell } from '../src/app-shell.tsx'
import { StreamView, conversationWidth } from '../src/stream-view.tsx'
import { MarkdownBlock } from '../src/markdown.tsx'
import { TuiLoop, feedbackLine, STATUS_HINT, statusSlot } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import { SessionPane } from '../src/session-pane.tsx'
import { applyTheme, paintRow, styled } from '../src/theme.ts'
import { setHyperlinks } from '../src/hyperlink.ts'
import type { ViewModel } from '../src/projection.ts'
import type { SearchPaneState } from '../src/search-pane.tsx'
import type { ModelPaneState } from '../src/model-pane.tsx'
import type { HelpPaneState } from '../src/help-pane.tsx'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'

/** Strip SGR sequences so content-level assertions ignore tier bytes. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

afterEach(() => {
  applyTheme('truecolor')
  setHyperlinks(false)
})

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  reasoningExpanded: false,
  toolCardsExpanded: false,
}
const EMPTY_PANE = {
  rows: [],
  selectedIndex: 0,
  open: false,
  confirmDelete: false,
  deleteUnavailable: false,
  currentId: undefined,
}
const EMPTY_SEARCH: SearchPaneState = {
  query: '',
  results: [],
  selectedIndex: 0,
  open: false,
  status: 'idle',
}
const EMPTY_MODEL_PANE: ModelPaneState = {
  open: false,
  filter: '',
  rows: [],
  selectedIndex: 0,
  status: 'idle',
}
const EMPTY_HELP_PANE: HelpPaneState = {
  open: false,
  lines: [],
}

/** A minimal controller stub; the loop renders it in renderToString mode. */
function stubController(
  overrides: Partial<TuiController> = {},
): TuiController {
  return {
    getModel: () => IDLE_MODEL,
    getInteraction: () => 'idle',
    getBadge: () => 'provider · model',
    getTitle: () => '',
    getSessionPane: () => EMPTY_PANE,
    getSearchPane: () => EMPTY_SEARCH,
    getTimelineOpen: () => false,
    getModelPane: () => EMPTY_MODEL_PANE,
    getHelpPane: () => EMPTY_HELP_PANE,
    getApprovalPane: () => EMPTY_APPROVAL_PANE,
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
    ...overrides,
  }
}

function renderStream(model: ViewModel): string {
  return renderToString(
    createElement(StreamView, {
      model,
    }),
  )
}

function renderMarkdown(source: string): string {
  return renderToString(createElement(MarkdownBlock, { source }))
}

describe('AppShell frame', () => {
  it('draws a thin full-width separator under the title row (L5 thin-only)', () => {
    const out = renderToString(
      createElement(AppShell, {
        title: '会话',
        badge: 'provider · model',
        children: createElement(Text, null, 'body'),
      }),
    )
    // renderToString reports the default 80-column window.
    expect(out).toContain('─'.repeat(80))
    expect(out).not.toContain('═')
    expect(out).not.toContain('║')
    expect(out).not.toContain('┌')
    expect(out).not.toContain('└')
  })

  it('keeps the title and badge above the separator', () => {
    const out = renderToString(
      createElement(AppShell, {
        title: 'top',
        badge: 'provider · model',
        children: null,
      }),
    )
    expect(out.indexOf('top')).toBeGreaterThanOrEqual(0)
    expect(out.indexOf('top')).toBeLessThan(out.indexOf('─'.repeat(80)))
    expect(out).toContain('provider · model')
  })
})

describe('dynamic title hierarchy', () => {
  it('replaces the fixed app-name fallback with the live session title', () => {
    const out = renderToString(
      createElement(TuiLoop, {
        title: 'deepseek-tui',
        controller: stubController({ getTitle: () => '当前会话' }),
      }),
    )
    expect(out).toContain('当前会话')
    expect(out).not.toContain('deepseek-tui')
  })

  it('shows the fixed app name before a session binds a title', () => {
    const out = renderToString(
      createElement(TuiLoop, {
        title: 'deepseek-tui',
        controller: stubController({ getTitle: () => '' }),
      }),
    )
    expect(out).toContain('deepseek-tui')
  })
})

describe('conversation column', () => {
  it('uses near-full width on wide terminals', () => {
    expect(conversationWidth(80)).toBe(76)
    expect(conversationWidth(120)).toBe(116)
    expect(conversationWidth(123)).toBe(119)
    expect(conversationWidth(200)).toBe(196)
    expect(conversationWidth(1)).toBe(1)
  })

  it('never collapses to zero columns', () => {
    expect(conversationWidth(0)).toBe(1)
    expect(conversationWidth(10)).toBe(10)
    expect(conversationWidth(39)).toBe(39)
    expect(conversationWidth(40)).toBe(36)
    expect(conversationWidth(79)).toBe(75)
  })

  it('centers user and assistant rows and keeps two blank rows between blocks', () => {
    const history: ViewModel['history'] = [
      { id: 1, kind: 'user', text: 'hello', timestamp: 1_000 },
      { id: 2, kind: 'assistant', text: 'world', timestamp: 2_000 },
    ]
    const out = renderStream({
      history,
      activeTurn: undefined,
      status: 'idle',
      reasoningExpanded: false,
      toolCardsExpanded: false,
    })
    const lines = out.split('\n')
    const userIndex = lines.findIndex(line =>
      stripAnsi(line).includes('> hello'),
    )
    const assistantIndex = lines.findIndex(line =>
      stripAnsi(line).includes('● world'),
    )
    const userPlain = stripAnsi(lines[userIndex] ?? '')
    const assistantPlain = stripAnsi(lines[assistantIndex] ?? '')
    const userLead = userPlain.length - userPlain.trimStart().length
    const assistantLead = assistantPlain.length - assistantPlain.trimStart().length
    expect(userLead).toBe(assistantLead)
    expect(userLead).toBe(Math.ceil((80 - conversationWidth(80)) / 2))
    expect(userPlain.trim()).toBe('> hello')
    expect(assistantPlain.trim()).toBe('● world')
    // Exactly two blank rows between message blocks (02-UI-SPEC §1.2 T2).
    expect(assistantIndex - userIndex).toBe(3)
  })

  it('keeps one blank row inside the active turn', () => {
    const out = renderStream({
      history: [],
      activeTurn: {
        turn: 1,
        assistantText: 'answer',
        reasoningText: 'deep',
        toolCalls: [],
        reasoningDurationMs: 100,
      },
      status: 'idle',
      reasoningExpanded: false,
      toolCardsExpanded: false,
    })
    const lines = out.split('\n')
    expect(
      lines.findIndex(line => line.includes('answer')) -
        lines.findIndex(line => line.includes('✻ 思考 (0.1s)')),
    ).toBe(2)
  })
})

describe('theme tiers', () => {
  it('maps semantic tokens through truecolor, 256, 16, and none', () => {
    expect(styled('x', 'accent', 'truecolor')).toBe(
      '\x1b[38;2;77;107;254mx\x1b[0m',
    )
    expect(styled('x', 'success', '256')).toBe('\x1b[38;5;40mx\x1b[0m')
    expect(styled('x', 'error', '16')).toBe('\x1b[31mx\x1b[0m')
    expect(styled('x', 'codeBg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'accent', 'none')).toBe('x')
  })

  it('maps the bg/fg pair through all four tiers as the only color source', () => {
    expect(styled('x', 'bg', 'truecolor')).toBe('\x1b[48;2;0;0;0mx\x1b[0m')
    expect(styled('x', 'bg', '256')).toBe('\x1b[48;5;16mx\x1b[0m')
    expect(styled('x', 'bg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'bg', 'none')).toBe('x')
    expect(styled('x', 'fg', 'truecolor')).toBe(
      '\x1b[38;2;247;247;248mx\x1b[0m',
    )
    expect(styled('x', 'fg', '256')).toBe('\x1b[38;5;255mx\x1b[0m')
    expect(styled('x', 'fg', '16')).toBe('\x1b[37mx\x1b[0m')
    expect(styled('x', 'fg', 'none')).toBe('x')
  })

  it('keeps the accent brightness tiers (bold/normal/accentDim) paired', () => {
    expect(styled('x', 'accent', '16', true)).toBe('\x1b[1m\x1b[94mx\x1b[0m')
    expect(styled('x', 'accent', 'truecolor', true)).toBe(
      '\x1b[1m\x1b[38;2;77;107;254mx\x1b[0m',
    )
    expect(styled('x', 'accent', '256', true)).toBe('\x1b[1m\x1b[38;5;69mx\x1b[0m')
    expect(styled('x', 'accent', 'none', true)).toBe('x')
    expect(styled('x', 'accentDim', '16')).toBe('\x1b[34mx\x1b[0m')
    expect(styled('x', 'accentDim', 'truecolor')).toBe(
      '\x1b[38;2;52;65;91mx\x1b[0m',
    )
    expect(styled('x', 'accentDim', '256')).toBe('\x1b[38;5;60mx\x1b[0m')
    expect(styled('x', 'accentDim', 'none')).toBe('x')
  })

  it('paints rows through the bg strip with one paired reset per part', () => {
    applyTheme('16')
    const row = paintRow([styled('> ', 'fgDim'), styled('hi', 'fg')])
    expect(row).toBe(
      '\x1b[40m\x1b[90m> \x1b[0m\x1b[0m\x1b[40m\x1b[37mhi\x1b[0m\x1b[0m',
    )
    // none: the painted row is the joined plain text (A3 readable).
    applyTheme('none')
    expect(paintRow([styled('> ', 'fgDim'), styled('hi', 'fg')])).toBe('> hi')
  })

  it('degrades the whole frame to plain text at none while keeping glyphs and copy', () => {
    applyTheme('none')
    const shell = renderToString(
      createElement(AppShell, {
        title: 't',
        badge: 'b',
        children: createElement(Text, null, 'body'),
      }),
    )
    expect(shell).not.toContain('\x1b')
    expect(shell).toContain('─'.repeat(80))

    const stream = renderStream({
      history: [{ kind: 'user', text: 'hi', timestamp: 1_000 }],
      activeTurn: undefined,
      status: 'idle',
      reasoningExpanded: false,
      toolCardsExpanded: false,
    })
    expect(stream).not.toContain('\x1b')
    expect(stream).toContain('> hi')

    const markdown = renderMarkdown('```ts\nconst x = 1\n```')
    expect(markdown).not.toContain('\x1b')
    expect(markdown).toContain('const x = 1')

    expect(statusSlot('generating')).toBe(
      '⏹ Ctrl+C 停止 · ↑↓/jk 滚动',
    )
  })
})

describe('frame bg/fg wiring', () => {
  const TIER_BG: Record<string, string> = {
    truecolor: '\x1b[48;2;0;0;0m',
    '256': '\x1b[48;5;16m',
    '16': '\x1b[40m',
  }

  it('paints every shell row through the bg token at each tier', () => {
    for (const tier of ['truecolor', '256', '16'] as const) {
      applyTheme(tier)
      const out = renderToString(
        createElement(AppShell, {
          title: '会话',
          badge: 'provider · model',
          children: createElement(Text, null, 'body'),
        }),
      )
      // The title row, separator row, and badge run all carry the bg strip.
      expect(out).toContain(TIER_BG[tier])
      expect(out).toContain('─'.repeat(80))
      expect(stripAnsi(out)).toContain('会话')
      expect(stripAnsi(out)).toContain('provider · model')
    }
  })

  it('centers user rows in the conversation column with fgDim marker plus fg body', () => {
    applyTheme('16')
    const out = renderStream({
      history: [{ kind: 'user', text: 'hello', timestamp: 1_000 }],
      activeTurn: undefined,
      status: 'idle',
      reasoningExpanded: false,
      toolCardsExpanded: false,
    })
    const line = out.split('\n').find(l => stripAnsi(l).includes('> hello'))
    expect(stripAnsi(line ?? '').trimStart()).toBe('> hello')
    const prefix = (line ?? '').slice(0, (line ?? '').indexOf('>'))
    expect(prefix).toContain('\x1b[40m')
    expect(line).toContain('\x1b[90m> ')
    expect(line).toContain('\x1b[37mhello')
  })

  it('marks the current turn with bold accent and the streaming cursor in accentDim', () => {
    applyTheme('16')
    const out = renderStream({
      history: [],
      activeTurn: {
        turn: 1,
        assistantText: 'answer',
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 100,
      },
      status: 'generating',
      reasoningExpanded: false,
      toolCardsExpanded: false,
    })
    expect(out).toContain('\x1b[1m\x1b[94m● \x1b[22m\x1b[37manswer')
    expect(out).toContain('\x1b[34m▌\x1b[39m')
  })
})

describe('markdown tier mapping', () => {
  it('maps code tokens at truecolor, 256, 16, and none', () => {
    expect(renderMarkdown('```ts\nconst x = 1\n```')).toContain(
      '\x1b[48;2;15;17;21m',
    )
    applyTheme('256')
    expect(renderMarkdown('```ts\nconst x = 1\n```')).toContain(
      '\x1b[48;5;233m',
    )
    expect(renderMarkdown('a `b` c')).toContain('\x1b[48;5;233mb')
    applyTheme('16')
    expect(renderMarkdown('```ts\nconst x = 1\n```')).toContain('\x1b[40m')
    applyTheme('none')
    expect(renderMarkdown('```ts\nconst x = 1\n```')).not.toContain('\x1b')
  })

  it('marks inline links and emphasis with the accent token', () => {
    expect(renderMarkdown('[docs](https://example.com)')).toContain(
      '\x1b[38;2;77;107;254mdocs',
    )
    expect(renderMarkdown('*note*')).toContain('\x1b[38;2;77;107;254mnote')
  })
})

describe('status copy and hint', () => {
  it('keeps the locked copy and adds the fgDim hint beside generating/stopped rows', () => {
    expect(STATUS_HINT).toBe('↑↓/jk 滚动')
    expect(statusSlot('generating')).toBe(
      '\x1b[48;2;0;0;0m\x1b[38;2;77;107;254m⏹ Ctrl+C 停止\x1b[0m\x1b[0m' +
        '\x1b[48;2;0;0;0m · \x1b[38;2;138;143;152m↑↓/jk 滚动\x1b[0m\x1b[0m',
    )
    expect(statusSlot('stopped')).toContain('继续生成')
    expect(statusSlot('exit-armed')).toBe(
      '\x1b[48;2;0;0;0m\x1b[38;2;77;107;254m再按一次 Ctrl+C 退出\x1b[0m\x1b[0m',
    )
  })

  it('renders the styled status row into the frame while generating', () => {
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController({ getInteraction: () => 'generating' }),
      }),
    )
    expect(out).toContain('\x1b[48;2;15;17;21m')
    expect(out).toContain('/workspace · ⏹ Ctrl+C 停止')
    expect(out).toContain('↑↓/jk 滚动')
    expect(out).not.toContain('/ 命令')
  })

  it('keeps the adaptive scroll hint plain until the final style layer', () => {
    const adaptive = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      status: '生成中',
    }
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController({
          getInteraction: () => 'generating',
          getAdaptiveInfoFooter: () => adaptive,
        }),
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('↑↓/jk 滚动')
    expect(plain).not.toContain('\\x1b[')
  })

  it('paints cwd, badge, and command hints on the idle status row', () => {
    const out = renderToString(
      createElement(TuiLoop, {
        title: 't',
        controller: stubController(),
      }),
    )
    expect(out).toContain('/workspace · 状态 空闲')
    expect(out).toContain('provider · model · / 命令 · @ 提及')
    expect(out).toContain('输入消息')
    expect(out).toContain('\x1b[38;2;138;143;152m')
  })
})

describe('A3 escape before styling', () => {
  it('escapes user content before the styled layer in the session directory', () => {
    const rows = [{ id: 's1', title: 'evil \x1b[2J title', updatedAt: 0 }]
    const out = renderToString(
      createElement(SessionPane, {
        rows,
        selectedIndex: 0,
        currentId: undefined,
        confirmDelete: false,
        deleteUnavailable: false,
      }),
    )
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b[2J')
    expect(out).toContain('evil')
  })

  it('escapes markdown payloads before tier styling', () => {
    const out = renderMarkdown('*\x1b[2J*')
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b[2J')
  })

  it('styles feedback only after escaping (A3)', () => {
    const line = feedbackLine('✗ 失败：\x1b[31mboom\x1b[0m')
    expect(line).toContain('\\x1b')
    expect(line).not.toContain('\x1b[31m')
    expect(line).toContain('boom')
  })
})

describe('TuiLoop mounted render branches', () => {
  it('renders goal, stats, todo, jobs, workflow, and generating status together', () => {
    const goal = { phase: 'execute', objective: 'finish coverage', maxGoalRounds: 4, roundsStarted: 2 }
    const stats = { turns: 3, decodeTokens: 12, llmMs: 40 }
    const todos = [{ content: 'task', status: 'in_progress' as const }]
    const jobs = [{ id: 'job-1', status: 'running', label: 'worker' }]
    const workflow = { phase: 'verify', current: { seq: 1, label: 'member' } }
    const out = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getInteraction: () => 'generating',
        getBadge: () => '',
        getGoalFooter: () => goal,
        getSessionStats: () => stats,
        getTodoHud: () => todos,
        getJobsHud: () => jobs,
        getWorkflowHud: () => workflow,
        getComposerHud: () => 'composer hud',
      }),
    }))
    expect(out).toContain('目标 execute 2/4')
    expect(out).toContain('job-1 · running · worker')
    expect(out).toContain('阶段 verify')
    expect(out).toContain('composer hud')
  })

  it('renders optional settings and model error fields', () => {
    const settingsState = {
      ...EMPTY_SETTINGS_PANE,
      open: true,
      onboarding: true,
      updateError: 'settings failed',
    }
    const settings = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getSettingsPane: () => settingsState,
      }),
    }))
    expect(settings).toContain('首次设置')
    expect(settings).toContain('settings failed')

    const modelState = {
      ...EMPTY_MODEL_PANE,
      open: true,
      status: 'error' as const,
      error: 'catalog failed',
    }
    const model = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getModelPane: () => modelState,
      }),
    }))
    expect(model).toContain('catalog failed')
  })

  it('renders help, session, and ask-user ownership branches', () => {
    const helpState = { open: true, lines: ['help line'] }
    const help = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getHelpPane: () => helpState,
      }),
    }))
    expect(help).toContain('help line')

    const sessionState = { ...EMPTY_PANE, open: true }
    const sessions = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getSessionPane: () => sessionState,
      }),
    }))
    expect(sessions).toContain('无会话')

    const askState = {
      ...EMPTY_ASK_USER_PANE,
      open: true,
      header: 'Choose',
      options: ['A'],
      selectedIndex: 0,
    }
    const ask = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({
        getInteraction: () => 'generating',
        getAskUserPane: () => askState,
      }),
    }))
    expect(ask).toContain('Choose')
    expect(ask).toContain('A')
  })

  it('keeps the composer for workspace and feedback edit modes', () => {
    const workspace = {
      open: true,
      root: '/workspace',
      nodes: [],
      selectedIndex: 0,
      editing: true,
    }
    const workspaceOut = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({ getWorkspacePane: () => workspace as never }),
    }))
    expect(workspaceOut).toContain('> ')

    const feedback = { open: true, hasTarget: true, editing: true }
    const feedbackOut = renderToString(createElement(TuiLoop, {
      title: 't',
      controller: stubController({ getFeedbackPane: () => feedback as never }),
    }))
    expect(feedbackOut).toContain('> ')
  })
})
