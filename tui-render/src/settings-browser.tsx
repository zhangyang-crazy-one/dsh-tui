/** Bounded category navigation and contextual details for the settings browser. */
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent, wcwidthSafeSlice, wrapDisplayLines } from './content.ts'
import { paintBackgroundRow, styled, type BackgroundToken, type StyleToken } from './theme.ts'
import type { SettingsFieldRow, SettingsPaneProps } from './settings-pane.tsx'
import { tuiCopy } from './ui-copy.ts'

function fit(text: string, width: number): string {
  const safe = escapeContent(text).replace(/\n/gu, ' ↵ ')
  return displayWidth(safe) <= width ? safe : `${wcwidthSafeSlice(safe, Math.max(0, width - 1))}…`
}

/** Match the quick changes supported by the official settings controller. */
export function canToggleSetting(row: SettingsFieldRow | undefined): boolean {
  return row !== undefined && row.navigable !== true && row.editable !== false
    && (row.value === 'true' || row.value === 'false'
      || row.namespace === 'tui' && ['brandAnimation', 'locale', 'theme', 'colorTier'].includes(row.field))
}

function tabLine(categories: NonNullable<SettingsPaneProps['categories']>, activeId: string | undefined, width: number): string[] {
  const active = Math.max(0, categories.findIndex(category => category.id === activeId))
  let start = active
  let end = active + 1
  const label = (index: number) => index === active ? `[${categories[index]!.label}]` : ` ${categories[index]!.label} `
  const used = (from: number, to: number) => categories.slice(from, to).reduce((sum, _, i) => sum + displayWidth(escapeContent(label(from + i))) + 1, 4)
  while (start > 0 || end < categories.length) {
    if (start > 0 && used(start - 1, end) <= width) { start--; continue }
    if (end < categories.length && used(start, end + 1) <= width) { end++; continue }
    break
  }
  return [
    styled(start > 0 ? '‹ ' : '  ', 'fgDim'),
    ...categories.slice(start, end).map((_, index) => styled(
      fit(label(start + index), Math.max(1, width - 5)) + ' ',
      start + index === active ? 'accentText' : 'fgDim', undefined, start + index === active,
    )),
    styled(end < categories.length ? '›' : '', 'fgDim'),
  ]
}

function fieldLabel(row: SettingsFieldRow, locale: SettingsPaneProps['locale']): string {
  const label = row.label ?? row.field
  if (row.namespace !== 'tui' || label !== row.field) return label
  if (row.field === 'reasoning' || row.field === 'scrollbar' || row.field === 'statusDetails' || row.field === 'locale') return `${tuiCopy(row.field, locale)} (${row.field})`
  const names: Record<string, string> = { theme: '明暗主题', brandAnimation: '品牌动画', submitOnEnter: '回车发送', colorTier: '色彩档位' }
  return locale !== 'en-US' && names[row.field] !== undefined ? `${names[row.field]} (${row.field})` : label
}

