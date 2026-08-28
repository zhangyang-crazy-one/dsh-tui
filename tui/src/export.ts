/**
 * Renders a Session log through the TUI transcript allowlist and writes it as
 * `session-<encoded-id>.md`. The allowlist preserves durable order for direct
 * human messages, assistant-message text blocks, tool calls, and tool results;
 * reasoning, internal model context, lifecycle events, and provider metadata
 * stay private.
 *
 * Human prose is control-safe and quoted. Structured records use a fence longer
 * than any payload backtick run. The resolved target must remain a direct child
 * of the requested directory.
 * @module @deepseek-ai/dsh-tui/export
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { isHumanUserMessage } from '@deepseek-ai/dsh-tui-render'
import { escapeContent } from './ansi-styling.ts'

/** ISO-8601 time header for one transcript block. */
function timeHeaderOf(time: number): string {
  return new Date(time).toISOString()
}

/** Keep every prose line, including blanks, inside one Markdown quote. */
function proseBlock(text: string): string {
  return escapeContent(text)
    .split('\n')
    .map(line => line === '' ? '>' : `> ${line}`)
    .join('\n')
}

/** Fence JSON with more backticks than any run carried by its payload. */
function structuredBlock(record: Record<string, unknown>): string {
  const json = JSON.stringify(record, undefined, 2)
  const longestRun = Math.max(
    0,
    ...(json.match(/`+/gu) ?? []).map(run => run.length),
  )
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}json\n${json}\n${fence}`
}

/** Render a typed tool call record in deterministic field order. */
function toolCallBlock(event: SessionEvent<'tool/call'>): string {
  return structuredBlock({
    callId: escapeContent(event.data.callId),
    name: escapeContent(event.data.name),
    arguments: escapeContent(event.data.arguments),
  })
}

/** Render a typed tool result record in deterministic field order. */
function toolResultBlock(event: SessionEvent<'tool/result'>): string {
  const result = event.data.message.content[0]
  const record = {
    callId: escapeContent(result.toolCallId),
    result: escapeContent(result.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')),
    isError: result.isError ?? false,
    ...(event.data.error === undefined
      ? {}
      : {
        error: {
          name: escapeContent(event.data.error.name),
          code: escapeContent(event.data.error.code),
        },
      }),
  }
  return structuredBlock(record)
}

/**
 * Render the Session event log through an explicit allowlist. Direct human
 * text, assistant-message text blocks, tool calls, and tool results retain
 * durable event order. Internal user sources, reasoning, lifecycle records,
 * provider metadata, non-text message blocks, and empty text blocks are excluded.
 *
 * Persisted prose is control-safe and quoted so its Markdown cannot create a
 * sibling section. Structured JSON uses a fence longer than every payload
 * backtick run, so record content cannot terminate its block.
 * @param events - the session's immutable event log.
 * @returns a trailing-newline-terminated Markdown document.
 */
export function renderSessionMarkdown(
  events: readonly SessionEvent[],
): string {
  const blocks: string[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        if (!isHumanUserMessage(event)) break
        blocks.push(`## User — ${timeHeaderOf(event.time)}`)
        for (const block of event.data.content) {
          if (block.type === 'text' && block.text !== '') {
            blocks.push(proseBlock(block.text))
          }
        }
        break
      }
      case 'assistant/message': {
        blocks.push(`## Assistant — ${timeHeaderOf(event.time)}`)
        for (const block of event.data.message.content) {
          if (block.type === 'text' && block.text !== '') {
            blocks.push(proseBlock(block.text))
          }
        }
        break
      }
      case 'tool/call': {
        blocks.push(`## Tool Call — ${timeHeaderOf(event.time)}`)
        blocks.push(toolCallBlock(event))
        break
      }
      case 'tool/result': {
        blocks.push(`## Tool Result — ${timeHeaderOf(event.time)}`)
        blocks.push(toolResultBlock(event))
        break
      }
      default:
        // Extension and lifecycle events are intentionally absent from this export.
        break
    }
  }
  return `${blocks.join('\n\n')}\n`
}

/**
 * Write the Session transcript to a direct child of `dir`, replacing an existing
 * file with the same encoded Session id. The directory is created when needed;
 * containment is checked before any filesystem mutation.
 * @param session - the live session whose log is exported.
 * @param dir - the export directory (the workspace `cwd`).
 * @returns the resolved absolute path that was written.
 * @throws when containment fails or directory creation/file writing is rejected.
 */
export async function exportSessionMarkdown(
  session: Session,
  dir: string,
): Promise<string> {
  const resolvedDir = resolve(dir)
  const target = resolve(
    resolvedDir,
    `session-${encodeURIComponent(session.id)}.md`,
  )
  if (dirname(target) !== resolvedDir) {
    throw new Error('session export target must be a direct child of the export directory')
  }
  await mkdir(resolvedDir, { recursive: true })
  await writeFile(target, renderSessionMarkdown(session.events), 'utf8')
  return target
}
