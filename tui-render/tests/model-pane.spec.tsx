/** ModelPane rendering: rows, current marker, injection escaping, windowing, state triple. */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { ModelPane } from '../src/model-pane.tsx'
import type { ModelRow } from '../src/model-pane.tsx'

function rows(...entries: Array<[provider: string, model: string]>): ModelRow[] {
  return entries.map(([provider, model], index) => ({
    id: `${provider}:${model}`,
    provider,
    model,
    name: model,
    fallback: false,
    current: index === 0,
  }))
}

function renderPane(
  props: Partial<Parameters<typeof ModelPane>[0]>,
): string {
  return renderToString(
    createElement(ModelPane, {
      filter: '',
      rows: [],
      selectedIndex: 0,
      ...props,
    }),
  )
}

describe('ModelPane', () => {
  it('renders the filter, model names, provider routes, and the footer', () => {
    const out = renderPane({
      filter: 'deep',
      rows: rows(['deepseek-official', 'deepseek-chat']),
      selectedIndex: 0,
    })
    expect(out).toContain('模型: deep')
    expect(out).toContain('deepseek-chat')
    expect(out).toContain('deepseek-official')
    expect(out).toContain('↑↓/jk 选择 · Enter 切换 · Esc 关闭')
  })

  it('styles the selected row: bold accent prefix, fg model, fgDim provider', () => {
    const out = renderPane({
      rows: rows(['deepseek-official', 'deepseek-chat']),
      selectedIndex: 0,
    })
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254m› ')
    expect(out).toContain('\x1b[38;2;138;143;152mdeepseek-official')
    expect(out).toContain('\x1b[38;2;138;143;152m↑↓/jk 选择 · Enter 切换 · Esc 关闭')
  })

  it('marks the live selection with the accentDim tail', () => {
    const out = renderPane({
      rows: [
        { id: 'p:a', provider: 'p', model: 'a', name: 'a', fallback: false, current: false },
        { id: 'p:b', provider: 'p', model: 'b', name: 'b', fallback: false, current: true },
      ],
      selectedIndex: 1,
    })
    expect(out).toContain('\x1b[38;2;52;65;91m · 当前')
  })

  it('escapes ANSI injected through the filter, model names, and provider routes', () => {
    const out = renderPane({
      filter: '\u001b[31mred\u001b[0m',
      rows: [
        { id: 'p:x', provider: '\u001b[32mprov\u001b[0m', model: 'x', name: '\u001b[33mname\u001b[0m', fallback: false, current: false },
      ],
    })
    expect(out).not.toContain('\u001b[31m')
    expect(out).not.toContain('\u001b[32m')
    expect(out).not.toContain('\u001b[33m')
    expect(out).toContain('\\x1b')
    expect(out).toContain('red')
    expect(out).toContain('prov')
    expect(out).toContain('name')
  })

  it('windows to 30 rows and shows the truncation hint', () => {
    const many = Array.from({ length: 35 }, (_, index) => ({
      id: `p:m-${index}`,
      provider: 'p',
      model: `m-${index}`,
      name: `m-${index}`,
      fallback: false,
      current: false,
    }))
    const out = renderPane({ rows: many })
    expect(out).toContain('m-0')
    expect(out).not.toContain('m-34')
    expect(out).toContain('还有 5 个模型')
  })

  it('shows the loading, error, and empty states mutually exclusively', () => {
    const loading = renderPane({ status: 'loading', rows: rows(['p', 'a']) })
    expect(loading).toContain('加载中…')
    expect(loading).not.toContain('无可用模型')
    expect(loading).not.toContain('p')
    const error = renderPane({ status: 'error', error: 'adapter down' })
    expect(error).toContain('✗ 加载失败：adapter down')
    expect(error).not.toContain('加载中…')
    const bareError = renderPane({ status: 'error' })
    expect(bareError).toContain('✗ 加载失败：模型目录不可用')
    expect(renderPane({})).toContain('无可用模型')
  })

  it('does not render stale rows while loading or after an error', () => {
    const loading = renderPane({
      status: 'loading',
      rows: rows(['p', 'stale']),
    })
    expect(loading).not.toContain('stale')
    const error = renderPane({
      status: 'error',
      rows: rows(['p', 'stale']),
    })
    expect(error).not.toContain('stale')
  })

  it('renders the degraded fallback row like any other row', () => {
    const out = renderPane({
      rows: [
        {
          id: 'default:p',
          provider: 'p',
          model: 'default-model',
          name: 'default-model',
          fallback: true,
          current: true,
        },
      ],
      selectedIndex: 0,
    })
    expect(out).toContain('default-model')
    expect(out).toContain(' · 当前')
  })
})