/** This view never reads configuration or owns the input draft. */
export function SettingsBrowser(props: SettingsPaneProps & { columns: number }): ReactNode {
  const { rows, selectedIndex, editing, updateError, busy, searching, filter = '', breadcrumb = ['设置'], categories = [], activeCategory, locale } = props
  const width = Math.max(1, props.columns)
  const budget = Math.max(1, props.maxRows ?? 18)
  const selected = Math.max(0, Math.min(selectedIndex, rows.length - 1))
  const active = rows[selected]
  const compact = budget < 8
  const filtered = filter !== '' || searching === true
  const category = categories.find(entry => entry.id === activeCategory)?.label ?? breadcrumb[1]
  const back = breadcrumb.length > 2 ? '返回' : '关闭'
  const action = active?.navigable === true ? '进入' : active?.editable === false ? '只读' : canToggleSetting(active) ? '切换' : '编辑'
  const primary = action === '只读' ? action : `Enter ${action}`
  let footer = busy === true ? ['正在处理，请稍候…'] : editing ? ['Enter 保存 · Esc 取消']
    : searching === true ? ['↑↓ 选择 · Enter 完成搜索 · Esc 清除', 'Tab/Shift+Tab 分类']
      : compact ? [`${primary} · Esc ${back}`]
        : width < 80 ? [`↑↓ 选择 · ${primary} · Esc ${back}`, `Tab 分类 · / 搜索${active?.navigable === true && active.editable !== false ? ' · i JSON' : ''}`]
          : [`↑↓ 选择 · PgUp/PgDn 翻页 · ${primary} · ←/Esc ${back}`, `Tab/Shift+Tab 分类 · / 搜索${active?.navigable === true && active.editable !== false ? ' · i JSON 编辑' : canToggleSetting(active) ? ' · Space 切换' : ''} · e 导出 · r 重载`]
  if (budget <= 2) footer = []
  const lines: { parts: string[]; bg: BackgroundToken }[] = []
  const add = (text: string, token: StyleToken = 'fg', bold = false, bg: BackgroundToken = 'bg') => lines.push({ parts: [styled(fit(text, width), token, undefined, bold)], bg })
  const count = `${rows.length === 0 ? 0 : selected + 1}/${rows.length}`
  const title = compact && category !== undefined ? `[${category}]` : '设置'
  add(`${fit(title, Math.max(1, width - displayWidth(count) - 2))}  ${count}`, 'fg', true)
  const showTabs = !compact && categories.length > 0
  if (showTabs) lines.push({ parts: tabLine(categories, activeCategory, width), bg: 'bg' })
  if (!compact) {
    const path = breadcrumb.slice(showTabs ? 2 : 1).join(' › ') || category || '选择分类'
    const location = displayWidth(escapeContent(path)) <= width ? path : `… › ${breadcrumb.slice(-2).join(' › ')}`
    add(filtered ? `搜索结果 /${filter}${searching === true ? '▏' : ''}` : location, filtered ? 'accentText' : 'fgDim')
  } else if (searching === true) {
    lines[0] = { parts: [styled(fit(`搜索 /${filter}▏`, width), 'accentText')], bg: 'bg' }
  }
  const status = updateError !== undefined ? `✗ 更新失败：${updateError}` : busy === true ? '正在处理设置…' : undefined
  const space = Math.max(0, budget - lines.length - footer.length - (status === undefined ? 0 : 1))
  const detail: string[] = []
  // Reserve at least three list rows on ordinary screens; details use the rest.
  const detailBudget = compact || active === undefined ? 0 : Math.min(6, Math.max(0, space - Math.min(3, Math.max(1, rows.length))))
  if (active !== undefined && detailBudget > 0) {
    const source = filtered ? `${active.namespace} · ${active.field}` : fieldLabel(active, locale)
    detail.push(...wrapDisplayLines(escapeContent(`当前项: ${source}`), width).slice(0, filtered ? 2 : 1))
    const value = active.value === '' ? '—' : active.value
    detail.push(...wrapDisplayLines(escapeContent(`${active.navigable === true ? '包含' : '当前值'}: ${value}`), width))
    if (active.description !== undefined) detail.push(...wrapDisplayLines(escapeContent(active.description), width))
    if (detail.length > detailBudget) {
      detail.length = detailBudget
      detail[detail.length - 1] = `${wcwidthSafeSlice(detail[detail.length - 1]!, Math.max(0, width - 1))}…`
    }
  }
  const size = Math.min(rows.length, Math.max(0, space - detail.length))
  const start = Math.max(0, Math.min(rows.length - size, selected - Math.floor(size / 2)))
  if (size === 0 && space > detail.length) add(filtered ? '没有匹配的设置 · Esc 清除搜索' : '无可用设置', 'fgDim')
  for (const [offset, row] of rows.slice(start, start + size).entries()) {
    const isSelected = start + offset === selected
    const rawValue = row.value === 'true' ? '✓ 开启' : row.value === 'false' ? '○ 关闭' : row.value
    const value = rawValue || (row.navigable === true ? '打开 ›' : '—')
    const labelWidth = Math.max(1, Math.min(44, Math.floor((width - 4) * 0.45)))
    const label = fit(`${fieldLabel(row, locale)}${row.required === true ? ' *' : ''}`, labelWidth)
    const gap = Math.max(2, labelWidth - displayWidth(label) + 2)
    const text = `${isSelected ? '› ' : '  '}${label}${' '.repeat(gap)}${fit(`${row.navigable === true ? '› ' : ''}${value}`, Math.max(1, width - 2 - displayWidth(label) - gap))}`
    add(text, isSelected ? 'fg' : 'fgSoft', isSelected, isSelected ? 'settingsCardBg' : 'bg')
  }
  for (const text of detail) add(text, 'fgDim')
  if (status !== undefined) add(status, updateError === undefined ? 'fgDim' : 'error')
  for (const text of footer) add(text, 'fgDim')
  return <Box flexDirection="column" width="100%" flexShrink={0}>
    {lines.slice(0, budget).map((line, index) => <Box key={index} height={1} flexShrink={0} width="100%"><Text wrap="truncate-end">{paintBackgroundRow(line.parts, line.bg, width)}</Text></Box>)}
  </Box>
}
