/**
 * Pure helper that turns one {@link MarkdownRenderLine} into its final
 * painted terminal bytes. Lives outside the JSX bridge so the visible-row
 * slicer can render one line at a time without owning its own projector
 * state; both {@link ./markdown.tsx} and {@link ./physical-row.tsx} import
 * the same paint function so the per-line bridge stays byte-identical to
 * the legacy per-block bridge.
 *
 * The painter always runs the spans through {@link styled} at the installed
 * theme tier and wraps any span whose href is an OSC 8 URL in the OSC 8
 * escape pair when hyperlinks are enabled. A `codeBg` background token
 * extends the painted row across the measured columns so short code lines
 * still cover the full body width.
 * @module @deepseek-ai/dsh-tui-render/painted-line
 */

import { paintBackgroundRow, paintRow, styled } from './theme.ts'
import { displayColumnSlice } from './content.ts'
import type { MarkdownRenderLine } from './markdown-projector.ts'
import { hyperlinksEnabled, isOsc8Href, wrapOsc8 } from './hyperlink.ts'

/**
 * Render one {@link MarkdownRenderLine} into its painted terminal bytes.
 * Empty line spans return the bare bg row so the bridge never paints a
 * zero-byte row that drops the bg strip.
 * @param line - the projected physical row.
 * @param hyperlinks - override for the OSC 8 capability; omit to read the
 *   installed flag (tests can pin it on or off deterministically).
 * @returns the painted row bytes.
 */
export function paintLineFromRenderLine(
  line: MarkdownRenderLine,
  hyperlinks: boolean = hyperlinksEnabled(),
): string {
  if (line.spans.length === 0) return paintRow([])
  const parts: string[] = []
  for (const span of line.spans) {
    const text = displayColumnSlice(line.text, span.start, span.end)
    if (text === '') continue
    const styledText = styled(text, span.token, undefined, span.bold)
    if (span.href !== undefined && hyperlinks && isOsc8Href(span.href)) {
      parts.push(wrapOsc8(styledText, span.href))
    } else {
      parts.push(styledText)
    }
  }
  if (line.background !== undefined && line.background !== 'bg') {
    return paintBackgroundRow(
      parts,
      line.background,
      line.backgroundColumns ?? Math.max(line.displayWidth, 1),
    )
  }
  return paintRow(parts)
}
