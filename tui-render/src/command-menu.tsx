/**
 * CommandMenu: the `/` palette. Case-insensitive name-prefix matching over
 * the command directory, Tab completion, Enter executes the highlighted match.
 * Names sit in a left column; descriptions sit in a right column.
 * @module @deepseek-ai/dsh-tui-render/command-menu
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { displayWidth, escapeContent, wcwidthSafeSlice } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** One selectable command entry. */
export interface CommandItem {
  /** Command name (e.g. 'compact'). */
  name: string
  /** Human-readable summary in the right column. */
  description: string
}

/** Visible palette rows under the composer. */
export const COMMAND_MENU_WINDOW = 8
/** Marker plus trailing space (`› ` or two spaces). */
const MARKER_COLS = 2
/** Gap between the name column and the description. */
const NAME_GAP = 2
/** One-column ellipsis when a description overflows. */
const DESC_ELLIPSIS = '…'

/**
 * Filter commands by case-insensitive name prefix. An empty query returns
 * the directory unchanged.
 * @param items - the directory.
 * @param query - the typed query, without a leading `/`.
 * @returns matching items, preserving directory order.
 */
export function filterCommands(
  items: readonly CommandItem[],
  query: string,
): CommandItem[] {
  const needle = query.toLowerCase()
  if (needle === '') return [...items]
  return items.filter(item => item.name.toLowerCase().startsWith(needle))
}

/** Complete the first matching item for the query (Tab). */
export function completeFirst(
  items: readonly CommandItem[],
  query: string,
): CommandItem | undefined {
  return filterCommands(items, query)[0]
}

/**
 * Clamp one menu selection after a directional move.
 * @param selectedIndex - current controlled index.
 * @param delta - signed row movement.
 * @param itemCount - current candidate count.
 * @returns zero for an empty menu, otherwise a valid candidate index.
 */
export function moveSelectionIndex(
  selectedIndex: number,
  delta: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return 0
  return Math.max(0, Math.min(selectedIndex + delta, itemCount - 1))
}

/**
 * Complete the controlled matching item for one query.
 * @param items - command directory.
 * @param query - typed command prefix.
 * @param selectedIndex - controlled match index.
 * @returns the clamped match, or undefined when no item matches.
 */
export function completeSelected(
  items: readonly CommandItem[],
  query: string,
  selectedIndex: number,
): CommandItem | undefined {
  const matches = filterCommands(items, query)
  return matches[moveSelectionIndex(selectedIndex, 0, matches.length)]
}

/**
 * Resolve the query Enter executes: the highlighted prefix match's name,
 * with any trailing arguments kept. An empty query resolves the controlled
 * directory row shown by the open palette.
 * @param items - the directory.
 * @param query - the text after `/`.
 * @param selectedIndex - controlled prefix-match index.
 * @returns the expanded command query, including trailing arguments.
 */
export function resolveEnterQuery(
  items: readonly CommandItem[],
  query: string,
  selectedIndex = 0,
): string {
  if (query === '') return completeSelected(items, query, selectedIndex)?.name ?? query
  const space = query.indexOf(' ')
  const head = space === -1 ? query : query.slice(0, space)
  const tail = space === -1 ? '' : query.slice(space)
  if (head === '') return query
  const completed = completeSelected(items, head, selectedIndex)
  if (completed === undefined) return query
  return `${completed.name}${tail}`
}

/** CommandMenu props. */
export interface CommandMenuProps {
  /** The command directory. */
  items: readonly CommandItem[]
  /** The typed query. */
  query: string
  /** Controller-owned selected match index. */
  selectedIndex?: number | undefined
}

/**
 * Fit `text` into `maxCols`, appending an ellipsis when it overflows.
 * @param text - already-escaped text.
 * @param maxCols - remaining columns.
 * @returns the fitted run.
 */
function fitText(text: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  if (displayWidth(text) <= maxCols) return text
  const ellipsisWidth = displayWidth(DESC_ELLIPSIS)
  const budget = maxCols - ellipsisWidth
  if (budget <= 0) return wcwidthSafeSlice(DESC_ELLIPSIS, maxCols)
  return `${wcwidthSafeSlice(text, budget)}${DESC_ELLIPSIS}`
}

/**
 * One palette row: `/{name}` in a shared left column, description on the right.
 * @param item - directory entry.
 * @param selected - whether this row carries the accent marker.
 * @param nameCols - shared name-column width.
 * @param columns - terminal width.
 * @returns paint parts for {@link paintRow}.
 */
function paletteRow(
  item: CommandItem,
  selected: boolean,
  nameCols: number,
  columns: number,
): string[] {
  const marker = selected
    ? styled(escapeContent('› '), 'accent', undefined, true)
    : '  '
  const name = escapeContent(`/${item.name}`)
  const pad = Math.max(0, nameCols - displayWidth(name))
  const used = MARKER_COLS + nameCols + NAME_GAP
  const desc = fitText(escapeContent(item.description), Math.max(0, columns - used))
  return [
    marker,
    styled(`${name}${' '.repeat(pad)}`, selected ? 'fg' : 'fgDim'),
    styled(' '.repeat(NAME_GAP), 'bg'),
    ...(desc === '' ? [] : [styled(desc, 'fgDim')]),
  ]
}

/**
 * The `/` palette: a two-column list under the composer. The first match
 * carries the accent `›` marker and an `fg` name; descriptions stay `fgDim`.
 * Names and descriptions are escaped.
 * @param props - directory and query.
 * @returns the element tree.
 */
export function CommandMenu({
  items,
  query,
  selectedIndex = 0,
}: CommandMenuProps): ReactNode {
  const { columns } = useWindowSize()
  const width = columns > 0 ? columns : 80
  const allMatches = filterCommands(items, query)
  const clampedIndex = moveSelectionIndex(selectedIndex, 0, allMatches.length)
  const offset = Math.max(0, clampedIndex - COMMAND_MENU_WINDOW + 1)
  const matches = allMatches.slice(offset, offset + COMMAND_MENU_WINDOW)
  if (matches.length === 0) return null
  let nameCols = 0
  for (const item of matches) {
    const widthName = displayWidth(`/${item.name}`)
    if (widthName > nameCols) nameCols = widthName
  }
  return (
    <Box flexDirection="column" width="100%">
      {matches.map((item, index) => (
        <Box key={item.name} width="100%">
          <Text>
            {paintRow(paletteRow(item, offset + index === clampedIndex, nameCols, width))}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
