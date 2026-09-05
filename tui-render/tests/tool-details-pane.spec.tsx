/** Source pages retain the selected action and failure status above long results. */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { EMPTY_TOOL_DETAILS_PANE, ToolDetailsPane } from '../src/tool-details-pane.tsx'
import { displayWidth } from '../src/content.ts'
import { stripTerminalControls } from './helpers.ts'

describe('ToolDetailsPane', () => {
  it.each([80, 112])('retains failure identity before source content in %i columns', (columns) => {
    const text = stripTerminalControls(renderToString(createElement(ToolDetailsPane, {
      state: { ...EMPTY_TOOL_DETAILS_PANE, open: true, detail: true, cards: [{
        callId: ToolCallId('failed-source'), name: 'bash', arguments: '{}', status: 'error',
        callView: { card: 'terminal', title: 'printf diagnostics' },
        resultText: 'first result line\n[exit code: 2]',
      }] }, columns, maxRows: 20, pageRows: 16, locale: 'zh-CN',
    }), { columns }))
    const heading = text.split('\n')[0] ?? ''
    expect(heading).toContain('/tools · 1/1')
    expect(heading).toContain('printf diagnostics')
    expect(heading).toContain('失败')
    expect(displayWidth(heading)).toBeLessThanOrEqual(columns)
    expect(text).toContain('first result line')
    expect(text).toContain('Esc 返回')
  })
})
