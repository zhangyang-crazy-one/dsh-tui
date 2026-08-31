/**
 * Physical-row viewport state for the fullscreen transcript.
 *
 * The reducer owns the only user-visible scroll coordinate. Renderers report
 * measured block rows after each Ink layout; detached updates preserve a
 * stable block/row anchor instead of translating the whole transcript column.
 * @module @deepseek-ai/dsh-tui-render/transcript-viewport
 */

/** One measured top-level transcript block. */
export interface TranscriptBlockLayout {
  /** Stable identity retained while the block changes or reflows. */
  readonly id: string
  /** Zero-based physical row from the transcript start. */
  readonly top: number
  /** Measured physical row count, including the block's trailing gap. */
  readonly rows: number
}

/** Stable reading location inside one transcript block. */
export interface TranscriptViewportAnchor {
  /** Stable block identity. */
  readonly blockId: string
  /** Zero-based physical row inside the block. */
  readonly rowWithinBlock: number
  /** Physical viewport row where the anchored row remains painted. */
  readonly viewportRow: number
}

/** Complete physical-row viewport state. */
export interface TranscriptViewportState {
  /** Whether layout changes keep the viewport attached to the latest row. */
  readonly follow: boolean
  /** Physical rows between the viewport's bottom edge and the transcript end. */
  readonly offsetFromBottom: number
  /** Physical rows appended below a detached viewport. */
  readonly unseenRows: number
  /** Total measured transcript rows. */
  readonly contentRows: number
  /** Physical rows available inside the fixed viewport. */
  readonly viewportRows: number
  /** Stable detached reading location, when one has been measured. */
  readonly anchor?: TranscriptViewportAnchor | undefined
  /** Last measured layouts used to recover a removed anchor. */
  readonly blocks: readonly TranscriptBlockLayout[]
}

/** Physical-row viewport transition. */
export type TranscriptViewportAction =
  | Readonly<{
    kind: 'layout'
    contentRows: number
    viewportRows: number
    blocks: readonly TranscriptBlockLayout[]
    /** Newly appended physical rows, excluding estimate-to-measurement refinement. */
    unseenRowsAdded?: number | undefined
  }>
  | Readonly<{ kind: 'scroll'; delta: number }>
  | Readonly<{ kind: 'offset'; offsetFromBottom: number }>
  | Readonly<{ kind: 'position'; fraction: number }>
  | Readonly<{ kind: 'edge'; edge: 'oldest' | 'latest' }>
  | Readonly<{ kind: 'reset' }>

/** One loop-issued navigation command consumed after Ink has measured layout. */
export type TranscriptViewportCommand =
  | Readonly<{ sequence: number; kind: 'scroll'; delta: number }>
  | Readonly<{ sequence: number; kind: 'page'; delta: -1 | 1 }>
  | Readonly<{ sequence: number; kind: 'position'; fraction: number }>
  | Readonly<{ sequence: number; kind: 'edge'; edge: 'oldest' | 'latest' }>
  | Readonly<{ sequence: number; kind: 'reset' }>

/** Empty live-edge viewport before the first Ink layout. */
export const EMPTY_TRANSCRIPT_VIEWPORT: TranscriptViewportState = Object.freeze({
  follow: true,
  offsetFromBottom: 0,
  unseenRows: 0,
  contentRows: 0,
  viewportRows: 0,
  blocks: Object.freeze([]),
})

function maxOffset(contentRows: number, viewportRows: number): number {
  return Math.max(0, contentRows - viewportRows)
}

function clampOffset(value: number, contentRows: number, viewportRows: number): number {
  return Math.max(0, Math.min(value, maxOffset(contentRows, viewportRows)))
}

function topRow(state: Pick<
  TranscriptViewportState,
  'contentRows' | 'viewportRows' | 'offsetFromBottom'
>): number {
  return Math.max(0, state.contentRows - state.viewportRows - state.offsetFromBottom)
}

