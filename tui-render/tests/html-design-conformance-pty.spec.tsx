/** Real-PTY geometry baselines for the HTML terminal design mapping. */

import { afterEach, describe, expect, it } from 'vitest'
import { render, Text } from 'ink'
import { createElement } from 'react'
import { AppShell } from '../src/app-shell.tsx'
import { InputBar } from '../src/input-bar.tsx'
import { StreamView } from '../src/stream-view.tsx'
import type { ViewModel } from '../src/projection.ts'
import { ScreenAtlas } from '../src/screen-atlas.ts'
import { applyTheme } from '../src/theme.ts'
import { transformFrameChunk, wrapStdoutForFrameBg } from '../src/frame-fill.ts'
import type { ColorTier } from '../src/terminal-capabilities.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'
import { displayWidth } from '../src/content.ts'

const IDLE: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  reasoningExpanded: false,
  toolCardsExpanded: false,
}

function tty(columns: number, rows: number) {
  const stdout = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
    isTTY: boolean
    columns: number
    rows: number
  }
  stdout.isTTY = true
  stdout.columns = columns
  stdout.rows = rows
  return stdout
}

async function idleFrame(columns: number, rows: number, tier: 'half-block' | 'plain') {
  const stdout = tty(columns, rows)
  const atlas = new ScreenAtlas(columns, rows)
  const chunks: string[] = []
  stdout.on('data', (chunk: unknown) => {
    const text = typeof chunk === 'string' ? chunk : String(chunk)
    chunks.push(text)
    atlas.feed(text)
  })
  const instance = render(createElement(AppShell, {
    title: 'SESSION_TITLE',
    badge: 'provider · model',
    children: createElement(StreamView, { model: IDLE, brandTier: tier }),
    status: createElement(Text, null, 'provider/model · 状态 空闲'),
    input: createElement(InputBar, {
      text: '',
      commandMode: false,
      mentionMode: false,
    }),
  }), {
    stdout,
    stdin: fakeTtyStdin(),
    exitOnCtrlC: false,
    patchConsole: false,
    interactive: true,
  })
  await instance.waitUntilRenderFlush()
  await instance.waitUntilRenderFlush()
  return {
    instance,
    frame: atlas.extract({ col: 1, row: 1 }, { col: columns, row: rows }),
    output: chunks.map(chunk => transformFrameChunk(chunk)).join(''),
  }
}

function defaultBackgroundPrints(output: string): string[] {
  const violations: string[] = []
  let background = false
  let index = 0
  while (index < output.length) {
    if (output[index] === '\x1b' && output[index + 1] === '[') {
      let end = index + 2
      while (end < output.length && !/[A-Za-z]/u.test(output[end])) end += 1
      if (output[end] === 'm') {
        const values = output.slice(index + 2, end).split(';').map(Number)
        if (values[0] === 0 || Number.isNaN(values[0])) background = false
        for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
          const value = values[valueIndex]
          if (value === 49) background = false
          if (value === 48) {
            background = true
            valueIndex += values[valueIndex + 1] === 2 ? 4 : 2
          } else if (
            (value !== undefined && value >= 40 && value <= 47)
            || (value !== undefined && value >= 100 && value <= 107)
          ) background = true
        }
      }
      index = Math.min(output.length, end + 1)
      continue
    }
    const code = output.charCodeAt(index)
    if (code >= 0x20 && code !== 0x7f && !background) {
      violations.push(output[index])
    }
    index += 1
  }
  return violations
}

afterEach(() => { applyTheme('truecolor') })

