/**
 * Mention: the controlled `@` completer presenter. The loop/controller owns
 * async loading, candidate lifecycle, and keyboard selection state; this
 * component renders the established loading and empty states plus the grouped
 * candidate rows.
 * @module @deepseek-ai/dsh-tui-render/mention
 */

import { Box, Text, useWindowSize } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { styled } from './theme.ts'
import { conversationWidth } from './conversation-layout.ts'

/** One `@` candidate: a file, directory, skill, or running child. */
export interface MentionCandidate {
  /** Candidate kind; the popup sections rows under each kind. */
  kind: 'file' | 'directory' | 'skill' | 'subagent'
  /** Display name (path or skill name), escaped at render. */
  name: string
  /** One-line context shown in fgDim. */
  description?: string
  /** The value to insert on select when it differs from the name. */
  target?: string
}

/** The injected mention data source (implemented by the runtime controller). */
export type ListMentions = (
  basePath: string,
  query: string,
  signal?: AbortSignal,
) => Promise<MentionCandidate[]>

/** Popup phases: loading until the loop settles the active query. */
export type MentionPhase = 'loading' | 'ready'

/** Mention props. */
export interface MentionProps {
  /** Loading/ready phase for the active query. */
  phase: MentionPhase
  /** Candidate rows for the active query. */
  candidates: readonly MentionCandidate[]
  /** Controller-owned selected row index. */
  selectedIndex: number
}

/** Section labels per candidate kind. */
const KIND_LABELS: Readonly<Record<MentionCandidate['kind'], string>> = {
  file: '文件',
  directory: '目录',
  skill: '技能',
  subagent: '子代理',
}

/**
 * The single canonical insertion transform for mention selection. Provider
 * targets may already carry trailing whitespace; the shipping insert always
 * ends with exactly one ASCII space.
 *
 * @param candidate - the chosen mention candidate.
 * @returns the buffer text to insert.
 */
export function normalizeMentionInsertion(candidate: MentionCandidate): string {
  return (candidate.target ?? `@${candidate.name}`).replace(/\s+$/u, '') + ' '
}

/**
 * Controlled `@` candidate popup: the row at `selectedIndex` receives the
 * selected treatment, out-of-range indexes clamp for rendering only, and the
 * grouped rows stay stable until the controller provides a new candidate list.
 *
 * @param props - loading phase, current candidates, and selected row index.
 * @returns the element tree.
 */
export function Mention({
  phase,
  candidates,
  selectedIndex,
}: MentionProps): ReactNode {
  const { columns } = useWindowSize()
  const width = conversationWidth(columns > 0 ? columns : 80)
  if (phase === 'loading') {
    return <Box width="100%" alignItems="center"><Box width={width}><Text dimColor>加载中…</Text></Box></Box>
  }
  if (candidates.length === 0) {
    return <Box width="100%" alignItems="center"><Box width={width}><Text dimColor>无匹配</Text></Box></Box>
  }
  const clampedIndex = Math.max(0, Math.min(selectedIndex, candidates.length - 1))
  const sections = new Map<MentionCandidate['kind'], MentionCandidate[]>()
  for (const candidate of candidates) {
    const bucket = sections.get(candidate.kind)
    if (bucket === undefined) {
      sections.set(candidate.kind, [candidate])
    } else {
      bucket.push(candidate)
    }
  }
  const rows: ReactNode[] = []
  let rowIndex = 0
  for (const [kind, group] of sections) {
    rows.push(
      <Box key={kind}>
        <Text dimColor>{KIND_LABELS[kind]}</Text>
      </Box>,
    )
    for (const candidate of group) {
      const selected = rowIndex === clampedIndex
      rows.push(
        <Box key={`${kind}:${candidate.name}`}>
          <Text>
            {selected
              ? styled(escapeContent('› '), 'accent', undefined, true)
              : '  '}
          </Text>
          <Text dimColor={!selected}>
            @ {escapeContent(candidate.name)}
          </Text>
          {candidate.description !== undefined ? (
            <Text dimColor> — {escapeContent(candidate.description)}</Text>
          ) : null}
        </Box>,
      )
      rowIndex += 1
    }
  }
  return (
    <Box flexDirection="column" alignItems="center" width="100%">
      <Box flexDirection="column" width={width}>{rows}</Box>
    </Box>
  )
}
