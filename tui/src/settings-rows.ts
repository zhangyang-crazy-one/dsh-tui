/**
 * Project host `settings.describe()` sections into overlay rows and parse
 * composer drafts back into JSON-compatible patches.
 * @module @deepseek-ai/dsh-tui/settings-rows
 */

import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { SettingsFieldRow } from '@deepseek-ai/dsh-tui-render'

/** Overlay order for known provider/general namespaces; others follow alphabetically. */
const LEADING_NAMESPACES = [
  'tui',
  'llm-deepseek',
  'llm-openai',
  'llm-anthropic',
  'llm-pi-ai',
] as const

const BRAND_ANIMATION_LABELS = {
  auto: '自动',
  on: '开启',
  off: '关闭',
} as const

type BrandAnimationSetting = keyof typeof BRAND_ANIMATION_LABELS

/** Pre-configured model provider template. */
export interface ProviderTemplate {
  readonly id: string
  readonly name: string
  readonly api: string
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly displayName: string
  readonly models: readonly string[]
}

/** Standard provider templates available for instant configuration. */
export const PROVIDER_TEMPLATES: readonly ProviderTemplate[] = [
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    api: 'openai-completions',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    displayName: '硅基流动',
    models: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1'],
  },
  {
    id: 'deepseek-api',
    name: 'DeepSeek 官方开放平台',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    displayName: 'DeepSeek 官方',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'custom-openai',
    name: '通用 OpenAI 兼容接口',
    api: 'openai-completions',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    displayName: 'OpenAI 兼容',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'ollama',
    name: 'Ollama 本地服务',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    displayName: 'Ollama 本地',
    models: ['deepseek-r1:8b', 'qwen2.5:7b'],
  },
]

/** Format a models list into a comma-separated string for display or editing. */
export function formatModelsList(models: unknown): string {
  if (!Array.isArray(models)) return ''
  return models
    .map((m) => {
      if (typeof m === 'object' && m !== null && 'id' in m) {
        return String((m as { id: unknown }).id)
      }
      return String(m)
    })
    .filter(Boolean)
    .join(', ')
}

/** Parse a comma-separated or JSON string into an array of model profile objects. */
export function parseModelsList(draft: string): Array<{ id: string }> {
  const trimmed = draft.trim()
  if (trimmed === '') return []
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      // SAFETY: JSON.parse validated against array bounds.
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map(m => (typeof m === 'object' && m !== null && 'id' in m ? (m as { id: string }) : { id: String(m) }))
      }
      throw new TypeError('JSON 无效')
    } catch {
      throw new TypeError('JSON 无效')
    }
  }
  return trimmed
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(id => ({ id }))
}

/* jscpd:ignore-start -- plain object check mirrors settings package */
/** Whether a value is a plain data object (not an array or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
/* jscpd:ignore-end */

/**
 * Render one field value for the overlay composer.
 * @param value - resolved settings field.
 * @returns a string the composer can edit.
 */
export function stringifySettingValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  return JSON.stringify(value)
}

/**
 * Parse a composer draft back into the field's JSON type.
 * @param current - the resolved value used to pick the parser.
 * @param draft - composer text.
 * @returns a JSON-compatible patch value.
 */
/** JSON-compatible parsed settings value. */
export type ParsedSettingValue = string | number | boolean | object | null | undefined

export function parseSettingValue(current: unknown, draft: string): ParsedSettingValue {
  if (Array.isArray(current) || isPlainObject(current) || current === null) {
    try {
      // SAFETY: JSON.parse result validated against object/array bounds.
      return JSON.parse(draft) as ParsedSettingValue
    } catch {
      throw new TypeError('JSON 无效')
    }
  }
  if (typeof current === 'boolean') {
    if (draft === 'true') return true
    if (draft === 'false') return false
    throw new TypeError('需要 true 或 false')
  }
  if (typeof current === 'number') {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) throw new TypeError('需要有限数字')
    return parsed
  }
  return draft
}

/**
 * Render one settings field with its field-specific user vocabulary.
 * @param namespace - settings namespace.
 * @param field - top-level field name.
 * @param value - resolved field value.
 * @returns the editable terminal string.
 */
