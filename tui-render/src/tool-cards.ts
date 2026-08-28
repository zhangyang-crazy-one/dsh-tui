/**
 * Pair projected tool-call and tool-result records into one card model per
 * `callId`. Fold state and Ink rendering live in the ToolCard component; this
 * module is a pure function of retained projection content.
 * @module @deepseek-ai/dsh-tui-render/tool-cards
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { escapeContent, displayWidth, wcwidthSafeSlice } from './content.ts'
import type {
  ActiveTurn,
  ProjectedToolCall,
  ProjectedToolResult,
  ProjectedTurnContent,
} from './projection.ts'

/** Card status derived from whether a result has arrived and whether it failed. */
export type ToolCardStatus = 'running' | 'ok' | 'error'

/** One foldable tool card keyed by the originating call. */
export interface ToolCardModel {
  /** Provider-issued identity correlating the call with its result. */
  callId: ToolCallId
  /** Tool name from the typert registry. */
  name: string
  /** Raw arguments accumulated from tool-call deltas. */
  arguments: string
  /** running when no result; ok/error from the result's `isError`. */
  status: ToolCardStatus
  /** Concatenated model-facing result text, once a result has arrived. */
  resultText?: string
  /** Tool-private JSON presentation metadata, when the result supplied it. */
  meta?: ProjectedToolResult['meta']
  /** Stable internal failure identity, when the tool supplied one. */
  error?: ProjectedToolResult['error']
  /** Presenter call view (structural projection of the dsh-tools call views). */
  callView?: ToolCardCallView | undefined
  /** Presenter result view; drives the specialized expanded card (D-11). */
  resultView?: ToolCardResultView | undefined
}

/**
 * Structural projections of the dsh-tools presentation views the cards read,
 * declared here so this package keeps its no-dsh-tools stance (the registry
 * lookup above satisfies the same shape). Unknown fields are ignored.
 */
export type ToolCardCallView =
  | {
    readonly card: 'generic'
    readonly title: string
    readonly kind?: string
    readonly locations?: readonly { readonly path: string; readonly line?: number }[]
  }
  | { readonly card: 'terminal'; readonly title: string; readonly cwd?: string }
  | {
    readonly card: 'diff'
    readonly title: string
    readonly diffs: readonly ToolCardFileDiff[]
    readonly locations?: readonly { readonly path: string; readonly line?: number }[]
  }

/** One file change in a diff card. */
export interface ToolCardFileDiff {
  /** The changed file's display path. */
  readonly path: string
  /** Prior content, or null for a create/overwrite. */
  readonly oldText: string | null
  /** Content after the change. */
  readonly newText: string
}

/** Structural projection of the dsh-tools result views the cards read. */
export type ToolCardResultView =
  | { readonly card: 'generic'; readonly title?: string }
  | {
    readonly card: 'terminal'
    readonly title?: string
    readonly output?: string
    readonly exitCode?: number
    readonly signal?: string
  }
  | { readonly card: 'diff'; readonly title?: string; readonly diffs: readonly ToolCardFileDiff[] }
  | {
    readonly card: 'search'
    readonly title?: string
    readonly shape: 'matches'
    readonly files: readonly {
      readonly path: string
      readonly matches: readonly { readonly lineNumber: number; readonly line: string }[]
    }[]
    readonly truncated: boolean
    readonly total: number
  }
  | {
    readonly card: 'search'
    readonly title?: string
    readonly shape: 'paths'
    readonly paths: readonly string[]
    readonly truncated: boolean
    readonly total: number
  }
  | {
    readonly card: 'read'
    readonly title?: string
    readonly path: string
    readonly offset: number
    readonly lines: readonly { readonly number: number; readonly text: string }[]
    readonly totalLines: number
  }
  | {
    readonly card: 'web'
    readonly title?: string
    readonly kind: 'search'
    readonly sources: readonly { readonly url: string; readonly title?: string }[]
    readonly truncated: boolean
  }
  | {
    readonly card: 'web'
    readonly title?: string
    readonly kind: 'fetch'
    readonly url: string
    readonly statusCode: number
    readonly truncated: boolean
  }


/**
 * Tools-registry subset used to attach presenter views. Matches
 * `ctx.get('tools')` structurally so this package does not depend on
 * `@deepseek-ai/dsh-tools`.
 */
export interface ToolPresenterLookup {
  /**
   * Look up a tool definition by registry name.
   * @param name - the tool name as registered.
   * @returns the definition, or undefined when it is not visible.
   */
  get(name: string): {
    presentCall?(args: unknown): ToolCardCallView | undefined
    presentResult?(
      args: unknown,
      result: {
        content: readonly unknown[]
        isError: boolean
        meta?: unknown
      },
    ): ToolCardResultView | undefined
  } | undefined
}

/**
 * Fold consecutive `tool-call` / `tool-result` items into ordered cards.
 * Orphan results (no preceding call with the same `callId`) are dropped.
 * Text and reasoning items are ignored. The function does not mutate `content`.
 * @param content - ordered projected turn records.
 * @returns one card per observed call, in first-seen order.
 */
export function cardsFrom(
  content: readonly ProjectedTurnContent[],
): ToolCardModel[] {
  const pending = new Map<ToolCallId, ToolCardModel>()
  const ordered: ToolCardModel[] = []
  for (const item of content) {
    if (item.kind === 'tool-call') {
      const card: ToolCardModel = {
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
        status: 'running',
      }
      pending.set(item.callId, card)
      ordered.push(card)
      continue
    }
    if (item.kind !== 'tool-result') continue
    const card = pending.get(item.callId)
    if (card === undefined) continue
    card.status = item.isError ? 'error' : 'ok'
    card.resultText = item.text
    if (item.meta !== undefined) card.meta = item.meta
    if (item.error !== undefined) card.error = item.error
  }
  return ordered
}

