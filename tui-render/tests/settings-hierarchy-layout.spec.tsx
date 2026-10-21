import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString, useWindowSize } from 'ink'
import { SettingsPane } from '../src/settings-pane.tsx'
import { displayWidth } from '../src/content.ts'
vi.mock('ink', async original => ({ ...await original<typeof import('ink')>(), useWindowSize: vi.fn(() => ({ columns: 80, rows: 24 })) }))
afterEach(() => vi.mocked(useWindowSize).mockReturnValue({ columns: 80, rows: 24 }))
for (const columns of [40, 80, 120]) {
  it(`keeps field, value, errors and controls within 12 physical rows at ${String(columns)} columns`, () => {
    vi.mocked(useWindowSize).mockReturnValue({ columns, rows: 24 })
    const rows = Array.from({ length: 80 }, (_, index) => ({ namespace: 'llm-pi-ai', field: `providers.provider-with-a-very-long-name-${String(index)}.baseURL`, label: `很长的字段名称-${'name'.repeat(20)}`, value: 'https://gateway.example/v1', description: '接口地址与协议设置' }))
    const output = renderToString(createElement(SettingsPane, { rows, selectedIndex: 20, editing: false, maxRows: 12, breadcrumb: ['设置', '模型与凭据', 'llm-pi-ai', 'very-long-provider-name'], updateError: '服务器拒绝保存：'.repeat(10), filter: 'gateway' }), { columns })
    const plain = output.replace(/\x1b\[[0-9;]*m/gu, '')
    const lines = plain.split('\n')
    expect(lines.length).toBeLessThanOrEqual(12)
    expect(lines.every(line => displayWidth(line) <= columns)).toBe(true)
    expect(plain).toContain('https://gateway')
    expect(plain).toContain('✗')
    expect(plain).toContain('Enter')
    expect(plain).toContain('Esc')
    expect(plain).toContain('搜索')
  })
}
for (const columns of [40, 80, 120]) for (const maxRows of [4, 6, 8]) {
  it(`retains value, failure and actions inside ${String(maxRows)} rows at ${String(columns)} columns`, () => {
    vi.mocked(useWindowSize).mockReturnValue({ columns, rows: 12 })
    const output = renderToString(createElement(SettingsPane, { rows: Array.from({ length: 20 }, (_, index) => ({ namespace: 'llm-pi-ai', field: `field-${String(index)}`, label: 'field'.repeat(40), value: 'https://gateway.example/v1', description: 'optional description' })), selectedIndex: 10, editing: false, breadcrumb: ['设置', 'models', 'alpha'], filter: 'gateway', updateError: 'rejected'.repeat(40), maxRows }), { columns })
    const plain = output.replace(/\x1b\[[0-9;]*m/gu, '')
    expect(plain.split('\n').length).toBeLessThanOrEqual(maxRows)
    expect(plain).toContain('https://gateway')
    expect(plain).toContain('✗')
    expect(plain).toContain('Enter')
    expect(plain).toContain('Esc')
  })
}
