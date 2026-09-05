/** Tool detail windows retain canonical text while formatting only requested rows. */
import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolCardModel } from '../src/tool-cards.ts'
import { createToolBodyDocument, planToolBodyWindow, materializeToolBodyRow, toolCardOriginalText } from '../src/tool-body.ts'
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
})
