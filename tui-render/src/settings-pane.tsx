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
const FOOTNOTE = '↑↓/jk 选择 · Enter 编辑 · e 导出 · r 重载 · Esc 关闭'
/** Exact key footnote while the composer holds the draft value. */
const EDIT_FOOTNOTE = 'Enter 应用 · Esc 取消'
/** Exact key footnote while collecting the first API key. */
const ONBOARDING_FOOTNOTE = 'Enter 保存 · Esc 跳过'
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
}

/** SettingsPane props. */
export interface SettingsPaneProps {
  /** Presentation-copy locale, Chinese when omitted. */
  locale?: TuiLocale
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
  /** Available row budget; when omitted, defaults to {@link SETTINGS_WINDOW}. */
  maxRows?: number
}

/** Controller snapshot backing the settings overlay. */
export interface SettingsPaneState {
  /** Whether the overlay currently replaces the conversation column. */
  open: boolean
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
  const escapedLabel = escapeContent(label)
  const escapedValue = escapeContent(value)
  const labelToken = selected ? 'fg' : 'fgSoft'
  const labelCols = MARKER_COLS + reqWidth + displayWidth(escapedLabel)
  const valueBudget = Math.max(0, columns - labelCols - VALUE_GAP)
  const fittedValue = fitValue(escapedValue, valueBudget)
  const gap = Math.max(
    VALUE_GAP,
    columns - labelCols - displayWidth(fittedValue),
  )
  return [
    marker,
    ...(required ? [reqMark] : []),
    styled(escapedLabel, labelToken),
    styled(' '.repeat(gap), 'settingsCardBg'),
    ...(fittedValue === '' ? [] : [styled(fittedValue, selected ? 'fg' : 'fgDim')]),
  ]
}

/**
 * Compute the maximum visible items in the settings table.
 *
 * @param maxRows - available vertical row budget, or undefined for default window.
 * @param totalRows - total settings field rows count.
 * @param errorReason - failure copy or empty table reason if present.
 * @returns number of item rows visible in the window.
 */
export function computeSettingsWindow(
  maxRows: number | undefined,
  totalRows: number,
  errorReason: string | undefined,
): number {
  if (maxRows === undefined) return SETTINGS_WINDOW
  const errorLines = errorReason === undefined ? 0 : errorReason === EMPTY_TABLE_REASON ? 1 : 2
  const fixedOverhead = 2 + errorLines
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
  rows,
  selectedIndex,
  editing,
  onboarding,
  updateError,
  locale,
  maxRows,
}: SettingsPaneProps): ReactNode {
  const { columns } = useWindowSize()
  const width = columns > 0 ? columns : 80
  const errorReason = updateError ?? (rows.length === 0 ? EMPTY_TABLE_REASON : undefined)
  const footnote = onboarding === true
    ? ONBOARDING_FOOTNOTE
    : editing ? EDIT_FOOTNOTE : FOOTNOTE
  const windowLimit = computeSettingsWindow(maxRows, rows.length, errorReason)
  const size = Math.min(windowLimit, rows.length)
  const start = rows.length <= size
    ? 0
    : Math.min(
      Math.max(0, selectedIndex - Math.floor(size / 2)),
      rows.length - size,
    )
  const visible = rows.slice(start, start + size)
  const renderLine = (text: string, token: 'fg' | 'fgDim' | 'error' | 'accent', bold = false) => (
    <Box width="100%">
      <Text>
        {paintBackgroundRow([styled(escapeContent(text), token, undefined, bold)], 'settingsCardBg', width)}
      </Text>
    </Box>
  )
  return (
    <Box flexDirection="column" width="100%">
      {renderLine(onboarding === true ? ONBOARDING_TITLE : TITLE, 'fg', true)}
      {start > 0 ? renderLine(`… 还有 ${String(start)} 项`, 'fgDim') : null}
      {visible.map((row, index) => {
        const absolute = start + index
        const selected = absolute === selectedIndex
        let localized: string
        if (row.label !== undefined) {
          localized = row.label
        } else if (
          row.namespace === 'tui'
          && (row.field === 'reasoning' || row.field === 'scrollbar'
            || row.field === 'statusDetails' || row.field === 'locale')
        ) {
          localized = `${row.field} · ${tuiCopy(row.field, locale)}`
        } else if (row.field === 'apiKeyEnv') {
          localized = `${row.field} · 环境变量名`
        } else {
          localized = row.field
        }
        const label = row.label === undefined ? `${row.namespace} · ${localized}` : localized
        return (
          <Box key={`${row.namespace}:${row.field}`} width="100%">
            <Text>
              {paintBackgroundRow(fieldRow(label, row.value, selected, width, row.required === true), 'settingsCardBg', width)}
            </Text>
          </Box>
        )
      })}
      {rows.length > start + size
        ? renderLine(`… 还有 ${String(rows.length - start - size)} 项`, 'fgDim')
        : null}
      {errorReason === undefined ? null : (
        <Box flexDirection="column" width="100%">
          {renderLine(
            errorReason === EMPTY_TABLE_REASON
              ? EMPTY_TABLE_REASON
              : `✗ 更新失败：${errorReason}`,
            'error',
          )}
          {errorReason === EMPTY_TABLE_REASON ? null : renderLine(FAIL_NEXT, 'fgDim')}
        </Box>
      )}
      {renderLine(footnote, 'fgDim')}
    </Box>
  )
}
