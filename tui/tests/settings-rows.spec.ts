/**
 * Overlay row projection from settings.describe() values.
 */

import { describe, expect, it } from 'vitest'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import {
  credentialSettingRows,
  isAutoDiscoverProviderDraft,
  parseCustomProviderDraft,
  parseProviderFormDraft,
  parseSettingValue,
  parseSettingsFieldValue,
  settingsRowsFromDescribe,
  stringifySettingValue,
  stringifySettingsFieldValue,
} from '../src/settings-rows.ts'

function descriptor(ns: string, secrets: SettingsDescriptor['secrets'] = []): SettingsDescriptor {
  return {
    ns: ns as SettingsDescriptor['ns'],
    schema: {},
    value: {},
    revision: 0,
    applies: 'live',
    ...(secrets.length === 0 ? {} : { secrets }),
  }
}

describe('stringifySettingValue / parseSettingValue', () => {
  it('round-trips strings, numbers, booleans, and JSON objects', () => {
    expect(stringifySettingValue('https://api.example')).toBe('https://api.example')
    expect(parseSettingValue('https://api.example', 'https://next.example')).toBe('https://next.example')
    expect(stringifySettingValue(300_000)).toBe('300000')
    expect(parseSettingValue(300_000, '1')).toBe(1)
    expect(stringifySettingValue(true)).toBe('true')
    expect(parseSettingValue(false, 'true')).toBe(true)
    expect(stringifySettingValue({ id: 'm' })).toBe('{"id":"m"}')
    expect(stringifySettingValue(null)).toBe('null')
    expect(parseSettingValue(null, 'null')).toBe(null)
    expect(parseSettingValue(true, 'false')).toBe(false)
    expect(parseSettingValue([{ id: 'a' }], '[{"id":"b"}]')).toEqual([{ id: 'b' }])
  })

  it('rejects invalid JSON, booleans, and non-finite numbers', () => {
    expect(() => parseSettingValue({}, '{')).toThrow('JSON 无效')
    expect(() => parseSettingValue(true, 'yes')).toThrow('需要 true 或 false')
    expect(() => parseSettingValue(1, 'nope')).toThrow('需要有限数字')
  })
})

describe('brandAnimation setting vocabulary', () => {
  it('presents Chinese labels while preserving the stored union', () => {
    expect(stringifySettingsFieldValue('tui', 'brandAnimation', 'auto')).toBe('自动')
    expect(stringifySettingsFieldValue('tui', 'brandAnimation', 'on')).toBe('开启')
    expect(stringifySettingsFieldValue('tui', 'brandAnimation', 'off')).toBe('关闭')
    expect(parseSettingsFieldValue('tui', 'brandAnimation', 'auto', '自动')).toBe('auto')
    expect(parseSettingsFieldValue('tui', 'brandAnimation', 'auto', 'on')).toBe('on')
    expect(() => parseSettingsFieldValue('tui', 'brandAnimation', 'auto', '循环'))
      .toThrow('需要 自动、开启 或 关闭')
  })

  it('does not translate an identical field outside the tui namespace', () => {
    expect(stringifySettingsFieldValue('other', 'brandAnimation', 'auto')).toBe('auto')
    expect(parseSettingsFieldValue('other', 'brandAnimation', 'auto', '关闭')).toBe('关闭')
  })
})

describe('credential-ref field defense', () => {
  it('rejects literal API keys in apiKeyEnv', () => {
    expect(() => parseSettingsFieldValue('llm-deepseek', 'apiKeyEnv', 'DEEPSEEK_API_KEY', 'sk-abcdef123456'))
      .toThrow('apiKeyEnv 是环境变量名（如 DEEPSEEK_API_KEY），请勿输入真实密钥；请用 /key DEEPSEEK_API_KEY <密钥> 配置该变量')
  })

  it('rejects invalid environment variable identifiers in apiKeyEnv', () => {
    expect(() => parseSettingsFieldValue('llm-deepseek', 'apiKeyEnv', 'DEEPSEEK_API_KEY', 'not an env!'))
      .toThrow('apiKeyEnv 需要合法的环境变量名（例如 DEEPSEEK_API_KEY）')
  })

  it('accepts valid environment variable names in apiKeyEnv', () => {
    expect(parseSettingsFieldValue('llm-deepseek', 'apiKeyEnv', 'DEEPSEEK_API_KEY', 'CUSTOM_API_KEY'))
      .toBe('CUSTOM_API_KEY')
  })
})

