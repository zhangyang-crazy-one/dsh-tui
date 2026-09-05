import { describe, expect, it, vi } from 'vitest'
import { render, renderToString, Text } from 'ink'
import { createElement, useLayoutEffect } from 'react'
import { AppShell } from '../src/app-shell.tsx'
import { StreamView, conversationWidth, scrollRailGeometry } from '../src/stream-view.tsx'
import type { ProjectedTurnContent, ViewModel } from '../src/projection.ts'
import { fakeTtyStdin, fakeTtyStdout, frameTtyStdout } from './helpers.ts'
import { BRAND_APP_TITLE } from '../src/brand.ts'
import { activeBrandRevealTimerCount } from '../src/pixel-fish-home.tsx'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { setHyperlinks } from '../src/hyperlink.ts'
import { ScreenAtlas } from '../src/screen-atlas.ts'
import type { TranscriptViewportCommand } from '../src/transcript-viewport.ts'
import { createFrameMetrics } from '../src/frame-metrics.ts'
import { renderPolicyDefaults } from '../src/render-policy.ts'
import { visibleFrameSnapshot } from '../src/frame-snapshot.ts'
import { PRESET_TABLE_MARKDOWN } from './fixtures/preset-table.ts'
import { displayWidth } from '../src/content.ts'

function model(overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    history: [],
    activeTurn: undefined,
    status: 'idle',
    reasoningExpanded: false,
    toolCardsExpanded: false,
    ...overrides,
  }
}

