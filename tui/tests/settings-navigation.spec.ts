import { describe, expect, it } from 'vitest'
import { SettingsNavigation, settingsTreeFromDescribe, settingsPathPatch } from '../src/settings-navigation.ts'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'

const value = {
  providers: {
    'very-long-provider-name': {
      api: 'openai-completions', baseURL: 'https://gateway.example/v1',
      models: [{ id: 'alpha', contextWindow: 32768, unknown: { costs: [1, 2] } }, { id: 'beta' }],
      extension: { nested: [{ name: 'preserve-me', enabled: false }] },
    },
  },
}
function tree(config: unknown = value) {
  return settingsTreeFromDescribe([{ ns: 'llm-pi-ai', value: config, schema: { type: 'object', dict: { providers: { type: 'dict', inner: { type: 'object', dict: { baseURL: { meta: { description: '接口地址', required: true } } } } } } } } as SettingsDescriptor], [])
}
function enter(nav: SettingsNavigation, label: string) {
  nav.selectedIndex = nav.rows.findIndex(row => row.label === label)
  expect(nav.selectedIndex).toBeGreaterThanOrEqual(0)
  expect(nav.enter()).toBe(true)
}
describe('settings hierarchy', () => {
  it('opens categories, namespace, provider list, provider fields and model details', () => {
    const nav = new SettingsNavigation(tree())
    expect(nav.rows.map(row => row.label)).toEqual(['模型与凭据'])
    enter(nav, '模型与凭据'); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    expect(nav.rows.map(row => row.label)).toContain('models')
    expect(nav.rows.find(row => row.label === 'baseURL')).toMatchObject({ description: '接口地址', required: true })
    enter(nav, 'models'); expect(nav.rows.map(row => row.label)).toEqual(['alpha', 'beta'])
    enter(nav, 'alpha'); expect(nav.rows.find(row => row.label === 'contextWindow')?.value).toBe('32768')
    expect(nav.breadcrumb).toContain('alpha')
    nav.back(); expect(nav.rows[nav.selectedIndex]?.label).toBe('alpha')
    nav.back(); expect(nav.rows[nav.selectedIndex]?.label).toBe('models')
  })
  it('browses unknown arrays and objects and preserves selection through rebuilds', () => {
    const nav = new SettingsNavigation(tree())
    enter(nav, '模型与凭据'); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    enter(nav, 'extension'); enter(nav, 'nested'); enter(nav, 'preserve-me')
    nav.selectedIndex = 1
    nav.replace(tree())
    expect(nav.rows[nav.selectedIndex]?.label).toBe('enabled')
    expect(nav.rows[nav.selectedIndex]?.sourcePath).toEqual(['providers', 'very-long-provider-name', 'extension', 'nested', '0', 'enabled'])
  })
  it('searches all paths and values and returns to the prior object', () => {
    const nav = new SettingsNavigation(tree())
    enter(nav, '模型与凭据')
    nav.search('32768')
    expect(nav.rows).toHaveLength(1)
    expect(nav.rows[0]?.field).toBe('providers.very-long-provider-name.models.0.contextWindow')
    nav.search(''); expect(nav.rows[0]?.label).toBe('llm-pi-ai')
  })
  it('updates array leaves and literal dotted keys without dropping unknown siblings', () => {
    const original = { 'a.b': [{ enabled: false, unknown: 'keep' }, { enabled: true }], extra: 7 }
    expect(settingsPathPatch(original, ['a.b', '0', 'enabled'], true)).toEqual({ 'a.b': [{ enabled: true, unknown: 'keep' }, { enabled: true }] })
    expect(original['a.b'][0]?.enabled).toBe(false)
  })
})

it('sends sparse object patches and retains user-only model attributes when copying arrays', () => {
  const resolved = { providers: { acme: { api: 'default-api', models: [{ id: 'x', contextWindow: 4096 }] } } }
  const user = { providers: { acme: { models: [{ id: 'x', extension: 'keep' }] } } }
  expect(settingsPathPatch(resolved, ['providers', 'acme', 'models', '0', 'contextWindow'], 8192, user)).toEqual({ providers: { acme: { models: [{ id: 'x', extension: 'keep', contextWindow: 8192 }] } } })
  expect(settingsPathPatch(resolved, ['providers', 'acme', 'api'], 'new-api', user)).toEqual({ providers: { acme: { api: 'new-api' } } })
})

it('retains the same model and field when model arrays reorder on reload', () => {
  const nav = new SettingsNavigation(tree())
  enter(nav, '模型与凭据'); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name'); enter(nav, 'models'); enter(nav, 'alpha')
  nav.selectedIndex = 1
  const changed = structuredClone(value)
  changed.providers['very-long-provider-name'].models.reverse()
  nav.replace(tree(changed))
  expect(nav.breadcrumb.at(-1)).toBe('alpha')
  expect(nav.rows[nav.selectedIndex]?.label).toBe('contextWindow')
  expect(nav.rows[nav.selectedIndex]?.sourcePath).toEqual(['providers', 'very-long-provider-name', 'models', '1', 'contextWindow'])
})

it('omits secret fields and refuses editing their containing JSON while retaining safe child navigation', () => {
  const nodes = settingsTreeFromDescribe([{ ns: 'custom', value: { nested: { token: 'REDACTED', enabled: true } }, secrets: [{ path: ['nested', 'token'] }], schema: {} } as SettingsDescriptor], [])
  expect(nodes.some(row => row.field === 'nested.token')).toBe(false)
  expect(nodes.find(row => row.field === 'nested')).toMatchObject({ editable: false, navigable: true })
  expect(nodes.find(row => row.field === 'nested.enabled')?.value).toBe('true')
})


