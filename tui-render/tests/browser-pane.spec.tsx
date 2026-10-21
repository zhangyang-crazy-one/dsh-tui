import { createElement } from 'react'
import { renderToString } from 'ink'
import { stripVTControlCharacters } from 'node:util'
import { expect, it } from 'vitest'
import { BrowserPane, EMPTY_BROWSER_PANE } from '../src/browser-pane.tsx'

it('bounds large lists and full text while preserving accessible footer and source', () => {
  const state = { ...EMPTY_BROWSER_PANE, open: true, title: '事件轨迹',
    rows: Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: `ROW_${i}` })), selectedIndex: 9999 }
  const output = stripVTControlCharacters(renderToString(createElement(BrowserPane, { state, maxRows: 10, maxCols: 40 })))
  expect(output).toContain('ROW_9999')
  expect(output).not.toContain('ROW_0')
  expect(output.split('\n').length).toBeLessThanOrEqual(10)
  const detail = stripVTControlCharacters(renderToString(createElement(BrowserPane, { state: {
    ...state, detail: '中文\n'.repeat(1000) + 'END_DETAIL\x1b[2J', offset: Number.MAX_SAFE_INTEGER,
  }, maxRows: 10, maxCols: 40 })))
  expect(detail).toContain('END_DETAIL')
  expect(detail).not.toContain('\x1b[2J')
  expect(detail).toContain('Esc')
})
