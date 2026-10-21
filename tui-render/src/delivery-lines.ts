/** Wrapped terminal rows for explicit file deliveries, shared by both paint paths. */
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import { escapeContent, wrapDisplayLines } from './content.ts'

/** One complete physical delivery row and its optional local-file target. */
export interface DeliveryLine {
  readonly text: string
  readonly href?: string
}

/**
 * Keep full file paths and descriptions visible through wrapping; no file is read.
 * @param files - declarations in this turn, in their recorded order.
 * @param width - positive terminal column budget.
 * @returns rows for the turn tail, or no rows without an explicit delivery.
 */
export function deliveryLines(files: readonly PresentedFile[], width: number): DeliveryLine[] {
  if (files.length === 0) return []
  const rows: DeliveryLine[] = wrapDisplayLines('交付文件 · /deliveries', width).map(text => ({ text }))
  for (const [index, file] of files.entries()) {
    const href = isAbsolute(file.path) ? pathToFileURL(file.path).href : undefined
    for (const text of wrapDisplayLines(`${index + 1}. ${escapeContent(file.path)}`, width)) {
      rows.push({ text, ...(href === undefined ? {} : { href }) })
    }
    if (file.description !== undefined) {
      for (const text of wrapDisplayLines(`   ${escapeContent(file.description)}`, width)) rows.push({ text })
    }
  }
  return rows
}
