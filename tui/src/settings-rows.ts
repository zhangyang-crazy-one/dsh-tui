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

/**
 * Derive the conventional credential-reference name a catalog provider reads,
 * so an added route has a sensible value to edit rather than an empty slot.
 * @param routeKey - the provider route key (for example `openai-codex`).
 * @returns the upper-snake credential reference name (for example `OPENAI_CODEX_API_KEY`).
 */
function credentialEnvName(routeKey: string): string {
  return `${routeKey.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_API_KEY`
}

/** Route ids a hand-declared provider may use: a settings key and a credential-name stem. */
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u

/** One hand-declared provider parsed from the composer's single-line form. */
export interface CustomProviderDraft {
  /** Chosen route key, also the display name and credential-name stem. */
  readonly name: string
  /** Wire protocol; `openai-completions` when the draft omits `api=`. */
  readonly api: string
  /** Endpoint the route serves. */
  readonly baseURL: string
  /** At least one model id, in draft order. */
  readonly models: readonly string[]
  /** Explicit credential reference; the route-derived name when omitted. */
  readonly apiKeyEnv?: string
  /** Explicit display name; the route key when omitted. */
  readonly displayName?: string
}

/**
 * Parse the one-line custom-provider form `name endpoint model[,model]…`, plus an
 * optional `api=<protocol>` token. Endpoint and at least one model are required
 * because the settings validator refuses a route the installed catalog does not
 * describe without them, so a name alone cannot become a serviceable profile.
 * @param draft - trimmed composer text.
 * @returns the draft, or undefined when the text is not that form.
 * @throws {TypeError} when the shape matches but a field cannot be served.
 */
export function parseCustomProviderDraft(draft: string): CustomProviderDraft | undefined {
  const tokens = draft.split(/\s+/u).filter(token => token !== '')
  if (tokens.length < 2) return undefined
  if (tokens.length < 3) {
    // Name and endpoint alone cannot describe a route the catalog does not ship.
    throw new TypeError('自定义 Provider 需要至少一个模型（跟在端点后，用逗号分隔）')
  }
  const name = tokens[0] as string
  const endpoint = tokens[1] as string
  let api = 'openai-completions'
  const models: string[] = []
  for (const token of tokens.slice(2)) {
    const apiMatch = /^api=(.+)$/u.exec(token)
    if (apiMatch?.[1] !== undefined) {
      api = apiMatch[1]
      continue
    }
    for (const id of token.split(',')) {
      const trimmedId = id.trim()
      if (trimmedId !== '') models.push(trimmedId)
    }
  }
  return normalizeCustomProvider({ name, api, baseURL: endpoint, models })
}

/**
 * Compose seed for a hand-declared provider: one `key=value` per line, so the
 * composer opens as a field-by-field form instead of one long line.
 */
export const PROVIDER_FORM_TEMPLATE = 'name=\nbaseURL=\nmodels=\napi=openai-completions'

/**
 * Validate the fields a hand-declared route must supply before it can be served.
 * The endpoint and at least one model are required because the settings
 * validator refuses a route the installed catalog does not describe without
 * them, so a name alone cannot become a serviceable profile.
 * @param input - parsed fields; `apiKeyEnv` and `displayName` are optional.
 * @returns the normalized draft.
 * @throws {TypeError} naming the field that cannot be served.
 */
function normalizeCustomProvider(input: {
  name: string
  api: string
  baseURL: string
  models: readonly string[]
  apiKeyEnv?: string
  displayName?: string
}): CustomProviderDraft {
  if (!ROUTE_ID_PATTERN.test(input.name)) {
    throw new TypeError(
      `Provider 名称 "${input.name}" 需以小写字母开头，仅含小写字母、数字与连字符`,
    )
  }
  if (!/^https?:\/\/\S+$/u.test(input.baseURL)) {
    throw new TypeError(`端点 "${input.baseURL}" 需以 http:// 或 https:// 开头`)
  }
  if (input.models.length === 0) {
    throw new TypeError('自定义 Provider 需要至少一个模型（models= 逗号分隔）')
  }
  const api = input.api === '' ? 'openai-completions' : input.api
  return {
    name: input.name,
    api,
    baseURL: input.baseURL,
    models: input.models,
    ...(input.apiKeyEnv === undefined || input.apiKeyEnv === ''
      ? {}
      : { apiKeyEnv: input.apiKeyEnv }),
    ...(input.displayName === undefined || input.displayName === ''
      ? {}
      : { displayName: input.displayName }),
  }
}

