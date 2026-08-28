/**
 * Workspace overlay (`工作区`, `g t`): the lazy ctx.fs tree. Directories carry
 * `▸` collapsed / `▾` expanded glyphs (tree nodes, not the Ctrl+E tool-card
 * fold); the selected row carries `› `. Browse footnote
 * `j/k 选择 · Enter 打开 · e 路径 · Esc 关闭`; the path draft switches the
 * footnote to `Enter 解析 · Esc 取消` and a failed resolve keeps the previous
 * root with `✗ 路径无效：{原因}` + `当前路径保持不变 · 可重试` (D-09).
 * @module @deepseek-ai/dsh-tui-render/workspace-pane
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { OverlayShell } from './overlay-shell.tsx'
import { escapeContent, displayWidth } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'

/** One visible workspace-tree row. */
export interface WorkspaceNode {
  /** The node target's displayPath (inserted into the composer on file Enter). */
  readonly path: string
  /** Basename shown in the tree (untrusted). */
  readonly name: string
  /** Indent depth; root children are 0. */
  readonly depth: number
  /** Entry kind from the fs listing. */
  readonly kind: 'directory' | 'file' | 'other'
  /** Directory expanded state. */
  readonly expanded: boolean
}

/** Controller snapshot for the workspace overlay. */
export interface WorkspacePaneState {
  /** Whether this overlay currently replaces the conversation column. */
  readonly open: boolean
  /** Tree root display path ('' until the first resolve lands). */
  readonly root: string
  /** Visible rows in tree order. */
  readonly nodes: readonly WorkspaceNode[]
  /** Selected row index. */
  readonly selectedIndex: number
  /** True while the path draft owns the InputBar. */
  readonly editing: boolean
  /** Opener failure when ctx.fs is not composed (S19). */
  readonly error?: string | undefined
  /** Path-resolve failure reason (paints `✗ 路径无效：{原因}`). */
  readonly resolveError?: string | undefined
}

/** Closed overlay snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_WORKSPACE_PANE: WorkspacePaneState = {
  open: false,
  root: '',
  nodes: [],
  selectedIndex: 0,
  editing: false,
}

/** Recovery copy painted under a failed resolve (settings FAIL_NEXT analog). */
const RESOLVE_FAIL_NEXT = '当前路径保持不变 · 可重试'

/**
 * The workspace overlay: title `工作区`, the escaped tree rows with the
 * selection prefix, and the mode-appropriate footnote.
 * @param props - the pane state and the display-column budget per row.
 * @returns the element tree, or null when closed.
 */
export function WorkspacePane({
  state,
  maxCols,
}: {
  /** The overlay snapshot. */
  state: WorkspacePaneState
  /** Display-column budget per tree row. */
  maxCols: number
}): ReactNode {
  if (!state.open) return null
  if (state.error !== undefined) {
    return <OverlayShell title="工作区" error={state.error} footnote="Esc 关闭" />
  }
  const footnote = state.editing
    ? 'Enter 解析 · Esc 取消'
    : state.nodes.length === 0
      ? 'e 输入路径 · Esc 关闭'
      : 'j/k 选择 · Enter 打开 · e 路径 · Esc 关闭'
  const rows: ReactNode[] = []
  state.nodes.forEach((node, index) => {
    const glyph = node.kind === 'directory' ? (node.expanded ? '▾' : '▸') : ' '
    const selected = index === state.selectedIndex && !state.editing
    const head = `${selected ? '› ' : '  '}${'  '.repeat(node.depth)}${glyph} `
    rows.push(
      <Text key={node.path} wrap="truncate">
        {paintRow([
          styled(escapeContent(head), selected ? 'accent' : 'fgDim'),
          styled(
            truncateDisplay(
              escapeContent(node.name),
              Math.max(1, maxCols - displayWidth(head)),
            ),
            selected ? 'fg' : 'fgDim',
          ),
        ])}
      </Text>,
    )
  })
  return (
    <OverlayShell
      title="工作区"
      body={state.nodes.length === 0 ? '此目录为空' : undefined}
      footnote={footnote}
      error={
        state.resolveError === undefined ? undefined : `路径无效：${state.resolveError}`
      }
      errorNext={state.resolveError === undefined ? undefined : RESOLVE_FAIL_NEXT}
    >
      {rows}
    </OverlayShell>
  )
}
