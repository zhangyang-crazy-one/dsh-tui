/**
 * Generated FishLogo home with capability fallbacks and one bounded reveal.
 * The component consumes committed terminal constants only; it never reads
 * environment, settings, input, or client runtime code.
 * @module @deepseek-ai/dsh-tui-render/pixel-fish-home
 */

import { Box, Text } from 'ink'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  BRAND_ASCII,
  BRAND_FULL_BLOCK,
  BRAND_HALF_BLOCK,
  BRAND_HALF_BLOCK_FRAMES,
  BRAND_HOME_LINE,
  BRAND_PLAIN_WORDMARK,
} from './brand.ts'
import { displayWidth } from './content.ts'
import { paintRow, styled } from './theme.ts'
import type { BrandRenderTier } from './terminal-capabilities.ts'
import { FrameProbe } from './frame-stats.ts'
import type { FrameProbeHandle } from './frame-stats.ts'

/** Delay for each of the four reveal frames. */
export const BRAND_FRAME_MS = 320

/** Generated contour height shared by the three visual tiers. */
export const BRAND_ART_ROWS = BRAND_HALF_BLOCK.length

/** Art plus wordmark, one spacer, and prompt. */
export const BRAND_HOME_ROWS = BRAND_ART_ROWS + 3

let activeRevealTimers = 0

/**
 * Return the number of live timeouts owned by generated-brand reveals.
 * @returns zero when every visible or hidden home has settled.
 */
export function activeBrandRevealTimerCount(): number {
  return activeRevealTimers
}

const TIER_ORDER = [
  'half-block',
  'full-block',
  'ascii',
  'plain',
] as const satisfies readonly BrandRenderTier[]

function rowsForTier(tier: Exclude<BrandRenderTier, 'plain'>): readonly string[] {
  switch (tier) {
    case 'half-block':
      return BRAND_HALF_BLOCK
    case 'full-block':
      return BRAND_FULL_BLOCK
    case 'ascii':
      return BRAND_ASCII
  }
}

function rowsFit(rows: readonly string[], maxColumns: number, maxRows: number): boolean {
  return maxRows >= BRAND_HOME_ROWS
    && rows.length === BRAND_ART_ROWS
    && rows.every(row => displayWidth(row) <= maxColumns)
}

/**
 * Select the strongest generated tier at or below the terminal capability.
 * Failed dimension or display-width checks continue through the locked
 * half-block → full-block → ASCII → plain order.
 * @param preferred - strongest glyph tier supported by the terminal.
 * @param maxColumns - available content columns.
 * @param maxRows - available content rows.
 * @returns the selected safe tier.
 */
export function selectBrandRenderTier(
  preferred: BrandRenderTier,
  maxColumns: number,
  maxRows: number,
): BrandRenderTier {
  const start = TIER_ORDER.indexOf(preferred)
  for (const tier of TIER_ORDER.slice(start)) {
    if (tier === 'plain' || rowsFit(rowsForTier(tier), maxColumns, maxRows)) return tier
  }
  return 'plain'
}

/** Runtime inputs for the generated idle home. */
export interface PixelFishHomeProps {
  /** Strongest glyph tier supported by the terminal environment. */
  tier: BrandRenderTier
  /** Whether the loop currently permits the one-shot reveal. */
  animate: boolean
  /** Whether the empty home remains the active content. */
  visible: boolean
  /** Available content columns. */
  maxColumns: number
  /** Available content rows. */
  maxRows: number
  /** Optional dedicated render-cost probe for the generated home subtree. */
  frameProbe?: FrameProbeHandle | undefined
}

/**
 * Render the official generated contour and own its single reveal timer.
 * Each dependency change clears the active timeout before a replacement can
 * start; the fourth frame settles to the static contour after 1280 ms.
 * @param props - capability, lifecycle permission, visibility, and dimensions.
 * @returns the generated home block.
 */
export function PixelFishHome({
  tier,
  animate,
  visible,
  maxColumns,
  maxRows,
  frameProbe,
}: PixelFishHomeProps): ReactNode {
  const selected = selectBrandRenderTier(tier, maxColumns, maxRows)
  const [frameIndex, setFrameIndex] = useState<number | undefined>(undefined)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const revealStartedRef = useRef(false)

  const clearTimer = (): void => {
    if (timerRef.current === undefined) return
    clearTimeout(timerRef.current)
    timerRef.current = undefined
    activeRevealTimers -= 1
  }

  const armTimer = (callback: () => void): void => {
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      activeRevealTimers -= 1
      callback()
    }, BRAND_FRAME_MS)
    activeRevealTimers += 1
  }

  useEffect(() => {
    clearTimer()
    setFrameIndex(undefined)
    if (!visible || !animate || selected !== 'half-block') return
    if (revealStartedRef.current) return

    revealStartedRef.current = true
    let nextFrame = 1
    setFrameIndex(0)
    const advance = (): void => {
      if (nextFrame >= BRAND_HALF_BLOCK_FRAMES.length) {
        setFrameIndex(undefined)
        return
      }
      setFrameIndex(nextFrame)
      nextFrame += 1
      armTimer(advance)
    }
    armTimer(advance)
    return clearTimer
  }, [animate, selected, visible])

  const rows = selected === 'plain'
    ? undefined
    : selected === 'half-block' && frameIndex !== undefined
      ? BRAND_HALF_BLOCK_FRAMES[frameIndex]
      : rowsForTier(selected)

  const home = (
    <Box flexDirection="column" width="100%">
      {rows?.map((row, index) => (
        <Text key={`fish-${String(index)}`}>{paintRow([styled(row, 'accent')])}</Text>
      ))}
      <Text>{paintRow([styled(BRAND_PLAIN_WORDMARK, 'accent', undefined, true)])}</Text>
      <Text>{paintRow([styled(' ', 'bg')])}</Text>
      <Text>{paintRow([styled(BRAND_HOME_LINE, 'fg')])}</Text>
    </Box>
  )
  return frameProbe === undefined
    ? home
    : <FrameProbe probe={frameProbe}>{home}</FrameProbe>
}
