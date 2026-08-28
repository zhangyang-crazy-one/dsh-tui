/** FIFO-only composer HUD chip for structured drafts. */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Exact queue-chip copy; zero hides the complete HUD row. */
export function queueChipText(count: number): string | undefined {
  return count <= 0 ? undefined : `待发 ${String(count)} · ↑ 取出`
}

/** Queue chip rendered closest to the composer without owning input. */
export function QueueChip({ count }: { readonly count: number }): ReactNode {
  const text = queueChipText(count)
  return text === undefined
    ? null
    : <Text>{paintRow([styled(escapeContent(text), 'fg')])}</Text>
}
