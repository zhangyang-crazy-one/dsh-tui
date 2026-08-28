/**
 * Foldable tool-call card. Collapsed: `▸ {title} · {status}` plus an optional
 * summary. Expanded: the specialized body for the presenter's `card` tag —
 * generic 参数/结果 payloads, terminal output + exit status, diff hunks,
 * search matches, read lines, or web sources — every line escaped, indented
 * two columns, on `codeBg` only (no extra card chrome). Unknown card tags
 * fall back to generic (D-11).
 * @module @deepseek-ai/dsh-tui-render/tool-card
 */

import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent, displayWidth } from './content.ts'
import { hyperlinksEnabled, wrapOsc8 } from './hyperlink.ts'
import { paintRow, styled } from './theme.ts'
import type { StyleToken } from './theme.ts'
import {
  collapsedCardSummary,
  fileUrlFromToolArguments,
  truncateDisplay,
} from './tool-cards.ts'
import type { ToolCardModel, ToolCardStatus } from './tool-cards.ts'

/** Collapsed status copy and token. Color never stands alone (A2). */
const STATUS_STYLE: Readonly<
  Record<ToolCardStatus, { readonly label: string; readonly token: StyleToken }>
> = {
  running: { label: '运行中', token: 'accent' },
  ok: { label: '完成', token: 'success' },
  error: { label: '失败', token: 'error' },
}

/** ToolCard props. */
export interface ToolCardProps {
  /** Paired call/result model. */
  card: ToolCardModel
  /** When true, paint the expanded payload blocks. */
  expanded?: boolean
  /** Column budget for the collapsed summary truncation. */
  maxCols?: number
}

/**
 * One escaped payload block: dim field name plus codeBg body, indented 2 cols.
 * @param label - field name (`参数` / `结果` / `meta`).
 * @param body - untrusted payload text.
 * @returns the element tree.
 */
function payloadBlock(label: string, body: string): ReactNode {
  const lines = escapeContent(body).split('\n')
  return (
    <Box key={label} flexDirection="column" marginLeft={2} width="100%">
      <Text>{paintRow([styled(label, 'fgDim')])}</Text>
      {lines.map((line, index) => (
        <Text key={`${label}-${index}`}>{styled(line, 'codeBg')}</Text>
      ))}
    </Box>
  )
}

/**
 * Escaped codeBg lines for one expanded body, indented 2 cols.
 * @param label - field name painted fgDim above the lines.
 * @param lines - untrusted payload lines.
 * @returns the element tree.
 */
function codeLines(label: string, lines: readonly string[]): ReactNode {
  return (
    <Box key={label} flexDirection="column" marginLeft={2} width="100%">
      <Text>{paintRow([styled(label, 'fgDim')])}</Text>
      {lines.map((line, index) => (
        <Text key={`${label}-${index}`}>{styled(escapeContent(line), 'codeBg')}</Text>
      ))}
    </Box>
  )
}

/** The expanded body for one card kind. */
function expandedBody(card: ToolCardModel): ReactNode[] {
  const result = card.resultView
  const kind = result?.card ?? card.callView?.card ?? 'generic'
  switch (kind) {
    case 'terminal': {
      const blocks: ReactNode[] = []
      const output = result?.card === 'terminal' ? result.output : undefined
      if (output !== undefined && output !== '') blocks.push(codeLines('结果', output.split('\n')))
      if (result?.card === 'terminal' && result.exitCode !== undefined) {
        blocks.push(codeLines('meta', [`exitCode ${String(result.exitCode)}`]))
      } else if (result?.card === 'terminal' && result.signal !== undefined) {
        blocks.push(codeLines('meta', [`signal ${result.signal}`]))
      }
      return blocks.length === 0 ? [payloadBlock('参数', card.arguments)] : blocks
    }
    case 'diff': {
      const diffs =
        result?.card === 'diff'
          ? result.diffs
          : (card.callView as Extract<NonNullable<ToolCardModel['callView']>, { card: 'diff' }>).diffs
      if (diffs.length === 0) return [payloadBlock('参数', card.arguments)]
      const lines: string[] = []
      for (const diff of diffs) {
        lines.push(`--- ${diff.path}`)
        if (diff.oldText !== null) {
          for (const line of diff.oldText.split('\n')) lines.push(`- ${line}`)
        }
        for (const line of diff.newText.split('\n')) lines.push(`+ ${line}`)
      }
      return [codeLines('diff', lines)]
    }
    case 'search': {
      if (result?.card !== 'search') return [payloadBlock('参数', card.arguments)]
      const lines: string[] = []
      if (result.shape === 'matches') {
        for (const file of result.files) {
          for (const match of file.matches) {
            lines.push(`${file.path}:${String(match.lineNumber)} ${match.line}`)
          }
        }
      } else {
        lines.push(...result.paths)
      }
      if (result.truncated) lines.push('…')
      return [codeLines('结果', lines)]
    }
    case 'read': {
      if (result?.card !== 'read') return [payloadBlock('参数', card.arguments)]
      return [
        codeLines(
          '结果',
          result.lines.map(line => `${String(line.number)} ${line.text}`),
        ),
      ]
    }
    case 'web': {
      if (result?.card !== 'web') return [payloadBlock('参数', card.arguments)]
      if (result.kind === 'fetch') {
        return [codeLines('结果', [`${result.url} · ${String(result.statusCode)}`])]
      }
      const lines = result.sources.map(source =>
        source.title === undefined ? source.url : `${source.title} · ${source.url}`,
      )
      if (result.truncated) lines.push('…')
      return [codeLines('结果', lines)]
    }
    default: {
      const blocks: ReactNode[] = [payloadBlock('参数', card.arguments)]
      if (card.resultText !== undefined) blocks.push(payloadBlock('结果', card.resultText))
      if (card.meta !== undefined) blocks.push(payloadBlock('meta', JSON.stringify(card.meta)))
      return blocks
    }
  }
}

