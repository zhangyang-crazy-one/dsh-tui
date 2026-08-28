/**
 * Overlay row projection from settings.describe() values.
 */

import { describe, expect, it } from 'vitest'
import { settingsNamespace, type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import {
  parseSettingValue,
  parseSettingsFieldValue,
  settingsRowsFromDescribe,
  stringifySettingValue,
  stringifySettingsFieldValue,
} from '../src/settings-rows.ts'

function descriptor(ns: string, secrets: SettingsDescriptor['secrets'] = []): SettingsDescriptor {
  return {
    ns: settingsNamespace(ns),
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

describe('settingsRowsFromDescribe', () => {
  it('orders leading namespaces and stringifies nested catalogs', () => {
    const deepseek = settingsNamespace('llm-deepseek')
    const openai = settingsNamespace('llm-openai')
    const pi = settingsNamespace('llm-pi-ai')
    const shell = settingsNamespace('shell')
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
    expect(rows[1]?.value).toBe('[{"id":"deepseek-v4-flash"}]')
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
    const ns = settingsNamespace('llm-deepseek')
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
    const shell = settingsNamespace('shell')
    const fs = settingsNamespace('fs')
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
})
