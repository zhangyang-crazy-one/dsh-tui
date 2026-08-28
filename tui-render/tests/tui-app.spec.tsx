import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { TuiApp } from '../src/index.ts'
import type { ViewModel } from '../src/projection.ts'

function model(status: ViewModel['status']): ViewModel {
  return {
    history: [{ kind: 'assistant', text: 'settled message' }],
    activeTurn:
      status === 'generating'
        ? {
          turn: 1,
          assistantText: 'growing',
          reasoningText: '',
          toolCalls: [],
          reasoningDurationMs: 10,
        }
        : undefined,
    status,
    scrollOffset: 0,
    unseenCount: 0,
    reasoningExpanded: false,
    toolCardsExpanded: false,
  }
}

describe('TuiApp', () => {
  it('renders the title, badge, and stream view', () => {
    const out = renderToString(
      createElement(TuiApp, {
        title: 'deepseek-tui',
        badge: 'deepseek-official · deepseek-chat',
        model: model('idle'),
      }),
    )
    expect(out).toContain('deepseek-tui')
    expect(out).toContain('deepseek-official · deepseek-chat')
    expect(out).toContain('settled message')
  })

  it('shows the stop hint while generating and the continue hint when stopped', () => {
    const generating = renderToString(
      createElement(TuiApp, {
        title: 't',
        badge: 'b',
        model: model('generating'),
      }),
    )
    expect(generating).toContain('⏹ Ctrl+C 停止')
    const stopped = renderToString(
      createElement(TuiApp, {
        title: 't',
        badge: 'b',
        model: model('stopped'),
      }),
    )
    expect(stopped).toContain('继续生成')
  })
})
