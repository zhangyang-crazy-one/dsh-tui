/**
 * ModelPane: the in-terminal model selection panel. Rows render the provider
 * route and model id through {@link escapeContent} before the theme layer —
 * provider names and model ids are external catalog data (P5) — and the list
 * keeps the highlighted row inside a {@link MODEL_WINDOW}-row moving window.
 * The component is purely
 * presentational: keys route through {@link mapKeyEvent} in the loop owner
 * (the `/model` command opens the panel, j/k move the highlight, printable
 * keys filter the catalog, Enter switches, Esc closes).
 * @module @deepseek-ai/dsh-tui-render/model-pane
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'

/** One model selection row: a provider/model pair from the catalog. */
export interface ModelRow {
  /** Stable row key (`provider:model`), unique across the catalog. */
  id: string
  /** Provider route id passed to {@link GenerateOptions.provider}. */
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  model: string
  /** Human-readable model name for the selector. */
  name: string
  /** True for the degraded `provider 当前默认` row (empty/failed catalog). */
  fallback: boolean
  /** True when this row matches the live selection. */
  current: boolean
  /** Guidance for a provider that currently advertises no models; such a row cannot be selected. */
  unavailable?: string
}

/** Model panel phase: loading/error are mutually exclusive with results. */
export type ModelPaneStatus = 'loading' | 'error' | 'idle'

/** ModelPane props. */
export interface ModelPaneProps {
  /** The live catalog filter (typed into the composer slot). */
  filter: string
  /** Matched provider/model rows, in catalog order. */
  rows: readonly ModelRow[]
  /** Index of the highlighted row. */
  selectedIndex: number
  /** Catalog phase (loading/error states render instead of results). */
  status?: ModelPaneStatus
  /** Failure detail shown in the error state. */
  error?: string
  /** Physical row budget after the shell, filter input and footer. */
  maxRows?: number
}

/** Controller snapshot backing the model panel. */
export interface ModelPaneState {
  /** The live catalog filter. */
  filter: string
  /** Matched provider/model rows, in catalog order. */
  rows: readonly ModelRow[]
  /** Index of the highlighted row. */
  selectedIndex: number
  /** Whether the panel is open. */
  open: boolean
  /** Catalog phase: loading/error vs. settled rows. */
  status: ModelPaneStatus
  /** Failure detail shown in the error state. */
  error?: string
}

/** Maximum visible rows in the selection-following catalog window. */
export const MODEL_WINDOW = 30

/**
 * The model selection panel.
 * @param props - catalog rows and selection.
 * @returns the element tree.
 */
export function ModelPane({
  filter,
  rows,
  selectedIndex,
  status = 'idle',
  error,
  maxRows = MODEL_WINDOW + 3,
}: ModelPaneProps): ReactNode {
  const windowSize = Math.min(MODEL_WINDOW, Math.max(1, maxRows - 3))
  const windowStart = Math.min(
    Math.max(0, selectedIndex - windowSize + 1),
    Math.max(0, rows.length - windowSize),
  )
  const visible = rows.slice(windowStart, windowStart + windowSize)
  const hiddenBelow = rows.length - windowStart - visible.length
  let windowHint = `… 上方 ${windowStart} 个 · 下方 ${hiddenBelow} 个模型`
  if (windowStart === 0) {
    windowHint = `… 还有 ${hiddenBelow} 个模型`
  } else if (hiddenBelow === 0) {
    windowHint = `… 上方 ${windowStart} 个模型`
  }
  let bodyNode: ReactNode
  if (status === 'loading') {
    bodyNode = <Text>{styled(escapeContent('加载中…'), 'fgDim')}</Text>
  } else if (status === 'error') {
    bodyNode = (
      <Text>
        {styled(
          escapeContent(`✗ 加载失败：${error === undefined || error === '' ? '模型目录不可用' : error}`),
          'error',
        )}
      </Text>
    )
  } else if (rows.length === 0) {
    bodyNode = <Text>{styled(escapeContent('无可用模型'), 'fgDim')}</Text>
  } else {
    bodyNode = visible.map((row, index) => {
      const highlighted = windowStart + index === selectedIndex
      return (
        <Text key={row.id} wrap="truncate">
          {highlighted ? styled(escapeContent('› '), 'accent', undefined, true) : '  '}
          {styled(`${escapeContent(row.name)} `, highlighted ? 'fg' : 'fgSoft', undefined, highlighted)}
          {styled(escapeContent(row.provider), 'fgDim')}
          {row.current ? styled(escapeContent(' · 当前'), 'accentDim') : ''}
          {row.unavailable === undefined ? '' : styled(escapeContent(` · ${row.unavailable}`), 'warning')}
        </Text>
      )
    })
  }
  return (
    <Box flexDirection="column" width="100%">
      <Text wrap="truncate">
        {styled(`模型: ${escapeContent(filter)}`, 'fg', undefined, true)}
        {status === 'idle' && rows.length > 0
          ? styled(`  ·  ${String(Math.min(rows.length, Math.max(1, selectedIndex + 1)))}/${String(rows.length)}`, 'fgDim')
          : ''}
      </Text>
      {bodyNode}
      {status !== 'loading' && status !== 'error' && rows.length > windowSize ? (
        <Text dimColor wrap="truncate">{windowHint}</Text>
      ) : null}
      <Text wrap="truncate">{styled(escapeContent('↑↓/jk 选择 · Enter 切换 · Esc 关闭'), 'fgDim')}</Text>
    </Box>
  )
}
