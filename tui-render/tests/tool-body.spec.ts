/** Tool detail windows retain canonical text while formatting only requested rows. */
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolCardModel } from '../src/tool-cards.ts'
import { createToolBodyDocument, planToolBodyWindow, materializeToolBodyRow, toolCardOriginalText, type ToolBodyCard } from '../src/tool-body.ts'
import { displayWidth } from '../src/content.ts'

const options = { locale: 'zh-CN' as const, diagnostics: false, includeArguments: false }
const base: ToolCardModel = { callId: ToolCallId('window'), name: 'generic', arguments: '{"value":1}', status: 'ok' }

describe('tool body windows', () => {
  it('pages beyond 5000 lines and copies the entire original result', () => {
    const resultText = Array.from({ length: 5001 }, (_, index) => `output-${index}`).join('\n')
    const card = { ...base, resultText }
    const document = createToolBodyDocument(card, options)
    const first = planToolBodyWindow(document, { line: 0, offset: 0 }, 60, 6)
    expect(first.fragments).toHaveLength(6)
    expect(first.remainingLines).toBeGreaterThan(4900)
    expect(first.fragments.map(row => materializeToolBodyRow(document, row).text).join('\n')).not.toContain('output-5000')
    let page = first
    while (page.next !== undefined) page = planToolBodyWindow(document, page.next, 60, 100)
    expect(page.fragments.map(row => materializeToolBodyRow(document, row).text)).toContain('output-5000')
    expect(page.remainingLines).toBe(0)
    expect(toolCardOriginalText(card, options)).toContain(resultText)
  })

  it('does not serialize generic metadata until diagnostics are explicitly requested', () => {
    const meta = { stdout: 'same output' }
    const stringify = vi.spyOn(JSON, 'stringify')
    try {
      const card = { ...base, resultText: 'same output', meta }
      const document = createToolBodyDocument(card, options)
      expect(document.slice().map(row => row.text)).toEqual(['参数', '{"value":1}', '结果', 'same output'])
      expect(stringify).not.toHaveBeenCalled()
      const diagnostic = createToolBodyDocument(card, { ...options, diagnostics: true })
      expect(diagnostic.slice().at(-1)?.text).toBe('{"stdout":"same output"}')
      expect(stringify).toHaveBeenCalledWith(meta)
    } finally { stringify.mockRestore() }
  })

  it('keeps terminal exit facts and presenter output without duplicating raw metadata', () => {
    const document = createToolBodyDocument({ ...base, name: 'bash',
      resultText: 'raw duplicate', meta: { stdout: 'raw duplicate' },
      resultView: { card: 'terminal', output: 'command failed', exitCode: 2 },
    }, options)
    expect(document.slice().map(row => row.text)).toEqual(['结果', 'command failed', '进程状态', 'exitCode 2'])
  })

  it('retains a logged result when only the call has a specialized presenter', () => {
    const document = createToolBodyDocument({ ...base, name: 'bash',
      callView: { card: 'terminal', title: 'printf diagnostics' }, resultText: 'original outcome',
    }, { ...options, includeArguments: true })
    expect(document.slice().map(row => row.text)).toEqual(['参数', '{"value":1}', '结果', 'original outcome'])
  })

  it('advances within a very long logical line without breaking emoji or exposing controls', () => {
    const card = { ...base, arguments: '', resultText: `👩‍💻中${'x'.repeat(10000)}\x1b[2J\tEND` }
    const document = createToolBodyDocument(card, options)
    let cursor = { line: 0, offset: 0 }
    const text: string[] = []
    for (;;) {
      const page = planToolBodyWindow(document, cursor, 12, 4)
      expect(page.fragments.length).toBeLessThanOrEqual(4)
      const lines = page.fragments.map(row => materializeToolBodyRow(document, row).text)
      expect(lines.every(line => displayWidth(line) <= 12)).toBe(true)
      text.push(...lines)
      if (page.next === undefined) break
      expect(page.next.line > cursor.line || page.next.offset > cursor.offset).toBe(true)
      cursor = page.next
    }
    const out = text.join('')
    expect(out).toContain('👩‍💻中')
    expect(out).toContain('\\x1b[2J\\tEND')
    expect(out).not.toContain('\x1b')
  })

  it('renders vim-style diff with exact line numbers, gutter separator, and hunk headers', () => {
    const card: ToolBodyCard = {
      ...base,
      name: 'edit',
      resultView: {
        card: 'diff',
        title: 'Edit app.ts',
        diffs: [{
          path: 'src/app.ts',
          oldText: 'line1\nold2\nline3\n',
          newText: 'line1\nnew2\nline3\n',
          oldStart: 10,
          oldLines: 3,
          newStart: 10,
          newLines: 3,
          lines: [' line1', '-old2', '+new2', ' line3'],
        }],
      },
    }
    const document = createToolBodyDocument(card, options)
    const lines = document.slice().map(row => row.text)
    expect(lines).toEqual([
      'diff',
      '--- src/app.ts',
      '@@ -10,3 +10,3 @@',
      ' 10 │   line1',
      ' 11 │ - old2',
      ' 11 │ + new2',
      ' 12 │   line3',
    ])
  })

  it('computes fallback LCS diff with gutter line numbers when lines is omitted', () => {
    const card: ToolBodyCard = {
      ...base,
      name: 'edit',
      resultView: {
        card: 'diff',
        title: 'Edit simple.txt',
        diffs: [{
          path: 'simple.txt',
          oldText: 'alpha\nbeta\n',
          newText: 'alpha\ngamma\n',
        }],
      },
    }
    const document = createToolBodyDocument(card, options)
    const lines = document.slice().map(row => row.text)
    expect(lines).toEqual([
      'diff',
      '--- simple.txt',
      '@@ -1,2 +1,2 @@',
      '  1 │   alpha',
      '  2 │ - beta',
      '  2 │ + gamma',
    ])
  })

  it('does not duplicate file header across multiple hunks for the same file', () => {
    const card: ToolBodyCard = {
      ...base,
      name: 'edit',
      resultView: {
        card: 'diff',
        title: 'Edit multi.txt',
        diffs: [
          {
            path: 'multi.txt',
            oldText: 'a\n',
            newText: 'b\n',
            oldStart: 5,
            oldLines: 1,
            newStart: 5,
            newLines: 1,
            lines: ['-a', '+b'],
          },
          {
            path: 'multi.txt',
            oldText: 'x\n',
            newText: 'y\n',
            oldStart: 50,
            oldLines: 1,
            newStart: 50,
            newLines: 1,
            lines: ['-x', '+y'],
          },
        ],
      },
    }
    const document = createToolBodyDocument(card, options)
    const lines = document.slice().map(row => row.text)
    expect(lines).toEqual([
      'diff',
      '--- multi.txt',
      '@@ -5 +5 @@',
      '  5 │ - a',
      '  5 │ + b',
      '@@ -50 +50 @@',
      ' 50 │ - x',
      ' 50 │ + y',
    ])
  })
})
