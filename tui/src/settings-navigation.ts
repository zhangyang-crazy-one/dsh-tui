/** Hierarchical projection of the host's live settings forms. */
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import type { SettingsFieldRow } from '@deepseek-ai/dsh-tui-render'
import { settingsGroup, SETTINGS_GROUP_LABELS } from '@deepseek-ai/dsh-tui-render'
import { PROVIDER_FORM_TEMPLATE, stringifySettingValue, stringifySettingsFieldValue } from './settings-rows.ts'

export interface SettingsNode extends SettingsFieldRow {
  id: string
  parentId: string
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}
function childSchema(schema: unknown, key: string): unknown {
  const node = record(schema)
  return record(node.dict)[key] ?? record(node.properties)[key] ?? node.inner ?? node.items
}
/** String collections stay one editable value; records, objects, and other arrays open. */
function navigableValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(item => typeof item !== 'string')
  return value !== null && typeof value === 'object'
}
function summary(value: unknown): string {
  return Array.isArray(value) ? `${String(value.length)} 项`
    : value !== null && typeof value === 'object' ? `${String(Object.keys(value).length)} 个字段`
      : stringifySettingValue(value)
}

/** Include user-layer extension fields that schema resolution may omit. */
function withUserFields(resolved: unknown, user: unknown): unknown {
  if (Array.isArray(user)) return user.map((value, index) => withUserFields(Array.isArray(resolved) ? resolved[index] : undefined, value))
  if (user !== null && typeof user === 'object') return Object.fromEntries(
    [...new Set([...Object.keys(record(resolved)), ...Object.keys(user)])].map(key => [key, Object.hasOwn(user, key) ? withUserFields(record(resolved)[key], record(user)[key]) : record(resolved)[key]]),
  )
  return user === undefined ? resolved : user
}

/** Build navigation nodes without reading a second configuration source. */
export function settingsTreeFromDescribe(
  descriptors: readonly SettingsDescriptor[], credentials: readonly SettingsFieldRow[],
): SettingsNode[] {
  const nodes: SettingsNode[] = []
  const groups = new Set<string>()
  const addGroup = (namespace: string): string => {
    const group = settingsGroup({ namespace, field: '' })
    const id = `group:${group}`
    if (!groups.has(id)) {
      groups.add(id)
      nodes.push({ id, parentId: '', namespace, field: '', label: SETTINGS_GROUP_LABELS[group], value: '', navigable: true, editable: false })
    }
    return id
  }
  for (const descriptor of descriptors) {
    if (descriptor.value === null || typeof descriptor.value !== 'object' || Array.isArray(descriptor.value)) continue
    const namespace = String(descriptor.ns)
    const nsId = `ns:${namespace}`
    const group = addGroup(namespace)
    nodes.push({ id: nsId, parentId: group, namespace, field: '', label: namespace, value: summary(descriptor.value), navigable: true, editable: false })
    const formValue = withUserFields(descriptor.value, descriptor.user)
    const secrets = (descriptor.secrets ?? []).map(secret => secret.path.map(String))
    const walk = (value: unknown, path: string[], parentId: string, schema: unknown): void => {
      if (secrets.some(secret => secret.every((key, index) => path[index] === key))) return
      const field = path.join('.')
      const key = path[path.length - 1] ?? ''
      const parentValue = atPath(formValue, path.slice(0, -1))
      const modelId = record(value).id
      const identity = Array.isArray(parentValue) && typeof modelId === 'string'
        && parentValue.filter(entry => record(entry).id === modelId).length === 1 ? `id:${modelId}` : key
      const id = `${parentId}:${JSON.stringify(identity)}`
      const nested = value !== null && typeof value === 'object'
      const navigable = navigableValue(value)
      const meta = record(record(schema).meta)
      const label = Array.isArray(parentValue)
        ? String(record(value).id ?? record(value).name ?? key) : key
      nodes.push({
        id, parentId, namespace, field, sourcePath: path, label,
        value: path.length === 2 && path[0] === 'providers'
          ? `${String(Array.isArray(record(value).models) ? (record(value).models as unknown[]).length : 0)} 模型 · ${String(record(value).api ?? '默认协议')}`
          : navigable ? summary(value) : stringifySettingsFieldValue(namespace, field, value),
        editValue: stringifySettingValue(value),
        ...(navigable && secrets.some(secret => path.every((key, index) => secret[index] === key)) ? { editable: false } : {}),
        ...(navigable ? { navigable: true } : {}),
        ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
        ...(meta.required === true ? { required: true } : {}),
      })
      if (navigable) {
        for (const [child, next] of Object.entries(value)) walk(next, [...path, child], id, childSchema(schema, child))
        if (namespace === 'llm-pi-ai' && field === 'providers') {
          nodes.push({ id: `${id}:add`, parentId: id, namespace, field, sourcePath: path, label: '+ 添加 Provider', value: '目录名 / 表单', editValue: PROVIDER_FORM_TEMPLATE })
        }
      }
    }
    for (const [key, value] of Object.entries(record(formValue))) walk(value, [key], nsId, childSchema(descriptor.schema, key))
  }
  if (credentials.length > 0) {
    const group = addGroup('credentials')
    const parentId = 'ns:credentials'
    nodes.push({ id: parentId, parentId: group, namespace: 'credentials', field: '', label: '凭据管理', value: `${String(credentials.length)} 项`, navigable: true, editable: false })
    for (const row of credentials) nodes.push({ ...row, editValue: '', id: `${parentId}:${row.field}`, parentId, label: row.field })
  }
  return nodes
}