function anchorForRow(
  row: number,
  blocks: readonly TranscriptBlockLayout[],
  viewportRow = 0,
): TranscriptViewportAnchor | undefined {
  if (blocks.length === 0) return undefined
  const containing = blocks.find(block => row >= block.top && row < block.top + block.rows)
  const block = containing
    ?? blocks.findLast(candidate => candidate.top <= row)
    ?? blocks[0]
  if (block === undefined) return undefined
  return {
    blockId: block.id,
    rowWithinBlock: Math.max(0, Math.min(row - block.top, Math.max(0, block.rows - 1))),
    viewportRow,
  }
}

function recoverAnchorBlock(
  state: TranscriptViewportState,
  blocks: readonly TranscriptBlockLayout[],
): TranscriptBlockLayout | undefined {
  const anchor = state.anchor
  if (anchor === undefined) return undefined
  const exact = blocks.find(block => block.id === anchor.blockId)
  if (exact !== undefined) return exact
  const previousIndex = state.blocks.findIndex(block => block.id === anchor.blockId)
  if (previousIndex < 0) return undefined
  for (let index = previousIndex - 1; index >= 0; index -= 1) {
    const previous = state.blocks[index]
    if (previous === undefined) continue
    const recovered = blocks.find(block => block.id === previous.id)
    if (recovered !== undefined) return recovered
  }
  return blocks[0]
}

function sameBlocks(
  left: readonly TranscriptBlockLayout[],
  right: readonly TranscriptBlockLayout[],
): boolean {
  return left.length === right.length && left.every((block, index) => {
    const other = right[index]
    return other !== undefined
      && block.id === other.id
      && block.top === other.top
      && block.rows === other.rows
  })
}

function layoutState(
  state: TranscriptViewportState,
  action: Extract<TranscriptViewportAction, { kind: 'layout' }>,
): TranscriptViewportState {
  const contentRows = Math.max(0, action.contentRows)
  const viewportRows = Math.max(0, action.viewportRows)
  const blocks = Object.freeze([...action.blocks])
  if (state.follow) {
    if (
      state.contentRows === contentRows
      && state.viewportRows === viewportRows
      && state.offsetFromBottom === 0
      && state.unseenRows === 0
      && sameBlocks(state.blocks, blocks)
    ) return state
    return {
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      contentRows,
      viewportRows,
      blocks,
    }
  }

  const recovered = recoverAnchorBlock(state, blocks)
  let offsetFromBottom: number
  if (recovered !== undefined && state.anchor !== undefined) {
    const anchoredRow = recovered.top + Math.min(
      state.anchor.rowWithinBlock,
      Math.max(0, recovered.rows - 1),
    )
    const requestedTop = Math.max(0, anchoredRow - state.anchor.viewportRow)
    offsetFromBottom = clampOffset(
      contentRows - viewportRows - requestedTop,
      contentRows,
      viewportRows,
    )
  } else {
    offsetFromBottom = clampOffset(
      state.offsetFromBottom + contentRows - state.contentRows,
      contentRows,
      viewportRows,
    )
  }
  if (offsetFromBottom === 0) {
    return {
      follow: true,
      offsetFromBottom: 0,
      unseenRows: 0,
      contentRows,
      viewportRows,
      blocks,
    }
  }
  const nextTop = Math.max(0, contentRows - viewportRows - offsetFromBottom)
  const next: TranscriptViewportState = {
    follow: false,
    offsetFromBottom,
    unseenRows: state.unseenRows + Math.max(0, action.unseenRowsAdded ?? 0),
    contentRows,
    viewportRows,
    anchor: anchorForRow(nextTop, blocks, state.anchor?.viewportRow ?? 0),
    blocks,
  }
  if (
    state.contentRows === next.contentRows
    && state.viewportRows === next.viewportRows
    && state.offsetFromBottom === next.offsetFromBottom
    && state.unseenRows === next.unseenRows
    && state.anchor?.blockId === next.anchor?.blockId
    && state.anchor?.rowWithinBlock === next.anchor?.rowWithinBlock
    && state.anchor?.viewportRow === next.anchor?.viewportRow
    && sameBlocks(state.blocks, next.blocks)
  ) return state
  return next
}

