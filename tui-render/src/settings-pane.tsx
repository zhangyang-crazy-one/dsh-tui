import { settingsGroup, SETTINGS_GROUP_LABELS } from './settings-groups.ts'
import { SettingsBrowser } from './settings-browser.tsx'
/**
 * SettingsPane: the overlay for host settings fields. Presentational only —
 * keys route through {@link mapKeyEvent} in the loop owner, and the runtime
 * (not this module) calls `ctx.settings.update`.
 * @module @deepseek-ai/dsh-tui-render/settings-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent, wcwidthSafeSlice } from './content.ts'
import { paintBackgroundRow, styled } from './theme.ts'
import { tuiCopy, type TuiLocale } from './ui-copy.ts'

/** Exact overlay heading (bold fg, never accent). */
const TITLE = '设置'
/** Exact first-run heading. */
const ONBOARDING_TITLE = '首次设置'
/** Exact key footnote while browsing rows. */
/** Exact key footnote while the composer holds the draft value. */
const EDIT_FOOTNOTE = 'Enter 应用 · Esc 取消'
/** Exact key footnote while collecting the first API key. */
const ONBOARDING_FOOTNOTE = 'Enter 保存 · Esc 跳过'
/** Exact busy line for an in-flight auto-discover; the overlay stays open. */
const DISCOVERY_BUSY = '正在获取模型列表…'
/** Visible field rows; each field is one table row. */
export const SETTINGS_WINDOW = 8
/** Marker plus trailing space (`› ` or two spaces). */
const MARKER_COLS = 2
/** Minimum gap between the field label and the value. */
const VALUE_GAP = 2
/** One-column ellipsis when a value overflows the remaining columns. */
const VALUE_ELLIPSIS = '…'
/** Next-step copy after an update failure (S5: ✗ with Chinese). */
const FAIL_NEXT = '当前值保持不变 · 可重试'
/** Reason shown when the host exposes no editable rows. */
const EMPTY_TABLE_REASON = '无可用设置'

/** One host field the overlay can edit. */
export interface SettingsFieldRow {
  /** Settings namespace, as registered (for example `llm-deepseek`). */
  namespace: string
  /** Schema field key (for example `baseURL`). */
  field: string
  /** Current resolved value, already a string for display. */
  value: string
  /** Whether this field is required by the schema / template (renders * in accent/error color). */
  required?: boolean
  /** Optional custom display label for the field. */
  label?: string
  /** Composer seed for editing; defaults to {@link value} when omitted. */
  editValue?: string
  /** Literal source path, preserving dots in keys and array indices. */
  sourcePath?: readonly string[]
  navigable?: boolean
  editable?: boolean
  description?: string
}

/** SettingsPane props. */
export interface SettingsPaneProps {
  categories?: readonly { id: string; label: string; count: number }[]
  activeCategory?: string
  /** Presentation-copy locale, Chinese when omitted. */
  locale?: TuiLocale
  breadcrumb?: readonly string[]
  filter?: string
  searching?: boolean
  /** Host fields, in display order. */
  rows: readonly SettingsFieldRow[]
  /** Highlighted row index. */
  selectedIndex: number
  /** When true, the composer holds a draft and the edit footnote shows. */
  editing: boolean
  /** First-run API-key collection; changes heading and footnote. */
  onboarding?: boolean
  /** Update-failure reason; when set, paints the ✗ pair. */
  updateError?: string
  /** An async auto-discover is in flight; the overlay stays open with a busy line. */
  busy?: boolean
  /** Available row budget; when omitted, defaults to {@link SETTINGS_WINDOW}. */
  maxRows?: number
}

/** Controller snapshot backing the settings overlay. */
export interface SettingsPaneState {
  categories?: readonly { id: string; label: string; count: number }[]
  activeCategory?: string
  /** Whether the overlay currently replaces the conversation column. */
  open: boolean
  breadcrumb?: readonly string[]
  filter?: string
  searching?: boolean
  /** Host fields, in display order. */
  rows: readonly SettingsFieldRow[]
  /** Highlighted row index. */
  selectedIndex: number
  /** Whether the composer currently holds a draft URL. */
  editing: boolean
  /** First-run API-key collection. */
  onboarding?: boolean
  /** Update-failure reason, when the last apply did not land. */
  updateError?: string
  /** An async auto-discover is in flight; the overlay stays open with a busy line. */
  busy?: boolean
}

/** Closed snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_SETTINGS_PANE: SettingsPaneState = {
  open: false,
  rows: [],
  selectedIndex: 0,
  editing: false,
}



/**
 * Fit a value into `maxCols`, appending {@link VALUE_ELLIPSIS} when it overflows.
 * @param value - already-escaped value text.
 * @param maxCols - remaining columns after the marker, label, and gap.
 * @returns the fitted value.
 */
