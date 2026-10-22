import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString, useWindowSize } from 'ink'
import { SettingsPane, type SettingsPaneProps } from '../src/settings-pane.tsx'
import { displayWidth } from '../src/content.ts'
import * as content from '../src/content.ts'
import { applyTheme } from '../src/theme.ts'
import { InputBar } from '../src/input-bar.tsx'

vi.mock('ink', async original => ({ ...await original<typeof import('ink')>(), useWindowSize: vi.fn(() => ({ columns: 80, rows: 24 })) }))
afterEach(() => { applyTheme('truecolor'); vi.mocked(useWindowSize).mockReturnValue({ columns: 80, rows: 24 }) })
const categories = ['外观与输入', '模型与凭据', 'Agent Loop', 'Subagent', 'Web', 'Shell', '插件', '其他'].map((label, index) => ({ id: `group:${index}`, label, count: 2 }))
function screen(columns: number, overrides: Partial<SettingsPaneProps> = {}) {
  vi.mocked(useWindowSize).mockReturnValue({ columns, rows: 24 })
  const output = renderToString(createElement(SettingsPane, {
    rows: [{ namespace: 'llm-pi-ai', field: 'providers.acme.baseURL', label: 'baseURL', value: 'https://gateway.example/v1', description: '模型服务的接口地址' }],
    selectedIndex: 0, editing: false, maxRows: 20,
    breadcrumb: ['设置', '模型与凭据', 'llm-pi-ai', 'providers', 'acme'],
    categories, activeCategory: 'group:1', ...overrides,
  }), { columns })
  return { output, plain: output.replace(/\x1b\[[0-9;]*m/gu, '') }
}
for (const columns of [40, 80, 120]) {
  it(`shows an identifiable active category and actionable navigation at ${columns} columns`, () => {
    const { plain } = screen(columns)
    expect(plain).toContain('[模型与凭据]')
    expect(plain).toContain('Tab')
    expect(plain).toContain('Esc')
    expect(plain).toContain('Enter 编辑')
    expect(plain).not.toContain('Space')
    expect(plain).not.toContain('JSON')
    expect(plain).toContain('acme')
    expect(plain.split('\n').every(line => displayWidth(line) <= columns)).toBe(true)
    expect(plain.split('\n').length).toBeLessThanOrEqual(20)
  })
}
it('keeps the last selected tab visible in a narrow window and exposes previous categories', () => {
  const { plain } = screen(40, { activeCategory: 'group:7', breadcrumb: ['设置', '其他'] })
  expect(plain).toContain('[其他]')
  expect(plain).toContain('‹')
})
it('wraps the selected value in a detail area instead of losing its suffix', () => {
  const value = 'https://gateway.example/' + 'route/'.repeat(8) + 'unique-endpoint'
  const { plain } = screen(40, { rows: [{ namespace: 'llm', field: 'baseURL', value }], maxRows: 24 })
  expect(plain).toContain('unique-endpoint')
  expect(plain).toContain('当前值')
  expect(plain).not.toContain('i JSON')
})
it('bounds width measurement of long settings values while keeping controls visible', () => {
  const measure = vi.spyOn(content, 'displayWidth')
  try {
    const value = '中文👩‍💻á'.repeat(1000)
    const { plain } = screen(40, { rows: [{ namespace: 'llm', field: 'value', value }], maxRows: 12 })
    expect(plain).toContain('当前值')
    expect(plain).toContain('Enter 编辑')
    expect(plain).toContain('Esc')
    expect(plain).toContain('…')
    expect(plain.split('\n').length).toBeLessThanOrEqual(12)
    expect(plain.split('\n').every(line => displayWidth(line) <= 40)).toBe(true)
    expect(Math.max(...measure.mock.calls.map(([text]) => text.length))).toBeLessThan(200)
  } finally { measure.mockRestore() }
})
it('shows the full source identity for indistinguishable search results', () => {
  const { plain } = screen(80, { filter: 'contextWindow', rows: [{ namespace: 'llm-pi-ai', field: 'providers.acme.models.0.contextWindow', sourcePath: ['providers', 'acme', 'models', '0', 'contextWindow'], label: 'contextWindow', value: '32768' }] })
  expect(plain).toContain('providers.acme.models.0.contextWindow')
  expect(plain).toContain('搜索结果')
})
it('highlights a selected row against the ordinary row background', () => {
  const { output } = screen(80, { rows: [{ namespace: 'llm', field: 'one', value: '1' }, { namespace: 'llm', field: 'two', value: '2' }] })
  const lines = output.split('\n')
  const selected = lines.find(line => line.includes('› one')) ?? ''
  const ordinary = lines.find(line => line.includes('  two')) ?? ''
  expect(selected.match(/\x1b\[48;2;[0-9;]+m/u)?.[0]).not.toBe(ordinary.match(/\x1b\[48;2;[0-9;]+m/u)?.[0])
})
it('distinguishes a failed search from an empty settings service', () => {
  const { plain } = screen(40, { rows: [], filter: 'missing-setting' })
  expect(plain).toContain('没有匹配的设置')
  expect(plain).not.toContain('无可用设置')
})
it('keeps the active category identifiable without color', () => {
  applyTheme('none')
  expect(screen(40).plain).toContain('[模型与凭据]')
})
it('labels the settings draft as a value editor instead of a chat message', () => {
  const output = renderToString(createElement(InputBar, { text: 'https://gateway.example/v1', commandMode: false, mentionMode: false, actionHint: '设置值 · Enter 保存 · Esc 取消' }), { columns: 80 })
  expect(output).toContain('设置值 · Enter 保存 · Esc 取消')
  expect(output).not.toContain('输入消息')
  expect(output).not.toContain('Enter 发送')
})
