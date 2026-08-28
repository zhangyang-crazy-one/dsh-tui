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

/** Whether a value is a plain data object (not an array or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

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
export function parseSettingValue(current: unknown, draft: string): unknown {
  if (Array.isArray(current) || isPlainObject(current) || current === null) {
    try {
      return JSON.parse(draft) as unknown
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
): unknown {
  if (namespace === 'tui' && field === 'brandAnimation') {
    const match = (Object.entries(BRAND_ANIMATION_LABELS) as [BrandAnimationSetting, string][])
      .find(([, label]) => draft === label || draft === label.toLowerCase())
    if (match !== undefined) return match[0]
    if (draft === 'auto' || draft === 'on' || draft === 'off') return draft
    throw new TypeError('需要 自动、开启 或 关闭')
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
      rows.push({
        namespace: String(entry.ns),
        field,
        value: stringifySettingsFieldValue(String(entry.ns), field, fieldValue),
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
    return ns !== 0 ? ns : left.field.localeCompare(right.field)
  })
  return [...ordered, ...rest]
}