export function stringifySettingsFieldValue(
  namespace: string,
  field: string,
  value: unknown,
): string {
  if (
    namespace === 'tui'
    && field === 'brandAnimation'
    && (value === 'auto' || value === 'on' || value === 'off')
  ) {
    return BRAND_ANIMATION_LABELS[value]
  }
  if (field === 'models' || field.endsWith('.models')) {
    return formatModelsList(value)
  }
  if (field === 'providers' && isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      return '按 Enter 从预置模板添加 (硅基流动/DeepSeek/通用/Ollama)'
    }
    return `${String(keys.length)} 个 Provider (${keys.join(', ')})`
  }
  return stringifySettingValue(value)
}

/**
 * Parse one settings draft with its field-specific user vocabulary.
 * @param namespace - settings namespace.
 * @param field - top-level field name.
 * @param current - resolved field value used by generic parsers.
 * @param draft - composer text.
 * @returns the JSON-compatible persisted value.
 */
export function parseSettingsFieldValue(
  namespace: string,
  field: string,
  current: unknown,
  draft: string,
): ParsedSettingValue {
  if (namespace === 'tui' && field === 'brandAnimation') {
    const match = (Object.entries(BRAND_ANIMATION_LABELS) as [BrandAnimationSetting, string][])
      .find(([, label]) => draft === label || draft === label.toLowerCase())
    if (match !== undefined) return match[0]
    if (draft === 'auto' || draft === 'on' || draft === 'off') return draft
    throw new TypeError('需要 自动、开启 或 关闭')
  }
  if (field === 'models' || field.endsWith('.models')) {
    return parseModelsList(draft)
  }
  if (field === 'providers' && (isPlainObject(current) || current === undefined)) {
    const trimmed = draft.trim()
    if (trimmed.startsWith('{')) {
      return parseSettingValue(current, draft)
    }
    const query = trimmed.toLowerCase()
    const matched = PROVIDER_TEMPLATES.find(
      (t, idx) => query === String(idx + 1)
        || query === t.id
        || query.includes(t.id)
        || query.includes(t.displayName.toLowerCase())
        || (t.name && query.includes(t.name.toLowerCase())),
    ) ?? PROVIDER_TEMPLATES[0]
    const existing = isPlainObject(current) ? current : {}
    if (matched === undefined) return existing
    return {
      ...existing,
      [matched.id]: {
        api: matched.api,
        baseURL: matched.baseURL,
        apiKeyEnv: matched.apiKeyEnv,
        displayName: matched.displayName,
        models: matched.models.map(id => ({ id })),
      },
    }
  }
  if (field === 'api' || field.endsWith('.api')) {
    const trimmed = draft.trim()
    if (trimmed === '') throw new TypeError('api 协议为必填项，不可为空')
    return trimmed
  }
  if (field === 'baseURL' || field.endsWith('.baseURL')) {
    const trimmed = draft.trim()
    if (trimmed === '') throw new TypeError('baseURL 接口地址为必填项，不可为空')
    return trimmed
  }
  if (field === 'apiKeyEnv' || field === 'secretEnv' || field.endsWith('Env') || field.endsWith('Ref')) {
    const trimmed = draft.trim()
    if (trimmed === '' && (field.includes('providers.') || field === 'apiKeyEnv')) {
      throw new TypeError(`${field} 环境变量名为必填项，不可为空`)
    }
    if (trimmed.startsWith('sk-') || trimmed.startsWith('ghp_') || trimmed.startsWith('Bearer ') || trimmed.length > 50) {
      throw new TypeError(`${field} 是环境变量名（如 DEEPSEEK_API_KEY），请勿输入真实密钥。请使用 /key 配置密钥`)
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
      throw new TypeError(`${field} 需要合法的环境变量名（例如 DEEPSEEK_API_KEY）`)
    }
    return trimmed
  }
  return parseSettingValue(current, draft)
}

/**
 * Flatten registered settings sections into overlay rows.
 * Secret fields named in `describe({ redactSecrets: true }).secrets` are omitted.
 * @param descriptors - host descriptors, typically from `describe()`.
 * @param read - resolve one namespace's current value (`settings.get`).
 * @returns rows in {@link LEADING_NAMESPACES} order, then remaining namespaces.
 */