describe('settings category tabs', () => {
  function categories() {
    return settingsTreeFromDescribe([
      { ns: 'llm-pi-ai', value },
      { ns: 'tui', value: { theme: 'dark', nested: { enabled: true, other: false } } },
      { ns: 'web-search', value: { enabled: true } },
      { ns: 'llm-deepseek', value: { model: 'deepseek' } },
    ] as SettingsDescriptor[], [])
  }
  it('retains the constructor root but opens the first category without a redundant overview', () => {
    const nav = new SettingsNavigation(categories())
    expect(nav.rows.map(row => row.label)).toEqual(['模型与凭据', '外观与输入', 'Web'])
    expect(nav.categories).toEqual([
      { id: 'group:providers', label: '模型与凭据', count: 2 },
      { id: 'group:appearance', label: '外观与输入', count: 1 },
      { id: 'group:web', label: 'Web', count: 1 },
    ])
    expect(nav.activeCategory).toBeUndefined()
    nav.open()
    expect(nav.activeCategory).toBe('group:providers')
    expect(nav.rows.map(row => row.label)).toEqual(['llm-pi-ai', 'llm-deepseek'])
    expect(nav.back()).toBe(false)
  })
  it('visits the last category when cycling backwards from the constructor root', () => {
    const nav = new SettingsNavigation(categories())
    nav.group(-1)
    expect(nav.activeCategory).toBe('group:web')
    expect(nav.rows.map(row => row.label)).toEqual(['web-search'])
  })
  it('remembers each category deep location and selection in either direction', () => {
    const nav = new SettingsNavigation(categories())
    nav.open()
    enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    nav.selectedIndex = nav.rows.findIndex(row => row.label === 'models')
    nav.group(1)
    expect(nav.rows.map(row => row.label)).toEqual(['tui'])
    enter(nav, 'tui'); enter(nav, 'nested'); nav.selectedIndex = 1
    nav.group(-1)
    expect(nav.breadcrumb.at(-1)).toBe('very-long-provider-name')
    expect(nav.rows[nav.selectedIndex]?.label).toBe('models')
    nav.group(1)
    expect(nav.breadcrumb.at(-1)).toBe('nested')
    expect(nav.rows[nav.selectedIndex]?.label).toBe('other')
    expect(nav.back()).toBe(true)
    expect(nav.rows[nav.selectedIndex]?.label).toBe('nested')
  })
  it('returns search to the prior selection and does not save search results as category positions', () => {
    const nav = new SettingsNavigation(categories())
    nav.open(); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    nav.selectedIndex = nav.rows.findIndex(row => row.label === 'models')
    nav.search('32768')
    expect(nav.rows).toHaveLength(1)
    expect(nav.back()).toBe(true)
    expect(nav.rows[nav.selectedIndex]?.label).toBe('models')
    nav.search('32768'); nav.group(1); nav.group(-1)
    expect(nav.filter).toBe('')
    expect(nav.breadcrumb.at(-1)).toBe('very-long-provider-name')
    expect(nav.rows[nav.selectedIndex]?.label).toBe('models')
  })
  it('keeps the selected result when completing the same search query', () => {
    const nav = new SettingsNavigation(categories())
    nav.open(); enter(nav, 'llm-pi-ai')
    nav.search('false')
    expect(nav.rows.length).toBeGreaterThan(1)
    nav.selectedIndex = 1
    const selectedId = nav.rows[1]!.id
    nav.search('false')
    expect(nav.selectedIndex).toBe(1)
    expect(nav.rows[nav.selectedIndex]?.id).toBe(selectedId)
    nav.search('true')
    expect(nav.selectedIndex).toBe(0)
  })
  it('prunes deleted deep locations in inactive categories before returning to them', () => {
    const nav = new SettingsNavigation(categories())
    nav.open(); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    nav.group(1)
    const providerId = 'ns:llm-pi-ai:"providers":"very-long-provider-name"'
    nav.replace(categories().filter(node => !node.id.startsWith(providerId)))
    nav.group(-1)
    expect(nav.breadcrumb.at(-1)).toBe('providers')
    expect(nav.rows.map(row => row.label)).toEqual(['+ 添加 Provider'])
  })
  it('cleans removed category positions and falls back to the surviving parent after deletion', () => {
    const nav = new SettingsNavigation(categories())
    nav.open(); enter(nav, 'llm-pi-ai'); enter(nav, 'providers'); enter(nav, 'very-long-provider-name')
    nav.group(1); enter(nav, 'tui'); enter(nav, 'nested')
    const changed = categories().filter(node => node.id !== 'ns:tui:"nested"' && node.parentId !== 'ns:tui:"nested"')
    nav.replace(changed)
    expect(nav.breadcrumb.at(-1)).toBe('tui')
    expect(nav.rows.map(row => row.label)).toEqual(['theme'])
    nav.group(-1); nav.group(1)
    expect(nav.breadcrumb.at(-1)).toBe('tui')
    nav.replace(categories().filter(node => !node.id.startsWith('ns:tui') && node.id !== 'group:appearance'))
    nav.group(1)
    expect(nav.activeCategory).toBe('group:providers')
    nav.group(-1)
    expect(nav.activeCategory).toBe('group:web')
  })
})