/** The collapsed summary trailing the status, per card kind. */
function collapsedSummary(card: ToolCardModel): string | undefined {
  const result = card.resultView
  const kind = result?.card ?? card.callView?.card ?? 'generic'
  switch (kind) {
    case 'terminal': {
      if (result?.card === 'terminal' && result.exitCode !== undefined) {
        return `exitCode ${String(result.exitCode)}`
      }
      if (result?.card === 'terminal' && result.signal !== undefined) {
        return `signal ${result.signal}`
      }
      if (result?.card === 'terminal' && result.output !== undefined && result.output !== '') {
        return escapeContent(result.output.replace(/\n/g, ' '))
      }
      return card.callView?.card === 'terminal' && card.callView.cwd !== undefined
        ? escapeContent(card.callView.cwd)
        : undefined
    }
    case 'diff': {
      const paths =
        card.callView?.card === 'diff'
          ? (card.callView.locations ?? card.callView.diffs.map(diff => ({ path: diff.path })))
          : (result as Extract<NonNullable<ToolCardModel['resultView']>, { card: 'diff' }>).diffs
            .map(diff => ({ path: diff.path }))
      if (paths.length === 0) return undefined
      return escapeContent(paths.map(entry => entry.path).join(' · '))
    }
    case 'search': {
      if (result?.card !== 'search') return undefined
      return `${String(result.total)} matches`
    }
    case 'read': {
      if (result?.card !== 'read') return undefined
      return escapeContent(result.path)
    }
    case 'web':
      if (result?.card !== 'web') return undefined
      if (result.kind === 'fetch') return escapeContent(`${result.url} · ${String(result.statusCode)}`)
      return result.sources.length === 0
        ? undefined
        : escapeContent(
          result.sources.length === 1
            ? (result.sources[0]?.title ?? result.sources[0]?.url as string)
            : `${String(result.sources.length)} sources`,
        )
    default:
      // Business parsing (bash `command`) stays the generic fallback while
      // presenters are absent; a callView title already replaced the name.
      return card.callView === undefined ? collapsedCardSummary(card.arguments) : undefined
  }
}

/**
 * One tool card: collapsed title (and optional summary) or the specialized
 * expanded body for the presenter card tag.
 * @param props - the card model and fold flag.
 * @returns the element tree.
 */
export function ToolCard({
  card,
  expanded = false,
  maxCols = 88,
}: ToolCardProps): ReactNode {
  const status = STATUS_STYLE[card.status]
  const glyph = expanded ? '▾' : '▸'
  const heading = card.resultView?.title ?? card.callView?.title ?? card.name
  const titlePrefix = `${glyph} ${escapeContent(heading)} · `
  const title = (
    <Text>
      {paintRow([
        styled(titlePrefix, 'fg'),
        styled(status.label, status.token),
      ])}
    </Text>
  )
  if (expanded) {
    return (
      <Box flexDirection="column" width="100%">
        {title}
        {expandedBody(card)}
      </Box>
    )
  }
  const summary = collapsedSummary(card)
  const prefixWidth = displayWidth(`${titlePrefix}${status.label} `)
  const budget = maxCols - prefixWidth
  const clipped =
    summary === undefined || budget < 2
      ? undefined
      : truncateDisplay(summary, budget)
  const fileHref = fileUrlFromToolArguments(card.arguments)
  const summaryRun =
    clipped === undefined
      ? undefined
      : hyperlinksEnabled() && fileHref !== undefined
        ? wrapOsc8(styled(` ${clipped}`, 'fgDim'), fileHref)
        : styled(` ${clipped}`, 'fgDim')
  return (
    <Box width="100%">
      <Text>
        {paintRow([
          styled(titlePrefix, 'fg'),
          styled(status.label, status.token),
          ...(summaryRun === undefined ? [] : [summaryRun]),
        ])}
      </Text>
    </Box>
  )
}