/**
 * Parse the multi-line `key=value` provider form (`name=`, `baseURL=`,
 * `models=`, optional `api=`/`apiKeyEnv=`/`displayName=`). Lines starting with
 * `#` and blank lines are ignored, so the seeded template stays editable.
 * @param draft - raw composer text; must span more than one line.
 * @returns the draft, or undefined when the text is not that form.
 * @throws {TypeError} naming the first field that is missing or unserviceable.
 */
export function parseProviderFormDraft(draft: string): CustomProviderDraft | undefined {
  if (!draft.includes('\n')) return undefined
  const fields = new Map<string, string>()
  for (const rawLine of draft.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 0) {
      throw new TypeError(`每行需为 key=value 形式，无法解析："${line}"`)
    }
    const key = line.slice(0, separator).trim().toLowerCase()
    if (key !== '') fields.set(key, line.slice(separator + 1).trim())
  }
  const name = fields.get('name') ?? fields.get('id') ?? ''
  if (name === '') throw new TypeError('请填写 name=（Provider 名称）')
  const baseURL = fields.get('baseurl') ?? fields.get('url') ?? ''
  if (baseURL === '') throw new TypeError('请填写 baseURL=（接口地址，含 http:// 或 https://）')
  const models = (fields.get('models') ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id !== '')
  if (models.length === 0) throw new TypeError('请填写 models=（至少一个模型，逗号分隔）')
  return normalizeCustomProvider({
    name,
    baseURL,
    models,
    api: fields.get('api') ?? '',
    apiKeyEnv: fields.get('apikeyenv') ?? fields.get('keyenv') ?? '',
    displayName: fields.get('displayname') ?? '',
  })
}

/** Build the stored profile for one hand-declared provider draft. */
function customProviderProfile(draft: CustomProviderDraft): Record<string, unknown> {
  return {
    api: draft.api,
    baseURL: draft.baseURL,
    apiKeyEnv: draft.apiKeyEnv ?? credentialEnvName(draft.name),
    displayName: draft.displayName ?? draft.name,
    models: draft.models.map(id => ({ id })),
  }
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
 * @param knownProviders - route keys the llm directory exposes for this namespace, so a
 *   catalog provider can be added by name; absence only narrows that suggestion.
 * @returns the JSON-compatible persisted value.
 */
export function parseSettingsFieldValue(
  namespace: string,
  field: string,
  current: unknown,
  draft: string,
  knownProviders: readonly string[] = [],
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
    if (trimmed === '') {
      throw new TypeError('请输入 Provider 名称、模板序号，或按表单填写')
    }
    if (trimmed.startsWith('{')) {
      return parseSettingValue(current, draft)
    }
    const existing = isPlainObject(current) ? current : {}
    const form = parseProviderFormDraft(draft)
    if (form !== undefined) {
      return { ...existing, [form.name]: customProviderProfile(form) }
    }
    const query = trimmed.toLowerCase()
    const matched = PROVIDER_TEMPLATES.find(
      (t, idx) => query === String(idx + 1)
        || query === t.id
        || query.includes(t.id)
        || query.includes(t.displayName.toLowerCase())
        || query.includes(t.name.toLowerCase()),
    )
    if (matched !== undefined) {
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
    // A catalog provider needs only its credential reference: the installed
    // catalog supplies the endpoint, protocol, and models. Any other route needs a
    // full profile, so it is declared through the form or the single-line form.
    const catalog = knownProviders.find(id => id.toLowerCase() === query)
    if (catalog !== undefined) {
      return { ...existing, [catalog]: { apiKeyEnv: credentialEnvName(catalog) } }
    }
    const custom = parseCustomProviderDraft(trimmed)
    if (custom !== undefined) {
      return { ...existing, [custom.name]: customProviderProfile(custom) }
    }
    throw new TypeError(
      `未知 Provider "${trimmed}"；可输入目录名（如 openai、anthropic、google）、模板序号 1-4，`
        + '或多行表单（name= / baseURL= / models=），单行可用 "名称 端点 模型"',
    )
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
            value: 'Enter：目录名 / 模板序号 1-4 / 或按表单填写',
            label: 'providers · [+ 添加 Provider]',
            editValue: PROVIDER_FORM_TEMPLATE,
          })
        } else {
          rows.push({
            namespace: 'llm-pi-ai',
            field: 'providers',
            value: stringifySettingsFieldValue('llm-pi-ai', 'providers', providersObj),
            label: 'providers · 提供商列表 (Enter 追加)',
            editValue: PROVIDER_FORM_TEMPLATE,
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
            value: 'Enter：目录名 / 模板序号 1-4 / 或按表单填写',
            label: 'providers · [+ 添加 Provider]',
            editValue: PROVIDER_FORM_TEMPLATE,
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
