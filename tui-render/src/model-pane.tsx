/**
 * ModelPane: the in-terminal model selection panel. Rows render the provider
 * route and model id through {@link escapeContent} before the theme layer —
 * provider names and model ids are external catalog data (P5) — and the list
 * windows to {@link MODEL_WINDOW} rows. The component is purely
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

/** Maximum visible rows before the truncation hint. */
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
}: ModelPaneProps): ReactNode {
  const visible = rows.slice(0, MODEL_WINDOW)
  return (
    <Box flexDirection="column" width="100%">
      <Text>模型: {escapeContent(filter)}</Text>
      {status === 'loading' ? (
        <Text>{styled(escapeContent('加载中…'), 'fgDim')}</Text>
      ) : status === 'error' ? (
        <Text>
          {styled(
            escapeContent(`✗ 加载失败：${error === undefined || error === '' ? '模型目录不可用' : error}`),
            'error',
          )}
        </Text>
      ) : rows.length === 0 ? (
        <Text>{styled(escapeContent('无可用模型'), 'fgDim')}</Text>
      ) : (
        visible.map((row, index) => {
          const highlighted = index === selectedIndex
          return (
            <Box key={row.id} width="100%">
              <Text>{highlighted ? styled(escapeContent('› '), 'accent', undefined, true) : '  '}</Text>
              <Text dimColor={!highlighted}>{escapeContent(row.name)}</Text>
              <Text dimColor={!highlighted}>
                {highlighted
                  ? ` ${styled(escapeContent(row.provider), 'fgDim')}`
                  : ` ${escapeContent(row.provider)}`}
              </Text>
              {row.current ? (
                <Text>{styled(escapeContent(' · 当前'), 'accentDim')}</Text>
              ) : null}
            </Box>
          )
        })
      )}
      {status !== 'loading' && status !== 'error' && rows.length > MODEL_WINDOW ? (
        <Text dimColor>… 还有 {rows.length - MODEL_WINDOW} 个模型</Text>
      ) : null}
      <Text>{styled(escapeContent('↑↓/jk 选择 · Enter 切换 · Esc 关闭'), 'fgDim')}</Text>
    </Box>
  )
}