/**
 * Fold one measured layout or navigation command over the transcript viewport.
 * @param state - current physical-row viewport.
 * @param action - measured layout or user navigation.
 * @returns the next immutable viewport state.
 */
export function reduceTranscriptViewport(
  state: TranscriptViewportState,
  action: TranscriptViewportAction,
): TranscriptViewportState {
  switch (action.kind) {
    case 'layout':
      return layoutState(state, action)
    case 'scroll': {
      const available = maxOffset(state.contentRows, state.viewportRows)
      if (action.delta === 0) return state
      if (available === 0) {
        return action.delta < 0 && !state.follow
          ? { ...state, follow: true, offsetFromBottom: 0, unseenRows: 0, anchor: undefined }
          : state
      }
      const offsetFromBottom = clampOffset(
        state.offsetFromBottom + action.delta,
        state.contentRows,
        state.viewportRows,
      )
      const follow = offsetFromBottom === 0
        ? true
        : action.delta > 0
          ? false
          : state.follow
      const nextTop = topRow({ ...state, offsetFromBottom })
      return {
        ...state,
        follow,
        offsetFromBottom,
        unseenRows: follow ? 0 : state.unseenRows,
        anchor: follow ? undefined : anchorForRow(nextTop, state.blocks),
      }
    }
    case 'offset': {
      const offsetFromBottom = clampOffset(
        action.offsetFromBottom,
        state.contentRows,
        state.viewportRows,
      )
      const follow = offsetFromBottom === 0
      const nextTop = topRow({ ...state, offsetFromBottom })
      return {
        ...state,
        follow,
        offsetFromBottom,
        unseenRows: follow ? 0 : state.unseenRows,
        anchor: follow ? undefined : anchorForRow(nextTop, state.blocks),
      }
    }
    case 'position': {
      const available = maxOffset(state.contentRows, state.viewportRows)
      const fraction = Math.max(0, Math.min(action.fraction, 1))
      const offsetFromBottom = Math.round(available * (1 - fraction))
      const follow = offsetFromBottom === 0
      const nextTop = topRow({ ...state, offsetFromBottom })
      return {
        ...state,
        follow,
        offsetFromBottom,
        unseenRows: follow ? 0 : state.unseenRows,
        anchor: follow ? undefined : anchorForRow(nextTop, state.blocks),
      }
    }
    case 'edge': {
      if (action.edge === 'latest') {
        return {
          ...state,
          follow: true,
          offsetFromBottom: 0,
          unseenRows: 0,
          anchor: undefined,
        }
      }
      const offsetFromBottom = maxOffset(state.contentRows, state.viewportRows)
      return {
        ...state,
        follow: false,
        offsetFromBottom,
        anchor: anchorForRow(0, state.blocks),
      }
    }
    case 'reset':
      return EMPTY_TRANSCRIPT_VIEWPORT
  }
}

/** Fixed-width physical scroll-rail cells for one transcript viewport. */
export interface PhysicalScrollRailGeometry {
  /** Total rail rows. */
  readonly rows: number
  /** First thumb row, zero based. */
  readonly thumbStart: number
  /** Thumb height; never below three rows. */
  readonly thumbRows: number
}

/**
 * Derive a bottom-relative rail from measured terminal rows.
 * @param contentRows - total measured transcript rows.
 * @param viewportRows - available physical viewport rows.
 * @param offsetFromBottom - rows between the viewport and live edge.
 * @returns rail geometry, or undefined while content does not overflow.
 */
export function physicalScrollRailGeometry(
  contentRows: number,
  viewportRows: number,
  offsetFromBottom: number,
): PhysicalScrollRailGeometry | undefined {
  if (viewportRows <= 0 || contentRows <= viewportRows) return undefined
  const rows = viewportRows
  const thumbRows = Math.min(
    rows,
    Math.max(3, Math.floor(rows * viewportRows / contentRows)),
  )
  const travel = rows - thumbRows
  const available = contentRows - viewportRows
  const fromBottom = Math.round(
    Math.max(0, Math.min(offsetFromBottom, available)) / available * travel,
  )
  return { rows, thumbStart: travel - fromBottom, thumbRows }
}
