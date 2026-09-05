/**
 * Stable physical-line records for the transcript renderer.
 *
 * Every line consumed downstream — Ink row painting, the ScreenAtlas cell
 * grid, OSC 8 hit testing, copy selection back-mapping, and the eventual
 * frame snapshot — reads from this single record shape. The record is
 * frozen: settled blocks expose a stable array reference whose line
 * objects never change identity, which lets React reconciliation and the
 * per-row diff skip unchanged rows without re-walking the transcript.
 *
 * The display width always comes from {@link displayWidth}, the render
 * layer's single width primitive. CJK, combining marks, variation
 * selectors and ZWJ emoji therefore stay aligned with the rest of the
 * renderer.
 * @module @deepseek-ai/dsh-tui-render/physical-line
 */

import { displayWidth } from './content.ts'
import type { BackgroundToken, StyleToken } from './theme.ts'

/**
 * OSC 8 hyperlink target covering a physical line. One target per line
 * keeps the hit-test O(1); longer URLs that span rows model themselves
 * as one target on each visible row.
 */
export interface PhysicalLineOsc8 {
  /** OSC 8 URL, already filtered by the hyperlink capability. */
  readonly href: string
  /** Stable id so two lines pointing at the same URL stay comparable. */
  readonly id: string
}

/**
 * Inline styled span. The text is already escaped through
 * {@link escapeContent}; consumers compose it into {@link paintRow} via
 * {@link styled} at the installed theme tier.
 */
export interface PhysicalLineSpan {
  /** Escaped plain text occupying part of the line. */
  readonly text: string
  /** Theme token to paint with. */
  readonly token: StyleToken
  /** Whether to prepend SGR 1 (bold). */
  readonly bold?: boolean
  /** OSC 8 target covering this span, when present. */
  readonly href?: string
}

/**
 * Stable physical-line record. Frozen by {@link createPhysicalLine}; the
 * owning block retains the same reference across reads until the block
 * revises or is evicted.
 */
export interface PhysicalLine {
  /** Stable owning block identity. */
  readonly blockId: string
  /** Visible plain text after escape, CJK/emoji preserved. */
  readonly text: string
  /** Display columns; always equal to `displayWidth(text)`. */
  readonly displayWidth: number
  /** Ordered styled spans partitioning `text` exactly. */
  readonly spans: readonly PhysicalLineSpan[]
  /** Inclusive start offset into the block's authoritative source. */
  readonly sourceStart: number
  /** Exclusive end offset into the block's authoritative source. */
  readonly sourceEnd: number
  /** Zero-based row inside the owning block. */
  readonly blockRow: number
  /** Background semantics used by row identity and forced repaint. */
  readonly background?: BackgroundToken
  /** Cell width painted through `background`; defaults to `displayWidth`. */
  readonly backgroundColumns?: number
  /** OSC 8 hyperlink target covering the line, when present. */
  readonly osc8?: PhysicalLineOsc8
  /**
   * Per-grapheme source offsets, parallel to text graphemes. Absent when
   * the projector cannot prove a per-grapheme correspondence; consumers
   * fall back to walking `sourceStart..sourceEnd` during selection
   * back-mapping.
   */
  readonly graphemeSources?: readonly number[]
}

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Concatenate the text of every span in order. */
function joinSpanText(spans: readonly PhysicalLineSpan[]): string {
  let joined = ''
  for (const span of spans) joined += span.text
  return joined
}

/** Count graphemes in `text` using the shared segmenter. */
function graphemeCount(text: string): number {
  let count = 0
  for (const _segment of GRAPHEME_SEGMENTER.segment(text)) count += 1
  return count
}

/**
 * Create one frozen physical-line record from validated inputs.
 * @param input - line geometry, spans, and optional link/selection metadata.
 * @returns the frozen immutable physical line.
 */