function fitValue(value: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  if (displayWidth(value) <= maxCols) return value
  const ellipsisWidth = displayWidth(VALUE_ELLIPSIS)
  const budget = maxCols - ellipsisWidth
  if (budget <= 0) return wcwidthSafeSlice(VALUE_ELLIPSIS, maxCols)
  return `${wcwidthSafeSlice(value, budget)}${VALUE_ELLIPSIS}`
}

/**
 * One settings table row: label on the left, value on the right, one line.
 * @param label - `{namespace} · {field}`.
 * @param value - resolved display value.
 * @param selected - whether this row carries the accent marker.
 * @param columns - terminal width.
 * @returns paint parts for {@link paintRow}.
 */
const TUI_EXTRA_LABELS: Readonly<Record<string, { readonly 'zh-CN': string; readonly 'en-US': string }>> = {
  theme: { 'zh-CN': '明暗主题', 'en-US': 'Appearance' },
  brandAnimation: { 'zh-CN': '品牌动画', 'en-US': 'Brand animation' },
  submitOnEnter: { 'zh-CN': '回车发送', 'en-US': 'Enter to send' },
  colorTier: { 'zh-CN': '色彩档位', 'en-US': 'Color tier' },
}

function valueTokenFor(
  value: string,
  selected: boolean,
): 'fg' | 'fgDim' | 'success' | 'warning' | 'accentText' {
  if (value === '已配置' || value === 'true' || value === '开启') {
    return 'success'
  }
  if (value === '未配置') {
    return 'warning'
  }
  if (
    value.startsWith('Enter：')
    || value.startsWith('按 Enter')
    || value === 'Enter 设置密钥'
  ) {
    return 'accentText'
  }
  return selected ? 'fg' : 'fgDim'
}

function fieldRow(
  label: string,
  value: string,
  selected: boolean,
  columns: number,
  required = false,
): string[] {
  const marker = selected
    ? styled(escapeContent('› '), 'accent', undefined, true)
    : '  '
  const reqMark = required
    ? styled('* ', 'error', undefined, true)
    : ''
  const reqWidth = required ? 2 : 0
  const rawLabel = escapeContent(label)
  const labelBudget = displayWidth(rawLabel) + displayWidth(escapeContent(value)) + MARKER_COLS + reqWidth + VALUE_GAP <= columns
    ? displayWidth(rawLabel) : Math.max(1, Math.floor((columns - MARKER_COLS - reqWidth - VALUE_GAP) * 0.48))
  const escapedLabel = fitValue(rawLabel, labelBudget)
  const escapedValue = escapeContent(value)
  const labelToken = selected ? 'fg' : 'fgSoft'
  const labelCols = MARKER_COLS + reqWidth + displayWidth(escapedLabel)
  const valueBudget = Math.max(0, columns - labelCols - VALUE_GAP)
  const fittedValue = fitValue(escapedValue, valueBudget)
  const gap = Math.max(
    VALUE_GAP,
    columns - labelCols - displayWidth(fittedValue),
  )
  const valToken = valueTokenFor(value, selected)
  return [
    marker,
    ...(required ? [reqMark] : []),
    styled(escapedLabel, labelToken, undefined, selected),
    styled(' '.repeat(gap), 'settingsCardBg'),
    ...(fittedValue === '' ? [] : [styled(fittedValue, valToken, undefined, selected)]),
  ]
}

/**
 * Compute the maximum visible items in the settings table.
 *
 * @param maxRows - available vertical row budget, or undefined for default window.
 * @param totalRows - total settings field rows count.
 * @param errorReason - failure copy or empty table reason if present.
 * @param busy - whether the in-flight discovery line reserves a row.
 * @returns number of item rows visible in the window.
 */
export function computeSettingsWindow(
  maxRows: number | undefined,
  totalRows: number,
  errorReason: string | undefined,
  busy = false,
): number {
  if (maxRows === undefined) return busy ? Math.max(1, SETTINGS_WINDOW - 1) : SETTINGS_WINDOW
  let errorLines = 0
  if (errorReason === EMPTY_TABLE_REASON) {
    errorLines = 1
  } else if (errorReason !== undefined) {
    errorLines = 2
  }
  const fixedOverhead = 2 + errorLines + (busy ? 1 : 0)
  const available = Math.max(1, maxRows - fixedOverhead)
  if (totalRows <= available) {
    return totalRows
  }
  return Math.max(1, available - 2)
}

/**
 * The settings overlay: heading, an adaptive window of one-line
 * table rows (label left, value right) around the selection, optional
 * error pair, and the browse or edit footnote. Does not call `ctx.settings`.
 * @param props - host rows, selection, editing flag, optional error, and row budget.
 * @returns the element tree.
 */
