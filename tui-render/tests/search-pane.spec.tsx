/** SearchPane rendering: candidates, snippets, injection escaping, windowing. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { SearchPane } from '../src/search-pane.tsx'
import type { SearchCandidate } from '../src/search-pane.tsx'

function candidates(...rows: Array<[string, string, string]>): SearchCandidate[] {
  return rows.map(([id, title, snippet], index) => ({
    id,
    title,
    snippet: snippet ?? `snippet ${index}`,
  }))
}

function renderPane(props: Partial<Parameters<typeof SearchPane>[0]>): string {
  return renderToString(
    createElement(SearchPane, {
      query: '',
      results: [],
      selectedIndex: 0,
      ...props,
    }),
  )
}

describe('SearchPane', () => {
  it('renders the query, candidate titles, and match snippets', () => {
    const out = renderPane({
      query: '备份',
      results: candidates(
        ['session-1', '数据备份方案', '…备份到远程…'],
        ['session-2', '日志备份', '…每日备份…'],
        ['session-3', '恢复演练', '…从备份恢复…'],
      ),
      selectedIndex: 1,
    })
    expect(out).toContain('搜索: 备份')
    expect(out).toContain('数据备份方案')
    expect(out).toContain('…备份到远程…')
    expect(out).toContain('日志备份')
    expect(out).toContain('› ')
    expect(out).toContain('↑↓/jk 选择 · Enter 恢复 · Esc 关闭')
  })

  it('styles the selected prefix bold accent and the footer in fgDim', () => {
    const out = renderPane({
      results: candidates(['s-1', 'alpha', 'snippet']),
      selectedIndex: 0,
    })
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254m› ')
    expect(out).toContain('\x1b[38;2;164;169;176m↑↓/jk 选择 · Enter 恢复 · Esc 关闭')
  })

  it('escapes ANSI injected through the query and the candidates', () => {
    const out = renderPane({
      query: '\u001b[31mred\u001b[0m',
      results: candidates(['s-1', '\u001b[32mtitle\u001b[0m', '\u001b[33msnip\u001b[0m']),
    })
    expect(out).not.toContain('\u001b[31m')
    expect(out).not.toContain('\u001b[32m')
    expect(out).not.toContain('\u001b[33m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('red')
    expect(out).toContain('title')
    expect(out).toContain('snip')
  })

  it('windows to 30 candidates and shows the truncation hint', () => {
    const many = Array.from({ length: 35 }, (_, index) => ({
      id: `s-${index}`,
      title: `title ${index}`,
      snippet: `snippet ${index}`,
    }))
    const out = renderPane({ results: many })
    expect(out).toContain('title 0')
    expect(out).not.toContain('title 34')
    expect(out).toContain('还有 5 条结果')
  })

  it('prompts for a query when empty and reports no matches otherwise', () => {
    expect(renderPane({ query: '' })).toContain('输入关键词搜索会话')
    expect(renderPane({ query: '无此词' })).toContain('无匹配会话')
  })

  it('shows the loading and error states mutually exclusively (S1)', () => {
    const loading = renderPane({ query: 'word', status: 'searching' })
    expect(loading).toContain('搜索中…')
    expect(loading).not.toContain('无匹配会话')
    const error = renderPane({ query: 'word', status: 'error' })
    expect(error).toContain('搜索失败，请重试')
    expect(error).not.toContain('搜索中…')
    expect(error).not.toContain('无匹配会话')
  })

  it('does not render candidates while searching', () => {
    const out = renderPane({
      query: 'word',
      status: 'searching',
      results: candidates(['s-1', 'stale title', 'stale snippet']),
    })
    expect(out).toContain('搜索中…')
    expect(out).not.toContain('stale title')
  })
})