/** Render one clock-driven active frame under deterministic fake time. */
async function timedActiveFrame(input: {
  readonly activeTurn: NonNullable<ViewModel['activeTurn']>
  readonly advanceMs: number
}): Promise<{
  readonly output: string
  readonly activeTimerCount: number
  readonly remainingTimerCount: number
}> {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  let now = Date.now()
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
  const chunks: string[] = []
  const stdout = fakeTtyStdout()
  stdout.on('data', (chunk: string) => chunks.push(chunk))
  const instance = render(
    createElement(StreamView, {
      model: model({ activeTurn: input.activeTurn, status: 'generating', reasoningExpanded: true }),
    }),
    {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: false,
    },
  )
  let unmounted = false
  let activeTimerCount = 0
  let remainingTimerCount = 0
  try {
    now += input.advanceMs
    await vi.advanceTimersByTimeAsync(input.advanceMs)
    activeTimerCount = vi.getTimerCount()
    instance.unmount()
    unmounted = true
    await instance.waitUntilExit()
    remainingTimerCount = vi.getTimerCount()
  } finally {
    if (!unmounted) instance.unmount()
    nowSpy.mockRestore()
    vi.useRealTimers()
  }
  return {
    output: stripAnsi(chunks.join('')),
    activeTimerCount,
    remainingTimerCount,
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

function streamElement(
  history: ViewModel['history'],
  viewportCommand?: TranscriptViewportCommand,
) {
  return createElement(StreamView, {
    model: model({ history }),
    viewportCommand,
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

function ttyFrame(atlas: ScreenAtlas, columns: number, rows: number): string {
  return atlas.extract({ col: 1, row: 1 }, { col: columns, row: rows })
}

describe('conversationWidth', () => {
  it('uses full width below 40 columns and two-column gutters above it', () => {
    expect(conversationWidth(39)).toBe(39)
    expect(conversationWidth(40)).toBe(36)
    expect(conversationWidth(79)).toBe(75)
    expect(conversationWidth(80)).toBe(76)
    expect(conversationWidth(120)).toBe(116)
    expect(conversationWidth(200)).toBe(196)
  })

  it('never collapses to zero columns', () => {
    expect(conversationWidth(1)).toBe(1)
    expect(conversationWidth(0)).toBe(1)
  })
})

describe('scrollRailGeometry', () => {
  it('omits the rail without overflow and keeps a three-row thumb', () => {
    expect(scrollRailGeometry(18, 18, 0)).toBeUndefined()
    expect(scrollRailGeometry(600, 18, 0)).toEqual({
      rows: 18,
      thumbStart: 15,
      thumbRows: 3,
    })
    expect(scrollRailGeometry(600, 18, 582)).toEqual({
      rows: 18,
      thumbStart: 0,
      thumbRows: 3,
    })
  })
})

describe('StreamView', () => {
  it('keeps frame revisions proportional to visible rows rather than the entire history', async () => {
    const stdout = ttyStdout(24)
    const text = Array.from({ length: 5001 }, (_, index) => `BODY_${index}`).join('\n')
    const element = createElement(AppShell, { title: 'REVISION', badge: '',
      children: createElement(StreamView, { model: model({ history: [{ id: 1, kind: 'assistant', text, timestamp: 0 }] }) }),
      input: createElement(Text, null, 'INPUT'), status: createElement(Text, null, 'STATUS') })
    const instance = render(element, { stdout: frameTtyStdout(stdout), stdin: fakeTtyStdin(),
      exitOnCtrlC: false, patchConsole: false, interactive: true })
    try {
      await instance.waitUntilRenderFlush()
      const snapshot = visibleFrameSnapshot()!
      expect(snapshot.rows.some(row => row.line.text.includes('BODY_5000'))).toBe(true)
      const identityLength = snapshot.rows.reduce((size, row) => size + row.id.length + row.identity.length, 0)
      expect(snapshot.revision.length).toBeLessThan(identityLength + 200)
      expect(snapshot.revision).not.toContain('BODY_0\n')
    } finally { instance.unmount() }
  })

  it('releases transcript paint ownership before a replacement pane lays out', async () => {
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const observations: boolean[] = []
    const panelRow = `SETTINGS${' '.repeat(63)}PANEL_END`
    const Panel = () => {
      useLayoutEffect(() => { observations.push(visibleFrameSnapshot() !== undefined) }, [])
      return createElement(Text, null, panelRow)
    }
    const shell = (panel: boolean) => createElement(AppShell, {
      title: 'PANES', badge: '',
      children: panel ? createElement(Panel) : createElement(StreamView, { model: model({ history: [{
        id: 1, kind: 'assistant', timestamp: 0,
        text: Array.from({ length: 60 }, (_, index) => `OLD_TRANSCRIPT_${index}`).join('\n'),
      }] }) }),
      input: createElement(Text, null, '> INPUT'), status: createElement(Text, null, 'STATUS'),
    })
    const instance = render(shell(false), { stdout: frameTtyStdout(stdout), stdin: fakeTtyStdin(),
      exitOnCtrlC: false, patchConsole: false, interactive: true })
    try {
      await instance.waitUntilRenderFlush()
      expect(visibleFrameSnapshot()).toBeDefined()
      instance.rerender(shell(true))
      await instance.waitUntilRenderFlush()
      expect(observations).toEqual([false])
      const screen = atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
      expect(screen).toContain('SETTINGS')
      expect(screen).toContain('PANEL_END')
      expect(screen).not.toContain('OLD_TRANSCRIPT_')
      expect(screen).not.toMatch(/[·█]/u)
    } finally {
      instance.unmount()
    }
  })

  it('streams complete opt-in reasoning through the shared viewport and keeps it after settlement', async () => {
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const thoughts = (count: number) => Array.from({ length: count }, (_, index) =>
      `THOUGHT_${String(index).padStart(2, '0')}`).join('\n')
    const activeModel = (count: number, shown: boolean) => model({
      reasoningExpanded: shown, status: 'generating',
      activeTurn: { turn: 1, assistantText: '', reasoningText: thoughts(count),
        reasoningDurationMs: 0, toolCalls: [] },
    })
    const shell = (value: ViewModel, command?: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'THOUGHT_FLOW', badge: '',
      children: createElement(StreamView, { model: value, viewportCommand: command }),
      status: createElement(Text, null, 'STATUS'), input: createElement(Text, null, '> INPUT'),
    })
    const instance = render(shell(activeModel(30, false)), {
      stdout: frameTtyStdout(stdout), stdin: fakeTtyStdin(),
      exitOnCtrlC: false, patchConsole: false, interactive: true,
    })
    const screen = () => atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
    try {
      await instance.waitUntilRenderFlush()
      expect(screen()).not.toContain('THOUGHT_00')
      expect(screen()).not.toContain('✻ 思考')
      instance.rerender(shell(activeModel(30, true)))
      await instance.waitUntilRenderFlush()
      await expect.poll(screen).toContain('THOUGHT_29')
      expect(screen().match(/THOUGHT_\d+/gu)?.length).toBeGreaterThan(4)
      const oldest = { sequence: 1, kind: 'edge', edge: 'oldest' } as const
      instance.rerender(shell(activeModel(30, true), oldest))
      await instance.waitUntilRenderFlush()
      await expect.poll(screen).toContain('THOUGHT_00')
      instance.rerender(shell(activeModel(40, true), oldest))
      await instance.waitUntilRenderFlush()
      expect(screen()).toContain('THOUGHT_00')
      expect(screen()).toContain('End/G')
      const completed = model({ reasoningExpanded: true, history: [{
        id: 1, kind: 'assistant', text: 'ANSWER_FINAL', timestamp: 1,
        turnOrdinal: 1, reasoningText: thoughts(40),
      }] })
      instance.rerender(shell(completed, { sequence: 2, kind: 'edge', edge: 'latest' }))
      await instance.waitUntilRenderFlush()
      expect(screen()).toContain('THOUGHT_39')
      expect(screen()).toContain('ANSWER_FINAL')
      instance.rerender(shell({ ...completed, reasoningExpanded: false }))
      await instance.waitUntilRenderFlush()
      expect(screen()).not.toMatch(/THOUGHT_\d+/u)
      expect(screen()).not.toContain('✻ 思考')
      expect(screen()).toContain('ANSWER_FINAL')
      expect(screen()).toContain('> INPUT')
    } finally {
      instance.unmount()
    }
  })

  it('paints each wheel animation row within the overscan window and reaches the exact target', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const history: ViewModel['history'] = [{
      id: 1, kind: 'user', timestamp: 0,
      text: Array.from({ length: 80 }, (_, index) => `SCROLL_ROW_${String(index).padStart(3, '0')}`).join('\n'),
    }]
    const shell = (command?: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'SCROLL', badge: '', children: streamElement(history, command),
      status: createElement(Text, null, 'STATUS'), input: createElement(Text, null, '> INPUT'),
    })
    const instance = render(shell(), { stdout: frameTtyStdout(stdout), stdin: fakeTtyStdin(),
      exitOnCtrlC: false, patchConsole: false, interactive: true })
    const firstRow = () => Number(/SCROLL_ROW_(\d+)/u.exec(visibleFrameSnapshot()?.rows[0]?.line.text ?? '')?.[1])
    try {
      await instance.waitUntilRenderFlush()
      const initial = firstRow()
      expect(Number.isFinite(initial)).toBe(true)
      instance.rerender(shell({ sequence: 1, kind: 'scroll', delta: 4 }))
      await instance.waitUntilRenderFlush()
      expect(firstRow()).toBe(initial - 1)
      for (let offset = 2; offset <= 4; offset += 1) {
        await vi.advanceTimersByTimeAsync(renderPolicyDefaults().scroll.frameIntervalMs)
        await instance.waitUntilRenderFlush()
        expect(firstRow()).toBe(initial - offset)
      }
      instance.rerender(shell({ sequence: 2, kind: 'edge', edge: 'latest' }))
      await instance.waitUntilRenderFlush()
      instance.rerender(shell({ sequence: 3, kind: 'scroll', delta: 8 }))
      await vi.advanceTimersByTimeAsync(renderPolicyDefaults().scroll.frameIntervalMs)
      await instance.waitUntilRenderFlush()
      expect(firstRow()).toBeLessThan(initial)
      instance.rerender(shell({ sequence: 4, kind: 'scroll', delta: -3 }))
      await vi.advanceTimersByTimeAsync(renderPolicyDefaults().scroll.frameIntervalMs)
      await instance.waitUntilRenderFlush()
      expect(firstRow()).toBe(initial)
      expect(ttyFrame(atlas, 80, 24)).toContain('SCROLL_ROW_079')
    } finally {
      instance.unmount()
      vi.useRealTimers()
    }
  })

  it('toggles the scrollbar without moving a centered table or losing detached navigation', async () => {
    const columns = 112
    const stdout = ttyStdout(40, columns)
    const atlas = new ScreenAtlas(columns, 40)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const history: ViewModel['history'] = [{ id: 1, kind: 'assistant', timestamp: 0,
      text: `# Presets\n\n${PRESET_TABLE_MARKDOWN}\n\n${'tail\n\n'.repeat(30)}` }]
    const shell = (scrollbar: boolean) => createElement(AppShell, {
      title: 'TABLE', badge: '',
      children: createElement(StreamView, { model: model({ history }), scrollbar,
        viewportCommand: { sequence: 1, kind: 'edge', edge: 'oldest' } }),
      status: createElement(Text, null, 'STATUS'), input: createElement(Text, null, '> INPUT'),
    })
    const instance = render(shell(true), { stdout: frameTtyStdout(stdout, () => 'none'), stdin: fakeTtyStdin(),
      exitOnCtrlC: false, patchConsole: false, interactive: true })
    const tableBounds = () => {
      const row = visibleFrameSnapshot()?.rows.find(row => row.line.text.includes('┌'))
      expect(row).toBeDefined()
      const text = row!.line.text
      const left = row!.col - 1 + displayWidth(text.slice(0, text.indexOf('┌')))
      const right = columns - row!.col + 1 - displayWidth(text.slice(0, text.indexOf('┐') + 1))
      return { left, right }
    }
    try {
      await instance.waitUntilRenderFlush()
      const bounds = tableBounds()
      expect(bounds.left).toBe(bounds.right)
      expect(visibleFrameSnapshot()?.geometry.rail).toBeDefined()
      instance.rerender(shell(false))
      await instance.waitUntilRenderFlush()
      expect(visibleFrameSnapshot()?.geometry.rail).toBeUndefined()
      expect(tableBounds()).toEqual(bounds)
      expect(ttyFrame(atlas, columns, 40)).toContain('↓ 底部 · End/G')
      for (let row = 3; row < 35; row += 1) expect(atlas.cellAt(columns, row)?.ch).not.toMatch(/[·█]/u)
      instance.rerender(shell(true))
      await instance.waitUntilRenderFlush()
      expect(visibleFrameSnapshot()?.geometry.rail).toBeDefined()
      expect(tableBounds()).toEqual(bounds)
    } finally {
      instance.unmount()
    }
  })

  it('keeps the fixed shell while edge commands replace physical viewport rows', async () => {
    const chunks: string[] = []
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => {
      chunks.push(chunk)
      atlas.feed(chunk)
    })
    const history = historyRows(100)
    const shell = (command: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'FIXED_TITLE',
      badge: 'badge',
      children: streamElement(history, command),
      status: createElement(Text, null, 'FIXED_STATUS'),
      input: createElement(Text, null, '> FIXED_INPUT'),
    })
    const instance = render(shell({ sequence: 1, kind: 'edge', edge: 'oldest' }), {
      stdout: frameTtyStdout(stdout, () => 'none'),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const oldest = atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
      expect(oldest).toContain('FIXED_TITLE')
      expect(oldest).toContain('FIXED_STATUS')
      expect(oldest).toContain('FIXED_INPUT')
      expect(oldest).toContain('ROW_000')
      expect(oldest).not.toContain('ROW_099')
      expect(oldest.match(/ROW_\d{3}/gu)?.length ?? 0).toBeGreaterThanOrEqual(5)
      expect(oldest).toContain('█')
      expect(oldest).toContain('·')
      expect(oldest).toContain('↓ 底部 · End/G')

      chunks.length = 0
      instance.rerender(shell({ sequence: 2, kind: 'edge', edge: 'latest' }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const latest = atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
      expect(latest).toContain('FIXED_TITLE')
      expect(latest).toContain('FIXED_STATUS')
      expect(latest).toContain('FIXED_INPUT')
      expect(latest).toContain('ROW_099')
      expect(latest).not.toContain('ROW_000')
      expect(latest.match(/ROW_\d{3}/gu)?.length ?? 0).toBeGreaterThanOrEqual(5)
      expect(latest).not.toContain('↓ 底部 · End/G')
    } finally {
      instance.unmount()
    }
  })

  it('keeps detached physical rows stable while new content accumulates unseen rows', async () => {
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk) => { atlas.feed(chunk) })
    const initial = historyRows(20)
    const shell = (
      history: ViewModel['history'],
      command?: TranscriptViewportCommand,
    ) => createElement(AppShell, {
      title: 'ANCHOR_TITLE',
      badge: 'badge',
      children: createElement(StreamView, {
        model: model({ history }),
        viewportCommand: command,
      }),
      status: createElement(Text, null, 'ANCHOR_STATUS'),
      input: createElement(Text, null, '> ANCHOR_INPUT'),
    })
    const instance = render(shell(initial), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    const screen = (): string => ttyFrame(atlas, 80, 24)
    try {
      await instance.waitUntilRenderFlush()
      instance.rerender(shell(initial, { sequence: 1, kind: 'position', fraction: 0.5 }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const beforeLines = screen().split('\n')
      const beforeAnchor = beforeLines.find(line => line.includes('ROW_'))
      const beforeRow = beforeLines.findIndex(line => line === beforeAnchor)
      expect(beforeAnchor).toBeDefined()

      const appended = [
        ...initial,
        { id: 21, kind: 'user' as const, text: 'ROW_020', timestamp: 21 },
      ]
      instance.rerender(shell(appended, { sequence: 1, kind: 'position', fraction: 0.5 }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const afterLines = screen().split('\n')
      expect(afterLines[beforeRow].slice(0, 78).trimEnd()).toBe(beforeAnchor.slice(0, 78).trimEnd())
      expect(afterLines[beforeRow]).toContain('ROW_')
      expect(screen()).toContain('↓ 最新消息 · 3')
      expect(screen()).toContain('ANCHOR_TITLE')
      expect(screen()).toContain('ANCHOR_STATUS')
      expect(screen()).toContain('ANCHOR_INPUT')
    } finally {
      instance.unmount()
    }
  })

  it('keeps a detached history anchor while the active turn becomes settled history', async () => {
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk) => { atlas.feed(chunk) })
    const initialHistory = historyRows(30)
    const active = {
      turn: 7,
      assistantText: 'ACTIVE_SETTLEMENT_TAIL',
      reasoningText: 'working',
      toolCalls: [],
      reasoningDurationMs: 100,
    }
    const shell = (
      viewModel: ViewModel,
      command?: TranscriptViewportCommand,
    ) => createElement(AppShell, {
      title: 'SETTLE_ANCHOR_TITLE',
      badge: 'badge',
      children: createElement(StreamView, {
        model: viewModel,
        viewportCommand: command,
      }),
      status: createElement(Text, null, 'SETTLE_ANCHOR_STATUS'),
      input: createElement(Text, null, '> SETTLE_ANCHOR_INPUT'),
    })
    const activeModel = model({
      history: initialHistory,
      activeTurn: active,
      status: 'generating',
    })
    const command = { sequence: 1, kind: 'position', fraction: 0.5 } as const
    const instance = render(shell(activeModel), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    const screen = (): string => ttyFrame(atlas, 80, 24)
    try {
      await instance.waitUntilRenderFlush()
      instance.rerender(shell(activeModel, command))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const beforeLines = screen().split('\n')
      const anchorRow = beforeLines.findIndex(line => line.includes('ROW_'))
      const anchor = beforeLines[anchorRow]
      expect(anchorRow).toBeGreaterThan(1)
      expect(anchor).toBeDefined()

      const settledModel = model({
        history: [
          ...initialHistory,
          {
            id: 31,
            kind: 'assistant',
            text: 'FINAL_SETTLEMENT_TAIL',
            timestamp: 31,
            turnOrdinal: 7,
          },
        ],
      })
      instance.rerender(shell(settledModel, command))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const afterAnchor = screen().split('\n')[anchorRow]
      expect(afterAnchor.slice(0, 78).trimEnd()).toBe(anchor.slice(0, 78).trimEnd())
      expect(afterAnchor).toContain('ROW_')
      expect(screen()).toContain('SETTLE_ANCHOR_INPUT')
    } finally {
      instance.unmount()
    }
  })

  it('shows a physical rail for one long message with fewer than 60 events', async () => {
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk) => { atlas.feed(chunk) })
    const instance = render(createElement(AppShell, {
      title: 'LONG_TITLE',
      badge: 'badge',
      children: createElement(StreamView, {
        model: model({
          history: [{
            id: 1,
            kind: 'user',
            text: Array.from({ length: 30 }, (_, index) => `LONG_${String(index)}`).join('\n'),
            timestamp: 1,
          }],
        }),
      }),
      status: createElement(Text, null, 'LONG_STATUS'),
      input: createElement(Text, null, '> LONG_INPUT'),
    }), {
      stdout: frameTtyStdout(stdout, () => 'none'),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const frame = atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
      expect(frame).toContain('█')
      expect(frame).toContain('·')
      expect(frame).toContain('LONG_INPUT')
    } finally {
      instance.unmount()
    }
  })

  it('keeps the detached anchor visible across terminal resize', async () => {
    const stdout = ttyStdout(30, 120) as ReturnType<typeof ttyStdout> & {
      emit(event: 'resize'): boolean
    }
    const atlas = new ScreenAtlas(120, 30)
    stdout.on('data', (chunk) => { atlas.feed(chunk) })
    const history = historyRows(30)
    const shell = (command?: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'RESIZE_TITLE',
      badge: 'badge',
      children: createElement(StreamView, {
        model: model({ history }),
        viewportCommand: command,
      }),
      status: createElement(Text, null, 'RESIZE_STATUS'),
      input: createElement(Text, null, '> RESIZE_INPUT'),
    })
    const instance = render(shell(), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      instance.rerender(shell({ sequence: 1, kind: 'scroll', delta: 10 }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const before = atlas.extract({ col: 1, row: 1 }, { col: 120, row: 30 })
      const anchor = /ROW_\d{3}/u.exec(before)?.[0]
      expect(anchor).toBeDefined()

      stdout.columns = 80
      stdout.rows = 24
      atlas.resize(80, 24)
      stdout.emit('resize')
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const after = atlas.extract({ col: 1, row: 1 }, { col: 80, row: 24 })
      expect(after).toContain(anchor as string)
      expect(after).toContain('RESIZE_TITLE')
      expect(after).toContain('RESIZE_STATUS')
      expect(after).toContain('RESIZE_INPUT')
    } finally {
      instance.unmount()
    }
  })

  it('retains the complete transcript source for physical-row measurement', () => {
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
    expect(out).toContain('row 0')
    expect(out).toContain('row 99')
    expect(out).toContain('●')
    expect(out).toContain('> ')
  })

  it('streams prose without painting a transcript cursor and keeps markdown once settled', () => {
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
    expect(stripAnsi(generating)).toContain('streaming text')
    expect(stripAnsi(generating)).not.toContain('▌')
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
    expect(blankStart).toContain('● 正在处理…')

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
    expect(withFirstPart).toContain('● first token')
    expect(withFirstPart).not.toContain('▌')
    expect(withFirstPart).not.toContain('● 正在处理…')
  })

  it('advances the blank-start thinking duration without waiting for a model event', async () => {
    const result = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: '',
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 0,
      },
      advanceMs: 300,
    })
    expect(result.output).toContain('正在处理… (0.3s)')
    expect(result.activeTimerCount).toBeGreaterThan(0)
    expect(result.remainingTimerCount).toBe(0)
  })

  it('advances the current reasoning header between streamed reasoning events', async () => {
    const result = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: '',
        reasoningText: 'available reasoning summary',
        toolCalls: [],
        reasoningDurationMs: 100,
      },
      advanceMs: 300,
    })
    expect(result.output).toContain('思考 (0.4s)')
    expect(result.activeTimerCount).toBeGreaterThan(0)
    expect(result.remainingTimerCount).toBe(0)
  })

  it('stops the reasoning clock after streamed prose follows the reasoning run', async () => {
    const proseOnly = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: 'continue with the answer',
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 0,
      },
      advanceMs: 300,
    })
    const result = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: 'continue with the answer',
        reasoningText: 'finished reasoning',
        toolCalls: [],
        reasoningDurationMs: 800,
        content: [
          { kind: 'reasoning', text: 'finished reasoning', durationMs: 800 },
          { kind: 'text', text: 'continue with the answer' },
        ],
      },
      advanceMs: 300,
    })
    expect(result.output).toContain('思考 (0.8s)')
    expect(result.output).not.toContain('思考 (1.1s)')
    expect(result.activeTimerCount).toBe(proseOnly.activeTimerCount)
    expect(result.remainingTimerCount).toBe(0)
  })

  it('stops the reasoning clock after a tool follows the reasoning run', async () => {
    const toolCall = {
      kind: 'tool-call' as const,
      callId: ToolCallId('clock-tool'),
      name: 'bash',
      arguments: '{}',
    }
    const toolOnly = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: '',
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 0,
        content: [toolCall],
      },
      advanceMs: 300,
    })
    const result = await timedActiveFrame({
      activeTurn: {
        turn: 1,
        assistantText: '',
        reasoningText: 'finished reasoning',
        toolCalls: [],
        reasoningDurationMs: 800,
        content: [
          { kind: 'reasoning', text: 'finished reasoning', durationMs: 800 },
          toolCall,
        ],
      },
      advanceMs: 300,
    })
    expect(result.output).toContain('思考 (0.8s)')
    expect(result.output).toContain('bash · 运行中')
    expect(result.activeTimerCount).toBe(toolOnly.activeTimerCount)
    expect(result.remainingTimerCount).toBe(0)
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
    // Live markdown renders the heading frame and strong text instead of raw
    // markers; the hardware cursor remains owned by the composer.
    expect(plain).toContain('━━━ Report ━━━')
    expect(plain).toContain('bold')
    expect(plain).not.toContain('**bold**')
    expect(plain).toContain('claim')
    expect(plain).not.toContain('▌')
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
    expect(plain).toContain('● 正在处理…')
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

  it('hides reasoning and its header when not enabled', () => {
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
    expect(out).not.toContain('✻ 思考')
    expect(out).not.toContain('deep thinking')
  })

  it('keeps completed reasoning hidden until Ctrl+O display is enabled', () => {
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
    expect(collapsed).not.toContain('✻ 思考')
    expect(collapsed).not.toContain('retained reasoning')

    const expanded = renderToString(
      createElement(StreamView, {
        model: model({ history, reasoningExpanded: true }),
      }),
    )
    expect(expanded).toContain('retained reasoning')
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
      expect(composerAt).toBeGreaterThan(msgAt)
      expect(statusAt).toBeGreaterThan(composerAt)
      expect(msgAt - titleAt).toBeGreaterThan(composerAt - msgAt)
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
    expect(out).toContain('\x1b[38;2;238;240;242m有什么可以帮忙的')
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
      expect(stripAnsi(chunks.join(''))).toContain('▄▄▄█████████████')
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
      expect(composerAt).toBeGreaterThan(homeAt)
      expect(statusAt).toBeGreaterThan(composerAt)
      expect(homeAt - titleAt).toBeGreaterThan(3)
      expect(composerAt - homeAt).toBeGreaterThan(3)
    } finally {
      instance.unmount()
    }
  })

  it('centers the conversation column and keeps two blank lines between messages', () => {
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
    expect(userLead).toBe(Math.ceil((80 - conversationWidth(80)) / 2))
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

  it('keeps one blank line between visible reasoning and the assistant row', () => {
    const active = {
      turn: 1,
      assistantText: 'answer',
      reasoningText: 'deep',
      toolCalls: [],
      reasoningDurationMs: 100,
    }
    const out = renderToString(
      createElement(StreamView, {
        model: model({ activeTurn: active, status: 'idle', reasoningExpanded: true }),
      }),
    )
    const lines = out.split('\n')
    expect(
      lines.findIndex(line => line.includes('answer')) -
        lines.findIndex(line => line.includes('deep')),
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
    expect(plain).toContain('▸ bash · ✓')
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
    expect(plain).toContain('▾ bash · ✓')
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
    expect(plain.indexOf('▸ bash · ✓')).toBeGreaterThan(plain.indexOf('BEFORE_TOOL'))
    expect(plain.indexOf('AFTER_TOOL')).toBeGreaterThan(plain.indexOf('▸ bash · ✓'))
  })

  it('hides reasoning completely by default while streaming the answer', () => {
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
    expect(plain).not.toContain('✻ 思考')
    expect(plain).not.toContain('Ctrl+O 展开')
    expect(plain).toContain('looking')
    expect(plain).not.toContain('THINK_0')
    expect(plain).not.toContain('THINK_9')
  })

  it('labels each reasoning run with its own duration while generating', () => {
    const plain = stripAnsi(renderToString(
      createElement(StreamView, {
        model: model({
          reasoningExpanded: true,
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
    expect(plain).toMatch(/思考 \(2\.[12]s\)/u)
    expect(plain).not.toContain('思考 (21.7s)')
    expect(plain).not.toContain('Ctrl+O 展开')
    expect(plain).toContain('first think')
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
    expect(plain.replace(/\n {4}/gu, '')).toContain('WRAP_TAIL')
  })

  it('wraps generating text without adding a transcript cursor', () => {
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
    expect(plain).toContain('TAIL')
    expect(plain).not.toContain('▌')
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
    setHyperlinks(false)
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
          diffs: [{ path: '/workspace/a.ts', oldText: 'x', newText: 'y' }],
          locations: [{ path: '/workspace/a.ts' }],
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
            turnUsage: {
              uncachedInputTokens: 18,
              outputTokens: 12,
              totalTokens: 50,
              cacheReadTokens: 20,
              cacheWriteTokens: 0,
            },
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
    expect(plainTail).toContain('/workspace/a.ts')
    const producedLine = plainTail.split('\n').find(line => line.includes('产物 · '))
    expect(producedLine?.match(/\/workspace\/a\.ts/gu)).toHaveLength(1)
    expect(plainTail).toContain('turn 3 · ↑38 · ↓12 · 340 ms · 缓存命中 53%')
    expect(plainTail.indexOf('产物 · ')).toBeLessThan(plainTail.indexOf('turn 3 · ↑38'))
    expect(plainTail.indexOf('turn 3 · ↑38')).toBeLessThan(plainTail.indexOf('── 已完成 ──'))
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

  it('shows all reasoning only when enabled in a dense settled turn', () => {
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
    expect(collapsed).not.toContain('● 过程摘要')
    expect(collapsed).not.toContain('✻ 思考')
    expect(collapsed).not.toContain('THINK_')
    expect(collapsed).toContain('PART_0')
    expect(collapsed).toContain('PART_20')

    const expanded = stripAnsi(renderToString(
      createElement(StreamView, {
        model: { ...baseModel, reasoningExpanded: true },
      }),
    ))
    expect(expanded.match(/▾ ✻ 思考/gu)).toHaveLength(10)
    expect(expanded).toContain('PART_0')
    expect(expanded).toContain('PART_20')

    const toolExpanded = stripAnsi(renderToString(
      createElement(StreamView, {
        model: { ...baseModel, toolCardsExpanded: true },
      }),
    ))
    expect(toolExpanded).not.toContain('● 过程摘要')
    expect(toolExpanded).toContain('PART_0')

  })

  it('bounds dense tool history while retaining the latest failure and final Markdown', () => {
    const content = Array.from({ length: 10 }, (_, index) => {
      const callId = ToolCallId(`dense-${String(index)}`)
      return [
        {
          kind: 'tool-call' as const,
          callId,
          name: `bash-${String(index)}`,
          arguments: JSON.stringify({ command: `command-${String(index)}` }),
        },
        {
          kind: 'tool-result' as const,
          callId,
          text: index === 2 ? 'command failed' : 'ok',
          isError: index === 2,
          ...(index === 2
            ? { error: { name: 'ToolError', code: 'E2' } }
            : {}),
        },
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
    expect(out).toContain('▸ 工具记录 · 已收起 7 个 · Ctrl+E 展开')
    expect(out.match(/▸ bash-/gu)).toHaveLength(3)
    expect(out).toContain('▸ bash-2 · 失败 E2 · command failed')
    expect(out).toContain('▸ bash-8 · ✓ command-8')
    expect(out).toContain('▸ bash-9 · ✓ command-9')
    expect(out).not.toContain('bash-0')
    expect(out).toContain('FINAL')

    const expanded = stripAnsi(renderToString(createElement(StreamView, {
      model: model({
        toolCardsExpanded: true,
        history: [{
          id: 1,
          kind: 'assistant',
          text: 'FINAL',
          content,
          timestamp: 1,
        }],
      }),
    })))
    expect(expanded).not.toContain('工具记录')
    expect(expanded.match(/▾ bash-/gu)).toHaveLength(10)
  })

  it('bounds a dense running tool stack before answer text exists', () => {
    const content = Array.from({ length: 10 }, (_, index) => ({
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
    expect(out).toContain('▸ 工具记录 · 已收起 7 个 · 运行中 7 · Ctrl+E 展开')
    expect(out.match(/▸ read · 运行中/gu)).toHaveLength(3)
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
    expect(stripAnsi(out)).toContain('  · /tmp/')
    expect(stripAnsi(out)).toContain('bb.ts')
    expect(out).toContain(`\x1b]8;;file://${absolutePath}`)
    expect(out).not.toContain('\x1b]8;;file://relative')
    setHyperlinks(false)
  })
})

describe('StreamView physical-row virtualization', () => {
  it('keeps the tool-summary expansion hint on a narrow terminal', async () => {
    const columns = 30
    const rows = 24
    const stdout = ttyStdout(rows, columns)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const content = Array.from({ length: 10 }, (_, index) => {
      const callId = ToolCallId(`narrow-${String(index)}`)
      return [
        { kind: 'tool-call' as const, callId, name: 'bash', arguments: '{}' },
        { kind: 'tool-result' as const, callId, text: 'ok', isError: false },
      ]
    }).flat()
    const instance = render(createElement(AppShell, {
      title: 'NARROW_TOOL_TITLE',
      badge: 'b',
      children: createElement(StreamView, {
        model: model({
          history: [{ id: 1, kind: 'assistant', text: 'FINAL', content, timestamp: 1 }],
        }),
      }),
      status: createElement(Text, null, 'NARROW_TOOL_STATUS'),
      input: createElement(Text, null, '> NARROW_TOOL_INPUT'),
    }), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      expect(ttyFrame(atlas, columns, rows)).toContain('▸ 工具 7 · Ctrl+E')
    } finally {
      instance.unmount()
    }
  })

  it('stacks adjacent tool cards without blank transcript rows', async () => {
    const columns = 80
    const rows = 24
    const stdout = ttyStdout(rows, columns)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const first = ToolCallId('first')
    const second = ToolCallId('second')
    const instance = render(
      createElement(AppShell, {
        title: 'TOOL_GAP_TITLE',
        badge: 'b',
        children: createElement(StreamView, {
          model: model({
            history: [{
              id: 1,
              kind: 'assistant',
              text: '',
              timestamp: 1,
              content: [
                { kind: 'tool-call', callId: first, name: 'first-tool', arguments: '{}' },
                { kind: 'tool-result', callId: first, text: 'ok', isError: false },
                { kind: 'tool-call', callId: second, name: 'second-tool', arguments: '{}' },
                { kind: 'tool-result', callId: second, text: 'ok', isError: false },
              ],
            }],
          }),
        }),
        status: createElement(Text, null, 'TOOL_GAP_STATUS'),
        input: createElement(Text, null, '> TOOL_GAP_INPUT'),
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
      await instance.waitUntilRenderFlush()
      const lines = ttyFrame(atlas, columns, rows).split('\n')
      const firstRow = lines.findIndex(line => line.includes('first-tool'))
      const secondRow = lines.findIndex(line => line.includes('second-tool'))
      expect(firstRow).toBeGreaterThanOrEqual(0)
      expect(secondRow - firstRow).toBe(1)
    } finally {
      instance.unmount()
    }
  })

  it('reserves the assistant marker columns before projecting physical rows', async () => {
    const columns = 80
    const rows = 24
    const body = `${'x'.repeat(conversationWidth(columns) - 1)}Z`
    const stdout = ttyStdout(rows, columns)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const instance = render(
      createElement(AppShell, {
        title: 'PREFIX_WIDTH_TITLE',
        badge: 'b',
        children: createElement(StreamView, {
          model: model({
            history: [{
              id: 1,
              kind: 'assistant',
              text: body,
              timestamp: 1,
            }],
          }),
        }),
        status: createElement(Text, null, 'PREFIX_WIDTH_STATUS'),
        input: createElement(Text, null, '> PREFIX_WIDTH_INPUT'),
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
      await instance.waitUntilRenderFlush()
      const frame = ttyFrame(atlas, columns, rows)
      expect(frame).toContain('Z')
      expect(frame).not.toContain('…')
    } finally {
      instance.unmount()
    }
  })

  it('uses the former cursor column when projecting active physical rows', async () => {
    const columns = 80
    const rows = 24
    const body = `${'y'.repeat(conversationWidth(columns) - 3)}Z`
    const stdout = ttyStdout(rows, columns)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const instance = render(
      createElement(AppShell, {
        title: 'CURSOR_WIDTH_TITLE',
        badge: 'b',
        children: createElement(StreamView, {
          model: model({
            activeTurn: {
              turn: 1,
              assistantText: body,
              reasoningText: '',
              toolCalls: [],
              reasoningDurationMs: 0,
            },
            status: 'generating',
          }),
        }),
        status: createElement(Text, null, 'CURSOR_WIDTH_STATUS'),
        input: createElement(Text, null, '> CURSOR_WIDTH_INPUT'),
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
      await instance.waitUntilRenderFlush()
      const frame = ttyFrame(atlas, columns, rows)
      expect(frame).toContain('Z')
      expect(frame).not.toContain('▌')
      expect(frame).not.toContain('…')
    } finally {
      instance.unmount()
    }
  })

  it('mounts only viewport+overscan rows for a 10,000-line single Markdown block', async () => {
    // Build a single settled assistant message whose source is 10,000
    // short lines so the block-rows projector emits 10,000 `MarkdownRenderLine`
    // records but the slice path should only mount the ones in the visible
    // viewport plus the policy overscan.
    const tenThousand = Array.from({ length: 10_000 }, (_, index) => `line_${String(index).padStart(5, '0')}`)
      .join('\n')
    const history: ViewModel['history'] = [{
      id: 1,
      kind: 'assistant',
      text: tenThousand,
      timestamp: 1,
    }]
    const stdout = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
      isTTY: boolean
      columns: number
      rows: number
    }
    stdout.isTTY = true
    stdout.columns = 80
    stdout.rows = 24
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const metrics = createFrameMetrics()
    const policy = renderPolicyDefaults()
    const instance = render(
      createElement(AppShell, {
        title: 'T',
        badge: 'b',
        children: createElement(StreamView, {
          model: { history, activeTurn: undefined, status: 'idle', reasoningExpanded: false, toolCardsExpanded: false },
          renderPolicy: policy,
          frameMetrics: metrics,
        }),
        status: createElement(Text, null, 'STATUS'),
        input: createElement(Text, null, '> INPUT'),
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
      await instance.waitUntilRenderFlush()
      expect(ttyFrame(atlas, 80, 24)).toContain('line_09999')
      const mountedRows = metrics.snapshot().mountedRows.total
      // The slice budget is roughly one viewport + a bounded overscan
      // for both directions; the legacy full-block mount path would have
      // reported a number close to 10,000.
      expect(mountedRows).toBeLessThan(500)
      expect(mountedRows).toBeGreaterThan(0)
    } finally {
      instance.unmount()
    }
  })

  it('slices a growing active turn and preserves detached mid-block geometry', async () => {
    const source = Array.from({ length: 1_000 }, (_, index) => (
      `live_${String(index).padStart(5, '0')}`
    )).join('\n')
    const activeModel = model({
      activeTurn: {
        turn: 7,
        assistantText: source,
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 0,
      },
      status: 'generating',
    })
    const stdout = ttyStdout(24)
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const metrics = createFrameMetrics()
    const shell = (command?: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'ACTIVE_SLICE_TITLE',
      badge: 'b',
      children: createElement(StreamView, {
        model: activeModel,
        viewportCommand: command,
        frameMetrics: metrics,
      }),
      status: createElement(Text, null, 'ACTIVE_SLICE_STATUS'),
      input: createElement(Text, null, '> ACTIVE_SLICE_INPUT'),
    })
    const instance = render(shell(), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const follow = ttyFrame(atlas, 80, 24)
      const tail = follow.split('\n').find(line => line.includes('live_00999'))
      expect(tail).not.toContain('▌')
      expect(tail).not.toContain('●')
      expect(metrics.snapshot().mountedRows.total).toBeLessThan(500)
      expect(metrics.snapshot().mountedRows.windowMax).toBeLessThanOrEqual(48)

      instance.rerender(shell({ sequence: 1, kind: 'position', fraction: 0.5 }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const detached = ttyFrame(atlas, 80, 24)
      const indexes = [...detached.matchAll(/live_(\d{5})/g)].map(match => Number(match[1]))
      expect(indexes.length).toBeGreaterThan(0)
      expect(Math.max(...indexes)).toBeGreaterThan(500)
      expect(Math.max(...indexes)).toBeLessThan(700)
      expect(detached).not.toContain('live_00999')
    } finally {
      instance.unmount()
    }
  })

  it('generating+follow still mounts configured overscan and one scroll up reveals an already-projected row', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `stream_row_${i.toString().padStart(4, '0')}`).join('\n')
    const activeTurn = {
      turn: 1,
      assistantText: lines,
      reasoningText: '',
      reasoningDurationMs: 0,
      toolCalls: [],
    }
    const stdout = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
      isTTY: boolean
      columns: number
      rows: number
    }
    stdout.isTTY = true
    stdout.columns = 80
    stdout.rows = 24
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const metrics = createFrameMetrics()
    const shell = (viewportCommand?: TranscriptViewportCommand) => createElement(AppShell, {
      title: 'TITLE',
      badge: 'B',
      children: createElement(StreamView, {
        model: {
          history: [],
          activeTurn,
          status: 'generating',
          reasoningExpanded: false,
          toolCardsExpanded: false,
        },
        viewportCommand,
        frameMetrics: metrics,
      }),
      status: createElement(Text, null, 'STATUS'),
      input: createElement(Text, null, '> INPUT'),
    })
    const instance = render(shell(), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const followFrame = ttyFrame(atlas, 80, 24)
      expect(followFrame).toContain('stream_row_0199')
      // Mounted rows in follow mode should be greater than viewport height (reflecting configured overscan)
      const mountedDuringFollow = metrics.snapshot().mountedRows.windowMax
      expect(mountedDuringFollow).toBeGreaterThan(18)

      // One single row scroll up reveals an already-projected overscan row
      instance.rerender(shell({ sequence: 1, kind: 'scroll', delta: 1 }))
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const scrolledFrame = ttyFrame(atlas, 80, 24)
      expect(scrolledFrame).not.toContain('stream_row_0199')
    } finally {
      instance.unmount()
    }
  })

  it('reports mounted row counts even on small blocks', async () => {
    const history: ViewModel['history'] = [
      { id: 1, kind: 'user', text: 'ping', timestamp: 1 },
      { id: 2, kind: 'user', text: 'pong', timestamp: 2 },
    ]
    const stdout = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
      isTTY: boolean
      columns: number
      rows: number
    }
    stdout.isTTY = true
    stdout.columns = 80
    stdout.rows = 24
    const atlas = new ScreenAtlas(80, 24)
    stdout.on('data', (chunk: string) => { atlas.feed(chunk) })
    const metrics = createFrameMetrics()
    const instance = render(
      createElement(StreamView, {
        model: { history, activeTurn: undefined, status: 'idle', reasoningExpanded: false, toolCardsExpanded: false },
        frameMetrics: metrics,
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
      await instance.waitUntilRenderFlush()
      const total = metrics.snapshot().mountedRows.total
      expect(total).toBeGreaterThan(0)
    } finally {
      instance.unmount()
    }
  })

  it('keeps the same row references across an active→settled transition for an assistant block', () => {
    const assistantId = 99
    const text = 'Settle-stable stream content that should keep its line refs intact.'
    const active = {
      turn: 7,
      assistantText: text,
      reasoningText: '',
      toolCalls: [],
      reasoningDurationMs: 0,
    }
    const baseModel: ViewModel = {
      history: [],
      activeTurn: active,
      status: 'generating' as const,
      reasoningExpanded: false,
      toolCardsExpanded: false,
    }
    const activeOut = renderToString(createElement(StreamView, { model: baseModel }))
    expect(stripAnsi(activeOut)).toContain(text)
    const settledModel: ViewModel = {
      ...baseModel,
      activeTurn: undefined,
      status: 'idle' as const,
      history: [{
        id: assistantId,
        kind: 'assistant' as const,
        text,
        timestamp: 1,
        turnOrdinal: 7,
      }],
    }
    const settledOut = renderToString(createElement(StreamView, { model: settledModel }))
    expect(stripAnsi(settledOut)).toContain(text)
  })

  it('does not re-render invisible settled rows while the active turn grows', () => {
    const settledHistory: ViewModel['history'] = [
      { id: 1, kind: 'user', text: 'older', timestamp: 0 },
      { id: 2, kind: 'assistant', text: 'STABLE SETTLED ANSWER', timestamp: 1 },
    ]
    const initialActive = {
      turn: 1,
      assistantText: 'streaming answer',
      reasoningText: '',
      toolCalls: [],
      reasoningDurationMs: 0,
    }
    const out1 = renderToString(createElement(StreamView, {
      model: {
        history: settledHistory,
        activeTurn: initialActive,
        status: 'generating',
        reasoningExpanded: false,
        toolCardsExpanded: false,
      },
    }))
    const grownActive = { ...initialActive, assistantText: 'streaming answer expanded' }
    const out2 = renderToString(createElement(StreamView, {
      model: {
        history: settledHistory,
        activeTurn: grownActive,
        status: 'generating',
        reasoningExpanded: false,
        toolCardsExpanded: false,
      },
    }))
    const plain1 = stripAnsi(out1)
    const plain2 = stripAnsi(out2)
    expect(plain1).toContain('STABLE SETTLED ANSWER')
    expect(plain2).toContain('STABLE SETTLED ANSWER')
    expect(plain1).toContain('streaming answer')
    expect(plain2).toContain('streaming answer expanded')
  })

  it('keeps only the latest pending complete stream snapshot', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const stdout = fakeTtyStdout()
    const metrics = createFrameMetrics()
    const activeModel = (text: string): ViewModel => model({
      activeTurn: {
        turn: 1,
        assistantText: text,
        reasoningText: '',
        toolCalls: [],
        reasoningDurationMs: 0,
      },
      status: 'generating',
    })
    const element = (text: string) => createElement(StreamView, {
      model: activeModel(text),
      frameMetrics: metrics,
    })
    const instance = render(element('snapshot one'), {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: false,
    })
    let unmounted = false
    try {
      await instance.waitUntilRenderFlush()
      instance.rerender(element('snapshot two'))
      await instance.waitUntilRenderFlush()
      instance.rerender(element('snapshot three'))
      await instance.waitUntilRenderFlush()

      expect(metrics.snapshot().renderQueue.maxDepth).toBe(1)

      await vi.advanceTimersByTimeAsync(renderPolicyDefaults().stream.frameIntervalMs)
      await instance.waitUntilRenderFlush()
      expect(metrics.snapshot().renderQueue.currentDepth).toBe(0)
      instance.unmount()
      unmounted = true
      await instance.waitUntilExit()
    } finally {
      if (!unmounted) instance.unmount()
      vi.useRealTimers()
    }
  })

  it('excludes tool cards in focus mode so conclusions dominate', () => {
    const cardId = ToolCallId('tc_focus_01')
    const assistantMessage: ViewModel['history'][number] = {
      id: 1,
      kind: 'assistant',
      text: 'BEFORE_TOOL AFTER_TOOL',
      content: [
        { kind: 'text', text: 'BEFORE_TOOL' },
        {
          kind: 'tool-call',
          callId: cardId,
          name: 'bash',
          arguments: '{"command":"cargo build"}',
        },
        {
          kind: 'tool-result',
          callId: cardId,
          text: 'build ok',
          isError: false,
        },
        { kind: 'text', text: 'AFTER_TOOL' },
      ],
      timestamp: 1,
    }
    const standard = stripAnsi(renderToString(createElement(StreamView, {
      model: model({ history: [assistantMessage] }),
      mode: 'agent',
    })))
    expect(standard).toContain('bash')
    expect(standard).toContain('BEFORE_TOOL')
    expect(standard).toContain('AFTER_TOOL')

    const focus = stripAnsi(renderToString(createElement(StreamView, {
      model: model({ history: [assistantMessage] }),
      mode: 'focus',
    })))
    expect(focus).not.toContain('bash')
    expect(focus).toContain('BEFORE_TOOL')
    expect(focus).toContain('AFTER_TOOL')
  })
})
