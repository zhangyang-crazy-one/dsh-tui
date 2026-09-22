/**
 * Workspace overlay (`工作区`, `g t`): the lazy ctx.fs tree. Directories carry
 * `▸` collapsed / `▾` expanded glyphs (tree nodes, not the Ctrl+E tool-card
 * fold); the selected row carries `› `. Browse footnote
 * `j/k 选择 · Enter 打开 · e 路径 · Esc 关闭`; the path draft switches the
 * footnote to `Enter 解析 · Esc 取消` and a failed resolve keeps the previous
 * root with `✗ 路径无效：{原因}` + `当前路径保持不变 · 可重试` (D-09).
 * File previews wrap before paging, retain source line numbers, and reuse
 * Markdown syntax colors. Below the gutter's minimum width, content owns
 * the row; a one-column terminal substitutes wide glyphs with `�`.
 * @module @deepseek-ai/dsh-tui-render/workspace-pane
 */

import { Box, Text, useWindowSize } from 'ink'
import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { OverlayShell } from './overlay-shell.tsx'
import { escapeContent, displayWidth } from './content.ts'
import { paintBackgroundRow, paintRow, styled, type StyleToken } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'
import { materializeToolBodyRow, planToolBodyWindow, type ToolBodyCursor, type ToolBodyLine } from './tool-body.ts'
import { tokenize } from './markdown.tsx'

/** One visible workspace-tree row. */
export interface WorkspaceNode {
  /** The node target's displayPath (inserted into the composer on `i`). */
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
  /** Open file preview details when viewing file content. */
  readonly preview?: WorkspaceFilePreview | undefined
}

/** Active file preview model for WorkspacePane. */
export interface WorkspaceFilePreview {
  readonly path: string
  readonly name: string
  readonly lines: readonly string[]
  /** Zero-based physical row, clamped to the last full page at the current width and height. */
  readonly scrollOffset: number
}

