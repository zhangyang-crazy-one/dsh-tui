/** HelpPane rendering: lines, injection escaping, windowing with the loop-owned offset. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { HelpPane } from '../src/help-pane.tsx'

function renderPane(
  props: Partial<Parameters<typeof HelpPane>[0]>,
): string {
  return renderToString(
    createElement(HelpPane, {
      lines: [],
      offset: 0,
      ...props,
    }),
  )
}

const LINES = [
  '/help — 命令与键位速查',
  '/export — Export this session to a Markdown file',
  '/model — Switch the active model',
  '',
  '键位: Ctrl+C 停止/退出 · Ctrl+O 展开/收起推理',
  'Ctrl+E 工具卡 · y/n 审批 · /permission · /settings',
  'g a 子代理 · g t 工作区 · g f 反馈 · g w 工作流',
  '↑↓/jk 滚动 · g s 会话列表 · Tab 补全 · Esc 关闭',
  '/plan 计划 · /goal 目标 · /compact 压缩',
]

describe('HelpPane', () => {
  it('renders the help lines and the fgDim footer', () => {
    const out = renderPane({ lines: LINES })
    expect(out).toContain('/help — 命令与键位速查')
    expect(out).toContain('/model — Switch the active model')
    expect(out).toContain('Ctrl+C 停止/退出')
    expect(out).toContain('Ctrl+E 工具卡 · y/n 审批 · /permission')
    expect(out).toContain('g a 子代理 · g t 工作区 · g f 反馈 · g w 工作流')
    expect(out).toContain('/plan 计划 · /goal 目标 · /compact 压缩')
    expect(out).toContain('\x1b[38;2;138;143;152m↑↓/jk 滚动 · Esc/Enter 关闭')
  })

  it('escapes ANSI injected through command metadata', () => {
    const out = renderPane({
      lines: ['/evil — \u001b[31mred\u001b[0m description'],
    })
    expect(out).not.toContain('\u001b[31m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('red')
  })

  it('windows to 20 lines and scrolls with the offset', () => {
    const many = Array.from({ length: 25 }, (_, index) => `line ${index}`)
    const top = renderPane({ lines: many })
    expect(top).toContain('line 0')
    expect(top).not.toContain('line 24')
    const scrolled = renderPane({ lines: many, offset: 10 })
    expect(scrolled).toContain('line 10')
    expect(scrolled).toContain('line 24')
    expect(scrolled).not.toContain('line 0')
  })

  it('clamps the offset to the window edge and shows the top hint', () => {
    const many = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    const clamped = renderPane({ lines: many, offset: 100 })
    expect(clamped).toContain('line 10')
    expect(clamped).toContain('line 29')
    const hint = renderPane({ lines: many, offset: 10 })
    expect(hint).toContain('… 还有 10 行')
    expect(renderPane({ lines: many })).not.toContain('… 还有')
  })

  it('renders an empty sheet with only the footer', () => {
    const out = renderPane({ lines: [] })
    expect(out).toContain('↑↓/jk 滚动 · Esc/Enter 关闭')
  })
})
