/**
 * Folds an already-admitted session-event stream into the terminal view model.
 * Historical messages retain stable event-sequence ids, assistant reasoning,
 * and ordered tool records; only the active turn changes between pushes.
 *
 * Caller precondition: a global event consumer must admit events by authoritative
 * Session identity before calling this module. The projection API receives no
 * Session object and therefore cannot verify Session identity.
 *
 * Durable replay and live delivery use the same fold through {@link Projector.seed} and {@link Projector.push}.
 * @module @deepseek-ai/dsh-tui-render/projection
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { BlockAssembler, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ToolCallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import { isHumanUserMessage } from './message-visibility.ts'

/** One tool call observed inside the active turn. */
export interface ProjectedToolCall {
  /** Provider-issued identity that correlates the call with its result. */
  callId: ToolCallId
  /** Tool name from the typert registry. */
  name: string
  /** Raw arguments accumulated from tool-call deltas. */
  arguments: string
}

/** One completed tool result retained for replay and later card rendering. */
export interface ProjectedToolResult {
  /** Provider-issued identity of the originating call. */
  callId: ToolCallId
  /** Concatenated model-facing text blocks. */
  text: string
  /** Whether the tool result reports failure. */
  isError: boolean
  /** Stable internal failure identity, when the tool supplied one. */
  error?: Readonly<{ name: string; code: string }>
  /** Tool-private JSON presentation metadata. */
  meta?: SessionEvent<'tool/result'>['data']['meta']
}

/** Ordered content retained across every step of one assistant turn. */
export type ProjectedTurnContent =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'reasoning'; text: string; durationMs?: number }>
  | Readonly<{ kind: 'tool-call' } & ProjectedToolCall>
  | Readonly<{ kind: 'tool-result' } & ProjectedToolResult>

/** The active (generating or just-finished) turn's live state. */
export interface ActiveTurn {
  /** Turn number from turn/start. */
  turn: number
  /** Assembled assistant text so far. */
  assistantText: string
  /** Assembled reasoning text so far. */
  reasoningText: string
  /** Tool calls observed so far, in block order. */
  toolCalls: ProjectedToolCall[]
  /**
   * Live ordered content for tool-card pairing. Optional on test fixtures
   * that only paint assistant text; the projector always fills it.
   */
  content?: readonly ProjectedTurnContent[]
  /**
   * Milliseconds of the current or last reasoning run. Each reasoning
   * content item carries its own `durationMs`; this field is the last run,
   * used when a fixture has no ordered content.
   */
  reasoningDurationMs: number
  /** Turn outcome once turn/end arrived. */
  reason?: SessionEvent<'turn/end'>['data']['reason']
}

/** One frozen message row for the scrollable history. */
export interface FrozenMessage {
  /** Stable session-event sequence identity, independent of array position. */
  readonly id: number
  /** Message origin; user rows use the `>` marker, assistant rows use `●`. */
  readonly kind: 'user' | 'assistant'
  /** Plain text content (markdown rendered from this). */
  readonly text: string
  /** Retained assistant reasoning; absent on user rows. */
  readonly reasoningText?: string
  /**
   * Milliseconds of the last reasoning run in this frozen turn. Per-block
   * times live on `content` reasoning items.
   */
  readonly reasoningDurationMs?: number
  /** Ordered assistant, reasoning, and tool records; absent on user rows. */
  readonly content?: readonly ProjectedTurnContent[]
  /** Unix epoch milliseconds when the message settled in the log. */
  readonly timestamp: number
  /** Provider output tokens of the last usage-reporting step, when reported. */
  readonly usageOutputTokens?: number | undefined
  /** Wall milliseconds of the last step (step/start → assistant/message). */
  readonly stepWallMs?: number | undefined
  /** 1-based assistant-turn ordinal within the log (drives `turn {n}`). */
  readonly turnOrdinal?: number | undefined
}

/** One durable compaction marker interleaved with frozen transcript rows. */
export interface CompactionDivider {
  /** Stable `compaction/start` event sequence. */
  readonly id: number
  /** Transaction identity shared with summary/end. */
  readonly compactionId: string
  /** Replaced surface event count, once the summary lands. */
  readonly shadowedCount?: number | undefined
  /** Plain summary text, once the summary lands. */
  readonly summary: string
}

/** Clipboard payload selected from the latest visible assistant row. */
export interface AssistantCopyTarget {
  /** Whether the payload is the whole message or its last fenced code body. */
  readonly kind: 'message' | 'code'
  /** Exact plain text sent to the clipboard seam. */
  readonly text: string
}

