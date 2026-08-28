/**
 * SettingsPane: the overlay for host settings fields. Presentational only —
 * keys route through {@link mapKeyEvent} in the loop owner, and the runtime
 * (not this module) calls `ctx.settings.update`.
 * @module @deepseek-ai/dsh-tui-render/settings-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent, wcwidthSafeSlice } from './content.ts'
import { paintRow, styled } from './theme.ts'

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
}

/** SettingsPane props. */
export interface SettingsPaneProps {
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
 * One painted, escaped row.
 * @param text - untrusted or static copy.
 * @param token - theme token.
 * @param bold - heading uses the fg bold tier.
 * @returns the Text element.
 */
function line(
  text: string,
  token: 'fg' | 'fgDim' | 'error' | 'accent',
  bold = false,
): ReactNode {
  return (
    <Text>
      {paintRow([styled(escapeContent(text), token, undefined, bold)])}
    </Text>
  )
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
): string[] {
  const marker = selected
    ? styled(escapeContent('› '), 'accent', undefined, true)
    : '  '
  const escapedLabel = escapeContent(label)
  const escapedValue = escapeContent(value)
  const labelToken = selected ? 'fg' : 'fgDim'
  const labelCols = MARKER_COLS + displayWidth(escapedLabel)
  const valueBudget = Math.max(0, columns - labelCols - VALUE_GAP)
  const fittedValue = fitValue(escapedValue, valueBudget)
  const gap = Math.max(
    VALUE_GAP,
    columns - labelCols - displayWidth(fittedValue),
  )
  return [
    marker,
    styled(escapedLabel, labelToken),
    styled(' '.repeat(gap), 'bg'),
    ...(fittedValue === '' ? [] : [styled(fittedValue, 'fgDim')]),
  ]
}

/**
 * The settings overlay: heading, a {@link SETTINGS_WINDOW} of one-line
 * table rows (label left, value right) around the selection, optional
 * error pair, and the browse or edit footnote. Does not call `ctx.settings`.
 * @param props - host rows, selection, editing flag, and optional error.
 * @returns the element tree.
 */
export function SettingsPane({
  rows,
  selectedIndex,
  editing,
  onboarding,
  updateError,
}: SettingsPaneProps): ReactNode {
  const { columns } = useWindowSize()
  const width = columns > 0 ? columns : 80
  const errorReason = updateError ?? (rows.length === 0 ? EMPTY_TABLE_REASON : undefined)
  const footnote = onboarding === true
    ? ONBOARDING_FOOTNOTE
    : editing ? EDIT_FOOTNOTE : FOOTNOTE
  const size = Math.min(SETTINGS_WINDOW, rows.length)
  const start = rows.length <= SETTINGS_WINDOW
    ? 0
    : Math.min(
      Math.max(0, selectedIndex - Math.floor(SETTINGS_WINDOW / 2)),
      rows.length - SETTINGS_WINDOW,
    )
  const visible = rows.slice(start, start + size)
  return (
    <Box flexDirection="column" width="100%">
      {line(onboarding === true ? ONBOARDING_TITLE : TITLE, 'fg', true)}
      {start > 0 ? line(`… 还有 ${String(start)} 项`, 'fgDim') : null}
      {visible.map((row, index) => {
        const absolute = start + index
        const selected = absolute === selectedIndex
        const label = `${row.namespace} · ${row.field}`
        return (
          <Box key={`${row.namespace}:${row.field}`} width="100%">
            <Text>
              {paintRow(fieldRow(label, row.value, selected, width))}
            </Text>
          </Box>
        )
      })}
      {rows.length > start + size
        ? line(`… 还有 ${String(rows.length - start - size)} 项`, 'fgDim')
        : null}
      {errorReason !== undefined ? (
        <Box flexDirection="column" width="100%">
          {line(
            errorReason === EMPTY_TABLE_REASON
              ? EMPTY_TABLE_REASON
              : `✗ 更新失败：${errorReason}`,
            'error',
          )}
          {errorReason === EMPTY_TABLE_REASON ? null : line(FAIL_NEXT, 'fgDim')}
        </Box>
      ) : null}
      {line(footnote, 'fgDim')}
    </Box>
  )
}