describe('settingsRowsFromDescribe', () => {
  it('orders leading namespaces and stringifies nested catalogs', () => {
    const deepseek = 'llm-deepseek'
    const openai = 'llm-openai'
    const pi = 'llm-pi-ai'
    const shell = 'shell'
    const values: Record<string, unknown> = {
      [deepseek]: {
        baseURL: 'https://api.deepseek.com',
        models: [{ id: 'deepseek-v4-flash' }],
      },
      [openai]: { baseURL: 'https://api.openai.com/v1' },
      [pi]: { providers: { acme: { api: 'openai-completions', baseURL: 'https://gw.example' } } },
      [shell]: { timeoutMs: 30 },
    }
    const rows = settingsRowsFromDescribe(
      [
        descriptor('shell'),
        descriptor('llm-pi-ai'),
        descriptor('llm-openai'),
        descriptor('llm-deepseek'),
      ],
      ns => values[ns],
    )
    expect(rows.map(row => `${row.namespace} · ${row.field}`)).toEqual([
      'llm-deepseek · baseURL',
      'llm-deepseek · models',
      'llm-openai · baseURL',
      'llm-pi-ai · providers',
      'shell · timeoutMs',
    ])
    expect(rows[1]?.value).toBe('deepseek-v4-flash')
    expect(rows[1]?.editValue).toBe('[{"id":"deepseek-v4-flash"}]')
  })

  it('shows brandAnimation with the approved label in the leading tui section', () => {
    const rows = settingsRowsFromDescribe(
      [descriptor('llm-deepseek'), descriptor('tui')],
      ns => String(ns) === 'tui'
        ? { submitOnEnter: true, brandAnimation: 'auto' }
        : { baseURL: 'https://api.deepseek.com' },
    )
    expect(rows.slice(0, 2)).toEqual([
      { namespace: 'tui', field: 'submitOnEnter', value: 'true' },
      { namespace: 'tui', field: 'brandAnimation', value: '自动' },
    ])
  })

  it('omits secret heads from redacted descriptors', () => {
    const ns = 'llm-deepseek'
    const rows = settingsRowsFromDescribe(
      [descriptor('llm-deepseek', [{ path: ['apiKey'], set: true }])],
      () => ({ apiKey: 'sk-hidden', baseURL: 'https://api.deepseek.com' }),
    )
    expect(rows).toEqual([
      { namespace: ns, field: 'baseURL', value: 'https://api.deepseek.com' },
    ])
  })

  it('skips a namespace whose get() is not a plain object', () => {
    const rows = settingsRowsFromDescribe(
      [descriptor('llm-deepseek'), descriptor('shell')],
      ns => String(ns) === 'shell' ? 1 : { baseURL: 'https://api.deepseek.com' },
    )
    expect(rows).toEqual([
      { namespace: 'llm-deepseek', field: 'baseURL', value: 'https://api.deepseek.com' },
    ])
  })

  it('accepts null-prototype objects and sorts remaining namespaces', () => {
    const shell = 'shell'
    const fs = 'fs'
    const values: Record<string, unknown> = {
      [shell]: Object.assign(Object.create(null) as Record<string, unknown>, { timeoutMs: 30, graceMs: 3 }),
      [fs]: { maxBytes: 1 },
    }
    const rows = settingsRowsFromDescribe(
      [
        descriptor('fs'),
        descriptor('shell', [{ path: [], set: false }]),
      ],
      ns => values[ns],
    )
    expect(rows.map(row => `${row.namespace} · ${row.field}`)).toEqual([
      'fs · maxBytes',
      'shell · graceMs',
      'shell · timeoutMs',
    ])
  })
  it('formats models as comma-separated string and parses comma-separated inputs', () => {
    expect(parseSettingsFieldValue('llm-pi-ai', 'providers.siliconflow.models', [], 'deepseek-v3, deepseek-r1'))
      .toEqual([{ id: 'deepseek-v3' }, { id: 'deepseek-r1' }])
    expect(stringifySettingsFieldValue('llm-pi-ai', 'providers.siliconflow.models', [{ id: 'm1' }, { id: 'm2' }]))
      .toBe('m1, m2')
  })

  it('pre-fills provider template when selecting by name or index', () => {
    const prefilled = parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'siliconflow') as Record<string, unknown>
    expect(prefilled['siliconflow']).toMatchObject({
      api: 'openai-completions',
      baseURL: 'https://api.siliconflow.cn/v1',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
      displayName: '硅基流动',
    })
    const byIndex = parseSettingsFieldValue('llm-pi-ai', 'providers', {}, '2') as Record<string, unknown>
    expect(Object.keys(byIndex)).toEqual(['deepseek-api'])
  })

  it('adds a catalog provider by name and refuses an unknown one instead of silently substituting', () => {
    const known = ['openai', 'anthropic', 'deepseek', 'openai-codex']
    const added = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      { siliconflow: { api: 'openai-completions', baseURL: 'https://x' } },
      'openai',
      known,
    ) as Record<string, unknown>
    expect(added['openai']).toEqual({ apiKeyEnv: 'OPENAI_API_KEY' })
    expect(added['siliconflow']).toEqual({ api: 'openai-completions', baseURL: 'https://x' })
    const hyphenated = parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'openai-codex', known) as Record<string, unknown>
    expect(hyphenated['openai-codex']).toEqual({ apiKeyEnv: 'OPENAI_CODEX_API_KEY' })
    // Unknown names and blank input must be visible refusals: an earlier silent
    // fallback made every unrecognized name re-add the first template, which read
    // as "adding a provider does nothing".
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'my-gateway', known))
      .toThrow('未知 Provider "my-gateway"')
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers', {}, '   ', known))
      .toThrow('请输入 Provider 名称、模板序号，或按表单填写')
  })

  it('declares a custom provider from the one-line name/endpoint/model form', () => {
    const declared = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      { siliconflow: { api: 'openai-completions', baseURL: 'https://x' } },
      'my-gw https://gw.example/v1 gpt-4o,gpt-4o-mini',
      [],
    ) as Record<string, unknown>
    expect(declared['my-gw']).toEqual({
      api: 'openai-completions',
      baseURL: 'https://gw.example/v1',
      apiKeyEnv: 'MY_GW_API_KEY',
      displayName: 'my-gw',
      models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
    })
    // The protocol token overrides the OpenAI-compatible default.
    const anthropic = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'gw2 https://gw/v1 m1 api=anthropic',
      [],
    ) as Record<string, unknown>
    expect(anthropic['gw2']).toMatchObject({ api: 'anthropic', models: [{ id: 'm1' }] })
    // Two tokens — name and endpoint alone — defer model assembly to discovery.
    const auto = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'my-gw https://gw.example/v1',
      [],
    )
    expect(isAutoDiscoverProviderDraft(auto)).toBe(true)
    expect(auto).toMatchObject({
      name: 'my-gw',
      api: 'openai-completions',
      baseURL: 'https://gw.example/v1',
      apiKeyEnv: 'MY_GW_API_KEY',
      displayName: 'my-gw',
    })
    // A route the catalog does not describe still validates name, baseURL,
    // and the field the user typed while still looking at it. An empty
    // models list with the literal `auto` token is the explicit auto-discover.
    const autoFromKeyword = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'my-gw https://gw/v1 auto api=anthropic',
      [],
    )
    expect(isAutoDiscoverProviderDraft(autoFromKeyword)).toBe(true)
    expect(autoFromKeyword).toMatchObject({ api: 'anthropic' })
    // Mixed tokens that include at least one real model name still parse as a
    // manual profile — `auto` is ignored when other models are present.
    const mixed = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'my-gw https://gw/v1 m1,auto,m2',
      [],
    ) as Record<string, unknown>
    expect(mixed['my-gw']).toMatchObject({ models: [{ id: 'm1' }, { id: 'm2' }] })
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'My-GW https://gw/v1 m1', []))
      .toThrow('以小写字母开头')
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'my-gw gw.example/v1 m1', []))
      .toThrow('需以 http:// 或 https:// 开头')
  })

  it('declares a custom provider from the multi-line form', () => {
    const draft = ['name=my-gw', 'baseURL=https://gw.example/v1', 'models=gpt-4o, gpt-4o-mini', 'api=openai-completions'].join('\n')
    const declared = parseSettingsFieldValue('llm-pi-ai', 'providers', {}, draft, []) as Record<string, unknown>
    expect(declared['my-gw']).toEqual({
      api: 'openai-completions',
      baseURL: 'https://gw.example/v1',
      apiKeyEnv: 'MY_GW_API_KEY',
      displayName: 'my-gw',
      models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
    })
    // The seeded template is editable rather than strict: comments and blank
    // lines are ignored, and a missing required field names itself.
    const withComments = ['# 一行一个 key=value', 'name=gw2', '', 'baseURL=https://gw2/v1', 'models=m1'].join('\n')
    expect(parseSettingsFieldValue('llm-pi-ai', 'providers', {}, withComments, [])).toMatchObject({
      gw2: { baseURL: 'https://gw2/v1', models: [{ id: 'm1' }] },
    })
    // Empty models= is now the auto-discover trigger, not a refusal.
    const autoFromEmpty = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'name=my-gw\nbaseURL=https://gw/v1\nmodels=',
      [],
    )
    expect(isAutoDiscoverProviderDraft(autoFromEmpty)).toBe(true)
    expect(autoFromEmpty).toMatchObject({
      name: 'my-gw',
      api: 'openai-completions',
      baseURL: 'https://gw/v1',
      apiKeyEnv: 'MY_GW_API_KEY',
      displayName: 'my-gw',
    })
    // Literal `auto` is the explicit form of the same request.
    const autoFromKeyword = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'name=my-gw\nbaseURL=https://gw/v1\nmodels=auto',
      [],
    )
    expect(isAutoDiscoverProviderDraft(autoFromKeyword)).toBe(true)
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers', {}, 'name=\nbaseURL=https://gw/v1\nmodels=m', []))
      .toThrow('请填写 name=')
    // Explicit credentials and display name win over the derived defaults.
    const explicit = ['name=gw', 'baseURL=https://gw/v1', 'models=m', 'apiKeyEnv=CUSTOM_KEY', 'displayName=网关'].join('\n')
    expect(parseSettingsFieldValue('llm-pi-ai', 'providers', {}, explicit, [])).toMatchObject({
      gw: { apiKeyEnv: 'CUSTOM_KEY', displayName: '网关' },
    })
  })

  it('still refuses a multi-line form that names no baseURL', () => {
    // Auto-discover needs an endpoint; an empty baseURL= line stays a
    // synchronous refusal so the apply layer never reaches the network.
    expect(() => parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'name=my-gw\nbaseURL=\nmodels=',
      [],
    )).toThrow('请填写 baseURL=')
  })

  it('still refuses a multi-line form with an invalid name when auto-discovering', () => {
    expect(() => parseSettingsFieldValue(
      'llm-pi-ai',
      'providers',
      {},
      'name=My-GW\nbaseURL=https://gw/v1\nmodels=',
      [],
    )).toThrow('以小写字母开头')
  })

  it('parseCustomProviderDraft returns an auto-discover sentinel for two tokens', () => {
    const draft = parseCustomProviderDraft('my-gw https://gw.example/v1')
    expect(isAutoDiscoverProviderDraft(draft)).toBe(true)
    expect(draft).toMatchObject({
      name: 'my-gw',
      api: 'openai-completions',
      baseURL: 'https://gw.example/v1',
      apiKeyEnv: 'MY_GW_API_KEY',
      displayName: 'my-gw',
    })
  })

  it('parseProviderFormDraft returns an auto-discover sentinel when models= is empty or auto', () => {
    const empty = parseProviderFormDraft('name=gw\nbaseURL=https://gw/v1\nmodels=\napi=openai-completions')
    expect(isAutoDiscoverProviderDraft(empty)).toBe(true)
    expect(empty).toMatchObject({
      name: 'gw',
      api: 'openai-completions',
      baseURL: 'https://gw/v1',
      apiKeyEnv: 'GW_API_KEY',
      displayName: 'gw',
    })
    const auto = parseProviderFormDraft('name=gw\nbaseURL=https://gw/v1\nmodels=auto')
    expect(isAutoDiscoverProviderDraft(auto)).toBe(true)
  })

  it('returns an auto-discover sentinel when providers.<route>.models is typed as auto', () => {
    const sentinel = parseSettingsFieldValue(
      'llm-pi-ai',
      'providers.siliconflow.models',
      [{ id: 'deepseek-v3' }],
      'auto',
      [],
    )
    expect(isAutoDiscoverProviderDraft(sentinel)).toBe(true)
    // The sentinel carries only the route name; api, baseURL, and credential
    // reference are filled by the apply layer from the stored profile.
    expect(sentinel).toMatchObject({
      name: 'siliconflow',
      api: '',
      baseURL: '',
      apiKeyEnv: '',
      displayName: '',
    })
    // A capitalised `AUTO` is treated the same; spaces around the token are
    // tolerated so a user who backspaces into the field does not lose the
    // auto behaviour to a stray whitespace.
    expect(isAutoDiscoverProviderDraft(parseSettingsFieldValue(
      'llm-pi-ai',
      'providers.siliconflow.models',
      [],
      '  AUTO  ',
      [],
    ))).toBe(true)
    // The empty value is not auto-discover: it parses to an empty models list,
    // matching the manual clear-the-list path.
    expect(parseSettingsFieldValue('llm-pi-ai', 'providers.siliconflow.models', [], ''))
      .toEqual([])
  })

  it('validates required fields for provider configuration', () => {
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers.custom.api', 'openai-completions', '  '))
      .toThrow('api 协议为必填项，不可为空')
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers.custom.baseURL', 'https://...', ''))
      .toThrow('baseURL 接口地址为必填项，不可为空')
    expect(() => parseSettingsFieldValue('llm-pi-ai', 'providers.custom.apiKeyEnv', 'KEY', ''))
      .toThrow('providers.custom.apiKeyEnv 环境变量名为必填项，不可为空')
  })

  it('expands provider child fields with required markers when expandProviders is enabled', () => {
    const rows = settingsRowsFromDescribe(
      [descriptor('llm-pi-ai')],
      () => ({
        providers: {
          sf: {
            api: 'openai-completions',
            baseURL: 'https://api.siliconflow.cn/v1',
            apiKeyEnv: 'SILICONFLOW_API_KEY',
            displayName: '硅基流动',
            models: [{ id: 'deepseek-v3' }],
          },
        },
      }),
      { expandProviders: true },
    )
    expect(rows.map(r => r.field)).toEqual([
      'providers',
      'providers.sf.api',
      'providers.sf.baseURL',
      'providers.sf.apiKeyEnv',
      'providers.sf.defaultInput',
      'providers.sf.displayName',
      'providers.sf.models',
      'providers',
    ])
    expect(rows[1]?.required).toBe(true)
    expect(rows[2]?.required).toBe(true)
    expect(rows[3]?.required).toBe(true)
    expect(rows[4]?.required).toBe(false)
    expect(rows[5]?.required).toBe(false)
    expect(rows[6]?.value).toBe('deepseek-v3')
  })

  it('lists one credential row per referenced name with its configured state', () => {
    const state = new Map<string, boolean>([['GOAT_API_KEY', false], ['MY_GW_API_KEY', true]])
    const rows = credentialSettingRows(
      ['DEEPSEEK_API_KEY', 'GOAT_API_KEY', 'MY_GW_API_KEY', 'GOAT_API_KEY'],
      name => state.get(name),
    )
    // The duplicate name collapses, an unprobed name stays actionable rather
    // than claiming the secret is missing, and no row carries a secret value.
    expect(rows).toEqual([
      {
        namespace: 'credentials',
        field: 'DEEPSEEK_API_KEY',
        value: 'Enter 设置密钥',
        label: '凭据 · DEEPSEEK_API_KEY',
      },
      {
        namespace: 'credentials',
        field: 'GOAT_API_KEY',
        value: '未配置',
        label: '凭据 · GOAT_API_KEY',
      },
      {
        namespace: 'credentials',
        field: 'MY_GW_API_KEY',
        value: '已配置',
        label: '凭据 · MY_GW_API_KEY',
      },
    ])
  })

  it('names the exact /key command when a secret is typed into apiKeyEnv', () => {
    expect(() => parseSettingsFieldValue(
      'llm-pi-ai',
      'providers.goat.apiKeyEnv',
      'GOAT_API_KEY',
      'sk-live-123456',
    )).toThrow('请用 /key GOAT_API_KEY <密钥> 配置该变量')
    // Without a route segment the refusal names the key the onboarding pane edits.
    expect(() => parseSettingsFieldValue('llm-deepseek', 'apiKeyEnv', undefined, 'sk-live-123456'))
      .toThrow('请用 /key DEEPSEEK_API_KEY <密钥> 配置该变量')
  })
})
