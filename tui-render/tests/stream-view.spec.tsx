import { describe, expect, it, vi } from 'vitest'
import { render, renderToString, Text } from 'ink'
import { createElement } from 'react'
import { AppShell } from '../src/app-shell.tsx'
import { StreamView, conversationWidth, scrollRailGeometry } from '../src/stream-view.tsx'
import type { ViewModel } from '../src/projection.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'
import { BRAND_APP_TITLE } from '../src/brand.ts'
import { activeBrandRevealTimerCount } from '../src/pixel-fish-home.tsx'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setHyperlinks } from '../src/hyperlink.ts'

function model(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    history: [],
    activeTurn: undefined,
    status: 'idle',
    scrollOffset: 0,
    follow: true,
    unseenCount: 0,
    reasoningExpanded: false,
    toolCardsExpanded: false,
    ...overrides,
  }
}

/** Strip SGR sequences so content-level assertions ignore tier bytes. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

function historyRows(count: number): ViewModel['history'] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    kind: 'user' as const,
    text: `ROW_${index.toString().padStart(3, '0')}`,
    timestamp: index,
  }))
}

function renderedRowNumbers(output: string): number[] {
  return [...output.matchAll(/ROW_(\d{3})/g)].map(match => Number(match[1]))
}

function rowRange(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, index) => start + index)
}

function streamElement(
  history: ViewModel['history'],
  scrollOffset: number,
  viewShift = 0,
) {
  return createElement(StreamView, {
    model: model({ history, scrollOffset, follow: scrollOffset === 0 }),
    viewShift,
  })
}

function ttyStdout(rows: number, columns = 80) {
  const stream = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
    isTTY: boolean
    columns: number
    rows: number
  }
  stream.isTTY = true
  stream.columns = columns
  stream.rows = rows
  return stream
}

describe('conversationWidth', () => {
  it('uses full width below 80 columns and the bounded transcript column above it', () => {
    expect(conversationWidth(40)).toBe(40)
    expect(conversationWidth(79)).toBe(79)
    expect(conversationWidth(80)).toBe(57)
    expect(conversationWidth(120)).toBe(86)
    expect(conversationWidth(123)).toBe(88)
    expect(conversationWidth(200)).toBe(88)
  })

  it('never collapses to zero columns', () => {
    expect(conversationWidth(1)).toBe(1)
    expect(conversationWidth(0)).toBe(1)
  })
})

describe('scrollRailGeometry', () => {
  it('omits the rail without overflow and keeps a three-row thumb', () => {
    expect(scrollRailGeometry(60, 18, 0)).toBeUndefined()
    expect(scrollRailGeometry(600, 18, 0)).toEqual({
      rows: 18,
      thumbStart: 15,
      thumbRows: 3,
    })
    expect(scrollRailGeometry(600, 18, 540)).toEqual({
      rows: 18,
      thumbStart: 0,
      thumbRows: 3,
    })
  })
})

describe('StreamView', () => {
  it('renders exactly rows 0 through 59 on the first real Ink frame at offset 40', async () => {
    const chunks: string[] = []
    const stdout = fakeTtyStdout()
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(streamElement(historyRows(100), 40), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      const rows = renderedRowNumbers(chunks.join(''))
      expect(rows).toEqual(rowRange(0, 60))
      expect(new Set(rows).size).toBe(60)
    } finally {
      instance.unmount()
    }
  })

  it('keeps history rows visible when a viewShift pads the column', async () => {
    const chunks: string[] = []
    const stdout = fakeTtyStdout()
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(streamElement(historyRows(3), 0, 4), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      expect(renderedRowNumbers(chunks.join(''))).toEqual([0, 1, 2])
    } finally {
      instance.unmount()
    }
  })

  it('replaces rows 40 through 99 with rows 0 through 59 on a real Ink rerender', async () => {
    const chunks: string[] = []
    const history = historyRows(100)
    const stdout = fakeTtyStdout()
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(streamElement(history, 0), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      expect(renderedRowNumbers(chunks.join(''))).toEqual(rowRange(40, 100))

      chunks.length = 0
      instance.rerender(streamElement(history, 40))
      await instance.waitUntilRenderFlush()
      const rows = renderedRowNumbers(chunks.join(''))
      expect(rows).toEqual(rowRange(0, 60))
      expect(new Set(rows).size).toBe(60)
      expect(rows.some(row => row >= 60)).toBe(false)
    } finally {
      instance.unmount()
    }
  })

  it('windows history to the recent rows (virtualization)', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      kind: i % 2 === 0 ? 'user' : 'assistant',
      text: `row ${i}`,
      timestamp: i,
    })) as ViewModel['history']
    const out = renderToString(
      createElement(StreamView, {
        model: model({ history }),
      }),
    )
    expect(out).not.toContain('row 0')
    expect(out).toContain('row 99')
    expect(out).toContain('●')
    expect(out).toContain('> ')
  })

  it('shows the live cursor while generating and markdown once settled', () => {
    const active = {
      turn: 1,
      assistantText: 'streaming text',
      reasoningText: '',
      toolCalls: [],
      reasoningDurationMs: 42,
    }
    const generating = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'generating' }),
      }),
    )
    expect(stripAnsi(generating)).toContain('streaming text▌')
    const idle = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'idle' }),
      }),
    )
    expect(idle).toContain('streaming text')
  })

  it('renders the blank-start generating placeholder until the first visible part arrives', () => {
    const blankStart = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: '',
            reasoningText: '',
            toolCalls: [],
            reasoningDurationMs: 0,
          },
          status: 'generating',
        }),
      }),
    ))
    expect(blankStart).toContain('● 正在思考…')

    const withFirstPart = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: 'first token',
            reasoningText: '',
            toolCalls: [],
            reasoningDurationMs: 0,
          },
          status: 'generating',
        }),
      }),
    ))
    expect(withFirstPart).toContain('● first token▌')
    expect(withFirstPart).not.toContain('● 正在思考…')
  })

  it('renders markdown formatting while the text is still streaming', () => {
    const active = {
      turn: 1,
      assistantText: '# Report\n\n**bold** claim',
      reasoningText: '',
      toolCalls: [],
      reasoningDurationMs: 42,
    }
    const generating = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'generating' }),
      }),
    )
    const plain = stripAnsi(generating)
    // Live markdown: the heading frame and strong text are already rendered,
    // not the raw markers, and the cursor sits on the last row.
    expect(plain).toContain('━━━ Report ━━━')
    expect(plain).toContain('bold')
    expect(plain).not.toContain('**bold**')
    expect(plain).toContain('claim▌')
  })

  it('shows the blank-start generating placeholder while the turn has no visible parts yet', () => {
    const plain = stripAnsi(
      renderToString(
        createElement(StreamView, {
          model: model({
            activeTurn: {
              turn: 1,
              assistantText: '',
              reasoningText: '',
              toolCalls: [],
              reasoningDurationMs: 0,
            },
            status: 'generating',
            history: [
              { id: 1, kind: 'user', text: '你好', timestamp: 1 },
            ],
          }),
        }),
      ),
    )
    expect(plain).toContain('你好')
    expect(plain).toContain('● 正在思考…')
    expect(plain).not.toContain('▌')
  })

  it('renders a table live once its delimiter row completes', () => {
    const streamed = (assistantText: string): string =>
      stripAnsi(
        renderToString(
          createElement(StreamView, {
            model: model({
              activeTurn: {
                turn: 1,
                assistantText,
                reasoningText: '',
                toolCalls: [],
                reasoningDurationMs: 0,
              },
              status: 'generating',
            }),
          }),
        ),
      )
    // GFM needs the whole delimiter row before the block is a table, so a
    // half-arrived one stays paragraph text rather than a broken grid.
    expect(streamed('| env | state |\n| --- ')).toContain('| env | state |')
    // Delimiter complete: cells are laid out in columns and the pipes of the
    // source no longer appear as literal text.
    const table = streamed('| env | state |\n| --- | --- |\n| prod | ok |')
    expect(table).toContain('│')
    expect(table).toContain('┌')
    expect(table).toMatch(/env\s+│\s+state/)
    expect(table).toMatch(/prod\s+│\s+ok/)
    expect(table).not.toContain('| --- |')
  })

  it('folds reasoning into the marker when not generating', () => {
    const active = {
      turn: 1,
      assistantText: '',
      reasoningText: 'deep thinking\nsecond line',
      toolCalls: [],
      reasoningDurationMs: 1234,
    }
    const out = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'idle' }),
      }),
    )
    expect(out).toContain('✻ 思考 (1.2s)')
    expect(out).not.toContain('deep thinking')
  })

  it('keeps completed reasoning collapsed until Ctrl+O expansion is enabled', () => {
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: 'answer',
      reasoningText: 'retained reasoning',
      reasoningDurationMs: 1_250,
      content: [
        { kind: 'reasoning', text: 'retained reasoning' },
        { kind: 'text', text: 'answer' },
      ],
      timestamp: 10,
    }]
    const collapsed = renderToString(
      createElement(StreamView, {
        model: model({ history }),
      }),
    )
    expect(collapsed).toContain('✻ 思考 (1.3s)')
    expect(collapsed).not.toContain('retained reasoning')

    const expanded = renderToString(
      createElement(StreamView, {
        model: model({ history, reasoningExpanded: true }),
      }),
    )
    expect(expanded).toContain('retained reasoning')
  })

  it('shows the exact new-message notice only while unseen rows remain', () => {
    const history = historyRows(61)
    const unseen = renderToString(
      createElement(StreamView, {
        model: model({ history, scrollOffset: 1, follow: false, unseenCount: 1 }),
      }),
    )
    expect(unseen).toContain('↓ 最新消息 · 1')

    const following = renderToString(
      createElement(StreamView, {
        model: model({ history, scrollOffset: 0, unseenCount: 0 }),
      }),
    )
    expect(following).not.toContain('↓ 新消息')
  })

  it('renders a one-column rail only for overflowing history', () => {
    const overflow = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          history: historyRows(100),
          scrollOffset: 40,
          follow: false,
        }),
      }),
    ))
    expect(overflow).toContain('█')
    expect(overflow).toContain('·')

    const short = stripAnsi(renderToString(
      createElement(StreamView, { model: model({ history: historyRows(60) }) }),
    ))
    expect(short).not.toContain('█')
  })

  it('packs a short transcript against the status and composer rows', async () => {
    const chunks: string[] = []
    const stdout = ttyStdout(24)
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(
      createElement(AppShell, {
        title: 'deepseek-tui',
        badge: 'badge',
        children: createElement(StreamView, {
          model: model({
            history: [
              { id: 1, kind: 'user', text: 'PIN_MSG', timestamp: 0 },
            ],
          }),
        }),
        status: createElement(Text, null, 'STATUS_ROW'),
        input: createElement(Text, null, '> COMPOSER'),
      }),
      {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      const lines = stripAnsi(chunks.join('')).split(/\r?\n/)
      const titleAt = lines.findIndex(line => line.includes('deepseek-tui'))
      const msgAt = lines.findIndex(line => line.includes('PIN_MSG'))
      const statusAt = lines.findIndex(line => line.includes('STATUS_ROW'))
      const composerAt = lines.findIndex(line => line.includes('COMPOSER'))
      expect(titleAt).toBeGreaterThanOrEqual(0)
      expect(msgAt).toBeGreaterThan(titleAt)
      expect(statusAt).toBeGreaterThan(msgAt)
      expect(composerAt).toBeGreaterThan(statusAt)
      expect(msgAt - titleAt).toBeGreaterThan(statusAt - msgAt)
    } finally {
      instance.unmount()
    }
  })

  it('paints the DeepSeek idle home in the conversation column', () => {
    const out = renderToString(
      createElement(StreamView, {
        model: model(),
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('DeepSeek')
    expect(plain).toContain('有什么可以帮忙的')
    expect(plain).not.toContain('> first')
    expect(plain).not.toContain('🐋')
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254mDeepSeek')
    expect(out).toContain('\x1b[38;2;247;247;248m有什么可以帮忙的')
  })

  it('hides the idle home once a transcript row exists', () => {
    const out = renderToString(
      createElement(StreamView, {
        model: model({
          history: [{ id: 1, kind: 'user', text: 'hi', timestamp: 1 }],
        }),
      }),
    )
    expect(stripAnsi(out)).not.toContain('有什么可以帮忙的')
    expect(stripAnsi(out)).toContain('> hi')
  })

  it('hides the idle home while an active turn is streaming', () => {
    const out = renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: 'hi',
            reasoningText: '',
            toolCalls: [],
            reasoningDurationMs: 0,
          },
        }),
      }),
    )
    expect(stripAnsi(out)).not.toContain('有什么可以帮忙的')
    expect(stripAnsi(out)).toContain('hi')
  })

  it('renders the generated contour at a safe size and clears reveal timing when history arrives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const chunks: string[] = []
    const stdout = ttyStdout(50, 120)
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(
      createElement(StreamView, {
        model: model(),
        brandTier: 'half-block',
        brandAnimation: true,
      }),
      {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      expect(stripAnsi(chunks.join(''))).toContain('▄▄▄█████▄▄█████▀')
      expect(activeBrandRevealTimerCount()).toBe(1)
      instance.rerender(createElement(StreamView, {
        model: model({
          history: [{ id: 1, kind: 'user', text: 'history stops reveal', timestamp: 1 }],
        }),
        brandTier: 'half-block',
        brandAnimation: true,
      }))
      await instance.waitUntilRenderFlush()
      expect(activeBrandRevealTimerCount()).toBe(0)
    } finally {
      instance.unmount()
      vi.useRealTimers()
    }
  })

  it('centers the idle home in the conversation slot', async () => {
    const chunks: string[] = []
    const stdout = ttyStdout(24)
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const instance = render(
      createElement(AppShell, {
        title: BRAND_APP_TITLE,
        badge: 'badge',
        children: createElement(StreamView, {
          model: model(),
        }),
        status: createElement(Text, null, 'STATUS_ROW'),
        input: createElement(Text, null, '> COMPOSER'),
      }),
      {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      const lines = stripAnsi(chunks.join('')).split(/\r?\n/)
      const titleAt = lines.findIndex(line => line.includes('deepseek-tui'))
      const homeAt = lines.findIndex(line => line.includes('有什么可以帮忙的'))
      const statusAt = lines.findIndex(line => line.includes('STATUS_ROW'))
      const composerAt = lines.findIndex(line => line.includes('COMPOSER'))
      expect(titleAt).toBeGreaterThanOrEqual(0)
      expect(homeAt).toBeGreaterThan(titleAt)
      expect(statusAt).toBeGreaterThan(homeAt)
      expect(composerAt).toBeGreaterThan(statusAt)
      expect(homeAt - titleAt).toBeGreaterThan(3)
      expect(statusAt - homeAt).toBeGreaterThan(3)
    } finally {
      instance.unmount()
    }
  })

  it('left-aligns the conversation column and keeps two blank lines between messages', () => {
    const history = [
      { id: 1, kind: 'user', text: 'first', timestamp: 1 },
      { id: 2, kind: 'assistant', text: 'second', timestamp: 2 },
    ] as ViewModel['history']
    const out = renderToString(
      createElement(StreamView, {
        model: model({ history }),
      }),
    )
    const lines = out.split('\n')
    const userIndex = lines.findIndex(line =>
      stripAnsi(line).includes('> first'),
    )
    const assistantIndex = lines.findIndex(line =>
      stripAnsi(line).includes('● second'),
    )
    const userPlain = stripAnsi(lines[userIndex] ?? '')
    const assistantPlain = stripAnsi(lines[assistantIndex] ?? '')
    const userLead = userPlain.length - userPlain.trimStart().length
    const assistantLead = assistantPlain.length - assistantPlain.trimStart().length
    expect(userLead).toBe(assistantLead)
    expect(userLead).toBe(0)
    expect(userPlain.trim()).toBe('> first')
    expect(assistantPlain.trim()).toBe('● second')
    // Exactly two blank rows between the message blocks (02-UI-SPEC §1.2 T2).
    expect(assistantIndex - userIndex).toBe(3)
  })

  it('wraps a user message that fills the conversation column', () => {
    const text = `ROW_FILL_${'x'.repeat(80)}`
    const out = renderToString(
      createElement(StreamView, {
        model: model({
          history: [{ id: 1, kind: 'user', text, timestamp: 1 }],
        }),
      }),
    )
    expect(stripAnsi(out)).toContain('> ROW_FILL_')
    expect(stripAnsi(out)).toContain('xxxx')
  })

  it('renders historical reasoning when duration is omitted', () => {
    const out = renderToString(
      createElement(StreamView, {
        model: model({
          history: [{
            id: 1,
            kind: 'assistant',
            text: 'answer',
            reasoningText: 'thought',
            timestamp: 1,
          }],
          reasoningExpanded: true,
        }),
      }),
    )
    expect(stripAnsi(out)).toContain('thought')
    expect(stripAnsi(out)).toContain('● answer')
  })

  it('keeps one blank line between the reasoning fold and the assistant row', () => {
    const active = {
      turn: 1,
      assistantText: 'answer',
      reasoningText: 'deep',
      toolCalls: [],
      reasoningDurationMs: 100,
    }
    const out = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'idle' }),
      }),
    )
    const lines = out.split('\n')
    expect(
      lines.findIndex(line => line.includes('answer')) -
        lines.findIndex(line => line.includes('✻ 思考 (0.1s)')),
    ).toBe(2)
  })

  it('paints collapsed tool cards in the conversation column for history', () => {
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: 'looking',
      content: [
        { kind: 'text', text: 'looking' },
        {
          kind: 'tool-call',
          callId: ToolCallId('call-hist'),
          name: 'bash',
          arguments: '{"command":"git status"}',
        },
        {
          kind: 'tool-result',
          callId: ToolCallId('call-hist'),
          text: 'ok',
          isError: false,
        },
      ],
      timestamp: 1,
    }]
    const out = renderToString(
      createElement(StreamView, {
        model: model({ history }),
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('● looking')
    expect(plain).toContain('▸ bash · 完成')
    expect(plain).not.toContain('> bash')
    expect(plain).not.toContain('● bash')
    expect(plain).not.toContain('有什么可以帮忙的')
  })

  it('paints running tool cards on the active turn', () => {
    const out = renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: 'checking',
            reasoningText: '',
            toolCalls: [{
              callId: ToolCallId('call-live'),
              name: 'read_file',
              arguments: '{"path":"a.ts"}',
            }],
            reasoningDurationMs: 10,
          },
          status: 'generating',
        }),
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('checking')
    expect(plain).toContain('▸ read_file · 运行中')
    expect(plain).not.toContain('有什么可以帮忙的')
  })

  it('expands history tool cards when toolCardsExpanded is true', () => {
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: 'looking',
      content: [
        {
          kind: 'tool-call',
          callId: ToolCallId('call-hist'),
          name: 'bash',
          arguments: '{"command":"git status"}',
        },
        {
          kind: 'tool-result',
          callId: ToolCallId('call-hist'),
          text: 'ok',
          isError: false,
        },
      ],
      timestamp: 1,
    }]
    const out = renderToString(
      createElement(StreamView, {
        model: model({ history, toolCardsExpanded: true }),
      }),
    )
    const plain = stripAnsi(out)
    expect(plain).toContain('▾ bash · 完成')
    expect(plain).toContain('参数')
    expect(plain).toContain('结果')
  })

  it('paints text, tool, text in content order', () => {
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: 'BEFORE_TOOL AFTER_TOOL',
      content: [
        { kind: 'text', text: 'BEFORE_TOOL' },
        {
          kind: 'tool-call',
          callId: ToolCallId('call-order'),
          name: 'bash',
          arguments: '{"command":"ls"}',
        },
        {
          kind: 'tool-result',
          callId: ToolCallId('call-order'),
          text: 'ok',
          isError: false,
        },
        { kind: 'text', text: 'AFTER_TOOL' },
      ],
      timestamp: 1,
    }]
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({ history }),
      }),
    ))
    expect(plain.indexOf('BEFORE_TOOL')).toBeGreaterThanOrEqual(0)
    expect(plain.indexOf('▸ bash · 完成')).toBeGreaterThan(plain.indexOf('BEFORE_TOOL'))
    expect(plain.indexOf('AFTER_TOOL')).toBeGreaterThan(plain.indexOf('▸ bash · 完成'))
  })

  it('does not dump the full reasoning essay while generating', () => {
    const reasoningText = Array.from(
      { length: 10 },
      (_, index) => `THINK_${index}`,
    ).join('\n')
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: 'looking',
            reasoningText,
            toolCalls: [],
            reasoningDurationMs: 48_800,
          },
          status: 'generating',
        }),
      }),
    ))
    expect(plain).toContain('✻ 思考 (48.8s)')
    expect(plain).toContain('looking')
    expect(plain).not.toContain('THINK_0')
    expect(plain).toContain('THINK_9')
  })

  it('labels each reasoning run with its own duration while generating', () => {
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: '',
            reasoningText: 'first\nsecond',
            toolCalls: [],
            reasoningDurationMs: 21_700,
            content: [
              { kind: 'reasoning', text: 'first think', durationMs: 800 },
              {
                kind: 'tool-call',
                callId: ToolCallId('c1'),
                name: 'bash',
                arguments: '{}',
              },
              {
                kind: 'tool-result',
                callId: ToolCallId('c1'),
                text: 'ok',
                isError: false,
              },
              { kind: 'reasoning', text: 'second think', durationMs: 2100 },
            ],
          },
          status: 'generating',
        }),
      }),
    ))
    expect(plain).toContain('思考 (0.8s)')
    expect(plain).toContain('思考 (2.1s)')
    expect(plain).not.toContain('思考 (21.7s)')
    expect(plain).toContain('Ctrl+O 展开')
    expect(plain).not.toContain('first think')
    expect(plain).toContain('second think')
  })

  it('wraps a long assistant paragraph onto more than one row', () => {
    const text = `WRAP_HEAD ${'W'.repeat(200)} WRAP_TAIL`
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          history: [{
            id: 1,
            kind: 'assistant',
            text,
            timestamp: 1,
          }],
        }),
      }),
    ))
    const wrapped = plain.split('\n').filter(line => line.includes('W'))
    expect(wrapped.length).toBeGreaterThan(1)
    expect(plain).toContain('WRAP_HEAD')
    expect(plain).toContain('WRAP_TAIL')
  })

  it('wraps generating text and keeps the cursor on the last row', () => {
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          activeTurn: {
            turn: 1,
            assistantText: `HEAD ${'G'.repeat(200)} TAIL`,
            reasoningText: '',
            toolCalls: [],
            reasoningDurationMs: 0,
          },
          status: 'generating',
        }),
      }),
    ))
    const wrapped = plain.split('\n').filter(line => /G/.test(line))
    expect(wrapped.length).toBeGreaterThan(1)
    expect(plain.trimEnd().endsWith('▌')).toBe(true)
  })

  it('does not paint wrapped assistant rows through the composer on a short TTY', async () => {
    const rows = 16
    const columns = 40
    const chunks: string[] = []
    const stdout = ttyStdout(rows, columns)
    stdout.on('data', (chunk: string) => chunks.push(chunk))
    const paragraph = `WRAP_HEAD ${'x'.repeat(400)} WRAP_TAIL`
    const table = [
      '| plugin | ver |',
      '| --- | --- |',
      '| omnisearch | 1.29.1 |',
    ].join('\n')
    const instance = render(
      createElement(AppShell, {
        title: 'deepseek-tui',
        badge: 'badge',
        children: createElement(StreamView, {
          model: model({
            history: [{
              id: 1,
              kind: 'assistant',
              text: `${paragraph}\n\n${table}`,
              timestamp: 1,
            }],
          }),
        }),
        status: createElement(Text, null, 'STATUS_ROW'),
        input: createElement(Text, null, '> COMPOSER'),
      }),
      {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
        interactive: true,
      },
    )
    try {
      await instance.waitUntilRenderFlush()
      const lines = stripAnsi(chunks.join('')).split(/\r?\n/)
      expect(lines.some(line => line.includes('COMPOSER'))).toBe(true)
      expect(lines.some(line =>
        line.includes('WRAP_HEAD') && line.includes('omnisearch'),
      )).toBe(false)
      expect(lines.some(line =>
        line.includes('xxxxx') && line.includes('COMPOSER'),
      )).toBe(false)
      expect(lines.some(line =>
        line.includes('omnisearch') && line.includes('COMPOSER'),
      )).toBe(false)
    } finally {
      instance.unmount()
    }
  })

  it('paints the TurnTail 产物 row and per-turn stats, hidden when empty', () => {
    const editCall: ProjectedTurnContent = {
      kind: 'tool-call',
      callId: ToolCallId('call-edit'),
      name: 'edit',
      arguments: '{}',
    }
    const editResult: ProjectedTurnContent = {
      kind: 'tool-result',
      callId: ToolCallId('call-edit'),
      text: 'ok',
      isError: false,
    }
    const presenters = {
      get: () => ({
        presentCall: () => ({
          card: 'diff' as const,
          title: 'Edit a.ts',
          diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }],
          locations: [{ path: 'a.ts' }],
        }),
      }),
    }
    const withTail = renderToString(
      createElement(StreamView, {
        model: model({
          history: [{
            id: 1,
            kind: 'assistant',
            text: 'done',
            content: [editCall, editResult],
            timestamp: 1,
            usageOutputTokens: 12,
            stepWallMs: 340,
            turnOrdinal: 3,
          }],
        }),
        presenters,
      }),
    )
    const plainTail = stripAnsi(withTail)
    expect(plainTail).toContain('── 已完成 ──')
    expect(plainTail).toContain('产物 · ')
    expect(plainTail).toContain('a.ts')
    expect(plainTail).toContain('turn 3 · 12 tok · 340 ms')
    expect(plainTail.indexOf('── 已完成 ──')).toBeLessThan(plainTail.indexOf('产物 · '))
    expect(plainTail.indexOf('产物 · ')).toBeLessThan(plainTail.indexOf('turn 3 · 12 tok · 340 ms'))
    const bare = renderToString(
      createElement(StreamView, {
        model: model({
          history: [{ id: 2, kind: 'assistant', text: 'plain', timestamp: 2 }],
        }),
      }),
    )
    const plainBare = stripAnsi(bare)
    expect(plainBare).not.toContain('产物')
    expect(plainBare).not.toContain(' tok')
  })

  it('collapses dense settled history into the exact digest row until expansion is enabled', async () => {
    const content = Array.from({ length: 21 }, (_, index) =>
      index % 2 === 0
        ? { kind: 'text' as const, text: `PART_${index}` }
        : { kind: 'reasoning' as const, text: `THINK_${index}`, durationMs: index * 10 },
    )
    const baseModel = model({
      history: [{
        id: 1,
        kind: 'assistant' as const,
        text: 'PART_20',
        content,
        timestamp: 1,
      }],
    })
    const collapsed = stripAnsi(renderToString(
      createElement(StreamView, {
        model: baseModel,
      }),
    ))
    expect(collapsed.replace(/\s+/g, ' ')).toContain('● 过程摘要 · 10 叙述 · 10 思考 · 0 工具')
    expect(collapsed).not.toContain('PART_0')
    expect(collapsed).toContain('PART_20')

    const expanded = stripAnsi(renderToString(
      createElement(StreamView, {
        model: { ...baseModel, reasoningExpanded: true },
      }),
    ))
    expect(expanded).not.toContain('● 过程摘要')
    expect(expanded).toContain('PART_0')
    expect(expanded).toContain('PART_20')

    const toolExpanded = stripAnsi(renderToString(
      createElement(StreamView, {
        model: { ...baseModel, toolCardsExpanded: true },
      }),
    ))
    expect(toolExpanded).not.toContain('● 过程摘要')
    expect(toolExpanded).toContain('PART_0')

    for (const [columns, marker] of [[123, '已折叠'], [98, 'Ctrl+O 推理']] as const) {
      const stdout = ttyStdout(24, columns)
      const chunks: string[] = []
      stdout.on('data', chunk => chunks.push(chunk))
      const instance = render(createElement(StreamView, { model: baseModel }), {
        stdout,
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
      })
      try {
        await instance.waitUntilRenderFlush()
        expect(stripAnsi(chunks.join(''))).toContain(marker)
      } finally {
        instance.unmount()
      }
    }
  })

  it('collapses a dense generating tool prefix and counts completed cards', () => {
    const content = Array.from({ length: 20 }, (_, index) => {
      const callId = ToolCallId(`dense-${String(index)}`)
      return [
        { kind: 'tool-call' as const, callId, name: 'read', arguments: '{}' },
        { kind: 'tool-result' as const, callId, text: 'ok', isError: false },
      ]
    }).flat()
    content.push({ kind: 'text', text: 'FINAL' } as never)
    const out = stripAnsi(renderToString(createElement(StreamView, {
      model: model({
        status: 'generating',
        activeTurn: {
          turn: 1,
          assistantText: 'FINAL',
          reasoningText: '',
          reasoningDurationMs: 0,
          toolCalls: [],
          content,
        },
      }),
    })))
    expect(out.replace(/\s+/g, ' ')).toContain('● 过程摘要 · 0 叙述 · 0 思考 · 20 工具')
    expect(out).toContain('FINAL')
  })

  it('does not create a digest when a dense settled turn has no answer text', () => {
    const content = Array.from({ length: 20 }, (_, index) => ({
      kind: 'tool-call' as const,
      callId: ToolCallId(`running-${String(index)}`),
      name: 'read',
      arguments: '{}',
    }))
    const out = stripAnsi(renderToString(createElement(StreamView, {
      model: model({
        history: [{ id: 1, kind: 'assistant', text: '', content, timestamp: 1 }],
      }),
    })))
    expect(out).not.toContain('● 过程摘要')
  })

  it('merges adjacent text and reasoning and enriches a matched card', () => {
    const callId = ToolCallId('merge-card')
    const out = stripAnsi(renderToString(createElement(StreamView, {
      model: model({
        reasoningExpanded: true,
        toolCardsExpanded: true,
        history: [{
          id: 1,
          kind: 'assistant',
          text: 'ab',
          timestamp: 1,
          content: [
            { kind: 'text', text: 'a' },
            { kind: 'text', text: 'b' },
            { kind: 'reasoning', text: 'r1', durationMs: 1 },
            { kind: 'reasoning', text: 'r2' },
            { kind: 'tool-result', callId: ToolCallId('orphan'), text: 'drop', isError: false },
            { kind: 'tool-call', callId, name: 'read', arguments: '{}' },
            {
              kind: 'tool-result', callId, text: 'done', isError: true,
              meta: { view: 'read' }, error: { name: 'ToolError', code: 'FAILED' },
            },
          ],
          reasoningDurationMs: 99,
        }],
      }),
    })))
    expect(out).toContain('ab')
    expect(out).toContain('r1r2')
    expect(out).toContain('done')
    expect(out).not.toContain('drop')
  })

  it('adds controller tool calls missing from active retained content', () => {
    const out = stripAnsi(renderToString(createElement(StreamView, {
      model: model({
        status: 'generating',
        activeTurn: {
          turn: 1,
          assistantText: 'working',
          reasoningText: '',
          reasoningDurationMs: 0,
          content: [{ kind: 'text', text: 'working' }],
          toolCalls: [{ callId: ToolCallId('missing-card'), name: 'bash', arguments: '{}' }],
        },
      }),
    })))
    expect(out).toContain('bash')
    expect(out).toContain('运行中')
  })

  it('wraps produced paths and hyperlinks absolute locations only', () => {
    setHyperlinks(true)
    const relativePath = `relative/${'a'.repeat(50)}.ts`
    const absolutePath = `/tmp/${'b'.repeat(50)}.ts`
    const calls = [relativePath, absolutePath].flatMap((_path, index) => {
      const callId = ToolCallId(`tail-${String(index)}`)
      return [
        { kind: 'tool-call' as const, callId, name: 'edit', arguments: '{}' },
        { kind: 'tool-result' as const, callId, text: 'ok', isError: false },
      ]
    })
    const presenters = {
      get: () => ({
        presentCall: (_args: unknown) => ({
          card: 'diff' as const,
          title: 'edit',
          diffs: [],
          locations: calls.map((_item, index) => ({
            path: index < 2 ? relativePath : absolutePath,
          })).filter((item, index, all) => all.findIndex(candidate => candidate.path === item.path) === index),
        }),
      }),
    }
    const out = renderToString(createElement(StreamView, {
      model: model({
        history: [
          { id: 1, kind: 'assistant', text: 'done', content: calls, timestamp: 1 },
          { id: 2, kind: 'assistant', text: 'latest', timestamp: 2 },
        ],
      }),
      presenters,
    }))
    expect(stripAnsi(out)).toContain(`  · ${absolutePath}`)
    expect(out).toContain(`\x1b]8;;file://${absolutePath}`)
    expect(out).not.toContain('\x1b]8;;file://relative')
    setHyperlinks(false)
  })
})