export function SettingsPane({
  rows, selectedIndex, editing, onboarding, updateError, busy, locale, maxRows,
  breadcrumb, filter, searching, categories, activeCategory,
}: SettingsPaneProps): ReactNode {
  const { columns } = useWindowSize()
  const width = columns > 0 ? columns : 80
  if (breadcrumb !== undefined && onboarding !== true) return <SettingsBrowser
    rows={rows} selectedIndex={selectedIndex} editing={editing} columns={width} breadcrumb={breadcrumb}
    {...(locale === undefined ? {} : { locale })}
    {...(filter === undefined ? {} : { filter })}
    {...(searching === undefined ? {} : { searching })}
    {...(categories === undefined ? {} : { categories })}
    {...(activeCategory === undefined ? {} : { activeCategory })}
    {...(maxRows === undefined ? {} : { maxRows })}
    {...(updateError === undefined ? {} : { updateError })}
    {...(busy === undefined ? {} : { busy })}
  />
  const selected = Math.min(Math.max(0, selectedIndex), Math.max(0, rows.length - 1))
  const active = rows[selected]
  const errorReason = updateError ?? (rows.length === 0 ? EMPTY_TABLE_REASON : undefined)
  const footer = onboarding === true
    ? [editing ? ONBOARDING_FOOTNOTE : '↑↓ 选择密钥 · Enter 输入 · Esc 关闭']
    : [editing ? EDIT_FOOTNOTE : '↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭']
  const size = Math.min(rows.length, computeSettingsWindow(maxRows, rows.length, errorReason, busy === true))
  const start = Math.min(Math.max(0, selected - Math.floor(size / 2)), Math.max(0, rows.length - size))
  const renderLine = (text: string, token: 'fg' | 'fgDim' | 'error' | 'accent', bold = false) => (
    <Box width="100%" height={1} flexShrink={0}><Text wrap="truncate-end">
      {paintBackgroundRow([styled(fitValue(escapeContent(text), width), token, undefined, bold)], 'settingsCardBg', width)}
    </Text></Box>
  )
  let heading = active === undefined ? TITLE : `${TITLE} · ${SETTINGS_GROUP_LABELS[settingsGroup(active)]}`
  if (onboarding === true) heading = rows.length > 1 ? 'API 密钥' : ONBOARDING_TITLE
  const counter = rows.length === 0 ? '' : `${active !== undefined ? `${active.namespace} · ` : ''}${String(selected + 1)}/${String(rows.length)}`
  if (counter !== '') heading = `${fitValue(escapeContent(heading), Math.max(1, width - displayWidth(counter) - 2))}  ${counter}`
  const localizedLabel = (row: SettingsFieldRow): string => {
    if (row.label !== undefined && !(row.namespace === 'tui' && row.label === row.field)) return row.label
    const resolved: TuiLocale = locale ?? 'zh-CN'
    const label = row.namespace === 'tui' && (row.field === 'reasoning' || row.field === 'scrollbar' || row.field === 'statusDetails' || row.field === 'locale')
      ? `${row.field} · ${tuiCopy(row.field, locale)}`
      : row.namespace === 'tui' && row.field in TUI_EXTRA_LABELS
        ? `${row.field} · ${TUI_EXTRA_LABELS[row.field]![resolved === 'en-US' ? 'en-US' : 'zh-CN']}`
        : row.field === 'apiKeyEnv' ? `${row.field} · 环境变量名` : row.field
    return `${row.namespace} · ${label}`
  }
  return <Box flexDirection="column" width="100%">
    {renderLine(heading, 'fg', true)}
    {start > 0 ? renderLine(`↑ 上方还有 ${String(start)} 项 (… 还有 ${String(start)} 项)`, 'fgDim') : null}
    {rows.slice(start, start + size).map((row, index) => <Box key={`${row.namespace}:${JSON.stringify(row.sourcePath ?? row.field)}:${String(start + index)}`} width="100%" height={1} flexShrink={0}><Text wrap="truncate-end">
      {paintBackgroundRow(fieldRow(localizedLabel(row), `${row.navigable === true ? '› ' : ''}${row.value}`, start + index === selected, width, row.required === true), 'settingsCardBg', width)}
    </Text></Box>)}
    {rows.length > start + size ? renderLine(`… 还有 ${String(rows.length - start - size)} 项`, 'fgDim') : null}
    {errorReason === undefined ? null : renderLine(errorReason === EMPTY_TABLE_REASON ? EMPTY_TABLE_REASON : `✗ 更新失败：${errorReason}`, 'error')}
    {errorReason === undefined || errorReason === EMPTY_TABLE_REASON ? null : renderLine(FAIL_NEXT, 'fgDim')}
    {busy === true ? renderLine(DISCOVERY_BUSY, 'fgDim') : null}
    {footer.map((line, index) => <Box key={index} width="100%" height={1} flexShrink={0}>{renderLine(line, 'fgDim')}</Box>)}
  </Box>
}
