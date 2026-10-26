import { createElement } from 'react'
import { renderToString } from 'ink'
import { describe, expect, it } from 'vitest'
import { EMPTY_INPUT, handleInput, InputBar } from '../src/input-bar.tsx'

const plain = (text: string) => text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')

describe('bounded composer draft window', () => {
  it.each([10, 100, 1000])('bounds mounted rows for %i lines and sends the complete draft', count => {
    const text = Array.from({ length: count }, (_, i) => `ROW_${i}_中文`).join('\n')
    const output = plain(renderToString(createElement(InputBar, {
      text, caretIndex: text.length, commandMode: false, mentionMode: false,
    }), { columns: 80 }))
    expect(output.split('\n').length).toBeLessThanOrEqual(9)
    expect(output).toContain(`ROW_${count - 1}_中文`)
    expect(output).toContain(`↑${count - 7}`)
    expect(handleInput({ ...EMPTY_INPUT, text }, { input: 'return', ctrl: false, shift: false }).command)
      .toEqual({ kind: 'send', text })
  })

  it('keeps a middle caret and both hidden counts visible', () => {
    const text = Array.from({ length: 1000 }, (_, i) => `ROW_${i}_é👩‍💻\t[图片 #1]`).join('\n')
    const output = plain(renderToString(createElement(InputBar, {
      text, caretIndex: text.indexOf('ROW_500_'), selectionAnchor: 0,
      commandMode: false, mentionMode: false,
    }), { columns: 80 }))
    expect(output.split('\n').length).toBeLessThanOrEqual(9)
    expect(output).toContain('ROW_500_é👩‍💻\\t[图片 #1]')
    expect(output).not.toContain('ROW_999_')
    expect(output).toMatch(/↑\d+.*↓\d+/u)
  })
})

describe('lossless draft replacement across the window', () => {
  it('copies and replaces a multiline selection against the full reference draft', async () => {
    const { selectedInputText, replaceInputSelection } = await import('../src/input-selection.ts')
    const text = Array.from({ length: 1000 }, (_, i) => `中é👩‍💻\t[图片 #1] row${i}`).join('\n')
    const start = text.indexOf('row10')
    const end = text.indexOf('row900')
    const state = { text, selectionAnchor: start, caretIndex: end }
    expect(selectedInputText(state)).toBe(text.slice(start, end))
    const replacement = '外部编辑器\n新草稿 [图片 #2]'
    const edited = replaceInputSelection(state, replacement)
    const reference = text.slice(0, start) + replacement + text.slice(end)
    expect(edited.text).toBe(reference)
    const output = renderToString(createElement(InputBar, {
      ...edited, commandMode: false, mentionMode: false,
    }), { columns: 80 })
    expect(plain(output)).toContain('新草稿 [图片 #2]')
    expect(handleInput({ ...EMPTY_INPUT, text: edited.text }, { input: 'return', ctrl: false, shift: false }).command)
      .toEqual({ kind: 'send', text: reference })
  })

  it('reindexes restored history and editor drafts while retaining the same mounted composer', async () => {
    const { render } = await import('ink')
    const { fakeTtyStdin, fakeTtyStdout, disposeRenderer } = await import('./helpers.ts')
    const { setFrameCaret, transformFrameChunk } = await import('../src/frame-fill.ts')
    const stdout = fakeTtyStdout()
    Object.assign(stdout, { isTTY: true, columns: 120, rows: 40 })
    const original = Array(1000).fill('原草稿 中é👩‍💻').join('\n')
    const history = Array(100).fill('历史恢复 [图片 #1]').join('\n')
    const edited = '外部编辑器\n中é👩‍💻\t[图片 #2]\n'
    const instance = render(createElement(InputBar, {
      text: original, commandMode: false, mentionMode: false,
    }), { stdout, stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true })
    try {
      for (const text of [history, edited, original]) {
        instance.rerender(createElement(InputBar, { text, commandMode: false, mentionMode: false }))
        await instance.waitUntilRenderFlush()
        expect(handleInput({ ...EMPTY_INPUT, text }, { input: 'return', ctrl: false, shift: false }).command)
          .toEqual({ kind: 'send', text })
        // 4 prompt columns + 18 history / 12 original display columns, then CSI is 1-based.
        const column = text.endsWith('\n') ? 5 : text === history ? 23 : 17
        expect(transformFrameChunk('\x1b[?2026l', 'none')).toContain(`\x1b[40;${column}H`)
      }
    } finally { await disposeRenderer(instance); setFrameCaret(undefined) }
  })
})

