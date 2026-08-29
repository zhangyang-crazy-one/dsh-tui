/** Shared near-full-width geometry for transcript rows and HUDs. */

/** Two terminal columns of breathing room on each side of wide conversations. */
const WIDE_GUTTER_COLUMNS = 2

/** Narrow terminals cannot afford fixed horizontal gutters. */
const GUTTER_BREAKPOINT_COLUMNS = 40

/**
 * Return the near-full conversation width for a terminal.
 * @param columns - terminal width in columns.
 * @returns full width below 40 columns, otherwise two columns inset per side.
 */
export function conversationWidth(columns: number): number {
  if (columns < GUTTER_BREAKPOINT_COLUMNS) return Math.max(1, columns)
  return Math.max(1, columns - WIDE_GUTTER_COLUMNS * 2)
}

/**
 * Return the left inset Yoga uses when centering the conversation column.
 * @param columns - terminal width in columns.
 * @param width - centered content width.
 * @returns zero-based left inset.
 */
export function conversationLeft(columns: number, width: number): number {
  return Math.max(0, Math.ceil((columns - width) / 2))
}
