/**
 * AppShell — the terminal surface frame: one top bar, the content slot, the
 * status slot, and the input slot, laid out relative to the terminal width.
 * @module @deepseek-ai/dsh-tui-render/app-shell
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent, wcwidthSafeSlice } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { BRAND_PLAIN_WORDMARK } from './brand.ts'

/** One-column ellipsis used when a title-bar run is truncated. */
const TITLE_BAR_ELLIPSIS = '…'

/**
 * Truncate `text` to `maxCols` display columns, appending {@link TITLE_BAR_ELLIPSIS}
 * when the original run overflows. Never splits a wide glyph.
 * @param text - escaped plain text.
 * @param maxCols - column budget; empty when non-positive.
 * @returns the fitted run.
 */
function fitDisplayWidth(text: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  const ellipsisWidth = displayWidth(TITLE_BAR_ELLIPSIS)
  const budget = maxCols - ellipsisWidth
  if (budget <= 0) return wcwidthSafeSlice(TITLE_BAR_ELLIPSIS, maxCols)
  return `${wcwidthSafeSlice(text, budget)}${TITLE_BAR_ELLIPSIS}`
}

/** Title-bar runs after they have been fitted into a column budget. */
export interface TitleBarLayout {
  /** Left-side title, possibly truncated. */
  title: string
  /** Right-side badge, possibly truncated. */
  badge: string
  /** Space columns between the title and badge; 0 when the row is a single run. */
  gap: number
}

/**
 * Fit the top-bar title and badge into `columns` so the painted row never
 * overflows the window. A short title keeps its glyphs and the badge
 * truncates first; a long title truncates when the badge still fits; both
 * shrink when neither side has a full-width remainder. The reserved gap is
 * one column whenever two runs remain.
 * @param title - escaped session title.
 * @param badge - escaped provider/model badge.
 * @param columns - terminal width in columns.
 * @returns the fitted title, badge, and gap that sum to `columns`.
 */
export function layoutTitleBar(
  title: string,
  badge: string,
  columns: number,
): TitleBarLayout {
  const cols = Math.max(0, columns)
  if (cols === 0) return { title: '', badge: '', gap: 0 }
  const gapMin = 1
  const titleWidth = displayWidth(title)
  const badgeWidth = displayWidth(badge)
  if (titleWidth + badgeWidth + gapMin <= cols) {
    return { title, badge, gap: cols - titleWidth - badgeWidth }
  }
  if (titleWidth + gapMin <= cols) {
    const fittedBadge = fitDisplayWidth(badge, cols - gapMin - titleWidth)
    return {
      title,
      badge: fittedBadge,
      gap: cols - titleWidth - displayWidth(fittedBadge),
    }
  }
  if (badgeWidth + gapMin <= cols) {
    const fittedTitle = fitDisplayWidth(title, cols - gapMin - badgeWidth)
    return {
      title: fittedTitle,
      badge,
      gap: cols - displayWidth(fittedTitle) - badgeWidth,
    }
  }
  const inner = Math.max(0, cols - gapMin)
  const fittedTitle = fitDisplayWidth(title, Math.min(titleWidth, inner))
  const fittedBadge = fitDisplayWidth(
    badge,
    inner - displayWidth(fittedTitle),
  )
  return {
    title: fittedTitle,
    badge: fittedBadge,
    gap: cols - displayWidth(fittedTitle) - displayWidth(fittedBadge),
  }
}

/**
 * Paint the fitted title: the DeepSeek wordmark uses accent, the rest uses fg.
 * @param title - already-fitted escaped title.
 * @returns styled parts for {@link paintRow}.
 */
function titleRun(title: string): string[] {
  if (title.startsWith(BRAND_PLAIN_WORDMARK)) {
    return [
      styled(BRAND_PLAIN_WORDMARK, 'accent'),
      ...(title.length > BRAND_PLAIN_WORDMARK.length
        ? [styled(title.slice(BRAND_PLAIN_WORDMARK.length), 'fg')]
        : []),
    ]
  }
  return [styled(title, 'fg')]
}

/** Slots the shell lays out; content providers plug into these. */
export interface AppShellProps {
  /** Session title shown in the top bar. */
  title: string
  /** Provider/model badge shown right-aligned in the top bar. */
  badge: string
  /** Main scrollable area. */
  children: ReactNode
  /** Status area under the content; the adaptive footer uses up to three rows. */
  status?: ReactNode
  /** Fixed input area at the bottom. */
  input?: ReactNode
}

/**
 * The shell frame. All sizes are relative (percent width or window-derived
 * columns), so a terminal resize re-lays out without absolute-column
 * assumptions. The frame owns the DeepSeek bg wiring (gap audit blocker#1):
 * every row the shell renders itself is painted through the bg token via
 * {@link paintRow}, so the pure-black strip survives each row's own SGR
 * resets and light terminals still show black-on-white body text. The title
 * and badge are fitted by {@link layoutTitleBar} so the top bar never
 * overflows the window. The thin `─` separator under the top bar is the L5
 * line vocabulary (thin only, no `═ ║`). Content/status/input slots paint
 * their own rows (StreamView owns the conversation rows; a slot's own
 * subtree owns its lines). The frame is
 * exactly the terminal height so the composer pins to the screen bottom
 * (Ink sizes its root by width only, so `height="100%"` cannot do this);
 * the content slot's flexGrow absorbs the leftover rows and its blank rows
 * stay black through the frame-fill erase bracketing.
 * @param props - slot content.
 * @returns the shell element tree.
 */
export function AppShell({ title, badge, children, status, input }: AppShellProps): ReactNode {
  const { columns, rows } = useWindowSize()
  const fitted = layoutTitleBar(
    escapeContent(title),
    escapeContent(badge),
    columns,
  )
  const titleParts = titleRun(fitted.title)
  if (fitted.gap > 0) titleParts.push(styled(' '.repeat(fitted.gap), 'bg'))
  if (fitted.badge !== '') titleParts.push(styled(fitted.badge, 'fgDim'))
  return (
    <Box flexDirection="column" width="100%" height={rows}>
      <Box flexDirection="row" width="100%" flexShrink={0}>
        <Text>
          {paintRow(titleParts)}
        </Text>
      </Box>
      <Box width="100%" flexShrink={0}>
        <Text>{paintRow([styled(escapeContent('─'.repeat(columns)), 'fgDim')])}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} width="100%" overflow="hidden">
        {children}
      </Box>
      {status !== undefined ? (
        <Box flexDirection="row" width="100%" flexShrink={0}>
          {status}
        </Box>
      ) : null}
      {input !== undefined ? (
        <Box flexDirection="row" width="100%" flexShrink={0}>
          {input}
        </Box>
      ) : null}
    </Box>
  )
}
