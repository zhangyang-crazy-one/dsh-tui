/**
 * Overlay row projection from settings.describe() values.
 */

import { describe, expect, it } from 'vitest'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import {
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
      .toThrow('apiKeyEnv 是环境变量名（如 DEEPSEEK_API_KEY），请勿输入真实密钥。请使用 /key 配置密钥')
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
      'providers.sf.displayName',
      'providers.sf.models',
      'providers',
    ])
    expect(rows[1]?.required).toBe(true)
    expect(rows[2]?.required).toBe(true)
    expect(rows[3]?.required).toBe(true)
    expect(rows[4]?.required).toBe(false)
    expect(rows[5]?.value).toBe('deepseek-v3')
  })
})
