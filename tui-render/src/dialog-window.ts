/** Physical-row windows shared by blocking dialogs; decision controls stay outside. */
import { useEffect, useMemo } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'

/** Keep wrapping out of spinner/stream updates while retaining the complete text. */
export function useDialogTextRows(source: string, columns: number): readonly string[] {
  return useMemo(() => source === '' ? [] : wrapDisplayLines(escapeContent(source), Math.max(1, columns)), [source, columns])
}

/** Clamp only when geometry/data requires it; ordinary refreshes preserve reading position. */
export function useDialogWindow<T>(
  rows: readonly T[], offset: number, limit: number, onOffsetChange?: (offset: number) => void,
): { visible: readonly T[]; start: number; total: number } {
  const count = Math.max(0, limit)
  const maximum = Math.max(0, rows.length - Math.max(1, count))
  const start = Math.max(0, Math.min(offset, maximum))
  useEffect(() => { if (start !== offset) onOffsetChange?.(start) }, [start, offset, onOffsetChange])
  return { visible: rows.slice(start, start + count), start, total: rows.length }
}