/** Geometry reported after wrapping; lines identifies the immutable preview being measured. */
export interface WorkspacePreviewLayout {
  readonly lines: readonly string[]
  readonly pageRows: number
  readonly maxOffset: number
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

/** File names and logical source lines cannot add unmeasured terminal rows. */
function previewText(text: string): string {
  return escapeContent(text.replace(/\r/gu, '\\r')).replace(/\n/gu, '\\n').replace(/\t/gu, '\\t')
}

const PREVIEW_TOKEN: Readonly<Record<ReturnType<typeof tokenize>[number]['kind'], StyleToken>> = {
  keyword: 'codeKeyword', string: 'codeString', comment: 'codeComment', plain: 'fg',
}

/** Bounds both temporary measurement fragments and retained seek checkpoints. */
const PREVIEW_INDEX_BLOCK = 128

/** Bounded physical rows; keyboard dispatch and file loading remain controller-owned. */
function WorkspacePreview({ preview, columns, maxRows, onLayout }: {
  preview: WorkspaceFilePreview
  columns: number
  maxRows: number
  onLayout?: ((layout: WorkspacePreviewLayout) => void) | undefined
}): ReactNode {
  const { lines, name, scrollOffset } = preview
  const digits = Math.max(3, String(lines.length).length)
  // Leave room for a wide grapheme before reserving a line-number gutter.
  const gutterWidth = columns >= digits + 5 ? digits + 3 : 0
  const bodyWidth = Math.max(1, columns - gutterWidth)
  // Retain only the current document/width index; scrolling does not rewrap or grow a page history.
  const { document, checkpoints, totalRows } = useMemo(() => {
    const document = lines.map((text): ToolBodyLine => ({ text: previewText(text), token: 'codeBg' }))
    let cursor: ToolBodyCursor | undefined = { line: 0, offset: 0 }
    let checkpoints = [{ row: 0, cursor }]
    let stride = PREVIEW_INDEX_BLOCK
    let totalRows = 0
    while (cursor !== undefined) {
      const block = planToolBodyWindow(document, cursor, bodyWidth, PREVIEW_INDEX_BLOCK)
      totalRows += block.fragments.length
      cursor = block.next
      if (cursor !== undefined && totalRows % stride === 0) {
        checkpoints.push({ row: totalRows, cursor })
        if (checkpoints.length === PREVIEW_INDEX_BLOCK) {
          checkpoints = checkpoints.filter((_, index) => index % 2 === 0)
          stride *= 2
        }
      }
    }
    return { document, checkpoints, totalRows }
  }, [lines, bodyWidth])
  const pageRows = Math.max(0, maxRows - 2)
  const maxOffset = pageRows === 0 ? 0 : Math.max(0, totalRows - pageRows)
  const offset = Math.min(maxOffset, Math.max(0, scrollOffset))
  useLayoutEffect(() => {
    onLayout?.({ lines, pageRows, maxOffset })
  }, [onLayout, lines, pageRows, maxOffset])
  if (maxRows <= 0) return null
  const checkpoint = checkpoints.findLast(point => point.row <= offset) ?? { row: 0, cursor: { line: 0, offset: 0 } }
  let cursor = checkpoint.cursor
  // The offset is clamped before seeking; traversal is bounded by this document's checkpoint gap.
  for (let remaining = offset - checkpoint.row; remaining > 0;) {
    const block = planToolBodyWindow(document, cursor, bodyWidth, Math.min(remaining, PREVIEW_INDEX_BLOCK))
    remaining -= block.fragments.length
    if (block.next === undefined) break
    cursor = block.next
  }
  const page = planToolBodyWindow(document, cursor, bodyWidth, pageRows).fragments
  const first = page[0]
  const last = page.at(-1)
  const range = `(${first === undefined ? 0 : first.line + 1}-${last === undefined ? 0 : last.line + 1}/${lines.length} 行)`
  const title = truncateDisplay(`预览: ${previewText(name)} ${range}`, columns)
  const footnote = truncateDisplay('j/k 滚动 · q/Esc 返回 · i 插入路径', columns)
  const tokens = new Map<number, ReturnType<typeof tokenize>>()
  const rows = page.map((fragment) => {
    const source = (document.at(fragment.line) as ToolBodyLine).text
    let spans = tokens.get(fragment.line)
    if (spans === undefined) {
      const trimmed = source.trimStart()
      spans = [
        { kind: 'plain', text: source.slice(0, source.length - trimmed.length) },
        ...tokenize(trimmed, name.slice(name.lastIndexOf('.') + 1)),
      ]
      tokens.set(fragment.line, spans)
    }
    const gutter = gutterWidth === 0 ? '' : `${fragment.start === 0 ? String(fragment.line + 1).padStart(digits) : ' '.repeat(digits)} │ `
    const parts = [styled(gutter, 'fgDim')]
    const row = materializeToolBodyRow(document, fragment)
    if (displayWidth(row.text) > bodyWidth) {
      // A two-cell glyph cannot fit a one-column terminal.
      parts.push(styled('�', 'fg'))
    } else {
      let start = 0
      for (const span of spans) {
        const end = start + span.text.length
        if (end > fragment.start && start < fragment.end) {
          parts.push(styled(span.text.slice(Math.max(0, fragment.start - start), fragment.end - start), PREVIEW_TOKEN[span.kind]))
        }
        start = end
        if (start >= fragment.end) break
      }
    }
    return <Text key={`${fragment.line}:${fragment.start}`} wrap="truncate">
      {paintBackgroundRow(parts, 'codeBg', columns)}
    </Text>
  })
  return <Box flexDirection="column" width={columns}>
    <Text wrap="truncate">{paintRow([styled(title, 'fg', undefined, true)])}</Text>
    {rows}
    {maxRows > 1 ? <Text wrap="truncate">{paintRow([styled(footnote, 'fgDim')])}</Text> : null}
  </Box>
}

/**
 * The workspace overlay: title `工作区`, the escaped tree rows with the
 * selection prefix, and the mode-appropriate footnote. Preview offsets count
 * physical rows; maxRows includes the preview title and footnote.
 * @param props - the pane state and available display columns and rows.
 * @returns the element tree, or null when closed.
 */
export function WorkspacePane({
  state,
  maxCols,
  maxRows,
  onPreviewLayout,
}: {
  /** The overlay snapshot. */
  state: WorkspacePaneState
  /** Display-column budget per tree row. */
  maxCols: number
  /** Total preview rows including title and footer; defaults to terminal rows minus shell chrome. */
  maxRows?: number | undefined
  /** Report current preview limits before input; the controller clamps its physical offset on resize. */
  onPreviewLayout?: ((layout: WorkspacePreviewLayout) => void) | undefined
}): ReactNode {
  const { rows: windowRows, columns: windowColumns } = useWindowSize()
  if (!state.open) return null
  if (state.error !== undefined) {
    return <OverlayShell title="工作区" error={state.error} footnote="Esc 关闭" />
  }
  if (state.preview !== undefined) {
    return <WorkspacePreview preview={state.preview}
      columns={Math.max(1, Math.min(maxCols, windowColumns))}
      maxRows={Math.max(0, Math.min(maxRows ?? windowRows - 4, windowRows))}
      onLayout={onPreviewLayout} />
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