/** Return the final closed backtick-fenced body in one Markdown message. */
function lastFencedCode(text: string): string | undefined {
  const lines = text.split(/\r?\n/u)
  let openingLength: number | undefined
  let bodyStart = 0
  let latest: string | undefined
  for (const [index, line] of lines.entries()) {
    if (openingLength === undefined) {
      const opening = /^ {0,3}(`{3,})[^`]*$/u.exec(line)
      if (opening !== null) {
        openingLength = (opening[1] as string).length
        bodyStart = index + 1
      }
      continue
    }
    const closing = /^ {0,3}(`{3,})[ \t]*$/u.exec(line)
    if (closing === null || (closing[1] as string).length < openingLength) continue
    latest = lines.slice(bodyStart, index).join('\n')
    openingLength = undefined
  }
  return latest
}

/**
 * Select the latest assistant clipboard payload from the immutable projection.
 * The final closed backtick fence wins; an unfinished fence is ordinary message
 * text and does not hide an earlier closed block.
 * @param history - frozen visible transcript rows.
 * @returns the selected payload, or undefined when no non-empty assistant row exists.
 */
export function latestAssistantCopyTarget(
  history: readonly FrozenMessage[],
): AssistantCopyTarget | undefined {
  const message = history.findLast(row => row.kind === 'assistant' && row.text !== '')
  if (message === undefined) return undefined
  const code = lastFencedCode(message.text)
  return code === undefined
    ? { kind: 'message', text: message.text }
    : { kind: 'code', text: code }
}

/** The terminal view model the render loop consumes. */
export interface ViewModel {
  /** Frozen historical messages (immutable between turns). */
  history: readonly FrozenMessage[]
  /** Compaction markers retained without deleting old frozen rows. */
  compactionDividers?: readonly CompactionDivider[] | undefined
  /** The latest divider expanded through Ctrl+K, when any. */
  expandedCompactionId?: string | undefined
  /** The live turn, or undefined when idle between turns. */
  activeTurn: ActiveTurn | undefined
  /** Rendering status. */
  status: 'generating' | 'stopped' | 'idle'
  /** Whether the reasoning fold is force-expanded (Ctrl+O toggle). */
  reasoningExpanded: boolean
  /** Whether tool cards in the current window are expanded (Ctrl+E toggle). */
  toolCardsExpanded: boolean
}

/** Empty starting model. */
export const EMPTY_VIEW: ViewModel = {
  history: [],
  compactionDividers: [],
  expandedCompactionId: undefined,
  activeTurn: undefined,
  status: 'idle',
  reasoningExpanded: false,
  toolCardsExpanded: false,
}

/** Mutable event-folding handle for one caller-admitted session stream. */
export interface Projector {
  /**
   * Fold one event into the current turn or frozen history.
   * @param event - event that has already passed the owning runtime's Session-identity admission.
   */
  push(event: SessionEvent): void
  /**
   * Replay an admitted durable event log in order, using the same fold as live delivery.
   * @param events - chronologically ordered events from the bound Session.
   */
  seed(events: readonly SessionEvent[]): void
  /**
   * Read the current projection without copying the frozen history array.
   * @returns the latest history, active turn, render status, and fold-display state.
   */
  snapshot(): ViewModel
}

/** Assistant blocks split into visible/reasoning content and live tool calls. */
interface ProjectedAssistantBlocks {
  content: ProjectedTurnContent[]
  toolCalls: ProjectedToolCall[]
}

/** Convert one human message into text plus ordered durable-image placeholders. */
function projectUserContent(blocks: readonly ContentBlock[]): string {
  let imageOrdinal = 0
  return blocks.map((block) => {
    switch (block.type) {
      case 'text':
        return block.text
      case 'image': {
        imageOrdinal += 1
        const suffix = block.attachment.name === undefined ? '' : ` · ${block.attachment.name}`
        return `[图片 #${String(imageOrdinal)}${suffix}]`
      }
      default:
        // Other and merge-extended block kinds have no user-row representation.
        return ''
    }
  }).join('')
}

/** Project one step's assistant blocks without promoting merge extensions into terminal text. */
function projectAssistantBlocks(blocks: readonly ContentBlock[]): ProjectedAssistantBlocks {
  const content: ProjectedTurnContent[] = []
  const toolCalls: ProjectedToolCall[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        content.push({ kind: 'text', text: block.text })
        break
      case 'reasoning':
        content.push({ kind: 'reasoning', text: block.text, durationMs: 0 })
        break
      case 'tool-call':
        toolCalls.push({
          callId: block.id,
          name: block.name,
          arguments: block.arguments,
        })
        break
      default:
        // Images, tool results, and plugin-merged blocks have no Phase 3
        // conversation-row representation. Their owning event remains durable.
        break
    }
  }
  return { content, toolCalls }
}