export function settingsRowsFromDescribe(
  descriptors: readonly SettingsDescriptor[],
  read: (ns: SettingsDescriptor['ns']) => unknown,
  options?: { expandProviders?: boolean },
): SettingsFieldRow[] {
  const leadingNames = new Set<string>(LEADING_NAMESPACES)
  const leading = new Map<string, SettingsFieldRow[]>()
  const rest: SettingsFieldRow[] = []
  for (const entry of descriptors) {
    const value = read(entry.ns)
    if (!isPlainObject(value)) continue
    const secretHeads = new Set(
      (entry.secrets ?? []).map(secret => secret.path[0]).filter(head => head !== undefined),
    )
    const rows: SettingsFieldRow[] = []
    for (const [field, fieldValue] of Object.entries(value)) {
      if (secretHeads.has(field)) continue
      if (options?.expandProviders === true && String(entry.ns) === 'llm-pi-ai' && field === 'providers' && isPlainObject(fieldValue)) {
        const providersObj = fieldValue
        const providerIds = Object.keys(providersObj)
        if (providerIds.length === 0) {
          rows.push({
            namespace: 'llm-pi-ai',
            field: 'providers',
            value: stringifySettingsFieldValue('llm-pi-ai', 'providers', providersObj),
            label: 'providers · 预置模板添加 (按 Enter)',
            editValue: '',
          })
        } else {
          rows.push({
            namespace: 'llm-pi-ai',
            field: 'providers',
            value: stringifySettingsFieldValue('llm-pi-ai', 'providers', providersObj),
            label: 'providers · 提供商列表 (按 Enter 追加模板)',
            editValue: '',
          })
          for (const pId of providerIds) {
            const profile = isPlainObject(providersObj[pId]) ? providersObj[pId] : {}
            rows.push({
              namespace: 'llm-pi-ai',
              field: `providers.${pId}.api`,
              value: stringifySettingValue(profile.api ?? 'openai-completions'),
              required: true,
              label: `providers · ${pId} · 协议 (api)`,
            })
            rows.push({
              namespace: 'llm-pi-ai',
              field: `providers.${pId}.baseURL`,
              value: stringifySettingValue(profile.baseURL ?? ''),
              required: true,
              label: `providers · ${pId} · 端点 (baseURL)`,
            })
            rows.push({
              namespace: 'llm-pi-ai',
              field: `providers.${pId}.apiKeyEnv`,
              value: stringifySettingValue(profile.apiKeyEnv ?? ''),
              required: true,
              label: `providers · ${pId} · 凭据变量 (apiKeyEnv)`,
            })
            rows.push({
              namespace: 'llm-pi-ai',
              field: `providers.${pId}.displayName`,
              value: stringifySettingValue(profile.displayName ?? pId),
              required: false,
              label: `providers · ${pId} · 别名 (displayName)`,
            })
            rows.push({
              namespace: 'llm-pi-ai',
              field: `providers.${pId}.models`,
              value: formatModelsList(profile.models),
              required: false,
              label: `providers · ${pId} · 模型 (models, 逗号分隔)`,
            })
          }
          rows.push({
            namespace: 'llm-pi-ai',
            field: 'providers',
            value: '按 Enter 追加新 Provider 模板',
            label: 'providers · [+ 添加新 Provider 模板]',
            editValue: '',
          })
        }
        continue
      }
      rows.push({
        namespace: String(entry.ns),
        field,
        value: stringifySettingsFieldValue(String(entry.ns), field, fieldValue),
        ...((field === 'models' || field.endsWith('.models')) && Array.isArray(fieldValue)
          ? { editValue: stringifySettingValue(fieldValue) }
          : {}),
      })
    }
    const key = String(entry.ns)
    if (leadingNames.has(key)) {
      const bucket = leading.get(key) ?? []
      bucket.push(...rows)
      leading.set(key, bucket)
    } else {
      rest.push(...rows)
    }
  }
  const ordered: SettingsFieldRow[] = []
  for (const name of LEADING_NAMESPACES) {
    const bucket = leading.get(name)
    if (bucket !== undefined) ordered.push(...bucket)
  }
  rest.sort((left, right) => {
    const ns = left.namespace.localeCompare(right.namespace)
    return ns === 0 ? left.field.localeCompare(right.field) : ns
  })
  return [...ordered, ...rest]
}