/**
 * Pair the live turn's `toolCalls` with any `tool-result` items already in
 * its content fold. Synthetic `tool-call` rows come from `toolCalls` so
 * streamed calls that are not yet in `content` still appear.
 * @param toolCalls - live tool calls in block order.
 * @param content - live turn content; only `tool-result` items are merged.
 * @returns the same ordered cards {@link cardsFrom} would produce.
 */
export function cardsFromActiveTurn(
  toolCalls: readonly ProjectedToolCall[],
  content: readonly ProjectedTurnContent[] = [],
): ToolCardModel[] {
  const calls: ProjectedTurnContent[] = toolCalls.map(call => ({
    kind: 'tool-call',
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
  }))
  const results = content.filter(
    (item): item is Extract<ProjectedTurnContent, { kind: 'tool-result' }> =>
      item.kind === 'tool-result',
  )
  return cardsFrom([...calls, ...results])
}

/**
 * Pair cards for a live {@link ActiveTurn}, using optional retained content
 * for results that have already arrived.
 * @param turn - the active turn snapshot.
 * @returns ordered cards for the live turn.
 */
export function cardsFromTurn(turn: ActiveTurn): ToolCardModel[] {
  return cardsFromActiveTurn(turn.toolCalls, turn.content ?? [])
}

/**
 * Attach `presentCall` / `presentResult` views onto a paired card. JSON.parse
 * failure returns the original card. A throw or soft-undefined from either
 * presenter leaves that view unset (generic collapse). Does not switch on
 * specialized `card` tags.
 * @param tools - registry lookup; omitted or missing names stay generic.
 * @param card - paired call/result model.
 * @returns the same card, or a copy with optional `callView` / `resultView`.
 */
export function attachPresenterViews(
  tools: ToolPresenterLookup | undefined,
  card: ToolCardModel,
): ToolCardModel {
  if (tools === undefined) return card
  let args: unknown
  try {
    args = JSON.parse(card.arguments)
  } catch {
    return card
  }
  const def = tools.get(card.name)
  if (def === undefined) return card
  let callView: ToolCardModel['callView']
  try {
    const view = def.presentCall?.(args)
    if (view !== undefined && typeof view.title === 'string' && view.title !== '') {
      callView = view
    }
  } catch {
    // presentCall is display-only; a throw keeps the generic collapsed title.
  }
  let resultView: ToolCardModel['resultView']
  if (card.status !== 'running') {
    try {
      const view = def.presentResult?.(args, {
        content: [{ type: 'text', text: card.resultText ?? '' }],
        isError: card.status === 'error',
        ...(card.meta === undefined ? {} : { meta: card.meta }),
      })
      if (view !== undefined) {
        resultView = view
      }
    } catch {
      // presentResult is display-only; a throw keeps the generic result body.
    }
  }
  if (callView === undefined && resultView === undefined) return card
  return {
    ...card,
    ...(callView === undefined ? {} : { callView }),
    ...(resultView === undefined ? {} : { resultView }),
  }
}

/**
 * Collapsed-row summary: bash `command` when `arguments` is JSON with a
 * string `command`, otherwise the escaped arguments as one line. Empty
 * arguments produce no summary.
 * @param argumentsJson - raw tool-call arguments.
 * @returns escaped single-line summary, or undefined when there is nothing to show.
 */
export function collapsedCardSummary(argumentsJson: string): string | undefined {
  if (argumentsJson === '') return undefined
  let command: string | undefined
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (
      parsed !== null
      && typeof parsed === 'object'
      && 'command' in parsed
      && typeof parsed.command === 'string'
    ) {
      command = parsed.command
    }
  } catch {
    // JSON.parse throws SyntaxError on invalid JSON; use the escaped raw
    // arguments string as the summary.
  }
  return escapeContent(command ?? argumentsJson).replace(/\n/g, ' ')
}

/**
 * Truncate already-escaped display text to `maxCols`, appending `…` when cut.
 * @param text - escaped single-line text.
 * @param maxCols - column budget.
 * @returns the text, or a width-safe prefix plus `…`.
 */
export function truncateDisplay(text: string, maxCols: number): string {
  if (maxCols <= 0) return ''
  if (displayWidth(text) <= maxCols) return text
  if (maxCols === 1) return '…'
  return `${wcwidthSafeSlice(text, maxCols - 1)}…`
}

/** JSON argument keys that may hold an absolute filesystem path. */
const FILE_PATH_KEYS = ['path', 'file_path', 'file', 'target_file', 'target'] as const

/**
 * Build a `file://` href from an absolute path in tool-call JSON arguments.
 * Relative paths and non-path tools return undefined.
 * @param argumentsJson - raw tool-call arguments.
 * @returns a `file://` href, or undefined when none is present.
 */
export function fileUrlFromToolArguments(argumentsJson: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const record = parsed as Record<string, unknown>
    for (const key of FILE_PATH_KEYS) {
      const value = record[key]
      if (typeof value !== 'string' || !isAbsolute(value)) continue
      if (/[\u0000-\u001f\u007f]/.test(value)) continue
      return pathToFileURL(value).href
    }
  } catch {
    // JSON.parse throws SyntaxError on invalid JSON; there is no path to wrap.
  }
  return undefined
}