/** Concatenate retained text for one content kind. */
function contentText(
  content: readonly ProjectedTurnContent[],
  kind: 'text' | 'reasoning',
): string {
  return content
    .filter((item): item is Extract<ProjectedTurnContent, { kind: typeof kind }> => item.kind === kind)
    .map(item => item.text)
    .join('')
}

/**
 * Create an event projector for one caller-admitted Session stream. Each step
 * gets an independent block assembler while completed step content remains
 * ordered within its turn; completed assistant rows retain reasoning and tool
 * records under a stable event-sequence id.
 *
 * The caller must verify Session identity before supplying live or replayed
 * events. This projector cannot perform that check because neither
 * {@link Projector.push} nor {@link Projector.seed} receives a Session object.
 * @returns a stateful projector whose snapshots share immutable historical rows.
 */
export function createProjector(): Projector {
  const history: FrozenMessage[] = []
  const compactionDividers: CompactionDivider[] = []
  let assembler: BlockAssembler | undefined
  let activeTurn: ActiveTurn | undefined
  let status: ViewModel['status'] = 'idle'
  let turnStartedAt = 0
  let turnEventAt = 0
  let stepStartedAt = 0
  let lastUsageOutputTokens: number | undefined
  let lastStepWallMs: number | undefined
  let assistantTurnCount = 0
  let turnContent: ProjectedTurnContent[] = []
  let stepContent: ProjectedTurnContent[] = []
  let stepToolCalls: ProjectedToolCall[] = []
  let stepCommitted = true
  const reasoningStarts: number[] = []
  const reasoningEnds: number[] = []

  function appendHistory(message: FrozenMessage): void {
    history.push(deepFreeze(message))
  }

  function appendCompaction(divider: CompactionDivider): void {
    compactionDividers.push(deepFreeze(divider))
  }

  function stampReasoningDurations(
    content: readonly ProjectedTurnContent[],
  ): ProjectedTurnContent[] {
    let index = 0
    const stamped = content.map((item, itemIndex) => {
      if (item.kind !== 'reasoning') return item
      if (reasoningStarts[index] === undefined) {
        if (index > 0 && reasoningEnds[index - 1] === undefined) {
          reasoningEnds[index - 1] = turnEventAt
        }
        reasoningStarts[index] = turnEventAt
      }
      const laterNonReasoning = content
        .slice(itemIndex + 1)
        .some(next => next.kind !== 'reasoning')
      if (laterNonReasoning && reasoningEnds[index] === undefined) {
        reasoningEnds[index] = turnEventAt
      }
      // The branch above initializes this exact index before duration calculation.
      const start = reasoningStarts[index] as number
      const end = reasoningEnds[index] ?? turnEventAt
      index += 1
      return {
        kind: 'reasoning' as const,
        text: item.text,
        durationMs: Math.max(0, end - start),
      }
    })
    reasoningStarts.length = index
    reasoningEnds.length = index
    return stamped
  }

  function updateActiveTurn(): void {
    // Every caller is inside an admitted active-turn event branch.
    const current = activeTurn as ActiveTurn
    const content = stampReasoningDurations([...turnContent, ...stepContent])
    current.assistantText = contentText(content, 'text')
    current.reasoningText = contentText(content, 'reasoning')
    current.content = content
    current.toolCalls = [
      ...turnContent
        .filter((item): item is Extract<ProjectedTurnContent, { kind: 'tool-call' }> => item.kind === 'tool-call')
        .map(({ callId, name, arguments: args }) => ({ callId, name, arguments: args })),
      ...stepToolCalls,
    ]
    const lastReasoning = content.findLast(item => item.kind === 'reasoning')
    current.reasoningDurationMs = lastReasoning?.durationMs
      ?? Math.max(0, turnEventAt - turnStartedAt)
  }

  function commitStep(): void {
    if (stepCommitted) return
    turnContent.push(...stepContent)
    stepContent = []
    stepToolCalls = []
    stepCommitted = true
    updateActiveTurn()
  }

  function replaceStep(blocks: readonly ContentBlock[]): void {
    const projected = projectAssistantBlocks(blocks)
    stepContent = projected.content
    stepToolCalls = projected.toolCalls
    stepCommitted = false
    updateActiveTurn()
  }

  function push(event: SessionEvent): void {
    if (activeTurn !== undefined) turnEventAt = event.time
    switch (event.type) {
      case 'turn/start': {
        assembler = new BlockAssembler()
        turnContent = []
        stepContent = []
        stepToolCalls = []
        stepCommitted = false
        reasoningStarts.length = 0
        reasoningEnds.length = 0
        activeTurn = {
          turn: event.data.turn,
          assistantText: '',
          reasoningText: '',
          toolCalls: [],
          content: [],
          reasoningDurationMs: 0,
        }
        status = 'generating'
        turnStartedAt = event.time
        turnEventAt = event.time
        return
      }
      case 'step/start': {
        if (activeTurn === undefined) return
        commitStep()
        assembler = new BlockAssembler()
        stepContent = []
        stepToolCalls = []
        stepCommitted = false
        stepStartedAt = event.time
        return
      }
      case 'user/message': {
        if (!isHumanUserMessage(event)) return
        const text = projectUserContent(event.data.content)
        appendHistory({ id: event.seq, kind: 'user', text, timestamp: event.time })
        return
      }
      case 'assistant/chunk': {
        if (activeTurn === undefined) return
        assembler ??= new BlockAssembler()
        assembler.push(event.data.chunk)
        replaceStep(assembler.blocks())
        return
      }
      case 'assistant/message': {
        if (activeTurn !== undefined) {
          replaceStep(event.data.message.content)
          commitStep()
          lastUsageOutputTokens = event.data.usage?.outputTokens
          lastStepWallMs = Math.max(0, event.time - stepStartedAt)
        }
        return
      }
      case 'compaction/start': {
        appendCompaction({
          id: event.seq,
          compactionId: event.data.compactionId,
          summary: '',
        })
        return
      }
      case 'compaction/summary': {
        const index = compactionDividers.findLastIndex(
          divider => divider.compactionId === event.data.compactionId,
        )
        if (index < 0) return
        const current = compactionDividers[index] as CompactionDivider
        compactionDividers[index] = deepFreeze({
          ...current,
          shadowedCount: event.data.shadowedSeqs.length,
          summary: event.data.summary
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join(''),
        })
        return
      }
      case 'tool/call': {
        if (activeTurn === undefined) return
        commitStep()
        turnContent.push({
          kind: 'tool-call',
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments,
        })
        updateActiveTurn()
        return
      }
      case 'tool/result': {
        if (activeTurn === undefined) return
        commitStep()
        const block = event.data.message.content[0]
        turnContent.push({
          kind: 'tool-result',
          callId: block.toolCallId,
          text: block.content
            .filter(item => item.type === 'text')
            .map(item => item.text)
            .join(''),
          isError: block.isError ?? false,
          ...event.data.error === undefined ? {} : { error: { ...event.data.error } },
          ...event.data.meta === undefined ? {} : { meta: structuredClone(event.data.meta) },
        })
        updateActiveTurn()
        return
      }
      case 'step/end': {
        commitStep()
        return
      }
      case 'turn/end': {
        if (activeTurn !== undefined) {
          commitStep()
          activeTurn.reason = event.data.reason
          updateActiveTurn()
          if (turnContent.length > 0) {
            assistantTurnCount += 1
            appendHistory({
              id: event.seq,
              kind: 'assistant',
              text: activeTurn.assistantText,
              reasoningText: activeTurn.reasoningText,
              reasoningDurationMs: activeTurn.reasoningDurationMs,
              // activeTurn.content is the stamped fold: raw turnContent items
              // still carry durationMs 0 from projectAssistantBlocks.
              content: (activeTurn.content as ProjectedTurnContent[]).map(item => ({ ...item })),
              timestamp: event.time,
              ...(lastUsageOutputTokens === undefined
                ? {}
                : { usageOutputTokens: lastUsageOutputTokens }),
              ...(lastStepWallMs === undefined ? {} : { stepWallMs: lastStepWallMs }),
              turnOrdinal: assistantTurnCount,
            })
          }
          activeTurn = undefined
          lastUsageOutputTokens = undefined
          lastStepWallMs = undefined
        }
        status = 'idle'
        return
      }
      default:
        return
    }
  }

  return {
    push,
    seed(events: readonly SessionEvent[]) {
      for (const event of events) push(event)
    },
    snapshot(): ViewModel {
      return {
        history,
        compactionDividers,
        expandedCompactionId: undefined,
        activeTurn,
        status,
        reasoningExpanded: false,
        toolCardsExpanded: false,
      }
    },
  }
}