export function createPhysicalLine(input: {
  /** Stable owning block identity. */
  blockId: string
  /** Ordered styled spans partitioning the visible text. */
  spans: readonly PhysicalLineSpan[]
  /** Inclusive source offset for the first grapheme. */
  sourceStart: number
  /** Exclusive source offset one past the last grapheme. */
  sourceEnd: number
  /** Zero-based row inside the block. */
  blockRow: number
  /** Background semantics for this row. */
  background?: BackgroundToken
  /** Cell width painted through `background`; defaults to `displayWidth`. */
  backgroundColumns?: number
  /** OSC 8 hyperlink target, when the whole line is one link. */
  osc8?: PhysicalLineOsc8
  /**
   * Per-grapheme source offsets parallel to text graphemes. Each entry
   * is the byte offset inside the block's authoritative source for the
   * grapheme occupying the matching position in `text`.
   */
  graphemeSources?: readonly number[]
}): PhysicalLine {
  if (input.blockId === '') {
    throw new Error('createPhysicalLine: blockId must be a non-empty string')
  }
  if (!Number.isInteger(input.sourceStart) || input.sourceStart < 0) {
    throw new Error('createPhysicalLine: sourceStart must be a non-negative integer')
  }
  if (!Number.isInteger(input.sourceEnd) || input.sourceEnd < input.sourceStart) {
    throw new Error('createPhysicalLine: sourceEnd must be an integer >= sourceStart')
  }
  if (!Number.isInteger(input.blockRow) || input.blockRow < 0) {
    throw new Error('createPhysicalLine: blockRow must be a non-negative integer')
  }
  if (
    input.backgroundColumns !== undefined
    && (!Number.isInteger(input.backgroundColumns) || input.backgroundColumns < 1)
  ) {
    throw new Error('createPhysicalLine: backgroundColumns must be a positive integer')
  }
  if (input.osc8 !== undefined && input.osc8.href === '') {
    throw new Error('createPhysicalLine: osc8.href must be non-empty')
  }
  if (input.osc8 !== undefined && input.osc8.id === '') {
    throw new Error('createPhysicalLine: osc8.id must be non-empty')
  }
  const text = joinSpanText(input.spans)
  if (input.graphemeSources !== undefined) {
    const expected = graphemeCount(text)
    if (input.graphemeSources.length !== expected) {
      throw new Error(
        'createPhysicalLine: graphemeSources length'
        + ` ${String(input.graphemeSources.length)}`
        + ` does not match text grapheme count ${String(expected)}`,
      )
    }
    for (const offset of input.graphemeSources) {
      if (!Number.isInteger(offset) || offset < input.sourceStart || offset > input.sourceEnd) {
        throw new Error(
          'createPhysicalLine: graphemeSources offset must be an integer'
          + ' inside [sourceStart, sourceEnd]',
        )
      }
    }
  }
  const spans: readonly PhysicalLineSpan[] = Object.freeze(
    input.spans.map(span => Object.freeze({
      text: span.text,
      token: span.token,
      ...(span.bold === undefined ? {} : { bold: span.bold }),
      ...(span.href === undefined ? {} : { href: span.href }),
    })),
  )
  const line: PhysicalLine = {
    blockId: input.blockId,
    text,
    displayWidth: displayWidth(text),
    spans,
    sourceStart: input.sourceStart,
    sourceEnd: input.sourceEnd,
    blockRow: input.blockRow,
    ...(input.background === undefined ? {} : { background: input.background }),
    ...(input.backgroundColumns === undefined
      ? {}
      : { backgroundColumns: input.backgroundColumns }),
    ...(input.osc8 === undefined
      ? {}
      : { osc8: Object.freeze({ href: input.osc8.href, id: input.osc8.id }) }),
    ...(input.graphemeSources === undefined
      ? {}
      : { graphemeSources: Object.freeze([...input.graphemeSources]) }),
  }
  return Object.freeze(line)
}

/**
 * Return the OSC 8 href covering one column, or undefined.
 * @param line - the physical line to hit-test.
 * @param column - zero-based display column inside the line.
 * @returns the link target when the column is inside the line's OSC 8 span.
 */
export function osc8AtColumn(
  line: PhysicalLine,
  column: number,
): string | undefined {
  if (!Number.isInteger(column) || column < 0 || column >= line.displayWidth) {
    return undefined
  }
  let cursor = 0
  for (const span of line.spans) {
    const end = cursor + displayWidth(span.text)
    if (column >= cursor && column < end) return span.href ?? line.osc8?.href
    cursor = end
  }
  return line.osc8?.href
}

/**
 * Map one display column inside `line` back to the owning source offset.
 * Uses the precomputed `graphemeSources` when available; otherwise walks
 * `sourceStart..sourceEnd` one grapheme at a time.
 * @param line - the physical line to query.
 * @param column - zero-based display column inside the line.
 * @returns the source offset of the grapheme occupying `column`.
 */
export function sourceOffsetAtColumn(
  line: PhysicalLine,
  column: number,
): number {
  if (!Number.isInteger(column)) return line.sourceStart
  if (column < 0) return line.sourceStart
  if (column >= line.displayWidth) return line.sourceEnd
  let cursor = 0
  let graphemeIndex = 0
  for (const segment of GRAPHEME_SEGMENTER.segment(line.text)) {
    const width = displayWidth(segment.segment)
    if (cursor + width > column) {
      if (line.graphemeSources !== undefined) {
        // graphemeSources is parallel to text graphemes and validated to
        // match in createPhysicalLine, so the indexed read is defined.
        return line.graphemeSources[graphemeIndex] as number
      }
      return line.sourceStart + segment.index
    }
    cursor += width
    graphemeIndex += 1
  }
  // v8 ignore next -- the for loop above always exits through the early returns; empty text falls out via `column >= displayWidth` above.
  return line.sourceEnd
}

/**
 * Sum the byte cost of one physical line for the LRU budget.
 * @param line - the physical line to measure.
 * @returns the approximate byte cost including spans and metadata.
 */
export function physicalLineByteSize(line: PhysicalLine): number {
  let bytes = 0
  bytes += line.text.length
  for (const span of line.spans) bytes += span.text.length + (span.href?.length ?? 0)
  bytes += line.sourceEnd - line.sourceStart
  if (line.osc8 !== undefined) bytes += line.osc8.href.length + line.osc8.id.length
  if (line.graphemeSources !== undefined) bytes += line.graphemeSources.length * 4
  return bytes
}
