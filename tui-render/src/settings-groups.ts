/** Stable field identities with section navigation independent of provider order. */
export type SettingsGroup = 'appearance' | 'providers' | 'agent' | 'subagents' | 'web' | 'shell' | 'plugins' | 'other'
export function settingsGroup(row: { namespace: string; field: string }): SettingsGroup {
  const ns = row.namespace
  if (ns === 'tui') return 'appearance'
  if (/llm|provider|credential/iu.test(ns)) return 'providers'
  if (/subagent|delegat/iu.test(ns)) return 'subagents'
  if (/agent|compaction|context|token/iu.test(ns)) return 'agent'
  if (/web|search|browser/iu.test(ns)) return 'web'
  if (/shell|terminal|sandbox/iu.test(ns)) return 'shell'
  if (/plugin|loader|cordis/iu.test(ns)) return 'plugins'
  return 'other'
}
export const SETTINGS_GROUP_LABELS: Readonly<Record<SettingsGroup, string>> = {
  appearance: '外观与输入', providers: '模型与凭据', agent: 'Agent Loop', subagents: 'Subagent',
  web: 'Web', shell: 'Shell', plugins: '插件', other: '其他',
}
export function nextSettingsGroup(rows: readonly { namespace: string; field: string }[], selected: number, direction: number): number {
  const groups = [...new Set(rows.map(settingsGroup))]
  const current = rows[selected]
  if (current === undefined || groups.length === 0) return 0
  const next = groups[(groups.indexOf(settingsGroup(current)) + (direction < 0 ? -1 : 1) + groups.length) % groups.length]
  return Math.max(0, rows.findIndex(row => settingsGroup(row) === next))
}