export function atPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) current = record(current)[key]
  return current
}
/** Replace an array/object leaf while keeping every sibling from the live form. */
export function settingsPathPatch(
  section: unknown, path: readonly string[], value: unknown, user?: unknown,
): object {
  const replace = (current: unknown, remaining: readonly string[], stored: unknown, preserve = false): unknown => {
    const [key, ...rest] = remaining
    if (key === undefined) return value
    // Settings.update merges objects but replaces arrays. Only array ancestors
    // need a full copy; use the user array to retain fields hidden by schemas.
    const source = stored !== undefined ? stored : current
    const complete = preserve || Array.isArray(source)
    const copy: Record<string, unknown> | unknown[] = Array.isArray(source) ? [...source] : complete ? { ...record(source) } : {}
    Object.defineProperty(copy, key, { value: replace(record(current)[key], rest, record(stored)[key], complete), writable: true, enumerable: true, configurable: true })
    return copy
  }
  return replace(section, path, user) as object
}

/** The same navigation state drives narrow and wide terminals. */
export class SettingsNavigation {
  selectedIndex = 0
  private parentId = ''
  private query = ''
  private selections = new Map<string, string>()
  private categoryPositions = new Map<string, string>()
  private beforeSearchIndex = 0
  constructor(private nodes: SettingsNode[]) {}
  get rows(): SettingsNode[] {
    const query = this.query.toLocaleLowerCase()
    return query === '' ? this.nodes.filter(node => node.parentId === this.parentId)
      : this.nodes.filter(node => node.field !== '' && `${node.namespace} ${node.field} ${node.label ?? ''} ${node.value} ${node.description ?? ''}`.toLocaleLowerCase().includes(query))
  }
  get breadcrumb(): string[] {
    const labels = ['设置']
    let node = this.nodes.find(entry => entry.id === this.parentId)
    const tail: string[] = []
    while (node !== undefined) { tail.unshift(node.label ?? node.field); node = this.nodes.find(entry => entry.id === node?.parentId) }
    return [...labels, ...tail]
  }
  get categories(): { id: string; label: string; count: number }[] {
    return this.nodes.filter(node => node.parentId === '').map(node => ({
      id: node.id, label: node.label ?? node.field,
      count: this.nodes.filter(child => child.parentId === node.id).length,
    }))
  }
  get activeCategory(): string | undefined {
    let node = this.nodes.find(entry => entry.id === this.parentId)
    while (node !== undefined && node.parentId !== '') node = this.nodes.find(entry => entry.id === node?.parentId)
    return node?.id
  }
  open(): void {
    if (this.parentId === '') this.group(1)
  }
  get filter(): string { return this.query }
  private remember(): void {
    if (this.query !== '') return
    const category = this.activeCategory
    if (category !== undefined) this.categoryPositions.set(category, this.parentId)
    const id = this.rows[this.selectedIndex]?.id
    if (id !== undefined) this.selections.set(this.parentId, id)
  }
  private restore(): void {
    const index = this.rows.findIndex(node => node.id === this.selections.get(this.parentId))
    this.selectedIndex = index < 0 ? Math.min(this.selectedIndex, Math.max(0, this.rows.length - 1)) : index
  }
  replace(nodes: SettingsNode[]): void {
    const selected = this.rows[this.selectedIndex]?.id
    this.remember()
    const previous = this.nodes
    this.nodes = nodes
    const survivingParent = (parent: string): string => {
      while (parent !== '' && !nodes.some(node => node.id === parent)) {
        parent = previous.find(node => node.id === parent)?.parentId ?? ''
      }
      return parent
    }
    this.parentId = survivingParent(this.parentId)
    for (const [parent, id] of this.selections) {
      if (!nodes.some(node => node.id === id && node.parentId === parent)) this.selections.delete(parent)
    }
    for (const [category, parent] of this.categoryPositions) {
      if (!nodes.some(node => node.id === category && node.parentId === '')) this.categoryPositions.delete(category)
      else this.categoryPositions.set(category, survivingParent(parent))
    }
    const index = this.rows.findIndex(node => node.id === selected)
    if (index >= 0) this.selectedIndex = index
    else this.restore()
  }
  enter(): boolean {
    const node = this.rows[this.selectedIndex]
    if (node?.navigable !== true) return false
    this.remember(); this.parentId = node.id; this.query = ''; this.selectedIndex = 0; this.restore()
    return true
  }
  back(): boolean {
    if (this.query !== '') { this.search(''); return true }
    const node = this.nodes.find(entry => entry.id === this.parentId)
    if (node === undefined || node.parentId === '') return false
    this.remember(); this.parentId = node.parentId; this.selectedIndex = 0; this.restore()
    return true
  }
  search(query: string): void {
    if (query === this.query) return
    if (this.query === '') { this.remember(); this.beforeSearchIndex = this.selectedIndex }
    this.query = query
    this.selectedIndex = query === '' ? this.beforeSearchIndex : 0
    if (query === '') this.restore()
  }
  group(delta: number): void {
    if (this.query !== '') this.search('')
    this.remember()
    const groups = this.categories
    const index = groups.findIndex(node => node.id === this.activeCategory)
    const nextIndex = index < 0 ? (delta < 0 ? groups.length - 1 : 0)
      : (index + (delta < 0 ? -1 : 1) + groups.length) % groups.length
    const next = groups[nextIndex]
    if (next === undefined) return
    this.parentId = this.categoryPositions.get(next.id) ?? next.id
    this.selectedIndex = 0
    this.restore()
  }
}