describe('mounted geometry bounds', () => {
  it.each([[80, 24, 9, 21], [120, 40, 14, 35]])(
    'bounds Yoga height and the middle-line IME anchor at %ix%i', async (columns, rows, maxHeight, caretRow) => {
      const { Box, measureElement, render } = await import('ink')
      const { createRef } = await import('react')
      const { fakeTtyStdin, fakeTtyStdout, disposeRenderer } = await import('./helpers.ts')
      const { setFrameCaret, transformFrameChunk } = await import('../src/frame-fill.ts')
      const stdout = fakeTtyStdout()
      Object.assign(stdout, { isTTY: true, columns, rows })
      const ref = createRef<import('ink').DOMElement>()
      for (const count of [10, 100, 1000]) {
        const text = Array.from({ length: count }, (_, i) => `ROW_${i}_中文`).join('\n')
        const instance = render(createElement(Box, { ref, flexDirection: 'column' },
          createElement(InputBar, { text, caretIndex: count === 1000 ? text.indexOf('ROW_500_') : text.length,
            selectionAnchor: 0, commandMode: false, mentionMode: false })),
        { stdout, stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true })
        try {
          await instance.waitUntilRenderFlush()
          expect(measureElement(ref.current as import('ink').DOMElement).height).toBeLessThanOrEqual(maxHeight)
          if (count === 1000) expect(transformFrameChunk('\x1b[?2026l', 'none'))
            .toContain(`\x1b[${caretRow};5H`)
        } finally { await disposeRenderer(instance); setFrameCaret(undefined) }
      }
    },
  )
})

describe('external caret normalization', () => {
  it.each([1, 2, 3, 4])('anchors stale editor offset %i at a whole emoji instead of inside its terminal cells', async caretIndex => {
    const { render } = await import('ink')
    const { fakeTtyStdin, fakeTtyStdout, disposeRenderer } = await import('./helpers.ts')
    const { setFrameCaret, transformFrameChunk } = await import('../src/frame-fill.ts')
    const stdout = fakeTtyStdout()
    Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 })
    const instance = render(createElement(InputBar, {
      text: '👩‍💻x', caretIndex, commandMode: false, mentionMode: false,
    }), { stdout, stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true })
    try {
      await instance.waitUntilRenderFlush()
      expect(transformFrameChunk('\x1b[?2026l', 'none')).toContain('\x1b[24;5H')
    } finally { await disposeRenderer(instance); setFrameCaret(undefined) }
  })
})

describe('registered caret writer', () => {
  it('labels the layout-effect caret write and routes it through the registered output', async () => {
    const { render } = await import('ink')
    const { fakeTtyStdin, fakeTtyStdout, disposeRenderer } = await import('./helpers.ts')
    const { TerminalOutput, registerTerminalOutput } = await import('../src/terminal-output.ts')
    const { setFrameCaret } = await import('../src/frame-fill.ts')
    const stdout = fakeTtyStdout()
    Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 })
    const calls: { bytes: string; source: string }[] = []
    const output = new TerminalOutput(stdout, () => {})
    const unregister = registerTerminalOutput(stdout, { output, control: (bytes, source) => {
      calls.push({ bytes, source })
      return output.write(bytes, source)
    } })
    const instance = render(createElement(InputBar, {
      text: 'hi', commandMode: false, mentionMode: false,
    }), { stdout, stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true })
    try {
      await instance.waitUntilRenderFlush()
      expect(calls).toContainEqual({ bytes: '\x1b[24;7H\x1b[?25h', source: 'caret' })
      expect(output.snapshot().trace.some(item => item.source === 'caret' && item.state === 'written')).toBe(true)
    } finally {
      await disposeRenderer(instance)
      unregister()
      output.dispose()
      setFrameCaret(undefined)
    }
  })
})