describe('HTML terminal design geometry', () => {
  it.each(['truecolor', '256', '16'] as const)(
    'keeps every printed AppShell cell on one background at the %s tier',
    async (colorTier: ColorTier) => {
      applyTheme(colorTier)
      const { instance, output } = await idleFrame(120, 40, 'half-block')
      try {
        expect(defaultBackgroundPrints(output)).toEqual([])
      } finally {
        instance.unmount()
      }
    },
  )

  it('adds no background SGR at the none tier', async () => {
    applyTheme('none')
    const { instance, output } = await idleFrame(120, 40, 'half-block')
    try {
      expect(output).not.toContain('\x1b[48;')
      expect(output).not.toContain('\x1b[40m')
    } finally {
      instance.unmount()
    }
  })

  it('prints full-width composer background cells without line-end erasure', async () => {
    applyTheme('truecolor')
    const columns = 120
    const { instance, output } = await idleFrame(columns, 40, 'plain')
    try {
      expect(output).toContain(`\x1b[39m${' '.repeat(columns - 4)}\x1b[49m`)
      expect(output).not.toContain('\x1b[K')
    } finally {
      instance.unmount()
    }
  })

  it('centers the home and keeps the bottom workspace full width at 120×40', async () => {
    applyTheme('none')
    const { instance, frame } = await idleFrame(120, 40, 'half-block')
    try {
      const lines = frame.split('\n')
      const wordmark = lines.find(line => line.includes('DeepSeek'))
      const composerHeader = lines.find(line => line.includes('› 输入消息'))
      const composerBody = lines.find(line => line.includes('│ >'))
      expect(wordmark?.indexOf('DeepSeek')).toBe(56)
      expect(composerHeader?.indexOf('› 输入消息')).toBe(2)
      expect(composerBody?.indexOf('│ >')).toBe(0)
      expect(frame).toContain('▄')
      expect(frame).toContain('有什么可以帮忙的')
      expect(frame).toContain('SESSION_TITLE')
      expect(frame).toContain('provider/model · 状态 空闲')
      expect(frame).not.toContain('\\x1b[')
    } finally {
      instance.unmount()
    }
  })

  it('keeps the composer visible with the compact brand at 80×24', async () => {
    applyTheme('none')
    const { instance, frame } = await idleFrame(80, 24, 'half-block')
    try {
      expect(frame).toContain('DeepSeek')
      expect(frame).toContain('有什么可以帮忙的')
      expect(frame).toContain('› 输入消息')
      expect(frame).toContain('│ >')
      expect(frame).toContain('▄')
    } finally {
      instance.unmount()
    }
  })

  it('keeps the bottom workspace full width on a 176-column screen', async () => {
    applyTheme('none')
    const { instance, frame } = await idleFrame(176, 40, 'plain')
    try {
      const composer = frame.split('\n').find(line => line.includes('› 输入消息'))
      expect(composer?.indexOf('› 输入消息')).toBe(2)
      expect(frame.split('\n').find(line => line.includes('│ >'))?.indexOf('│ >')).toBe(0)
      expect(frame).toContain('SESSION_TITLE')
    } finally {
      instance.unmount()
    }
  })

  it('keeps the thumb in the control column across a VS16 heading row', async () => {
    applyTheme('none')
    const columns = 80
    const rows = 24
    const stdout = tty(columns, rows)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: unknown) => { atlas.feed(String(chunk)) })
    const lines = Array.from({ length: 30 }, (_unused, index) =>
      index === 20 ? '## ⚠️ 两点说明' : `ROW_${String(index).padStart(2, '0')}`)
    const instance = render(createElement(AppShell, {
      title: 'RAIL_TITLE',
      badge: 'provider · model',
      children: createElement(StreamView, {
        model: {
          ...IDLE,
          history: [{
            id: 1,
            kind: 'user',
            text: lines.join('\n'),
            timestamp: 1,
          }],
        },
      }),
      status: createElement(Text, null, 'RAIL_STATUS'),
      input: createElement(Text, null, '> RAIL_INPUT'),
    }), {
      stdout: wrapStdoutForFrameBg(
        stdout,
        () => 'none',
      ) as unknown as typeof stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const frame = atlas.extract({ col: 1, row: 1 }, { col: columns, row: rows })
      const headingRow = frame.split('\n').findIndex(line => line.includes('⚠️')) + 1
      expect(headingRow).toBeGreaterThan(0)
      expect(atlas.cellAt(columns, headingRow)?.ch).toBe('█')
      expect(atlas.cellAt(columns - 1, headingRow)?.ch).not.toBe('█')
    } finally {
      instance.unmount()
    }
  })

  it('keeps emoji priority labels on one row in a constrained 113-column table', async () => {
    applyTheme('none')
    const columns = 113
    const rows = 43
    const stdout = tty(columns, rows)
    const atlas = new ScreenAtlas(columns, rows)
    stdout.on('data', (chunk: unknown) => { atlas.feed(String(chunk)) })
    const source = [
      '| 级别 | 位置 | 警告 | 建议 |',
      '| --- | --- | --- | --- |',
      `| 🔴 P1 | ${'a'.repeat(60)} | ${'b'.repeat(60)} | ${'c'.repeat(60)} |`,
      `| 🟠 P2 | ${'d'.repeat(60)} | ${'e'.repeat(60)} | ${'f'.repeat(60)} |`,
      `| 🟡 P3 | ${'g'.repeat(60)} | ${'h'.repeat(60)} | ${'i'.repeat(60)} |`,
    ].join('\n')
    const instance = render(createElement(AppShell, {
      title: 'EMOJI_TABLE_TITLE',
      badge: 'provider · model',
      children: createElement(StreamView, {
        model: {
          ...IDLE,
          history: [{
            id: 1,
            kind: 'assistant',
            text: source,
            timestamp: 1,
          }],
        },
      }),
      status: createElement(Text, null, 'EMOJI_TABLE_STATUS'),
      input: createElement(Text, null, '> EMOJI_TABLE_INPUT'),
    }), {
      stdout: wrapStdoutForFrameBg(
        stdout,
        () => 'none',
      ) as unknown as typeof stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    })
    try {
      await instance.waitUntilRenderFlush()
      await instance.waitUntilRenderFlush()
      const frame = atlas.extract({ col: 1, row: 1 }, { col: columns, row: rows })
      const tableLines = frame.split('\n').filter(line => /[┌│├└]/u.test(line))
      for (const label of ['🔴 P1', '🟠 P2', '🟡 P3']) {
        expect(tableLines.some(line => line.includes(label))).toBe(true)
      }
      expect(new Set(tableLines.map(displayWidth)).size).toBe(1)
      expect(frame).toContain('EMOJI_TABLE_INPUT')
      expect(frame).toContain('EMOJI_TABLE_STATUS')
    } finally {
      instance.unmount()
    }
  })
})
