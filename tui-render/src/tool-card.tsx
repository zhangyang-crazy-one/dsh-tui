/** Foldable tool preview using the same bounded rows as the transcript viewport. */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { hyperlinksEnabled } from './hyperlink.ts'
import { paintLineFromRenderLine } from './painted-line.ts'
import { inkColor } from './theme.ts'
import { ToolRowCache } from './tool-rows.ts'
import { toolPolicyDefaults, type RenderPolicyTools } from './render-policy.ts'
import type { ToolCardModel } from './tool-cards.ts'
import type { TuiLocale } from './ui-copy.ts'

/** Tool preview inputs; complete source remains available in the detail reader. */
export interface ToolCardProps {
  /** Paired call/result model. */
  card: ToolCardModel
  /** Disclose the bounded body preview. */
  expanded?: boolean
  /** Full card width in terminal columns. */
  maxCols?: number
  /** Locale for labels and the detail entry. */
  locale?: TuiLocale
  /** Host-validated preview and cache budgets. */
  policy?: RenderPolicyTools
}

/**
 * Render a tool heading and its bounded specialized preview.
 * @param props - canonical tool data, disclosure state, and display settings.
 * @returns rows shared with the physical transcript path.
 */
export function ToolCard({ card, expanded = false, maxCols = 80, locale = 'zh-CN', policy = toolPolicyDefaults() }: ToolCardProps): ReactNode {
  const cache = new ToolRowCache(policy)
  const rows = cache.rows(card.callId, card, maxCols, expanded, locale).slice()
  return <Box flexDirection="column" width="100%" backgroundColor={inkColor('toolBg')}>
    {rows.map((line, index) => <Text key={index} wrap="truncate">{paintLineFromRenderLine(line, hyperlinksEnabled())}</Text>)}
  </Box>
}
