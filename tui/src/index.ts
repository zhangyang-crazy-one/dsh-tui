/**
 * Mounts the interactive terminal surface over the base harness services. The
 * runtime owns the bound Agent, Session event admission, session transitions,
 * directory/search operations, terminal rendering, and process-signal claim.
 *
 * Ordinary unload returns SIGINT/SIGTERM ownership to the launcher before the
 * TUI hooks are removed. A declared process exit retains the TUI hooks while
 * the session flush, optional frame-stats write, terminal restore, and exit
 * request complete; late signals remain single-flight no-ops.
 * @module @deepseek-ai/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { rebuildReloadArgv, relaunchProcess } from './reload-argv.ts'
import type { RelaunchHost } from './reload-argv.ts'
import { editDraftExternally, resolveEditorCommand } from './external-editor.ts'
import type { EditorSpawn } from './external-editor.ts'
import { DEFAULT_NOTIFY_QUIET_INPUT_SECONDS, decideNotify } from './notify.ts'
import type { NotifyDecision, NotifyMode, NotifySettings } from './notify.ts'
import { constants } from 'node:fs'
import type { Stats } from 'node:fs'
import { access, lstat, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  ModelSelection,
  ModelSelectionRef,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// The named import carries the Context merge for ctx.commands; the service
// itself is composed by the base patch.
import type { CommandDescriptor } from '@deepseek-ai/dsh-commands'
// Type-only imports carry the Context merges for ctx.fs and ctx.skills; both
// services are composed by the base patch.
import type {} from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-skill'
// Type-only: declaration-merges ctx.subagents. The service is composed by
// the base patch; this plugin never injects it.
import type { SubagentListEntry, SubagentTimingProjection } from '@deepseek-ai/dsh-subagent'
// Type-only: declaration-merges ctx.planMode. The service is composed by
// the base patch; this plugin never injects it.
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
// Type-only: declaration-merges ctx.permissionPresets. The service is composed
// by the base patch; this plugin never injects it and never calls setApprovalPolicy.
import type {} from '@deepseek-ai/dsh-permission-presets'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  createUserMessage,
  type ToolCallId,
  type ContentBlock,
  type LlmModelInfo,
  type MessageId,
  assertNever,
} from '@deepseek-ai/dsh-llm'
import type { LlmRetryEventData, RetryId } from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-token-meter/src/projection.ts'
import type {
  ApprovalOutcome,
  ApprovalRequest,
} from '@deepseek-ai/dsh-user-approval'
import {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionItem,
  type AskUserQuestionRequest,
} from '@deepseek-ai/dsh-user-questions'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionHeader, TurnEndCancelCause, TurnEndReason } from '@deepseek-ai/dsh-session'
import {
  fallbackSessionTitle,
  foldSessionTitle,
} from '@deepseek-ai/dsh-session-title'
// Type-only imports carry the Context merges for ctx.get('sessionPersistence')
// and ctx.get('sessionTitle') — the services are composed by the base patch.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
// The session-query type import carries the Context merge for
// ctx.get('sessionQuery'); the search service is composed by the base patch.
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import {
  applyTheme,
  activeBrandRevealTimerCount,
  createFrameProbe,
  createProjector,
  frameStatsSnapshot,
  isHumanUserMessage,
  latestAssistantCopyTarget,
  mountTuiLoop,
  copyText,
  OSC52_MAX_CHARS,
  reduceInteraction,
  BRAND_APP_TITLE,
  EMPTY_APPROVAL_PANE,
  EMPTY_ASK_USER_PANE,
  EMPTY_PERMISSION_PANE,
  EMPTY_SETTINGS_PANE,
  EMPTY_OVERLAY_PANE,
  EMPTY_PLAN_DIRECTORY_PANE,
  EMPTY_PLAN_REVIEW_PANE,
  EMPTY_WORKFLOW_OVERLAY,
  EMPTY_WORKSPACE_PANE,
  EMPTY_FEEDBACK_PANE,
  WORKFLOW_OVERLAY_WINDOW,
  detectNotifyCapability,
  notifyBytes,
} from '@deepseek-ai/dsh-tui-render'
import type {
  AdaptiveInfoFooterView,
  ApprovalPaneState,
  AskUserPaneState,
  CommandItem,
  FeedbackPaneState,
  FeedbackWriteError,
  FrameProbeHandle,
  GoalFooterView,
  HelpPaneState,
  InteractionState,
  JobHudItem,
  LoopAction,
  MentionCandidate,
  ModelPaneState,
  ModelPaneStatus,
  ModelRow,
  AgentHubPaneState,
  AgentHubRow,
  PlanDirectoryPaneState,
  PlanReviewPaneState,
  PermissionPaneState,
  Projector,
  SearchCandidate,
  SearchPaneState,
  SearchStatus,
  SessionPaneState,
  SessionRow,
  SettingsFieldRow,
  SettingsPaneState,
  TodoHudItem,
  ToolPresenterLookup,
  TuiController,
  ViewModel,
  WorkflowHudMember,
  WorkflowHudState,
  WorkflowOverlayState,
  WorkspacePaneState,
} from '@deepseek-ai/dsh-tui-render'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for launcher lifecycle values.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
// The goal/projection/todo merges type `ctx.goals` and the todos projection.
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-message-feedback'
import type { MessageFeedbackItem, MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback'
import type { ProjectionSnapshot, SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-jobs'
import type { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-workflow'
import { assertInteractiveTerminal } from './terminal-guard.ts'
import { installSignalHooks } from './signal-semantics.ts'
import { exportSessionMarkdown } from './export.ts'
import { parseSettingsFieldValue, settingsRowsFromDescribe } from './settings-rows.ts'

/** Feedback row lifetime: cleared on the next key or after this bound (K8/S4). */
export const FEEDBACK_MS = 2000

/** Host table key that requires a second Enter before execute (D-03 / D-08). */
const DANGER_PRESET = 'danger-full-access'

/** General / theme settings namespace owned by this Consumer. */
const TUI_SETTINGS_NS = settingsNamespace('tui')

/** First-run credential the idle boot overlay collects. */
const ONBOARDING_KEY = 'DEEPSEEK_API_KEY'

/** TUI-owned user settings: color, input, notification, and brand presentation. */
interface TuiUserSettings {
  /** Optional override of the mount-time detected color tier. */
  colorTier?: 'truecolor' | '256' | '16' | 'none'
  /** When false, Enter inserts a newline and Ctrl+Enter sends. */
  submitOnEnter?: boolean
  /** Desktop notification policy (TERM-05): off, attention events only, or legacy per-turn popup. */
  notify?: NotifyMode
  /** Local input within this many seconds downgrades desktop notifications to bell. */
  notifyQuietInputSeconds?: number
  /** Generated FishLogo reveal mode (TERM-11). */
  brandAnimation?: 'auto' | 'on' | 'off'
}

const TuiUserSettings: z<TuiUserSettings> = z.object({
  colorTier: z.union(['truecolor', '256', '16', 'none'] as const),
  submitOnEnter: z.boolean().default(true),
  notify: z.union(['off', 'attention', 'every-turn'] as const).default('attention'),
  notifyQuietInputSeconds: z.natural().default(DEFAULT_NOTIFY_QUIET_INPUT_SECONDS),
  brandAnimation: z.union(['auto', 'on', 'off'] as const).default('auto'),
})
/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

/** Core services required before the terminal loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the optional task seed resolved from this app's provider service. */
export interface Config {
  /** The optional initial prompt text; an empty seed boots the loop idle. */
  task: string
  /** Session id to resume, if given on the command line. */
  resume?: string
  /** Working directory override, if given on the command line. */
  cwd?: string
  /** Frame-stats JSON output path, if given on the command line. */
  frameStats?: string
}

export const Config: z<Config> = z.object({
  task: z.string().required(),
  resume: z.string(),
  cwd: z.string(),
  frameStats: z.string(),
})

/** The process surfaces the driver uses; tests substitute captures. */
export const internals: {
  /** Terminal output consumed by the loop and direct diagnostics. */
  stdout: { write(chunk: string): unknown }
  /** Diagnostic output used for startup, export, and orderly-exit failures. */
  stderr: { write(chunk: string): unknown }
  /** TTY-shaped stdin Ink's input hooks attach to; tests inject a fake. */
  stdin: NodeJS.ReadStream
  /** Environment snapshot for the interactive-terminal guard. */
  environment: { isTTY: boolean; term: string | undefined }
  /** Terminal environment used to select the notification transport. */
  notifyEnvironment: NodeJS.ProcessEnv
  /** Literal `notify-send` fallback; failure is contained by the implementation. */
  notifySpawn: (command: string, args: readonly string[]) => void
  /** Loop mount used by the process runtime; tests replace it with a terminal-restoration probe. */
  mountLoop: typeof mountTuiLoop
  /** Durable frame-stats write used by the exit path; tests count exact writes. */
  writeFrameStatsFile: typeof writeFrameStatsFile
  /** Replacement-process spawn for `/reload`; tests inject a fake child. */
  spawn: RelaunchHost['spawn']
  /** Clipboard writer used by the message-copy action; tests capture its payload. */
  copyText: typeof copyText
  /** External-editor implementation; lifecycle tests inject a deterministic bridge. */
  editDraftExternally: typeof editDraftExternally
  /** Environment used to resolve `$VISUAL` before `$EDITOR`. */
  editorEnv: NodeJS.ProcessEnv
  /** Direct editor spawn, never a shell. */
  editorSpawn: EditorSpawn
  /** Parent for private editor workspaces. */
  editorTempParent: string
  /** Controlling terminal used for editor stdio. */
  editorTtyPath: string
  /** `process.argv` snapshot for `/reload` argv rebuilding. */
  processArgv: readonly string[]
  /** Clipboard-image reader spawn; tests inject a deterministic stub. */
  clipboardSpawn: (
    command: string,
    args: readonly string[],
    options: { stdio: ['ignore', 'pipe', 'pipe'] },
  ) => import('node:child_process').ChildProcessByStdio<
    null,
    import('node:stream').Readable,
    import('node:stream').Readable
  >
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  environment: { isTTY: process.stdout.isTTY, term: process.env.TERM },
  notifyEnvironment: process.env,
  notifySpawn: (command, args) => {
    const child = spawn(command, [...args], { stdio: 'ignore' })
    child.on('error', () => {})
  },
  mountLoop: mountTuiLoop,
  writeFrameStatsFile,
  spawn: (command, args, options) => spawn(command, args, options),
  copyText,
  editDraftExternally,
  editorEnv: process.env,
  editorSpawn: (command, args, options) => spawn(command, [...args], options),
  editorTempParent: tmpdir(),
  editorTtyPath: '/dev/tty',
  processArgv: process.argv,
  clipboardSpawn: (command, args, options) => spawn(command, [...args], options),
}

/** Observable ownership facts checked by the package invariant companion. */
export interface TuiRuntimeLifecycleSnapshot {
  /** Root-effect phase. */
  readonly phase: 'starting' | 'active' | 'ordinary-unload' | 'process-exit' | 'settled'
  /** Current launcher relationship for SIGINT/SIGTERM. */
  readonly launcherSignals: 'unavailable' | 'generic-owned' | 'consumer-owned'
  /** Current TUI hook relationship. */
  readonly tuiSignals: 'absent' | 'owned' | 'retained' | 'disposed'
  /** Whether asynchronous runtime work may still be live. */
  readonly runWork: 'open' | 'quiescing' | 'settled'
}

type TuiRuntimeLifecycleObserver = (snapshot: TuiRuntimeLifecycleSnapshot) => void

const liveRuntimeLifecycles = new Set<TuiRuntimeLifecycleSnapshot>()
const runtimeLifecycleObservers = new Set<TuiRuntimeLifecycleObserver>()

/**
 * Observe every live TUI root-effect ownership transition and seed the
 * observer with runtimes that already started.
 * @param observer - synchronous invariant check for one immutable snapshot.
 * @returns a disposer that removes the observer.
 */
export function observeTuiRuntimeLifecycle(
  observer: TuiRuntimeLifecycleObserver,
): () => void {
  runtimeLifecycleObservers.add(observer)
  for (const snapshot of liveRuntimeLifecycles) observer(snapshot)
  return () => {
    runtimeLifecycleObservers.delete(observer)
  }
}

/** Mutable owner that publishes immutable lifecycle facts. */
interface RuntimeLifecyclePublisher {
  update(change: Partial<TuiRuntimeLifecycleSnapshot>): void
  retire(): void
}

/** Register one root-effect lifecycle and publish its initial state. */
function createRuntimeLifecycle(
  launcherSignals: TuiRuntimeLifecycleSnapshot['launcherSignals'],
): RuntimeLifecyclePublisher {
  let current: TuiRuntimeLifecycleSnapshot = {
    phase: 'starting',
    launcherSignals,
    tuiSignals: 'absent',
    runWork: 'open',
  }
  const publish = (): void => {
    liveRuntimeLifecycles.add(current)
    for (const observer of runtimeLifecycleObservers) observer(current)
  }
  publish()
  return {
    update(change) {
      liveRuntimeLifecycles.delete(current)
      current = { ...current, ...change }
      publish()
    },
    retire() {
      liveRuntimeLifecycles.delete(current)
    },
  }
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
export interface TuiIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

type ExternalEditorSettlement =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'unconfigured' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'error'; readonly reason: string }

/** Durable raster reference carried by an image content block. */
type ImageAttachmentRef = Extract<ContentBlock, { type: 'image' }>['attachment']
/** Raster media types accepted by the version-one attachment path. */
type ImageMediaType = ImageAttachmentRef['mediaType']
/** Composer-facing placeholder for one pending or taken-back image. */
const IMAGE_TOKEN_PATTERN = /\[图片 #(\d+)\]/u
/** Global twin for matchAll: the shared stateless guard above must never
 * advance lastIndex, which would hide every token after the first scan. */
const IMAGE_TOKEN_GLOBAL = /\[图片 #(\d+)\]/gu

/** One immutable composer segment shared by text and future image intake. */
export type StructuredDraftSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
    readonly kind: 'image'
    readonly ref: Extract<ContentBlock, { type: 'image' }>['attachment']
    readonly name?: string | undefined
  }

/** One immutable user submission before it crosses into an Agent inbox. */
export interface StructuredDraft {
  /** Controller-local monotonic identity used by queue/take-back presentation. */
  readonly draftId: number
  /** Ordered model-facing segments; later image work reuses this array unchanged. */
  readonly segments: readonly StructuredDraftSegment[]
}

/** Read-only queue state consumed by the Phase 7 HUD. */
export interface DraftQueueSnapshot {
  /** Current-turn steer already handed to the host; never part of FIFO count. */
  readonly currentTurn?: {
    readonly draft: StructuredDraft
    readonly state: 'handoff' | 'inserted' | 'claimed'
  } | undefined
  /** Later-turn drafts not yet handed to the host, oldest first. */
  readonly fifo: readonly StructuredDraft[]
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: TuiIo, error: unknown): void {
  io.stderr.write(
    `dsh: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  io.exit(1)
}

/** One in-flight approval the live agent claimed from the host waterfall. */
interface QueuedApproval {
  /** Host request this entry answers. */
  readonly request: ApprovalRequest
  /** Settle the waterfall promise. */
  readonly resolve: (outcome: ApprovalOutcome) => void
  /** Enqueue order shared with ask-user (FIFO head paints). */
  readonly seq: number
  /** One-shot latch: ignore a second allow/deny after settle. */
  settled: boolean
  /** Whether the composer slot shows the details body. */
  detailsOpen: boolean
  /** Abort listener to remove on settle. */
  onAbort: () => void
}

/** One in-flight user question the current root-scoped TUI listener claimed. */
interface QueuedAskUser {
  /** Host request this entry answers. */
  readonly request: AskUserQuestionRequest
  /** Settle with the original (unescaped) selected labels. */
  readonly resolve: (answer: AskUserQuestionAnswer) => void
  /** Settle as ASK_ABORTED on Esc, abort, or teardown. */
  readonly reject: (error: UserQuestionError) => void
  /** Enqueue order shared with approval (FIFO head paints). */
  readonly seq: number
  /** One-shot latch: ignore a second submit/cancel after settle. */
  settled: boolean
  /** Highlighted option index for the first question. */
  selectedIndex: number
  /** Abort listener to remove on settle. */
  onAbort: () => void
}

/** One terminal outcome for the idempotent ask-user cleanup path. */
type AskUserSettlement =
  | { readonly answer: AskUserQuestionAnswer }
  | { readonly error: UserQuestionError }

/** Events the interaction machine accepts. */
type MachineEvent =
  | { kind: 'sigint' }
  | { kind: 'turn-started' }
  | { kind: 'turn-ended'; completed: boolean }
  | { kind: 'send'; draft: StructuredDraft }

/** Closed internal lifecycle for one serialized session transition. */
type SessionTransitionState =
  | { readonly phase: 'idle' }
  | {
    readonly phase: 'flushing' | 'creating' | 'resuming' | 'binding'
    readonly intent: 'create' | 'switch'
  }

/** Immutable request captured when a transition wins the single-flight slot. */
type SessionTransitionRequest =
  | { readonly intent: 'create' }
  | { readonly intent: 'switch'; readonly id: ReturnType<typeof SessionId> }

/** Unpublished candidate data prepared before the synchronous binding commit. */
interface PreparedCandidate {
  readonly handle: AgentHandle
  readonly projector: Projector
  readonly modelSelectionRef: ModelSelectionRef
  readonly badge: string
}

/** Input and cancellation operations captured from the bound Agent. */
interface BoundAgentInput {
  followup(message: ReturnType<typeof createUserMessage>): void
  steer(message: ReturnType<typeof createUserMessage>): void
  cancel(): void
}

interface CurrentTurnSteer {
  readonly draft: StructuredDraft
  readonly messageId: MessageId
  readonly state: 'handoff' | 'inserted' | 'claimed'
  readonly transcriptSeen: boolean
}

/** One active retry wait owned by the durable retry event pair. */
interface RetryFooterState {
  readonly retryId: RetryId
  readonly retry: number
  readonly maxRetries?: number | undefined
  readonly retryUntil: number
  readonly failureCode: string
}

/** Bound fields restored together when a pre-commit operation fails. */
interface BoundSnapshot {
  readonly liveHandle: AgentHandle | undefined
  readonly agent: Agent | undefined
  readonly agentHandle: BoundAgentInput | undefined
  readonly session: Session | undefined
  readonly projector: Projector
  readonly modelSelectionRef: ModelSelectionRef | undefined
  readonly badge: string
  readonly machine: InteractionState
}

const IDLE_TRANSITION: SessionTransitionState = { phase: 'idle' }

/** Terminal copy for every non-idle phase of one immutable intent. */
function transitionStatusText(
  state: SessionTransitionState,
): string | undefined {
  if (state.phase === 'idle') return undefined
  return state.intent === 'create' ? '正在新建会话…' : '正在切换会话…'
}

/** One concise reason suitable for the terminal failure row. */
function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read one field from a settings section object.
 * @param section - `ctx.settings.get` result.
 * @param field - schema field key.
 * @returns the field value, or undefined when the section is not a plain object.
 */
function fieldOf(section: unknown, field: string): unknown {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    return undefined
  }
  return (section as Record<string, unknown>)[field]
}

/** Hub table row for one `child` listing entry; diagnostics are omitted. */
function hubRowOf(entry: SubagentListEntry): AgentHubRow | undefined {
  if (entry.kind !== 'child') return undefined
  const label = entry.mode === 'continuable' ? entry.label : (entry.label ?? entry.id)
  return {
    id: entry.id,
    label,
    activity: entry.activity,
    hasChildren: entry.hasChildren,
  }
}

/** Subagent active-turn contribution to {@link hubMetricsOf}'s durationMs; 0 when no turn is open. */
function activeContributionMs(active: SubagentTimingProjection['active'], activity: string, now: number): number {
  if (active === undefined) return 0
  const through = activity === 'running' ? Math.max(now, active.through) : active.through
  return Math.max(0, through - active.since)
}

/** Render-only Hub metrics from one live or cold authoritative projection cut. */
function hubMetricsOf(
  values: Partial<SessionProjectionMap>,
  activity: string,
  now: number,
): Pick<AgentHubRow, 'contextPercent' | 'tokens' | 'durationMs'> {
  const usage = values.tokenUsage
  const tokens = usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
  const pressure = values.contextPressure
  const contextPercent = pressure?.pressureTokens === undefined
    || pressure.contextWindow === undefined
    || pressure.contextWindow === 0
    ? undefined
    : Math.round((pressure.pressureTokens / pressure.contextWindow) * 100)
  const timing = values.subagentTiming
  const durationMs = timing === undefined
    ? undefined
    : timing.settledMs + activeContributionMs(timing.active, activity, now)
  return {
    ...(contextPercent === undefined ? {} : { contextPercent }),
    ...(tokens === undefined || tokens === 0 ? {} : { tokens }),
    ...(durationMs === undefined ? {} : { durationMs }),
  }
}

/** Projection cells the Agent Hub is allowed to expose. */
const AGENT_HUB_PROJECTION_KEYS = [
  'tokenUsage',
  'contextPressure',
  'subagentTiming',
] as const satisfies readonly Extract<keyof SessionProjectionMap, string>[]

/** Concatenate the text blocks of a content array in one pass (no intermediate filter/map arrays). */
function joinTextBlocks(content: readonly ContentBlock[], separator: string): string {
  let result = ''
  let first = true
  for (const block of content) {
    if (block.type !== 'text') continue
    if (!first && separator !== '') result += separator
    result += block.text
    first = false
  }
  return result
}

/** Resolve the clipboard helper argv (wl-paste on Wayland, xclip on X11); undefined when neither surface is set. */
function clipboardHelperCommand(): string[] | undefined {
  if (process.env.WAYLAND_DISPLAY !== undefined && process.env.WAYLAND_DISPLAY !== '') {
    return ['wl-paste', '--type', 'image/png']
  }
  if (process.env.DISPLAY !== undefined && process.env.DISPLAY !== '') {
    return ['xclip', '-selection', 'clipboard', '-t', 'image/png', '-o']
  }
  return undefined
}

/** One localized status row label for the closed interaction state machine. */
function interactionStatusLabel(state: InteractionState): string {
  switch (state) {
    case 'idle': return '空闲'
    case 'generating': return '生成中'
    case 'stopped': return '已停止'
    case 'exit-armed': return '即将退出'
  }
}

/** Human-visible user and assistant lines for a Hub inspect transcript. */
function hubTranscriptOf(events: readonly SessionEvent[]): string {
  const lines: string[] = []
  for (const event of events) {
    if (isHumanUserMessage(event)) {
      const text = joinTextBlocks(event.data.content, '')
      if (text !== '') lines.push(`> ${text}`)
      continue
    }
    if (event.type !== 'assistant/message') continue
    const text = joinTextBlocks(event.data.message.content, '')
    if (text !== '') lines.push(`● ${text}`)
  }
  return lines.join('\n')
}

/** Fallback title caps for directory rows: UI presentation, not service config. */
const LIST_TITLE_MAX_WORDS = 8
const LIST_TITLE_MAX_BYTES = 80

/** Search candidates fetched before the panel's truncation hint. */
const SEARCH_LIMIT = 30

/** Delay after the final search edit before querying persisted transcripts. */
export const SEARCH_DEBOUNCE_MS = 120

/**
 * TUI-owned slash commands merged into the registry directory. The file
 * `/export` stays local because the registry's `export` (session-log-export)
 * is a Web-only placeholder that never writes files; `/help` opens the
 * in-terminal help sheet; `/model` opens the model-selection panel;
 * `/settings` opens the settings overlay.
 */
const LOCAL_COMMANDS: readonly CommandDescriptor[] = [
  { name: 'export', description: 'Export this session to a Markdown file' },
  { name: 'help', description: 'Show command help and key bindings' },
  { name: 'model', description: 'Switch the active model' },
  { name: 'reload', description: 'Relaunch this process and resume the session' },
  { name: 'resume', description: 'Switch or resume a session' },
  { name: 'settings', description: 'Edit settings, catalogs, and General' },
]

/**
 * Owns one committed Agent handle and every mutation derived from its Session.
 * The global `session/event` listener compares the authoritative Session object
 * with the committed `liveHandle.agent.session` before projection, interaction
 * reduction, turn-end flush, title/status recomputation, or render notification.
 * A Session with the same id but a different object is not admitted.
 *
 * Create and switch requests share one serialized transition. The old Session
 * is flushed before allocation; the candidate is replayed before a synchronous
 * binding commit; a pre-commit failure restores the complete old tuple and
 * disposes the unpublished candidate. Rename targets the live Session only when
 * every owned identity agrees, otherwise it edits the persisted cold Session.
 */
export class RuntimeController implements TuiController {
  /**
   * The slash-command directory exposed to the render loop: the registry's
   * descriptors for the live agent (minus the Web-only `/export` placeholder)
   * plus the local commands. Rebuilt on read so registrations stay live.
   * @returns the current name-sorted command items.
   */
  get commands(): readonly CommandItem[] {
    return this.commandDirectory().map(command => ({
      name: command.name,
      description: command.description,
    }))
  }

  /** The live agent the registry lists and executes commands against. */
  private agent: Agent | undefined
  /** Cancellation owner of the in-flight registry command, if any. */
  private commandAbort: AbortController | undefined
  /** Monotonic command request id: only the newest settlement may land. */
  private commandSeq = 0

  private readonly listeners = new Set<() => void>()
  /** Session-event subscription owned by this controller. */
  private readonly disposeSessionEvents: () => void
  /** Live Agent inbox lifecycle subscriptions owned by this controller. */
  private readonly disposeAgentInboxEvents: () => void
  /** Live-agent `approval/request` waterfall registration. */
  private readonly disposeApprovalRequest: () => void
  /** Current root Agent-scoped `user-questions/request` listener. */
  private disposeUserQuestions: () => void = () => {}
  /** FIFO of claimed approvals; only a blocking-slot head paints ApprovalPane. */
  private readonly approvalQueue: QueuedApproval[] = []
  /** FIFO of claimed questions; only a blocking-slot head paints AskUserPane. */
  private readonly askUserQueue: QueuedAskUser[] = []
  /** Shared enqueue counter: the older head of the two queues paints. */
  private slotSeq = 0
  /** Cached composer-slot snapshot; dropped on emit like the other panes. */
  private approvalPaneSnapshot: ApprovalPaneState | undefined
  /** Cached ask-user snapshot; dropped on emit like the other panes. */
  private askUserPaneSnapshot: AskUserPaneState | undefined
  /** Cached plan-review snapshot; dropped on emit like the other panes. */
  private planReviewPaneSnapshot: PlanReviewPaneState | undefined
  /** Cached goal-footer view; dropped on emit like the other panes (null = no goal). */
  private goalFooterSnapshot: GoalFooterView | null | undefined
  /** Cached authoritative info-footer view (null = no bound model). */
  private adaptiveInfoFooterSnapshot: AdaptiveInfoFooterView | null | undefined
  /** Cached todo HUD rows; dropped on emit like the other panes (null = hidden). */
  private todoHudSnapshot: readonly TodoHudItem[] | null | undefined
  /** Delivery-failure reason for the live plan-review head. */
  private planReviewDeliveryError: string | undefined
  /** Cancellation shared by create/resume work that has not published yet. */
  private readonly lifecycleAbort = new AbortController()
  /** Detached UI operations joined during root-effect teardown. */
  private readonly ownedWork = new Set<Promise<unknown>>()
  /** Idempotent quiescent controller teardown. */
  private disposeInFlight: Promise<void> | undefined
  private closed = false
  private machine: InteractionState = 'idle'
  /** Durable retry wait currently visible in the footer. */
  private retryFooter: RetryFooterState | undefined
  /** Single bounded refresh timer while {@link retryFooter} is visible. */
  private retryFooterTimer: ReturnType<typeof setTimeout> | undefined
  private projector = createProjector()
  private reasoningExpanded = false
  private toolCardsExpanded = false
  /** Latest compaction divider expanded by Ctrl+K. */
  private expandedCompactionId: string | undefined
  private pending: LoopAction[] = []
  private agentHandle: BoundAgentInput | undefined
  /** Monotonic identity for immutable structured drafts. */
  private nextDraftId = 1
  /** First running-turn draft already handed to `agent.steer`. */
  private currentTurnSteer: CurrentTurnSteer | undefined
  /** Later running-turn drafts not yet handed to the Agent. */
  private readonly draftFifo: StructuredDraft[] = []
  /** A completed turn permits one FIFO promotion at the next Agent idle event. */
  private draftDrainReady = false
  /** The owned agent handle, torn down on session switch or exit. */
  private liveHandle: AgentHandle | undefined
  /** The one controller-owned transition and its shared in-flight promise. */
  private transitionState: SessionTransitionState = IDLE_TRANSITION
  private transitionInFlight: Promise<void> | undefined
  /** The owned session, exposed for the exit flush. */
  session: Session | undefined
  /** Directory rows, newest activity first; refreshed from persistence. */
  private sessionList: SessionRow[] = []
  private selectedIndex = 0
  private listOpen = false
  private confirmDelete = false
  /** Full-text search panel state, driven by the session-query service. */
  private searchOpen = false
  private searchQuery = ''
  private searchResults: SearchCandidate[] = []
  private searchSelectedIndex = 0
  /** Monotonic request id: only the newest search response may land (K7/S1). */
  private searchSeq = 0
  /** Controller-owned delay for the newest non-empty search edit. */
  private searchTimer: ReturnType<typeof setTimeout> | undefined
  /** Search panel phase: loading/error vs. settled results. */
  private searchStatus: SearchStatus = 'idle'
  /** Read-only timeline view (Ctrl+T). */
  private timelineOpen = false
  /** Model-selection panel state, driven by the llm provider catalog. */
  private modelOpen = false
  private modelFilter = ''
  private modelRows: ModelRow[] = []
  private modelSelectedIndex = 0
  private modelStatus: ModelPaneStatus = 'idle'
  private modelError: string | undefined
  /** Monotonic catalog request id: only the newest load may land (K7/S1). */
  private modelSeq = 0
  /** Help panel state: the rendered `/help` sheet lines. */
  private helpOpen = false
  private helpLines: string[] = []
  /** Permission-preset overlay: host table rows, selection, danger confirm. */
  private permissionOpen = false
  private permissionNames: string[] = []
  private permissionSelectedIndex = 0
  private permissionCurrentName = ''
  private permissionConfirmDanger = false
  private permissionSwitchError: string | undefined
  private permissionDescriptions: (string | undefined)[] = []
  /** Settings overlay: host field rows, selection, draft editing. */
  private settingsOpen = false
  private settingsRows: SettingsFieldRow[] = []
  private settingsSelectedIndex = 0
  private settingsEditing = false
  private settingsOnboarding = false
  private settingsUpdateError: string | undefined
  /** K2 overlay flags: Agent Hub, workspace, feedback, workflow. */
  private agentHubOpen = false
  private agentHubRows: AgentHubRow[] = []
  private agentHubSelectedIndex = 0
  private agentHubView: 'table' | 'transcript' = 'table'
  private agentHubError: string | undefined
  private agentHubTranscript: string | undefined
  /** Monotonic listing/inspect id: only the newest Hub request may land. */
  private agentHubSeq = 0
  /** Cancellation owner for the newest Hub list, fold, expansion, or inspect. */
  private agentHubAbort: AbortController | undefined
  /** Plan-directory overlay: 开启/关闭 selection derived from host mode. */
  private planDirectoryOpen = false
  private planDirectorySelectedIndex = 0
  private planDirectoryCurrentActive = false
  private planDirectorySwitchError: string | undefined
  private planDirectoryStatusError: string | undefined
  private workspaceOpen = false
  /** Workspace tree root; undefined until the first resolve lands. */
  private workspaceRoot: FsTarget | undefined
  /** Loaded directory children by target key (lazy tree). */
  private readonly workspaceChildren = new Map<string, FsDirEntry[]>()
  /** Expanded directory target keys. */
  private readonly workspaceExpanded = new Set<string>()
  private workspaceSelectedIndex = 0
  /** True while the path draft owns the composer. */
  private workspaceEditing = false
  /** Path-resolve failure reason (paints `✗ 路径无效：{原因}`). */
  private workspaceResolveError: string | undefined
  /** Stale guard for in-flight workspace loads; bumped on open/close/re-root. */
  private workspaceSeq = 0
  private feedbackOpen = false
  /** True while the feedback note draft owns the composer. */
  private feedbackEditing = false
  /** The last write failure (kind + optional reason for the copy pair). */
  private feedbackWriteError: { kind: FeedbackWriteError; reason?: string | undefined } | undefined
  /** The target's current sidecar item (drives the `· 当前` marker and CAS). */
  private feedbackCurrent: MessageFeedbackItem | undefined
  /** The assistant message the overlay targets, captured at open. */
  private feedbackTargetId: MessageId | undefined
  /** Cached session-stats splice; dropped on emit like the other panes (null = hidden). */
  private sessionStatsSnapshot: { turns: number; decodeTokens: number; llmMs: number } | null | undefined
  /** Latest finalized assistant message id from the session event stream. */
  private lastAssistantMessageId: MessageId | undefined
  /** Stale guard for in-flight feedback reads/writes; bumped on open/close. */
  private feedbackSeq = 0
  private workflowOverlayOpen = false
  /** Live `tui` section reader installed by {@link installSettingsSection}. */
  private readTuiSettings: (() => TuiUserSettings) | undefined
  /** Last recorded turn ending, consumed by the idle-time notification summary. */
  private lastTurnEnd:
    | {
      readonly kind: TurnEndReason['kind']
      readonly abortCause?: TurnEndCancelCause
      readonly errorText?: string
    }
    | undefined
  /** Epoch ms of the most recent local keypress; drives the quiet-window suppression. */
  private lastInputAt = 0
  /** The live agent's mutable model selection, installed at agent creation. */
  private modelSelectionRef: ModelSelectionRef | undefined
  /** True while the backend delete capability is missing (K6/S3). */
  private deleteUnavailable = false
  /** Status-row failure feedback, cleared by the next key or FEEDBACK_MS. */
  private feedback: string | undefined
  /** Composer text retained across an external-editor unmount/remount. */
  private composerDraft = ''
  /** Full structured draft restored by FIFO take-back. */
  private composerStructuredDraft: StructuredDraft | undefined
  private feedbackTimer: ReturnType<typeof setTimeout> | undefined
  /** Controller-owned render notification timer. */
  private emitTimer: ReturnType<typeof setTimeout> | undefined
  private emitLastRun = 0
  private emitPending = false
  /** Provider/model label displayed in the top bar. */
  badge = ''
  /**
   * Cached snapshot objects for the object-valued getters. Every state
   * mutation funnels through emit(), which drops them; each getter rebuilds
   * on the next read, so a read between emissions returns the same reference
   * (useSyncExternalStore treats a fresh object as an update and re-renders
   * forever) while a read after a mutation is never stale.
   */
  private modelSnapshot: ViewModel | undefined
  private sessionPaneSnapshot: SessionPaneState | undefined
  private searchPaneSnapshot: SearchPaneState | undefined
  private modelPaneSnapshot: ModelPaneState | undefined
  private helpPaneSnapshot: HelpPaneState | undefined
  private permissionPaneSnapshot: PermissionPaneState | undefined
  private settingsPaneSnapshot: SettingsPaneState | undefined
  private agentHubPaneSnapshot: AgentHubPaneState | undefined
  private planDirectoryPaneSnapshot: PlanDirectoryPaneState | undefined
  private workspacePaneSnapshot: WorkspacePaneState | undefined
  private feedbackPaneSnapshot: FeedbackPaneState | undefined
  private workflowOverlaySnapshot: WorkflowOverlayState | undefined
  /** Cached jobs HUD rows; dropped on emit like the other panes (null = hidden). */
  private jobsHudSnapshot: readonly JobHudItem[] | null | undefined
  /** Cached workflow HUD snapshot; dropped on emit like the other panes (null = hidden). */
  private workflowHudSnapshot: WorkflowHudState | null | undefined
  /** Latest live workflow run rebuilt from `workflow/*` events (observe-only). */
  private workflowRun:
    | { id: WorkflowRunId; phase: string | undefined; members: Map<number, WorkflowHudMember> }
    | undefined
  /** First visible member row in the workflow overlay (j/k 滚动). */
  private workflowOverlayOffset = 0
  /** Jobs-registry change subscription; no-op when the service is absent. */
  private disposeJobsChanged: (() => void) | undefined
  /** The five `workflow/*` event subscriptions. */
  private disposeWorkflowEvents!: () => void

  /**
   * Create a controller and immediately subscribe to the global Session event
   * stream; {@link dispose} removes that subscription and joins owned work.
   * @param ctx - runtime context carrying Agent, Session, persistence, query,
   * command, filesystem, skill, and model services.
   * @param io - process output and exit effects.
   * @param config - validated startup task, resume, cwd, and frame-stats values.
   * @param requestExit - single-flight process-exit request owned by the root effect.
   */
  constructor(
    private readonly ctx: Context,
    private readonly io: TuiIo,
    private readonly config: Config,
    private readonly requestExit: () => void,
    private readonly requestReload: () => void = () => {},
    private readonly requestExternalEditor: (
      draft: string,
      settle: (result: ExternalEditorSettlement) => void,
    ) => boolean = () => false,
  ) {
    // The exact Session object is the admission authority. This check must run
    // before any projector, interaction, flush, title/status, or render mutation.
    this.disposeSessionEvents = ctx.on('session/event', (session, event: SessionEvent) => {
      if (session !== this.liveHandle?.agent.session) return
      this.projector.push(event)
      if (event.type === 'turn/start') {
        this.reduce({ kind: 'turn-started' })
      } else if (event.type === 'llm/retry') {
        this.startRetryFooter(event.data)
      } else if (
        event.type === 'llm/retry-started'
        && event.data.retryId === this.retryFooter?.retryId
      ) {
        this.clearRetryFooter()
      } else if (event.type === 'turn/end') {
        this.clearRetryFooter()
        this.reduce({
          kind: 'turn-ended',
          completed: event.data.reason.kind === 'completed',
        })
        this.notifyTurnEnd(event.data.reason)
        this.settleDraftTurn()
        this.flushOnTurnEnd()
      }
      if (event.type === 'user/message') {
        this.markDraftTranscript(event.data.id)
      }
      if (event.type === 'assistant/message') {
        this.lastAssistantMessageId = event.data.message.id
      }
      this.emit()
    })
    const inboxDisposers = [
      ctx.on('agent/inbox/inserted', ({ agent, message }) => {
        if (agent !== this.agent) return
        this.markSteerState(message.id, 'inserted')
      }),
      ctx.on('agent/inbox/claimed', ({ agent, message }) => {
        if (agent !== this.agent) return
        this.markSteerState(message.id, 'claimed')
      }),
      ctx.on('agent/inbox/discarded', ({ agent, message }) => {
        if (agent !== this.agent || message.id !== this.currentTurnSteer?.messageId) return
        this.currentTurnSteer = undefined
        this.setFeedback('当前回合草稿已取消')
      }),
      ctx.on('agent/status', ({ agent, status }) => {
        if (agent !== this.agent || status !== 'idle') return
        this.drainDraftFifo()
        this.notifyRunSettled()
      }),
    ]
    this.disposeAgentInboxEvents = () => {
      for (const dispose of inboxDisposers) dispose()
    }
    this.disposeApprovalRequest = ctx.on('approval/request', (request, next) => {
      if (this.agent === undefined || request.agent !== this.agent) return next()
      if (request.signal?.aborted === true) return Promise.resolve('cancelled')
      return this.enqueueApproval(request)
    })
    const jobs = ctx.get('jobs')
    this.disposeJobsChanged = jobs?.onJobsChanged(() => {
      // The registry already contains listener throws; emit() only drops
      // caches and schedules listeners.
      this.emit()
    })
    const workflowDisposers = [
      ctx.on('workflow/start', (info) => {
        this.workflowRun = { id: info.id, phase: undefined, members: new Map() }
        this.workflowOverlayOffset = 0
        this.emit()
      }),
      ctx.on('workflow/phase', (info, title) => {
        if (this.workflowRun?.id !== info.id) return
        this.workflowRun.phase = title
        this.emit()
      }),
      ctx.on('workflow/agent-start', (info, agent) => {
        if (this.workflowRun?.id !== info.id) return
        this.workflowRun.members.set(agent.seq, { seq: agent.seq, label: agent.label })
        this.emit()
      }),
      ctx.on('workflow/agent-end', (info, agent) => {
        if (this.workflowRun?.id !== info.id) return
        this.workflowRun.members.set(agent.seq, {
          seq: agent.seq,
          label: agent.label,
          outcome: agent.outcome,
        })
        this.emit()
      }),
      ctx.on('workflow/end', (info) => {
        if (this.workflowRun?.id !== info.id) return
        this.workflowRun = undefined
        this.emit()
      }),
    ]
    this.disposeWorkflowEvents = () => {
      for (const dispose of workflowDisposers) dispose()
    }
  }

  /** Own one asynchronous UI operation until it settles. */
  private ownWork(work: Promise<unknown>, label: string): void {
    this.ownedWork.add(work)
    void work.then(
      () => {
        this.ownedWork.delete(work)
      },
      (error: unknown) => {
        this.ownedWork.delete(work)
        this.ctx.logger.warn(`${label} failed: ${errorReason(error)}`)
      },
    )
  }

  /**
   * Stop event admission, invalidate delayed work, cancel live operations,
   * await every owned promise, and dispose the final Agent handle. Repeated
   * calls share the same teardown.
   * @returns a shared promise that settles only after controller quiescence.
   */
  dispose(): Promise<void> {
    this.disposeInFlight ??= this.disposeOwnedResources()
    return this.disposeInFlight
  }

  /** Perform the one quiescent controller teardown. */
  private async disposeOwnedResources(): Promise<void> {
    this.closed = true
    this.disposeSessionEvents()
    this.disposeAgentInboxEvents()
    this.disposeApprovalRequest()
    this.disposeUserQuestions()
    this.disposeUserQuestions = () => {}
    this.disposeJobsChanged?.()
    this.disposeWorkflowEvents()
    this.cancelQueuedApprovals()
    this.cancelQueuedAskUsers()
    this.invalidateSearch()
    this.currentTurnSteer = undefined
    this.draftFifo.length = 0
    this.draftDrainReady = false
    this.expandedCompactionId = undefined
    this.clearRetryFooter()
    this.clearFeedback()
    this.modelSeq++
    this.commandSeq++
    try {
      this.commandAbort?.abort()
    } catch (error: unknown) {
      this.ctx.logger.warn(`command cancellation during TUI unload failed: ${errorReason(error)}`)
    }
    this.lifecycleAbort.abort()
    this.listeners.clear()
    if (this.emitTimer !== undefined) {
      clearTimeout(this.emitTimer)
      this.emitTimer = undefined
    }
    this.emitPending = false
    try {
      this.agentHandle?.cancel()
    } catch (error: unknown) {
      this.ctx.logger.warn(`agent cancellation during TUI unload failed: ${errorReason(error)}`)
    }

    const transition = this.transitionInFlight
    if (transition !== undefined) {
      try {
        await transition
      } catch (error: unknown) {
        // start() owns and reports the same startup transition rejection; the
        // disposer records it only so no second rejection escapes teardown.
        this.ctx.logger.warn(`session transition during TUI unload failed: ${errorReason(error)}`)
      }
    }
    while (this.ownedWork.size > 0) {
      await Promise.allSettled([...this.ownedWork])
    }

    const handle = this.liveHandle
    this.liveHandle = undefined
    this.agent = undefined
    this.agentHandle = undefined
    this.session = undefined
    this.modelSelectionRef = undefined
    if (handle !== undefined) await handle.dispose()
  }

  /** Persist the live session after each completed turn (periodic durability). */
  private flushOnTurnEnd(): void {
    const sessions = this.ctx.get('sessions')
    const session = this.session
    if (sessions === undefined || session === undefined) return
    this.ownWork(sessions.flush(session), 'periodic session flush')
  }

  /**
   * Return the current terminal view model.
   * @returns a projection snapshot with runtime interaction state.
   */
  getModel(): ViewModel {
    if (this.modelSnapshot === undefined) {
      const model = this.projector.snapshot()
      this.modelSnapshot = {
        ...model,
        reasoningExpanded: this.reasoningExpanded,
        toolCardsExpanded: this.toolCardsExpanded,
        expandedCompactionId: this.expandedCompactionId,
        status: this.statusOf(),
      }
    }
    return this.modelSnapshot
  }

  /**
   * Return the interaction state.
   * @returns the current interaction state.
   */
  getInteraction(): InteractionState {
    return this.machine
  }

  /**
   * Return the top-bar provider/model label.
   * @returns the active provider/model label.
   */
  getBadge(): string {
    return this.badge
  }

  /**
   * Return the live session display title for the top bar, or '' when the
   * loop should show the mount app name. See {@link topBarTitle}.
   * @returns the top-bar title, or '' when none should replace the app name.
   */
  getTitle(): string {
    if (this.session === undefined) return ''
    return topBarTitle(this.session.events)
  }

  /**
   * Return the current session-directory state.
   * @returns session rows and directory interaction state.
   */
  getSessionPane(): SessionPaneState {
    if (this.sessionPaneSnapshot === undefined) {
      this.sessionPaneSnapshot = {
        rows: this.sessionList,
        selectedIndex: this.selectedIndex,
        open: this.listOpen,
        confirmDelete: this.confirmDelete,
        deleteUnavailable: this.deleteUnavailable,
        currentId: this.session?.id,
      }
    }
    return this.sessionPaneSnapshot
  }

  /**
   * Return the current full-text search-panel state.
   * @returns the live query, ranked candidates, and panel interaction state.
   */
  getSearchPane(): SearchPaneState {
    if (this.searchPaneSnapshot === undefined) {
      this.searchPaneSnapshot = {
        query: this.searchQuery,
        results: this.searchResults,
        selectedIndex: this.searchSelectedIndex,
        open: this.searchOpen,
        status: this.searchStatus,
      }
    }
    return this.searchPaneSnapshot
  }

  /**
   * Return the current model-selection panel state: the live filter, the
   * catalog rows already narrowed by it, and the panel interaction state.
   * @returns the filtered rows, selection, and open/status flags.
   */
  getModelPane(): ModelPaneState {
    if (this.modelPaneSnapshot === undefined) {
      this.modelPaneSnapshot = {
        filter: this.modelFilter,
        rows: this.filteredModelRows(),
        selectedIndex: this.modelSelectedIndex,
        open: this.modelOpen,
        status: this.modelStatus,
        ...(this.modelError === undefined ? {} : { error: this.modelError }),
      }
    }
    return this.modelPaneSnapshot
  }

  /**
   * Return the current help-panel state: the rendered `/help` sheet lines.
   * @returns the help lines and the open flag.
   */
  getHelpPane(): HelpPaneState {
    if (this.helpPaneSnapshot === undefined) {
      this.helpPaneSnapshot = {
        lines: this.helpLines,
        open: this.helpOpen,
      }
    }
    return this.helpPaneSnapshot
  }

  /**
   * Return the current approval-slot state. Open only while this controller
   * has claimed the live agent's head-of-queue `approval/request`.
   * @returns the open flag and pending request fields.
   */
  getApprovalPane(): ApprovalPaneState {
    if (this.approvalPaneSnapshot === undefined) {
      this.approvalPaneSnapshot = this.buildApprovalPane()
    }
    return this.approvalPaneSnapshot
  }

  /**
   * Return the current ask-user slot. Open only while this controller's
   * root-scoped listener has an unanswered request at the shared FIFO head.
   * @returns the open flag, header, labels, and selection.
   */
  getAskUserPane(): AskUserPaneState {
    if (this.askUserPaneSnapshot === undefined) {
      this.askUserPaneSnapshot = this.buildAskUserPane()
    }
    return this.askUserPaneSnapshot
  }

  /**
   * Return the current permission-preset overlay. Closed while idle; open only
   * after an empty `/permission` intercept (not a parameterized switch).
   * @returns the open flag, host names, selection, and confirm/error fields.
   */
  getPermissionPane(): PermissionPaneState {
    if (!this.permissionOpen) return EMPTY_PERMISSION_PANE
    if (this.permissionPaneSnapshot === undefined) {
      this.permissionPaneSnapshot = {
        open: true,
        names: this.permissionNames,
        selectedIndex: this.permissionSelectedIndex,
        currentName: this.permissionCurrentName,
        confirmDanger: this.permissionConfirmDanger,
        ...(this.permissionDescriptions.length === 0
          ? {}
          : { descriptions: this.permissionDescriptions }),
        ...(this.permissionSwitchError === undefined
          ? {}
          : { switchError: this.permissionSwitchError }),
      }
    }
    return this.permissionPaneSnapshot
  }

  /**
   * Return the current settings overlay. Closed while idle; open only after
   * an empty `/settings` intercept.
   * @returns the open flag, host field rows, selection, and editing/error fields.
   */
  getSettingsPane(): SettingsPaneState {
    if (!this.settingsOpen) return EMPTY_SETTINGS_PANE
    if (this.settingsPaneSnapshot === undefined) {
      this.settingsPaneSnapshot = {
        open: true,
        rows: this.settingsRows,
        selectedIndex: this.settingsSelectedIndex,
        editing: this.settingsEditing,
        ...(this.settingsOnboarding ? { onboarding: true } : {}),
        ...(this.settingsUpdateError === undefined
          ? {}
          : { updateError: this.settingsUpdateError }),
      }
    }
    return this.settingsPaneSnapshot
  }

  /**
   * Return the Agent Hub overlay. Closed while idle; open after `g a`.
   * Missing `subagents` still opens and paints 未组合 (S19).
   * @returns the open flag plus rows, view, and error/transcript fields.
   */
  getAgentHubPane(): AgentHubPaneState {
    if (!this.agentHubOpen) return EMPTY_OVERLAY_PANE
    if (this.agentHubPaneSnapshot === undefined) {
      this.agentHubPaneSnapshot = {
        open: true,
        rows: this.agentHubRows,
        selectedIndex: this.agentHubSelectedIndex,
        view: this.agentHubView,
        missing: this.ctx.get('subagents') === undefined,
        ...(this.agentHubError === undefined ? {} : { error: this.agentHubError }),
        ...(this.agentHubTranscript === undefined
          ? {}
          : { transcript: this.agentHubTranscript }),
      }
    }
    return this.agentHubPaneSnapshot
  }

  /**
   * Return the plan-directory overlay. Closed while idle; open after empty `/plan`.
   * @returns the open flag plus selection, current mode, and error fields.
   */
  getPlanDirectoryPane(): PlanDirectoryPaneState {
    if (!this.planDirectoryOpen) return EMPTY_PLAN_DIRECTORY_PANE
    if (this.planDirectoryPaneSnapshot === undefined) {
      this.planDirectoryPaneSnapshot = {
        open: true,
        selectedIndex: this.planDirectorySelectedIndex,
        currentActive: this.planDirectoryCurrentActive,
        ...(this.planDirectorySwitchError === undefined
          ? {}
          : { switchError: this.planDirectorySwitchError }),
        ...(this.planDirectoryStatusError === undefined
          ? {}
          : { statusError: this.planDirectoryStatusError }),
      }
    }
    return this.planDirectoryPaneSnapshot
  }

  /**
   * Return the workspace-tree overlay: the lazy ctx.fs tree rooted at the
   * resolved cwd, or the S19 opener error when the fs service is absent.
   * @returns the pane state.
   */
  getWorkspacePane(): WorkspacePaneState {
    if (!this.workspaceOpen) return EMPTY_WORKSPACE_PANE
    if (this.workspacePaneSnapshot === undefined) {
      const fs = this.ctx.get('fs')
      this.workspacePaneSnapshot = {
        open: true,
        root: this.workspaceRoot?.displayPath ?? '',
        nodes: this.computeWorkspaceRows().map(row => ({
          path: row.target.displayPath,
          name: row.name,
          depth: row.depth,
          kind: row.kind,
          expanded: row.expanded,
        })),
        selectedIndex: this.workspaceSelectedIndex,
        editing: this.workspaceEditing,
        error: fs === undefined ? '文件系统未组合' : undefined,
        resolveError: this.workspaceResolveError,
      }
    }
    return this.workspacePaneSnapshot
  }

  /** Visible workspace rows in tree order (expanded directories unfold). */
  private computeWorkspaceRows(): {
    target: FsTarget
    name: string
    kind: 'directory' | 'file' | 'other'
    depth: number
    expanded: boolean
  }[] {
    const rows: {
      target: FsTarget
      name: string
      kind: 'directory' | 'file' | 'other'
      depth: number
      expanded: boolean
    }[] = []
    const root = this.workspaceRoot
    if (root === undefined) return rows
    const walk = (targetKey: string, depth: number): void => {
      // Root and expanded directory keys are published only after their child list is cached.
      for (const child of this.workspaceChildren.get(targetKey) as readonly FsDirEntry[]) {
        const key = String(child.target.targetKey)
        const expanded = child.type === 'directory' && this.workspaceExpanded.has(key)
        rows.push({
          target: child.target,
          name: child.name,
          kind: child.type,
          depth,
          expanded,
        })
        if (expanded) walk(key, depth + 1)
      }
    }
    walk(String(root.targetKey), 0)
    return rows
  }

  /** Resolve the launch cwd and load its first level (stale-guarded). */
  private async loadWorkspaceRoot(seq: number): Promise<void> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return
    try {
      const root = await fs.resolve(this.config.cwd ?? '.')
      const children = await fs.listDir(root)
      if (seq !== this.workspaceSeq || !this.workspaceOpen) return
      this.commitResolvedWorkspaceRoot(root, children)
    } catch (error: unknown) {
      if (seq !== this.workspaceSeq || !this.workspaceOpen) return
      this.workspaceResolveError = errorReason(error)
    }
    this.emit()
  }

  /** Expand (loading on first open) or collapse the selected directory. */
  private async toggleWorkspaceDirectory(target: FsTarget): Promise<void> {
    const key = String(target.targetKey)
    if (this.workspaceExpanded.has(key)) {
      this.workspaceExpanded.delete(key)
      this.emit()
      return
    }
    if (!this.workspaceChildren.has(key)) {
      const fs = this.ctx.get('fs')
      if (fs === undefined) return
      const seq = this.workspaceSeq
      try {
        const children = await fs.listDir(target)
        if (seq !== this.workspaceSeq || !this.workspaceOpen) return
        this.workspaceChildren.set(key, children)
      } catch (error: unknown) {
        this.ctx.logger.warn(`workspace expand failed: ${errorReason(error)}`)
        this.setFeedback(`✗ 工作目录展开失败：${errorReason(error)}`)
        return
      }
    }
    this.workspaceExpanded.add(key)
    this.emit()
  }

  /** Resolve the typed path draft; failure keeps the previous root (D-09). */
  private async applyWorkspacePath(value: string, seq: number): Promise<void> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return
    try {
      const root = await fs.resolve(value)
      const children = await fs.listDir(root)
      if (seq !== this.workspaceSeq || !this.workspaceOpen) return
      this.commitResolvedWorkspaceRoot(root, children)
    } catch (error: unknown) {
      if (seq !== this.workspaceSeq || !this.workspaceOpen) return
      this.workspaceResolveError = errorReason(error)
    }
    this.emit()
  }

  /** Apply one freshly resolved workspace root + children (callers own the seq/workspaceOpen guard). */
  private commitResolvedWorkspaceRoot(root: FsTarget, children: FsDirEntry[]): void {
    this.workspaceRoot = root
    this.workspaceChildren.clear()
    this.workspaceChildren.set(String(root.targetKey), children)
    this.workspaceExpanded.clear()
    this.workspaceSelectedIndex = 0
    this.workspaceResolveError = undefined
  }

  /**
   * Return the message-feedback overlay targeting the assistant message that
   * was latest when the overlay opened. Paints the S19 opener error when the
   * service is not composed.
   * @returns the pane state.
   */
  getFeedbackPane(): FeedbackPaneState {
    if (!this.feedbackOpen) return EMPTY_FEEDBACK_PANE
    if (this.feedbackPaneSnapshot === undefined) {
      const current = this.feedbackCurrent
      this.feedbackPaneSnapshot = {
        open: true,
        hasTarget: this.feedbackTargetId !== undefined,
        rating: current?.rating,
        note: current?.note,
        editing: this.feedbackEditing,
        error: this.ctx.get('messageFeedback') === undefined ? '反馈服务未组合' : undefined,
        writeError: this.feedbackWriteError?.kind,
        writeErrorReason: this.feedbackWriteError?.reason,
      }
    }
    return this.feedbackPaneSnapshot
  }

  /** Load the target's current sidecar item so the `· 当前` marker paints. */
  private async refreshFeedbackCurrent(seq: number): Promise<void> {
    const service = this.ctx.get('messageFeedback')
    const session = this.session
    const messageId = this.feedbackTargetId
    if (service === undefined || session === undefined || messageId === undefined) return
    let items: readonly MessageFeedbackItem[]
    try {
      const list = await service.list({ sessionId: session.id })
      if (!list.ok) return
      items = list.value.items
    } catch {
      // A list failure only delays the 当前 marker; writes re-list anyway.
      return
    }
    if (seq !== this.feedbackSeq) return
    this.feedbackCurrent = items.find(item => item.messageId === messageId)
    this.emit()
  }

  /** Rate or annotate the captured target through the CAS sidecar. */
  private async applyFeedback(
    rating: MessageFeedbackRating,
    note: string | undefined,
    seq: number,
  ): Promise<void> {
    const service = this.ctx.get('messageFeedback')
    const session = this.session
    const messageId = this.feedbackTargetId
    if (service === undefined || session === undefined || messageId === undefined) return
    try {
      const list = await service.list({ sessionId: session.id })
      if (seq !== this.feedbackSeq) return
      if (!list.ok) {
        this.feedbackWriteError = { kind: 'write-failure', reason: list.error.code }
        this.emit()
        return
      }
      const current = list.value.items.find(item => item.messageId === messageId)
      const noteValue = note ?? current?.note
      const put = await service.put({
        sessionId: session.id,
        messageId,
        rating,
        ...(noteValue === undefined ? {} : { note: noteValue }),
        ifVersion: current === undefined ? null : current.version,
      })
      if (seq !== this.feedbackSeq) return
      if (put.ok) {
        this.feedbackCurrent = put.value
        this.feedbackWriteError = undefined
      } else if (put.error.code === 'version-conflict') {
        this.feedbackCurrent = put.error.current ?? undefined
        this.feedbackWriteError = { kind: 'version-conflict' }
      } else if (put.error.code === 'note-too-large') {
        this.feedbackWriteError = { kind: 'note-too-large' }
      } else {
        this.feedbackWriteError = { kind: 'write-failure', reason: put.error.code }
      }
    } catch (error: unknown) {
      if (seq !== this.feedbackSeq) return
      this.feedbackWriteError = { kind: 'write-failure', reason: errorReason(error) }
    }
    this.emit()
  }

  /**
   * Return the workflow overlay: the live run's phase and windowed member
   * rows, the empty state when no run was observed, or the S19 error when the
   * engine is not composed. Observe-only: opening never starts a run.
   * @returns the overlay state.
   */
  getWorkflowOverlay(): WorkflowOverlayState {
    if (!this.workflowOverlayOpen) return EMPTY_WORKFLOW_OVERLAY
    if (this.workflowOverlaySnapshot === undefined) {
      const run = this.workflowRun
      this.workflowOverlaySnapshot = {
        open: true,
        run:
          run === undefined
            ? undefined
            : {
              phase: run.phase,
              members: [...run.members.values()].sort((a, b) => a.seq - b.seq),
            },
        error:
          this.ctx.get('workflowEngine') === undefined
            ? '工作流状态不可用：未组合'
            : undefined,
        offset: this.workflowOverlayOffset,
      }
    }
    return this.workflowOverlaySnapshot
  }

  /**
   * Return the jobs HUD rows for the live agent. The registry is always
   * queried with the exact live Agent — a caller-less list would leak other
   * sessions' jobs. Undefined when the service is not composed.
   * @returns the job rows, or undefined.
   */
  getJobsHud(): readonly JobHudItem[] | undefined {
    if (this.jobsHudSnapshot === undefined) {
      this.jobsHudSnapshot = this.buildJobsHud() ?? null
    }
    return this.jobsHudSnapshot ?? undefined
  }

  /**
   * Return the live workflow HUD snapshot rebuilt from `workflow/*` events;
   * undefined while no run is live (S18).
   * @returns the HUD snapshot, or undefined.
   */
  getWorkflowHud(): WorkflowHudState | undefined {
    if (this.workflowHudSnapshot === undefined) {
      this.workflowHudSnapshot = this.buildWorkflowHud() ?? null
    }
    return this.workflowHudSnapshot ?? undefined
  }

  /** Rebuild the jobs HUD rows from the jobs registry (caller-scoped). */
  private buildJobsHud(): readonly JobHudItem[] | undefined {
    const agent = this.agent
    if (agent === undefined) return undefined
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined) return undefined
    return jobs.list(agent).map(job => ({
      id: String(job.id),
      status: job.status,
      label: job.label,
    }))
  }

  /** Rebuild the workflow HUD snapshot from the latest live-run state. */
  private buildWorkflowHud(): WorkflowHudState | undefined {
    const run = this.workflowRun
    if (run === undefined) return undefined
    const members = [...run.members.values()].sort((a, b) => a.seq - b.seq)
    const current = members.filter(member => member.outcome === undefined).at(-1) ?? members.at(-1)
    return { phase: run.phase, current }
  }

  /**
   * Return the plan-review dialog. Open when the FIFO ask-user head is a
   * single `plan-review` question; otherwise closed so AskUserPane owns it.
   * @returns the open flag, plan markdown, and delivery error.
   */
  getPlanReviewPane(): PlanReviewPaneState {
    if (this.planReviewPaneSnapshot === undefined) {
      this.planReviewPaneSnapshot = this.buildPlanReviewPane()
    }
    return this.planReviewPaneSnapshot
  }

  /**
   * Return the legacy free-form composer HUD strip.
   * @returns the strip text, or undefined while the queue HUD owns the slot.
   */
  getComposerHud(): string | undefined {
    return undefined
  }

  /**
   * Number of later-turn drafts not yet handed to the Agent.
   * @returns the FIFO depth.
   */
  getQueuedDraftCount(): number {
    return this.draftFifo.length
  }

  /**
   * Plain text of the oldest later-turn draft, or undefined while empty.
   * @returns the head draft's plain text, or undefined when the FIFO is empty.
   */
  getQueuedDraftText(): string | undefined {
    const draft = this.draftFifo[0]
    return draft === undefined ? undefined : this.draftToComposerText(draft)
  }
  /**
   * Return the current goal view for the status-row footer. Reads through the
   * goal service on every emission, so `/goal` set/clear paints without
   * polling; undefined when no goal is current or the service is absent.
   * @returns the goal view, or undefined.
   */
  getGoalFooter(): GoalFooterView | undefined {
    if (this.goalFooterSnapshot === undefined) {
      this.goalFooterSnapshot = this.buildGoalFooter() ?? null
    }
    return this.goalFooterSnapshot ?? undefined
  }

  /**
   * Return authoritative provider, usage, context, and retry footer values.
   * @returns the cached footer view, or undefined before a model binds.
   */
  getAdaptiveInfoFooter(): AdaptiveInfoFooterView | undefined {
    if (this.adaptiveInfoFooterSnapshot === undefined) {
      this.adaptiveInfoFooterSnapshot = this.buildAdaptiveInfoFooter() ?? null
    }
    return this.adaptiveInfoFooterSnapshot ?? undefined
  }

  /**
   * Return the todo HUD rows from the session projection. Undefined, null, or
   * an empty list hides the HUD (S18); the HUD never parses `todo_write` JSON.
   * @returns the todo rows, or undefined when the registry is absent.
   */
  getTodoHud(): readonly TodoHudItem[] | undefined {
    if (this.todoHudSnapshot === undefined) {
      this.todoHudSnapshot = this.buildTodoHud() ?? null
    }
    return this.todoHudSnapshot ?? undefined
  }

  /** Rebuild the goal footer view from the goal service. */
  private buildGoalFooter(): GoalFooterView | undefined {
    const agent = this.agent
    if (agent === undefined) return undefined
    const goals = this.ctx.get('goals')
    if (goals === undefined) return undefined
    return goals.get(agent)
  }

  /** Build the info footer from the bound selection and live projection cut. */
  private buildAdaptiveInfoFooter(): AdaptiveInfoFooterView | undefined {
    const selection = this.modelSelectionRef?.current
    if (selection === undefined) return undefined
    const session = this.session
    const projections = session === undefined
      ? undefined
      : this.ctx.get('sessionProjections')?.snapshot(session).values
    const usage = projections?.tokenUsage
    const measuredUsage = usage !== undefined
      && (
        usage.uncachedInputTokens !== 0
        || usage.outputTokens !== 0
        || usage.cacheReadTokens !== 0
        || usage.cacheWriteTokens !== 0
      )
      ? usage
      : undefined
    const pressure = projections?.contextPressure
    const measuredPressure = pressure !== undefined
      && (
        pressure.pressureTokens !== undefined
        || pressure.projectedTokens !== undefined
        || pressure.contextWindow !== undefined
      )
      ? pressure
      : undefined
    const status = interactionStatusLabel(this.machine)
    const retry = this.retryFooter
    return {
      provider: selection.provider,
      model: selection.model,
      status,
      ...(selection.reasoningEffort === undefined
        ? {}
        : { effort: String(selection.reasoningEffort) }),
      ...(measuredUsage === undefined ? {} : { tokenUsage: measuredUsage }),
      ...(measuredPressure === undefined ? {} : { contextPressure: measuredPressure }),
      ...(retry === undefined
        ? {}
        : {
          retry: {
            retry: retry.retry,
            ...(retry.maxRetries === undefined ? {} : { maxRetries: retry.maxRetries }),
            remainingMs: Math.max(0, retry.retryUntil - Date.now()),
            failureCode: retry.failureCode,
          },
        }),
    }
  }

  /** Rebuild the todo HUD rows from the session-projection registry. */
  private buildTodoHud(): readonly TodoHudItem[] | undefined {
    const session = this.session
    if (session === undefined) return undefined
    const projections = this.ctx.get('sessionProjections')
    if (projections === undefined) return undefined
    return projections.snapshot(session).values.todos ?? undefined
  }

  /**
   * Whole-log session stats for the idle status row splice (turns / tok / ms
   * from the projection). Undefined while the projection is absent or nothing
   * model-measured has landed yet — never painted as invented 0. The snapshot
   * is cached per emission like the other object-valued getters.
   * @returns the session-stats totals, or undefined.
   */
  getSessionStats(): { turns: number; decodeTokens: number; llmMs: number } | undefined {
    if (this.sessionStatsSnapshot === undefined) {
      this.sessionStatsSnapshot = this.buildSessionStats() ?? null
    }
    return this.sessionStatsSnapshot ?? undefined
  }

  /** Rebuild the session-stats splice; undefined while unmeasured. */
  private buildSessionStats(): { turns: number; decodeTokens: number; llmMs: number } | undefined {
    const session = this.session
    if (session === undefined) return undefined
    const projections = this.ctx.get('sessionProjections')
    if (projections === undefined) return undefined
    const stats = projections.snapshot(session).values.sessionStats
    if (stats === undefined || (stats.decodeTokens === 0 && stats.llmMs === 0)) {
      return undefined
    }
    return { turns: stats.turns, decodeTokens: stats.decodeTokens, llmMs: stats.llmMs }
  }

  /**
   * Return the tools registry for presenter titles. Undefined when the service
   * is not composed (tests without tools stay generic).
   * @returns the tools service, or undefined.
   */
  getToolPresenters(): ToolPresenterLookup | undefined {
    return this.ctx.get('tools')
  }

  /**
   * Return whether Enter sends a chat message.
   * @returns false when the `tui` section sets `submitOnEnter` to false.
   */
  getSubmitOnEnter(): boolean {
    const section = this.readTuiSettings?.()
      ?? (this.ctx.get('settings')?.get(TUI_SETTINGS_NS) as TuiUserSettings | undefined)
    return section?.submitOnEnter !== false
  }

  /**
   * Return the persisted generated-brand reveal mode.
   * @returns `auto` when no explicit value is configured.
   */
  getBrandAnimation(): 'auto' | 'on' | 'off' {
    const section = this.readTuiSettings?.()
      ?? (this.ctx.get('settings')?.get(TUI_SETTINGS_NS) as TuiUserSettings | undefined)
    return section?.brandAnimation ?? 'auto'
  }

  /**
   * Return whether the read-only timeline view is open.
   * @returns the Ctrl+T timeline toggle.
   */
  getTimelineOpen(): boolean {
    return this.timelineOpen
  }

  /**
   * Return transition progress or the latest failure/success feedback.
   * Transition progress wins until the transaction returns to idle.
   * @returns raw status-row text (escaped by the render layer).
   */
  getFeedback(): string | undefined {
    return transitionStatusText(this.transitionState) ?? this.feedback
  }

  /**
   * Composer draft restored when the root remounts after an external editor.
   * @returns the preserved draft text.
   */
  getComposerDraft(): string {
    return this.composerDraft
  }

  /**
   * Full structured draft restored from FIFO, including future image refs.
   * @returns the structured draft, or undefined when nothing is preserved.
   */
  getComposerStructuredDraft(): StructuredDraft | undefined {
    return this.composerStructuredDraft
  }

  /**
   * Immutable current-turn and FIFO draft state for the queue HUD.
   * @returns the frozen queue snapshot.
   */
  getDraftQueue(): DraftQueueSnapshot {
    const current = this.currentTurnSteer
    return Object.freeze({
      ...(current === undefined
        ? {}
        : { currentTurn: Object.freeze({ draft: current.draft, state: current.state }) }),
      fifo: Object.freeze([...this.draftFifo]),
    })
  }

  /** Force subscribers to rebuild every snapshot after a root remount. */
  redraw(): void {
    this.emit()
  }

  /**
   * Return the visible status for the controller-owned session transition.
   * Internal flushing/creating/resuming/binding phases map to one label per
   * immutable operation intent.
   * @returns exact create/switch progress copy, or undefined while idle.
   */
  getSessionTransitionStatus(): string | undefined {
    return transitionStatusText(this.transitionState)
  }

  /**
   * Subscribe to runtime updates.
   * @param callback - invoked after the view state changes.
   * @returns a disposer that removes the callback.
   */
  subscribe(callback: () => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /** Show one transient failure line; a later key or FEEDBACK_MS clears it. */
  private setFeedback(text: string): void {
    if (this.closed) return
    this.clearFeedback()
    this.feedback = text
    this.feedbackTimer = setTimeout(() => {
      this.feedback = undefined
      this.feedbackTimer = undefined
      this.emit()
    }, FEEDBACK_MS)
    this.emit()
  }

  /** Clear the feedback row and its timer (next-key rule, S4). */
  private clearFeedback(): void {
    this.feedback = undefined
    if (this.feedbackTimer !== undefined) {
      clearTimeout(this.feedbackTimer)
      this.feedbackTimer = undefined
    }
  }

  /** Whether the backend exposes the delete primitive (K6/S3 capability probe). */
  private deleteCapable(): boolean {
    const persistence = this.ctx.get('sessionPersistence')
    return persistence !== undefined && typeof persistence.delete === 'function'
  }

  /** Cancel delayed and in-flight search work and return its new request id. */
  private invalidateSearch(): number {
    if (this.searchTimer !== undefined) {
      clearTimeout(this.searchTimer)
      this.searchTimer = undefined
    }
    return ++this.searchSeq
  }

  /** Reset the search panel transients and invalidate every pending response. */
  private resetSearchState(): void {
    this.invalidateSearch()
    this.searchQuery = ''
    this.searchResults = []
    this.searchSelectedIndex = 0
    this.searchStatus = 'idle'
  }

  /** Reset the model panel transients (filter, rows, selection, phase). */
  private resetModelState(): void {
    this.modelFilter = ''
    this.modelRows = []
    this.modelSelectedIndex = 0
    this.modelStatus = 'idle'
    this.modelError = undefined
  }

  /**
   * Close every overlay panel and reset its transients (K2/S2 mutual
   * exclusion). The caller re-opens its own pane afterwards.
   */
  private closeOtherPanels(): void {
    this.listOpen = false
    this.searchOpen = false
    this.timelineOpen = false
    this.modelOpen = false
    this.helpOpen = false
    this.permissionOpen = false
    this.permissionConfirmDanger = false
    this.permissionSwitchError = undefined
    this.settingsOpen = false
    this.settingsEditing = false
    this.settingsOnboarding = false
    this.settingsUpdateError = undefined
    this.agentHubOpen = false
    this.resetAgentHub()
    this.planDirectoryOpen = false
    this.planDirectorySwitchError = undefined
    this.planDirectoryStatusError = undefined
    this.workspaceOpen = false
    this.feedbackOpen = false
    this.workflowOverlayOpen = false
    this.confirmDelete = false
    this.deleteUnavailable = false
    this.resetSearchState()
    this.resetModelState()
  }

  /**
   * Toggle one K2 overlay. Returns immediately while approval or ask-user is
   * open (K2′, maybeOpenOnboarding analog). Opening calls closeOtherPanels
   * first; the same overlay already open closes it (K20).
   * @param flag - the overlay boolean to toggle.
   */
  private toggleOverlay(
    flag: 'agentHubOpen' | 'workspaceOpen' | 'feedbackOpen' | 'workflowOverlayOpen',
  ): void {
    if (
      this.getApprovalPane().open
      || this.getAskUserPane().open
      || this.getPlanReviewPane().open
    ) return
    if (this[flag]) {
      this[flag] = false
      if (flag === 'agentHubOpen') this.resetAgentHub()
    } else {
      this.closeOtherPanels()
      this[flag] = true
    }
    this.emit()
  }

  /** Drop Hub transients; the caller owns `agentHubOpen` and emit(). */
  private resetAgentHub(): void {
    this.agentHubAbort?.abort()
    this.agentHubAbort = undefined
    this.agentHubRows = []
    this.agentHubSelectedIndex = 0
    this.agentHubView = 'table'
    this.agentHubError = undefined
    this.agentHubTranscript = undefined
    this.agentHubSeq += 1
  }

  /**
   * Cancel the prior Hub read and start one request tied to controller teardown.
   * @returns the request sequence and fused cancellation signal.
   */
  private beginAgentHubRequest(): { readonly seq: number; readonly signal: AbortSignal } {
    this.agentHubAbort?.abort()
    const abort = new AbortController()
    this.agentHubAbort = abort
    return {
      seq: ++this.agentHubSeq,
      signal: AbortSignal.any([this.lifecycleAbort.signal, abort.signal]),
    }
  }

  /**
   * List direct children of the live session into the Hub table. Missing
   * `subagents` leaves `missing` true on the snapshot (S19). A listing
   * rejection paints `无法列出子代理：{原因}`.
   */
  private async refreshAgentHub(): Promise<void> {
    const { seq, signal } = this.beginAgentHubRequest()
    this.agentHubView = 'table'
    this.agentHubTranscript = undefined
    this.agentHubError = undefined
    this.agentHubRows = []
    this.agentHubSelectedIndex = 0
    this.emit()
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined || this.session === undefined) return
    try {
      const entries = await subagents.listChildren(this.session.id, signal)
      const rows = await this.enrichAgentHubRows(entries, signal)
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubRows = rows
      this.agentHubError = undefined
      this.emit()
    } catch (error: unknown) {
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubRows = []
      this.agentHubError = `无法列出子代理：${errorReason(error)}`
      this.emit()
    }
  }

  /**
   * Replace the Hub table with the selected child's direct children.
   * @param childId - parent whose children become the table.
   */
  private async expandAgentHub(childId: string): Promise<void> {
    const { seq, signal } = this.beginAgentHubRequest()
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) return
    try {
      const entries = await subagents.listChildren(SessionId(childId), signal)
      const rows = await this.enrichAgentHubRows(entries, signal)
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubRows = rows
      this.agentHubSelectedIndex = 0
      this.agentHubError = undefined
      this.emit()
    } catch (error: unknown) {
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubError = `无法列出子代理：${errorReason(error)}`
      this.emit()
    }
  }

  /**
   * Preserve child identity rows, then enrich them through live projection or
   * cold-cache reads. A missing service or failed cold read omits metrics for
   * that row; the caller's request sequence decides whether the batch lands.
   * @param entries - subagent identity rows and diagnostics.
   * @returns render-owned child rows in listing order.
   */
  private async enrichAgentHubRows(
    entries: readonly SubagentListEntry[],
    signal: AbortSignal,
  ): Promise<AgentHubRow[]> {
    const now = Date.now()
    const rows = entries.flatMap((entry) => {
      const row = hubRowOf(entry)
      return row === undefined ? [] : [row]
    })
    const persistence = this.ctx.get('sessionPersistence')
    const cache = this.ctx.get('sessionProjectionCache')
    const coldHeaders = new Map<SessionId, SessionHeader>()
    if (persistence !== undefined && cache !== undefined
      && rows.some(row => this.ctx.sessions.get(row.id) === undefined)) {
      try {
        for (const header of await persistence.list(signal)) {
          coldHeaders.set(header.id, header)
        }
      } catch {
        signal.throwIfAborted()
      }
    }
    return Promise.all(rows.map(async (row) => {
      signal.throwIfAborted()
      let snapshot: ProjectionSnapshot | undefined
      const live = this.ctx.sessions.get(row.id)
      const projections = this.ctx.get('sessionProjections')
      if (live !== undefined) {
        if (projections === undefined) return row
        snapshot = projections.snapshot(live)
      } else {
        const header = coldHeaders.get(row.id)
        if (cache === undefined || persistence === undefined || header === undefined) return row
        try {
          snapshot = cache.cachedSnapshot(header, AGENT_HUB_PROJECTION_KEYS)
          if (snapshot === undefined) {
            const borrowed = await persistence.borrowSession(row.id, signal)
            try {
              signal.throwIfAborted()
              snapshot = cache.coldSnapshot(
                borrowed.inspection.meta,
                borrowed.inspection.events,
              )
            } finally {
              borrowed[Symbol.dispose]()
            }
          }
        } catch {
          signal.throwIfAborted()
          return row
        }
      }
      return { ...row, ...hubMetricsOf(snapshot.values, row.activity, now) }
    }))
  }

  /**
   * Open the inspect transcript for one child via sessionPersistence.inspect
   * without activating the child Agent. Failure stays in the transcript
   * subview so Esc returns to the table.
   * @param childId - durable child session id.
   */
  private async inspectAgentHub(childId: string): Promise<void> {
    const { seq, signal } = this.beginAgentHubRequest()
    this.agentHubView = 'transcript'
    this.agentHubTranscript = undefined
    this.agentHubError = undefined
    this.emit()
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      this.agentHubError = '无法读取子会话：会话持久化未组合'
      this.emit()
      return
    }
    try {
      const inspected = await persistence.inspect(SessionId(childId), signal)
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubTranscript = hubTranscriptOf(inspected.events)
      this.agentHubError = undefined
      this.emit()
    } catch (error: unknown) {
      if (!this.agentHubOpen || seq !== this.agentHubSeq) return
      this.agentHubError = `无法读取子会话：${errorReason(error)}`
      this.emit()
    }
  }

  /**
   * Dispatch one interaction action. Actions arriving before the first Agent
   * binds are retained in order; actions after teardown begins are ignored.
   * Asynchronous session, model, command, search, rename, delete, and export
   * operations become controller-owned work and settle after this method returns.
   * @param action - action requested by the render loop.
   */
  dispatch(action: LoopAction): void {
    if (this.closed) return
    if (this.agentHandle === undefined) {
      // Input before the agent exists: park it for the creation moment.
      this.pending.push(action)
      return
    }
    // Any keypress dismisses the feedback row (S4 next-key rule).
    this.clearFeedback()
    switch (action.kind) {
      case 'plan-review-scroll':
        // The loop owns the plan-review offset locally; this action never
        // reaches the controller, but the switch names it for exhaustiveness.
        return
      case 'intake-clipboard-image':
        // Resolved through the direct controller method in the loop owner.
        return
      case 'send':
        // Runtime-level no-op in front of the model request: an empty or
        // whitespace-only composer never reaches the Agent, so zero-arg boot
        // stays idle and Enter on the empty composer sends no followup. The
        // guard covers every send path (keymap, initial seed, parked input).
        if (action.text.trim() === '') return
        this.submitComposer(action.text)
        return
      case 'sigint':
        this.clearRetryFooter()
        this.reduce({ kind: 'sigint' })
        return
      case 'toggle-reasoning':
        this.reasoningExpanded = !this.reasoningExpanded
        this.emit()
        return
      case 'toggle-tool-cards':
        this.toolCardsExpanded = !this.toolCardsExpanded
        this.emit()
        return
      case 'copy-message':
        this.copyLatestMessage()
        return
      case 'edit-external':
        if (this.requestExternalEditor(
          action.text,
          (result) => { this.settleExternalEditor(result) },
        )) {
          this.composerDraft = action.text
        }
        return
      case 'take-queued-draft': {
        const draft = this.draftFifo.shift()
        if (draft === undefined) return
        if (this.draftFifo.length === 0) this.draftDrainReady = false
        this.composerStructuredDraft = draft
        this.composerDraft = this.draftToComposerText(draft)
        this.emit()
        return
      }
      case 'toggle-compaction-divider': {
        const divider = this.projector.snapshot().compactionDividers?.at(-1)
        if (divider === undefined) return
        this.expandedCompactionId = this.expandedCompactionId === divider.compactionId
          ? undefined
          : divider.compactionId
        this.emit()
        return
      }
      case 'scroll':
      case 'scroll-page':
      case 'scroll-edge':
        // Transcript navigation is consumed by TuiLoop's measured viewport.
        return
      case 'command':
        this.runCommand(action.query)
        return
      case 'session-pane':
        this.listOpen = !this.listOpen
        // Closing the list always drops an armed delete (Esc/Escape route).
        this.confirmDelete = false
        if (this.listOpen) {
          // Mutual exclusion (K2/S2): opening the list closes the other panes
          // and resets their transients.
          this.closeOtherPanels()
          this.listOpen = true
          this.deleteUnavailable = !this.deleteCapable()
          if (this.selectedIndex >= this.sessionList.length) {
            this.selectedIndex = Math.max(0, this.sessionList.length - 1)
          }
        }
        this.emit()
        return
      case 'search-pane':
        if (this.searchOpen) {
          this.searchOpen = false
          this.resetSearchState()
        } else {
          // Mutual exclusion: opening search closes the other panes.
          this.closeOtherPanels()
          this.searchOpen = true
        }
        this.emit()
        return
      case 'search':
        this.scheduleSearch(action.query)
        return
      case 'toggle-timeline':
        this.timelineOpen = !this.timelineOpen
        if (this.timelineOpen) {
          // Mutual exclusion: opening timeline closes the other panes.
          this.closeOtherPanels()
          this.timelineOpen = true
        }
        this.emit()
        return
      case 'model-pane':
        if (this.modelOpen) {
          this.modelOpen = false
          this.resetModelState()
        } else {
          this.openModelPane()
        }
        this.emit()
        return
      case 'model-move':
        if (this.filteredModelRows().length === 0) return
        this.modelSelectedIndex = Math.min(
          this.filteredModelRows().length - 1,
          Math.max(0, this.modelSelectedIndex + action.delta),
        )
        this.emit()
        return
      case 'model-filter':
        this.modelFilter = action.query
        this.modelSelectedIndex = 0
        this.emit()
        return
      case 'select-model':
        this.ownWork(this.switchModel(action.id), 'model selection')
        return
      case 'help-pane':
        if (this.helpOpen) {
          this.helpOpen = false
        } else {
          this.openHelpPane()
        }
        this.emit()
        return
      case 'help-scroll':
        // The loop owns the help-sheet window offset; nothing to route here.
        return
      case 'approval-allow':
        this.answerHead('allowed-once')
        return
      case 'approval-deny':
        this.answerHead('rejected')
        return
      case 'approval-detail': {
        const head = this.blockingHead()
        if (head?.kind !== 'approval') return
        head.entry.detailsOpen = !head.entry.detailsOpen
        this.emit()
        return
      }
      case 'ask-user-digit': {
        const head = this.askUserHead()
        if (head === undefined) return
        const count = askUserOptionCount(head)
        if (action.index < 0 || action.index >= count) return
        head.selectedIndex = action.index
        this.emit()
        return
      }
      case 'ask-user-move': {
        const head = this.askUserHead()
        if (head === undefined) return
        const count = askUserOptionCount(head)
        if (count === 0) return
        head.selectedIndex = Math.min(
          count - 1,
          Math.max(0, head.selectedIndex + action.delta),
        )
        this.emit()
        return
      }
      case 'ask-user-submit':
        this.submitAskUserHead()
        return
      case 'ask-user-cancel':
        this.cancelAskUserHead()
        return
      case 'plan-review-approve':
        this.submitPlanReview('Approve')
        return
      case 'plan-review-keep':
        this.submitPlanReview('Keep planning')
        return
      case 'permission-escape':
        if (!this.permissionOpen) return
        if (this.permissionConfirmDanger) {
          this.permissionConfirmDanger = false
          this.emit()
          return
        }
        this.permissionOpen = false
        this.permissionSwitchError = undefined
        this.emit()
        return
      case 'permission-move':
        if (!this.permissionOpen || this.permissionConfirmDanger) return
        if (this.permissionNames.length === 0) return
        this.permissionSelectedIndex = Math.min(
          this.permissionNames.length - 1,
          Math.max(0, this.permissionSelectedIndex + action.delta),
        )
        this.emit()
        return
      case 'permission-jump':
        if (!this.permissionOpen || this.permissionConfirmDanger) return
        if (action.index < 0 || action.index >= this.permissionNames.length) {
          return
        }
        this.permissionSelectedIndex = action.index
        this.emit()
        return
      case 'permission-apply': {
        if (!this.permissionOpen) return
        const selected = this.permissionNames[this.permissionSelectedIndex]
        if (selected === undefined) return
        if (selected === DANGER_PRESET && !this.permissionConfirmDanger) {
          this.permissionConfirmDanger = true
          this.emit()
          return
        }
        this.runCommand(`permission ${selected}`)
        return
      }
      case 'settings-escape':
        if (!this.settingsOpen) return
        if (this.settingsOnboarding) {
          this.settingsOnboarding = false
          this.settingsOpen = false
          this.settingsEditing = false
          this.settingsUpdateError = undefined
          this.setFeedback('✓ 已跳过引导')
          return
        }
        this.settingsOpen = false
        this.settingsEditing = false
        this.settingsUpdateError = undefined
        this.emit()
        return
      case 'settings-move':
        if (!this.settingsOpen || this.settingsEditing) return
        if (this.settingsRows.length === 0) return
        this.settingsSelectedIndex = Math.min(
          this.settingsRows.length - 1,
          Math.max(0, this.settingsSelectedIndex + action.delta),
        )
        this.emit()
        return
      case 'settings-edit':
        if (!this.settingsOpen) return
        this.settingsEditing = true
        this.settingsUpdateError = undefined
        this.emit()
        return
      case 'settings-cancel-edit':
        if (!this.settingsOpen) return
        if (this.settingsOnboarding) {
          this.settingsOnboarding = false
          this.settingsOpen = false
          this.settingsEditing = false
          this.settingsUpdateError = undefined
          this.setFeedback('✓ 已跳过引导')
          return
        }
        this.settingsEditing = false
        this.emit()
        return
      case 'settings-apply':
        this.applySettingsValue(action.value)
        return
      case 'settings-export':
        this.exportSettingsDocument()
        return
      case 'settings-reload':
        this.reloadSettingsRows()
        return
      case 'agent-hub':
        this.toggleOverlay('agentHubOpen')
        if (this.agentHubOpen) {
          this.ownWork(this.refreshAgentHub(), 'agent hub list')
        }
        return
      case 'agent-hub-escape':
        if (!this.agentHubOpen) return
        if (this.agentHubView === 'transcript') {
          this.agentHubAbort?.abort()
          this.agentHubAbort = undefined
          this.agentHubSeq += 1
          this.agentHubView = 'table'
          this.agentHubTranscript = undefined
          this.agentHubError = undefined
          this.emit()
          return
        }
        this.agentHubOpen = false
        this.resetAgentHub()
        this.emit()
        return
      case 'agent-hub-move':
        if (!this.agentHubOpen || this.agentHubView !== 'table') return
        if (this.agentHubRows.length === 0) return
        this.agentHubSelectedIndex = Math.min(
          this.agentHubRows.length - 1,
          Math.max(0, this.agentHubSelectedIndex + action.delta),
        )
        this.emit()
        return
      case 'agent-hub-enter':
        if (!this.agentHubOpen || this.agentHubView !== 'table') return
        {
          const row = this.agentHubRows[this.agentHubSelectedIndex]
          if (row === undefined) return
          if (row.hasChildren) {
            this.ownWork(this.expandAgentHub(row.id), 'agent hub expand')
            return
          }
          this.ownWork(this.inspectAgentHub(row.id), 'agent hub inspect')
        }
        return
      case 'workspace-pane': {
        const opening = !this.workspaceOpen
        this.toggleOverlay('workspaceOpen')
        if (opening) {
          this.workspaceSeq += 1
          this.workspaceEditing = false
          this.workspaceResolveError = undefined
          this.workspaceSelectedIndex = 0
          this.ownWork(this.loadWorkspaceRoot(this.workspaceSeq), 'workspace root listing')
        }
        return
      }
      case 'workspace-escape':
        if (!this.workspaceOpen) return
        this.workspaceOpen = false
        this.workspaceSeq += 1
        this.emit()
        return
      case 'workspace-move': {
        if (!this.workspaceOpen || this.workspaceEditing) return
        const rowCount = this.computeWorkspaceRows().length
        this.workspaceSelectedIndex = Math.min(
          Math.max(0, rowCount - 1),
          Math.max(0, this.workspaceSelectedIndex + action.delta),
        )
        this.emit()
        return
      }
      case 'workspace-enter': {
        if (!this.workspaceOpen || this.workspaceEditing) return
        const row = this.computeWorkspaceRows()[this.workspaceSelectedIndex]
        if (row === undefined) return
        if (row.kind === 'directory') {
          this.ownWork(this.toggleWorkspaceDirectory(row.target), 'workspace expand')
          return
        }
        if (row.kind === 'file') {
          // The loop already inserted the displayPath; close the overlay.
          this.workspaceOpen = false
          this.workspaceSeq += 1
          this.emit()
        }
        return
      }
      case 'workspace-edit':
        if (!this.workspaceOpen) return
        this.workspaceEditing = true
        this.workspaceResolveError = undefined
        this.emit()
        return
      case 'workspace-apply': {
        if (!this.workspaceOpen || !this.workspaceEditing) return
        this.workspaceEditing = false
        this.workspaceSeq += 1
        this.ownWork(
          this.applyWorkspacePath(action.value, this.workspaceSeq),
          'workspace path resolve',
        )
        this.emit()
        return
      }
      case 'workspace-cancel-edit':
        if (!this.workspaceOpen) return
        this.workspaceEditing = false
        this.emit()
        return
      case 'feedback-pane': {
        const opening = !this.feedbackOpen
        this.toggleOverlay('feedbackOpen')
        if (opening) {
          this.feedbackSeq += 1
          this.feedbackTargetId = this.lastAssistantMessageId
          this.feedbackCurrent = undefined
          this.feedbackEditing = false
          this.feedbackWriteError = undefined
          this.ownWork(this.refreshFeedbackCurrent(this.feedbackSeq), 'feedback list')
        }
        return
      }
      case 'feedback-escape':
        if (!this.feedbackOpen) return
        this.feedbackOpen = false
        this.feedbackSeq += 1
        this.feedbackEditing = false
        this.emit()
        return
      case 'feedback-rate':
        if (!this.feedbackOpen || this.feedbackEditing) return
        this.ownWork(
          this.applyFeedback(action.rating, undefined, this.feedbackSeq),
          'feedback rating',
        )
        return
      case 'feedback-note-edit':
        if (!this.feedbackOpen) return
        this.feedbackEditing = true
        this.emit()
        return
      case 'feedback-note-apply':
        if (!this.feedbackOpen || !this.feedbackEditing) return
        this.feedbackEditing = false
        this.ownWork(
          this.applyFeedback(this.feedbackCurrent?.rating ?? 'positive', action.value, this.feedbackSeq),
          'feedback note',
        )
        this.emit()
        return
      case 'feedback-note-cancel':
        if (!this.feedbackOpen) return
        this.feedbackEditing = false
        this.emit()
        return
      case 'workflow-overlay':
        this.toggleOverlay('workflowOverlayOpen')
        return
      case 'workflow-overlay-escape':
        if (!this.workflowOverlayOpen) return
        this.workflowOverlayOpen = false
        this.emit()
        return
      case 'workflow-overlay-scroll': {
        if (!this.workflowOverlayOpen) return
        const memberCount = this.workflowRun?.members.size ?? 0
        const maxOffset = Math.max(0, memberCount - WORKFLOW_OVERLAY_WINDOW)
        this.workflowOverlayOffset = Math.min(
          maxOffset,
          Math.max(0, this.workflowOverlayOffset + action.delta),
        )
        this.emit()
        return
      }
      case 'plan-directory':
        return
      case 'plan-directory-escape':
        if (!this.planDirectoryOpen) return
        this.planDirectoryOpen = false
        this.planDirectorySwitchError = undefined
        this.planDirectoryStatusError = undefined
        this.emit()
        return
      case 'plan-directory-move':
        if (!this.planDirectoryOpen || this.planDirectoryStatusError !== undefined) {
          return
        }
        this.planDirectorySelectedIndex = Math.min(
          1,
          Math.max(0, this.planDirectorySelectedIndex + action.delta),
        )
        this.emit()
        return
      case 'plan-directory-apply': {
        if (!this.planDirectoryOpen || this.planDirectoryStatusError !== undefined) {
          return
        }
        this.executeSlash(
          this.planDirectorySelectedIndex === 0 ? 'plan' : 'plan off',
        )
        return
      }
      case 'timeline-scroll':
        // The loop owns the timeline window offset; nothing to route here.
        return
      case 'session-pane-idle':
        // A non-command key in list mode only cancels an armed delete.
        this.confirmDelete = false
        this.emit()
        return
      case 'session-pane-move':
        if (this.searchOpen) {
          if (this.searchResults.length === 0) return
          this.searchSelectedIndex = Math.min(
            this.searchResults.length - 1,
            Math.max(0, this.searchSelectedIndex + action.delta),
          )
          this.emit()
          return
        }
        if (this.sessionList.length === 0) return
        this.selectedIndex = Math.min(
          this.sessionList.length - 1,
          Math.max(0, this.selectedIndex + action.delta),
        )
        this.confirmDelete = false
        this.emit()
        return
      case 'new-session':
        this.ownWork(this.createNewSession(), 'new session transition')
        return
      case 'select-session':
        this.ownWork(this.switchSession(action.id), 'session switch transition')
        return
      case 'rename-session':
        this.ownWork(this.renameSelected(action.title), 'session rename')
        return
      case 'delete-session':
        this.ownWork(this.deleteSelected(), 'session deletion')
        return
      /* v8 ignore next -- LoopAction is closed; retain compile-time exhaustiveness. */
      default:
        assertNever(action, 'LoopAction')
    }
  }

  private nextImageToken = 1
  /** Memory-only intake payloads keyed by composer token id; never serialized. */
  private readonly pendingImages = new Map<number, { data: Uint8Array; mediaType: ImageMediaType; name?: string }>()
  /** Token -> durable ref for taken-back images so resubmission never re-saves. */
  private readonly tokenRefs = new Map<number, ImageAttachmentRef>()
  private readonly refTokens = new Map<ImageAttachmentRef, number>()
  /** Freeze one text-only draft; TERM-06 appends image segments to this model. */
  private createDraft(text: string): StructuredDraft {
    const segments: readonly StructuredDraftSegment[] = Object.freeze([
      Object.freeze({ kind: 'text' as const, text }),
    ])
    return Object.freeze({ draftId: this.nextDraftId++, segments })
  }

  /** Materialize one immutable draft into the existing durable user-message vocabulary. */
  private messageFromDraft(draft: StructuredDraft): ReturnType<typeof createUserMessage> {
    const content: ContentBlock[] = draft.segments.map(segment => segment.kind === 'text'
      ? { type: 'text', text: segment.text }
      : { type: 'image', attachment: segment.ref })
    return createUserMessage({ content, source: { kind: 'user' } })
  }

  /** Replace the visible retry wait with one newly admitted durable record. */
  private startRetryFooter(data: LlmRetryEventData): void {
    this.clearRetryFooter()
    this.retryFooter = {
      retryId: data.retryId,
      retry: data.retry,
      ...(data.mode === 'normal' ? { maxRetries: data.maxRetries } : {}),
      retryUntil: Date.now() + data.delayMs,
      failureCode: data.failure.code,
    }
    this.armRetryFooterTimer()
  }

  /** Refresh only while a retry is visible; expiry removes the state and timer. */
  private armRetryFooterTimer(): void {
    const retry = this.retryFooter
    if (retry === undefined || this.closed) return
    const remaining = retry.retryUntil - Date.now()
    const delay = Math.max(1, Math.min(250, remaining))
    this.retryFooterTimer = setTimeout(() => {
      this.retryFooterTimer = undefined
      if (this.closed || this.retryFooter !== retry) return
      if (Date.now() >= retry.retryUntil) this.retryFooter = undefined
      else this.armRetryFooterTimer()
      this.emit()
    }, delay)
  }

  /** Remove retry visibility and its single refresh timer. */
  private clearRetryFooter(): void {
    this.retryFooter = undefined
    if (this.retryFooterTimer !== undefined) {
      clearTimeout(this.retryFooterTimer)
      this.retryFooterTimer = undefined
    }
  }

  /**
   * Record the turn ending for the run-settled summary; the `every-turn` escape
   * hatch additionally pops one desktop notification per turn end.
   * @param reason - the `turn/end` reason that just landed.
   */
  private notifyTurnEnd(reason: TurnEndReason): void {
    const errorText = reason.kind === 'error' ? reason.error.message : undefined
    const abortCause = reason.kind === 'aborted' ? reason.reason : undefined
    this.lastTurnEnd = {
      kind: reason.kind,
      ...(abortCause === undefined ? {} : { abortCause }),
      ...(errorText === undefined ? {} : { errorText }),
    }
    if (this.notifySettings().mode !== 'every-turn') return
    this.deliverNotify(decideNotify({
      kind: 'idle',
      settings: this.notifySettings(),
      secondsSinceLastInput: this.secondsSinceLastInput(),
      turnEndReason: reason.kind,
      ...(abortCause === undefined ? {} : { abortCause }),
      ...(errorText === undefined ? {} : { errorText }),
      sessionTitle: this.notifySessionTitle(),
    }))
  }

  /**
   * Notify (or stay silent) for the run settling to idle, using the last
   * recorded turn ending as the summary source. Attention mode only: the
   * `every-turn` escape hatch already popped once per turn end, so a settled
   * summary there would double-notify. Nothing to summarize means nothing to
   * say.
   */
  private notifyRunSettled(): void {
    if (this.notifySettings().mode !== 'attention') return
    const last = this.lastTurnEnd
    this.lastTurnEnd = undefined
    if (last === undefined) return
    this.deliverNotify(decideNotify({
      kind: 'idle',
      settings: this.notifySettings(),
      secondsSinceLastInput: this.secondsSinceLastInput(),
      turnEndReason: last.kind,
      ...(last.abortCause === undefined ? {} : { abortCause: last.abortCause }),
      ...(last.errorText === undefined ? {} : { errorText: last.errorText }),
      sessionTitle: this.notifySessionTitle(),
    }))
  }

  /**
   * Notify for one blocking attention ask (approval or ask-user) the moment it
   * enqueues; these never wait for the run to settle.
   * @param input - the ask kind plus its summary source text.
   */
  private notifyAttention(input: { kind: 'approval' | 'ask-user'; toolName?: string | undefined; questionText?: string | undefined }): void {
    this.deliverNotify(decideNotify({
      kind: input.kind,
      settings: this.notifySettings(),
      secondsSinceLastInput: this.secondsSinceLastInput(),
      toolName: input.toolName,
      questionText: input.questionText,
      sessionTitle: this.notifySessionTitle(),
    }))
  }

  /**
   * Write one decision through the detected transport ladder: silence does
   * nothing, bell-only writes BEL, and a desktop decision writes the transport
   * bytes plus the literal helper on fallback terminals.
   * @param decision - the decision from {@link decideNotify}.
   */
  private deliverNotify(decision: NotifyDecision): void {
    if (decision === undefined) return
    if (!decision.desktop) {
      this.io.stdout.write(notifyBytes('bell'))
      return
    }
    const transport = detectNotifyCapability(internals.notifyEnvironment)
    if (transport === 'bell') {
      this.io.stdout.write(notifyBytes('bell'))
      try {
        internals.notifySpawn('notify-send', ['-u', decision.urgency, decision.title, decision.body])
      } catch {
        // The literal helper is the optional final fallback; spawn failure does not affect the turn.
      }
      return
    }
    this.io.stdout.write(notifyBytes(transport, `${decision.title} ${decision.body}`, decision.titleSuffix))
  }

  /** Resolve the notification settings section, defaulting when no section is stored. */
  private notifySettings(): NotifySettings {
    const section = this.readTuiSettings?.()
      ?? (this.ctx.get('settings')?.get(TUI_SETTINGS_NS) as TuiUserSettings | undefined)
    return {
      mode: section?.notify ?? 'attention',
      quietInputSeconds: section?.notifyQuietInputSeconds ?? DEFAULT_NOTIFY_QUIET_INPUT_SECONDS,
    }
  }

  /** Seconds since the most recent local keypress, for the quiet window. */
  private secondsSinceLastInput(): number {
    return (Date.now() - this.lastInputAt) / 1000
  }

  /**
   * Session display title for notification bodies; undefined when the user
   * never produced a useful title. Prefers the persisted title from the
   * session log and falls back to the deterministic first-user-text title so
   * the notification always carries a session identifier when one is
   * available — the stricter top-bar policy (which suppresses fallback
   * titles while a user message is on screen) intentionally omits the suffix
   * in those cases and is not appropriate here.
   */
  private notifySessionTitle(): string | undefined {
    return this.session === undefined ? undefined : notifySessionTitle(this.session.events)
  }

  /** Record local user input for the notification quiet window. */
  noteUserActivity(): void {
    this.lastInputAt = Date.now()
  }

  /**
   * Surface one transient status line through the image-intake refusal channel.
   * @param text - fixed user-visible feedback.
   */
  note(text: string): void {
    this.setFeedback(text)
  }

  private static readonly IMAGE_MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }

  private attachmentStore(): {
    imageLimits: { maxImageBytes: number }
    validateImage(input: { data: Uint8Array; mediaType: ImageMediaType; name?: string }): Promise<void>
    saveImages(inputs: readonly { data: Uint8Array; mediaType: ImageMediaType; name?: string }[]): Promise<readonly ImageAttachmentRef[]>
  } | undefined {
    const store = (this.ctx as unknown as { get(key: string): unknown }).get('attachments')
    return store as ReturnType<RuntimeController['attachmentStore']> | undefined
  }

  private tokenText(id: number): string {
    return `[图片 #${String(id)}]`
  }

  /**
   * Admit one local image file into the composer as a pending token. Refuses
   * directories, symlinks, unknown extensions, control characters, and
   * over-limit bytes without touching durable storage.
   * @param raw - pasted or typed path, optionally wrapped in one quote pair.
   * @returns the admitted image token or a user-visible refusal reason.
   */
  async intakeImagePath(raw: string): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    let candidate = raw.trim()
    if (candidate.length >= 2
      && ((candidate.startsWith('"') && candidate.endsWith('"'))
        || (candidate.startsWith("'") && candidate.endsWith("'")))) {
      candidate = candidate.slice(1, -1).trim()
    }
    if (candidate === '' || /[\u0000-\u001f]/.test(candidate)) {
      return { ok: false, reason: '不是可用的图片路径' }
    }
    const info = await lstat(candidate).catch(() => undefined)
    if (info === undefined) return { ok: false, reason: '文件不存在' }
    if (info.isSymbolicLink()) return { ok: false, reason: '符号链接已拒绝' }
    if (!info.isFile()) return { ok: false, reason: '不是普通文件' }
    const extension = candidate.slice(candidate.lastIndexOf('.')).toLowerCase()
    const mediaType = RuntimeController.IMAGE_MEDIA_TYPES[extension]
    if (mediaType === undefined) return { ok: false, reason: '不支持的图片类型' }
    const store = this.attachmentStore()
    const limit = store?.imageLimits.maxImageBytes ?? 10 * 1024 * 1024
    if (info.size > limit) return { ok: false, reason: '图片超过大小上限' }
    const file = candidate.replace(/\\/g, '/').split('/').at(-1)
    const name = file === undefined ? undefined : file
    const data = new Uint8Array(await readFile(candidate))
    const admission = name === undefined
      ? { data, mediaType }
      : { data, mediaType, name }
    try {
      await store?.validateImage(admission)
    } catch (error) {
      return { ok: false, reason: errorReason(error) }
    }
    const id = this.nextImageToken++
    this.pendingImages.set(id, {
      data,
      mediaType,
      ...(name === undefined ? {} : { name }),
    })
    return { ok: true, token: this.tokenText(id) }
  }

  /**
   * Read one clipboard image through the platform helper (wl-paste on
   * Wayland, xclip elsewhere on X11); every failure maps to one locked
   * refusal reason and nothing is stored until send-time admission.
   * @returns the admitted image token or a user-visible refusal reason.
   */
  async intakeClipboardImage(): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
    const helper = clipboardHelperCommand()
    if (helper === undefined) return { ok: false, reason: '剪贴板助手缺失' }
    const [command] = helper
    if (command === undefined) return { ok: false, reason: '剪贴板助手缺失' }
    const child = internals.clipboardSpawn(command, helper.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    let received = 0
    const store = this.attachmentStore()
    const limit = store?.imageLimits.maxImageBytes ?? 10 * 1024 * 1024
    child.stdout.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received <= limit) chunks.push(chunk)
    })
    const closed = await new Promise<number | null | NodeJS.ErrnoException>((resolve) => {
      child.on('error', (error: NodeJS.ErrnoException) => {
        resolve(error)
      })
      child.on('close', (code) => {
        resolve(code)
      })
    })
    if (closed instanceof Error) {
      return closed.code === 'ENOENT'
        ? { ok: false, reason: '剪贴板助手缺失' }
        : { ok: false, reason: '剪贴板读取失败' }
    }
    if (closed !== 0) return { ok: false, reason: '剪贴板读取失败' }
    if (received === 0) return { ok: false, reason: '剪贴板中没有图片' }
    if (received > limit) return { ok: false, reason: '图片超过大小上限' }
    const data = new Uint8Array(Buffer.concat(chunks))
    try {
      await store?.validateImage({ data, mediaType: 'image/png' })
    } catch (error) {
      return { ok: false, reason: errorReason(error) }
    }
    const id = this.nextImageToken++
    this.pendingImages.set(id, { data, mediaType: 'image/png' })
    return { ok: true, token: this.tokenText(id) }
  }

  /** Composer text for one structured draft: image segments render as tokens. */
  private draftToComposerText(draft: StructuredDraft): string {
    let out = ''
    for (const segment of draft.segments) {
      if (segment.kind === 'text') {
        out += segment.text
        continue
      }
      let id = this.refTokens.get(segment.ref)
      if (id === undefined) {
        id = this.nextImageToken++
        this.refTokens.set(segment.ref, id)
        this.tokenRefs.set(id, segment.ref)
      }
      out += this.tokenText(id)
    }
    return out
  }

  /**
   * Submit composer text. Plain text keeps the synchronous legacy path;
   * token-bearing text admits every pending image in one atomic batch (or
   * reuses the durable ref of a taken-back image), preserving composer order.
   */
  private submitComposer(text: string): void {
    if (!IMAGE_TOKEN_PATTERN.test(text)) {
      this.composerDraft = ''
      this.composerStructuredDraft = undefined
      this.submitDraft(this.createDraft(text))
      return
    }
    void this.submitComposerWithImages(text)
  }

  private async submitComposerWithImages(text: string): Promise<void> {
    const parts: Array<{ kind: 'text'; text: string } | { kind: 'image'; id: number }> = []
    let cursor = 0
    for (const match of text.matchAll(IMAGE_TOKEN_GLOBAL)) {
      const index = match.index
      if (index > cursor) parts.push({ kind: 'text', text: text.slice(cursor, index) })
      parts.push({ kind: 'image', id: Number(match[1]) })
      cursor = index + match[0].length
    }
    if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) })
    const store = this.attachmentStore()
    const unsaved = [...new Set(parts
      .filter((part): part is { kind: 'image'; id: number } =>
        part.kind === 'image' && !this.tokenRefs.has(part.id))
      .filter(part => this.pendingImages.has(part.id)))]
    if (unsaved.length > 0 && store === undefined) {
      this.setFeedback('附件服务未组合，图片未发送')
      return
    }
    const saved = new Map<number, ImageAttachmentRef>()
    if (unsaved.length > 0 && store !== undefined) {
      try {
        const batch = unsaved.map((part) => {
          const pending = this.pendingImages.get(part.id)
          if (pending === undefined) throw new Error('pending image vanished before admission')
          const input = pending.name === undefined
            ? { data: pending.data, mediaType: pending.mediaType }
            : { data: pending.data, mediaType: pending.mediaType, name: pending.name }
          return { id: part.id, input }
        })
        const refs = await store.saveImages(batch.map(entry => entry.input))
        batch.forEach(({ id }, index) => {
          const ref = refs[index]
          if (ref !== undefined) {
            saved.set(id, ref)
            this.tokenRefs.set(id, ref)
            this.refTokens.set(ref, id)
          }
        })
      } catch (error) {
        this.setFeedback(`图片未发送：${errorReason(error)}`)
        return
      }
    }
    const segments: StructuredDraftSegment[] = []
    for (const part of parts) {
      if (part.kind === 'text') {
        if (part.text !== '') segments.push({ kind: 'text', text: part.text })
        continue
      }
      const ref = this.tokenRefs.get(part.id)
      if (ref === undefined) {
        segments.push({ kind: 'text', text: this.tokenText(part.id) })
        continue
      }
      const pending = this.pendingImages.get(part.id)
      segments.push({ kind: 'image', ref, ...(pending?.name === undefined ? {} : { name: pending.name }) })
    }
    for (const part of parts) {
      if (part.kind === 'image') this.pendingImages.delete(part.id)
    }
    this.composerDraft = ''
    this.composerStructuredDraft = undefined
    this.submitDraft(Object.freeze({
      draftId: this.nextDraftId++,
      segments: Object.freeze(segments.map(segment => Object.freeze(segment))),
    }))
  }

  /** Route one composer submission to ordinary follow-up, steer, or later FIFO. */
  private submitDraft(draft: StructuredDraft): void {
    if (this.machine !== 'generating') {
      this.reduce({ kind: 'send', draft })
      return
    }
    if (this.currentTurnSteer === undefined) {
      const message = this.messageFromDraft(draft)
      this.currentTurnSteer = {
        draft,
        messageId: message.id,
        state: 'handoff',
        transcriptSeen: false,
      }
      this.agentHandle?.steer(message)
      this.setFeedback('已引导当前回合')
      return
    }
    this.draftFifo.push(draft)
    this.emit()
  }

  /** Replace the current steer phase only for its exact host message identity. */
  private markSteerState(messageId: MessageId, state: 'inserted' | 'claimed'): void {
    const current = this.currentTurnSteer
    if (current === undefined || current.messageId !== messageId) return
    this.currentTurnSteer = { ...current, state }
    this.emit()
  }

  /** Record the durable user/message handoff for the exact current steer. */
  private markDraftTranscript(messageId: MessageId): void {
    const current = this.currentTurnSteer
    if (current === undefined || current.messageId !== messageId) return
    this.currentTurnSteer = { ...current, transcriptSeen: true }
  }

  /** Settle the current steer at turn/end and promote exactly one FIFO head. */
  private settleDraftTurn(): void {
    const current = this.currentTurnSteer
    if (current !== undefined) {
      this.currentTurnSteer = undefined
      if (!current.transcriptSeen) {
        this.agent?.inbox.remove(current.messageId)
        this.setFeedback('当前回合未采纳草稿')
      }
    }
    this.draftDrainReady = this.draftFifo.length > 0
  }

  /** Promote one FIFO head only after the real Agent reports idle. */
  private drainDraftFifo(): void {
    if (!this.draftDrainReady) return
    this.draftDrainReady = false
    this.reduce({ kind: 'send', draft: this.draftFifo.shift() as StructuredDraft })
  }

  /** Copy the latest assistant row or its final fenced code body. */
  private copyLatestMessage(): void {
    const target = latestAssistantCopyTarget(this.projector.snapshot().history)
    if (target === undefined) {
      this.setFeedback('无消息可复制')
      return
    }
    const payload = target.text.slice(0, OSC52_MAX_CHARS)
    internals.copyText(payload, (chunk) => { this.io.stdout.write(chunk) })
    this.setFeedback(target.kind === 'code' ? '已复制代码块' : '已复制最近消息')
  }

  /** Apply one root-owned editor settlement without touching dialog state. */
  private settleExternalEditor(result: ExternalEditorSettlement): void {
    switch (result.kind) {
      case 'success':
        this.composerDraft = result.text
        this.emit()
        return
      case 'unconfigured':
        this.setFeedback('未配置编辑器 · 请设置 $VISUAL 或 $EDITOR')
        return
      case 'unchanged':
        this.setFeedback('✗ 编辑器退出非零 · 输入未变')
        return
      case 'error':
        this.setFeedback(`✗ 无法打开编辑器：${result.reason}`)
        return
      /* v8 ignore next -- ExternalEditorSettlement is closed; retain compile-time exhaustiveness. */
      default:
        assertNever(result, 'ExternalEditorSettlement')
    }
  }

  /**
   * Request direct exit for SIGTERM/SIGHUP. A closed controller ignores the
   * request; otherwise it bypasses stop-generation and enters the root effect's
   * single-flight exit path.
   */
  dispatchExit(): void {
    if (this.closed) return
    this.clearRetryFooter()
    this.machine = 'exit-armed'
    this.reduce({ kind: 'sigint' })
  }

  /**
   * Create or resume the live agent, then drain parked input and the optional
   * initial task. An empty task sends nothing and leaves the loop idle. The
   * promise resolves after binding and dispatch, not after the initial turn.
   * @returns a promise that settles after initial binding and input dispatch.
   * @throws when required services are absent or fresh Session creation fails;
   * resume failure is reported through the configured process effects.
   */
  async start(): Promise<void> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      throw new Error(
        'tui-runtime: core services are unavailable before the tree mounts',
      )
    }
    await this.createOrResume()
    if (this.closed || this.agentHandle === undefined) return
    this.installTuiSettings()
    if (this.config.task === '') await this.maybeOpenOnboarding()
    this.emit()
    this.ownWork(this.refreshList(), 'session list refresh')
    const parked = this.pending
    this.pending = []
    for (const action of parked) this.dispatch(action)
    if (this.config.task !== '') {
      this.dispatch({ kind: 'send', text: this.config.task })
    }
  }

  /** Bind the live session: `--resume` rebuilds it, otherwise create fresh. */
  private async createOrResume(): Promise<void> {
    const resumeId = this.config.resume
    if (resumeId === undefined) {
      await this.transitionSession({ intent: 'create' }, true)
      return
    }
    try {
      await this.transitionSession(
        { intent: 'switch', id: SessionId(resumeId) },
        true,
      )
    } catch (error: unknown) {
      fail(
        this.io,
        new Error(`cannot resume session "${resumeId}": ${errorReason(error)}`),
      )
    }
  }

  /**
   * Enter the single-flight session-transition slot. The first request owns the
   * immutable intent; repeated create or switch requests receive its promise
   * until all commit, rollback, and cleanup work settles.
   * @param request - create intent or validated persisted Session identity.
   * @param startup - whether a pre-commit failure must reject startup instead of
   * becoming transient feedback.
   * @returns the shared in-flight transition promise.
   */
  private transitionSession(
    request: SessionTransitionRequest,
    startup = false,
  ): Promise<void> {
    if (this.transitionInFlight !== undefined) {
      return this.transitionInFlight
    }
    // Install the single-flight Promise before the first phase emits. A
    // synchronous subscriber cannot re-enter between that emit and ownership
    // of the operation becoming visible.
    const operation = Promise.resolve().then(
      () => this.performSessionTransition(request, startup),
    )
    this.transitionInFlight = operation
    void operation.then(
      () => {
        this.transitionInFlight = undefined
      },
      () => {
        this.transitionInFlight = undefined
      },
    )
    return operation
  }

  /**
   * Flush the old Session, allocate and replay a candidate, commit the new bound
   * tuple, then dispose the old handle. Any pre-commit failure restores the old
   * tuple and disposes the unpublished candidate; startup rejects, while an
   * interactive request reports failure and keeps the old Session usable.
   * @param request - immutable create or switch intent that won single-flight.
   * @param startup - whether failure propagates to startup.
   */
  private async performSessionTransition(
    request: SessionTransitionRequest,
    startup: boolean,
  ): Promise<void> {
    const previous = this.captureBoundState()
    let candidate: AgentHandle | undefined
    try {
      try {
        this.setTransition({ phase: 'flushing', intent: request.intent })
        await this.flushSession(previous.session)
        this.setTransition({
          phase: request.intent === 'create' ? 'creating' : 'resuming',
          intent: request.intent,
        })
        const allocated = await this.allocateCandidate(request)
        candidate = allocated.handle
        const projector = createProjector()
        projector.seed(candidate.agent.session.events)
        this.setTransition({ phase: 'binding', intent: request.intent })
        this.commitCandidate({ ...allocated, projector })
      } catch (primaryError: unknown) {
        this.restoreBoundState(previous)
        let reportedError = primaryError
        if (candidate !== undefined) {
          try {
            await candidate.dispose()
          } catch (disposeError: unknown) {
            reportedError = new AggregateError(
              [primaryError, disposeError],
              errorReason(primaryError),
            )
            this.ctx.logger.warn(
              `candidate rollback failed after ${request.intent}: primary=${errorReason(primaryError)}; cleanup=${errorReason(disposeError)}`,
            )
          }
        }
        if (startup) throw reportedError
        this.ctx.logger.warn(
          `session ${request.intent} failed: ${errorReason(primaryError)}`,
        )
        this.setFeedback(
          request.intent === 'create'
            ? '✗ 新建会话失败（当前会话保持可用）'
            : `✗ 切换失败：${errorReason(primaryError)}（当前会话保持可用）`,
        )
        return
      }

      if (previous.liveHandle !== undefined) {
        try {
          await previous.liveHandle.dispose()
        } catch (error: unknown) {
          this.ctx.logger.warn(
            `old session disposal after ${request.intent} failed: ${errorReason(error)}`,
          )
        }
      }
      if (!startup) {
        this.setFeedback(
          request.intent === 'create' ? '✓ 已新建会话' : '✓ 已切换会话',
        )
      }
      await this.refreshList(this.session?.id)
    } finally {
      this.setTransition(IDLE_TRANSITION)
    }
  }

  /** Allocate an unpublished handle and its operation-local model selection. */
  private async allocateCandidate(
    request: SessionTransitionRequest,
  ): Promise<Omit<PreparedCandidate, 'projector'>> {
    const agents = this.ctx.get('agents')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (agents === undefined || defaultModel === undefined) {
      throw new Error(
        'tui-runtime: core services are unavailable before the tree mounts',
      )
    }
    const selection = defaultModel.currentSelection()
    const ref: ModelSelectionRef = {
      current: selection,
      assembled: undefined,
    }
    const setup = (agentCtx: Context): void => {
      installModelSelection(agentCtx, ref)
    }
    const agentOptions = {
      provider: selection.provider,
      model: selection.model,
    }
    const handle = request.intent === 'create'
      ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: this.config.cwd ?? process.cwd() },
        agentOptions,
        setup,
        signal: this.lifecycleAbort.signal,
      })
      : await agents.resume({
        resumeSessionId: request.id,
        agentOptions,
        setup,
        signal: this.lifecycleAbort.signal,
      })
    return {
      handle,
      modelSelectionRef: ref,
      badge: `${selection.provider} · ${selection.model}`,
    }
  }

  /** Publish the fully replayed handle/projector/session tuple synchronously. */
  private commitCandidate(candidate: PreparedCandidate): void {
    this.cancelQueuedApprovals()
    this.cancelQueuedAskUsers()
    this.currentTurnSteer = undefined
    this.draftFifo.length = 0
    this.draftDrainReady = false
    this.expandedCompactionId = undefined
    this.clearRetryFooter()
    const agent = candidate.handle.agent
    const previousCommandAbort = this.commandAbort
    this.liveHandle = candidate.handle
    this.agent = agent
    this.bindUserQuestions(agent)
    this.agentHandle = {
      followup: (message) => { agent.followup(message) },
      steer: (message) => { agent.steer(message) },
      cancel: () => { agent.cancel({ kind: 'user' }) },
    }
    this.session = agent.session
    this.projector = candidate.projector
    this.modelSelectionRef = candidate.modelSelectionRef
    this.badge = candidate.badge
    this.machine = 'idle'
    const selectedIndex = this.sessionList.findIndex(row => row.id === agent.session.id)
    if (selectedIndex >= 0) this.selectedIndex = selectedIndex
    this.closeOtherPanels()

    // A command issued against the previous agent must not settle against
    // the newly bound one (or a disposed handle): abort the in-flight
    // request and bump the seq so its rejection is dropped by the guard
    // instead of flashing a misleading ✗ row over the new session.
    try {
      previousCommandAbort?.abort()
    } catch (error: unknown) {
      this.ctx.logger.warn(`previous command cancellation failed: ${errorReason(error)}`)
    }
    this.commandSeq++
  }

  /** Snapshot every field that constitutes the bound controller tuple. */
  private captureBoundState(): BoundSnapshot {
    return {
      liveHandle: this.liveHandle,
      agent: this.agent,
      agentHandle: this.agentHandle,
      session: this.session,
      projector: this.projector,
      modelSelectionRef: this.modelSelectionRef,
      badge: this.badge,
      machine: this.machine,
    }
  }

  /** Restore the prior tuple after any pre-commit failure. */
  private restoreBoundState(snapshot: BoundSnapshot): void {
    this.liveHandle = snapshot.liveHandle
    this.agent = snapshot.agent
    this.agentHandle = snapshot.agentHandle
    this.session = snapshot.session
    this.projector = snapshot.projector
    this.modelSelectionRef = snapshot.modelSelectionRef
    this.badge = snapshot.badge
    this.machine = snapshot.machine
  }

  /** Publish one internal phase change to the render loop. */
  private setTransition(state: SessionTransitionState): void {
    this.transitionState = state
    this.emit()
  }

  /** Flush one exact pre-transition session without consulting mutable state. */
  private async flushSession(session: Session | undefined): Promise<void> {
    if (session === undefined) return
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    await sessions.flush(session)
  }

  /** Ctrl+N: join or start the serialized create transaction. */
  private async createNewSession(): Promise<void> {
    await this.transitionSession({ intent: 'create' })
  }

  /** Enter on a listed row: join or start the serialized switch transaction. */
  private async switchSession(rawId: string): Promise<void> {
    const id = SessionId(rawId)
    if (this.session !== undefined && this.session.id === id) {
      this.listOpen = false
      this.searchOpen = false
      this.confirmDelete = false
      this.emit()
      return
    }
    await this.transitionSession({ intent: 'switch', id })
  }

  /**
   * Rename the selected persisted identity. The exact live Session is renamed
   * in memory and flushed; every other row uses cold persistence without resume
   * or publication. Failure preserves the prior title and emits a reason-bearing
   * feedback row.
   * @param title - replacement title for the selected row.
   */
  private async renameSelected(title: string): Promise<void> {
    const row = this.sessionList[this.selectedIndex]
    if (row === undefined) return
    const titles = this.ctx.get('sessionTitle')
    if (titles === undefined) return
    const id = SessionId(row.id)
    const bound = this.session
    const live = bound !== undefined
      && bound.id === id
      && this.liveHandle?.agent.session === bound
      && this.ctx.sessions.get(id) === bound
      ? bound
      : undefined
    try {
      if (live === undefined) {
        await titles.renamePersisted(id, title, this.lifecycleAbort.signal)
      } else {
        titles.rename(live, title)
        await this.flushSession(live)
      }
      await this.refreshList(id)
    } catch (error: unknown) {
      const reason = errorReason(error)
      this.ctx.logger.warn(`session rename for "${id}" failed: ${reason}`)
      this.setFeedback(`✗ 重命名失败：${reason}`)
    }
  }

  /** d: arm the delete confirmation; the second d permanently deletes the selected row. */
  private async deleteSelected(): Promise<void> {
    const row = this.sessionList[this.selectedIndex]
    if (row === undefined) return
    if (this.session !== undefined && this.session.id === row.id) {
      // The live row is never deletable (K6).
      this.confirmDelete = false
      this.emit()
      return
    }
    if (!this.deleteCapable()) {
      // K6/S3: missing backend capability is a visible state, never silent.
      this.deleteUnavailable = true
      this.emit()
      return
    }
    if (!this.confirmDelete) {
      this.confirmDelete = true
      this.emit()
      return
    }
    this.confirmDelete = false
    const persistence = this.ctx.get('sessionPersistence')
    try {
      // deleteCapable() above guarantees both the service and the primitive.
      await persistence?.delete(SessionId(row.id))
      await this.refreshList()
    } catch (error: unknown) {
      this.ctx.logger.warn(
        `session deletion for "${row.id}" failed: ${String(error)}`,
      )
      this.setFeedback('✗ 删除失败')
    }
    this.emit()
  }

  /** `/export`: write the live session transcript to the working directory. */
  private async exportLive(): Promise<void> {
    const session = this.session
    if (session === undefined) return
    try {
      await exportSessionMarkdown(
        session,
        this.config.cwd ?? process.cwd(),
      )
    } catch (error: unknown) {
      this.ctx.logger.warn(`session export failed: ${errorReason(error)}`)
      this.setFeedback(`✗ 会话导出失败：${errorReason(error)}`)
    }
  }

  /**
   * The effective slash-command directory: the registry's name-sorted
   * descriptors for the live agent minus the Web-only `/export` placeholder
   * (session-log-export reports a download request and never writes files),
   * merged with the TUI's local commands and sorted by name.
   * @returns the merged, name-sorted command descriptors.
   */
  private commandDirectory(): readonly CommandDescriptor[] {
    const commands = this.ctx.get('commands')
    const registry = this.agent === undefined || commands === undefined
      ? []
      : commands.list(this.agent).filter(command => command.name !== 'export')
    return [...registry, ...LOCAL_COMMANDS].sort((left, right) =>
      left.name < right.name ? -1 : 1,
    )
  }

  /**
   * Dispatch one slash command: local `/export` runs in-process, `/help` and
   * `/model` open their overlay panels, empty `/permission` opens the preset
   * overlay, empty `/settings` opens the settings overlay, empty `/plan` opens
   * the plan-directory overlay, every other line
   * forwards to the command registry. An unknown
   * command is a visible `✗ 未知命令` feedback, never a silent no-op; the
   * settled text result renders through the existing feedback row with the
   * ✓/✗ convention. A switch that fails while the permission or plan overlay
   * is open paints that overlay's error pair instead of the status row.
   * @param query - the text after `/`, passed verbatim to the registry.
   */
  private runCommand(query: string): void {
    if (query === 'export') {
      this.ownWork(this.exportLive(), 'session export')
      return
    }
    if (query === 'reload') {
      // Process replacement (flush/unmount/dispose/respawn) owns itself.
      this.requestReload()
      return
    }
    if (query === 'resume' || query === 'resume ') {
      // Open-only: a repeated /resume never toggles the list closed. K2′: an
      // unsettled approval keeps the composer.
      if (this.blockingHead() !== undefined) return
      if (!this.listOpen) this.dispatch({ kind: 'session-pane' })
      return
    }
    if (query === 'help') {
      this.openHelpPane()
      return
    }
    if (query === 'model') {
      this.openModelPane()
      return
    }
    if (query === 'permission' || query === 'permission ') {
      // K2′: an unsettled approval owns the composer; do not steal it.
      if (this.blockingHead() !== undefined) return
      this.openPermissionPane()
      return
    }
    if (query === 'settings' || query === 'settings ') {
      if (this.blockingHead() !== undefined) return
      this.openSettingsPane()
      return
    }
    if (query === 'plan' || query === 'plan ') {
      if (
        this.blockingHead() !== undefined
        || this.getApprovalPane().open
        || this.getAskUserPane().open
        || this.getPlanReviewPane().open
      ) return
      this.openPlanDirectoryPane()
      return
    }
    this.executeSlash(query)
  }

  /**
   * Forward `/{query}` to the command registry. Overlay Enter uses this
   * so empty `/plan` does not re-open the directory instead of toggling.
   * @param query - the text after `/`, passed verbatim to the registry.
   */
  private executeSlash(query: string): void {
    const agent = this.agent
    const commands = this.ctx.get('commands')
    if (agent === undefined || commands === undefined) {
      this.reportCommandFailure('未知命令')
      return
    }
    // A new request cancels the previous in-flight one; the sequence guard
    // drops the aborted settlement so it cannot clobber the newer feedback.
    this.commandAbort?.abort()
    const abort = new AbortController()
    this.commandAbort = abort
    const seq = ++this.commandSeq
    // pi-lens-ignore: sql-injection
    const operation = commands.execute(agent, `/${query}`, [], abort.signal).then(
      (execution) => {
        if (seq !== this.commandSeq) return
        if (execution === undefined) {
          this.reportCommandFailure('未知命令')
          return
        }
        if (execution.result.kind !== 'success') {
          this.reportCommandFailure(firstLine(execution.result.text))
          return
        }
        const text = execution.result.text
        const wasPermission = this.permissionOpen
        if (wasPermission) {
          this.permissionOpen = false
          this.permissionConfirmDanger = false
          this.permissionSwitchError = undefined
        }
        const wasPlanDirectory = this.planDirectoryOpen
        if (wasPlanDirectory) {
          this.planDirectoryOpen = false
          this.planDirectorySwitchError = undefined
          this.planDirectoryStatusError = undefined
        }
        if (text === undefined) {
          if (wasPermission || wasPlanDirectory) this.emit()
          return
        }
        this.setFeedback(`✓ ${firstLine(text)}`)
      },
      (error: unknown) => {
        if (seq !== this.commandSeq) return
        // A thrown or aborted handler is a visible failure, never silent.
        this.reportCommandFailure(
          error instanceof Error ? error.message : String(error),
        )
      },
    )
    this.ownWork(operation, 'slash command')
  }

  /**
   * Surface a command failure: the permission or plan overlay's ✗ pair while
   * that overlay is open, otherwise the status-row feedback.
   * @param reason - unprefixed failure text (the overlay or status row adds ✗).
   */
  private reportCommandFailure(reason: string): void {
    if (this.permissionOpen) {
      this.permissionSwitchError = reason
      this.emit()
      return
    }
    if (this.planDirectoryOpen) {
      this.planDirectorySwitchError = reason
      this.emit()
      return
    }
    this.setFeedback(`✗ ${reason}`)
  }

  /**
   * Open the plan-directory overlay from logged plan mode. Missing session
   * or an unreadable fold paints the status-error pair (not the welcome home).
   */
  private openPlanDirectoryPane(): void {
    this.closeOtherPanels()
    this.planDirectorySwitchError = undefined
    const status = this.readPlanStatus()
    if ('error' in status) {
      this.planDirectoryStatusError = status.error
      this.planDirectoryCurrentActive = false
      this.planDirectorySelectedIndex = 0
    } else {
      this.planDirectoryStatusError = undefined
      this.planDirectoryCurrentActive = status.active
      this.planDirectorySelectedIndex = status.active ? 0 : 1
    }
    this.planDirectoryOpen = true
    this.emit()
  }

  /**
   * Fold the host plan mode from `ctx.planMode` or the session log.
   * @returns the active flag, or an unreadable-status reason.
   */
  private readPlanStatus(): { active: boolean } | { error: string } {
    try {
      const agent = this.agent
      const planMode = this.ctx.get('planMode')
      if (agent !== undefined && planMode !== undefined) {
        return { active: planMode.get(agent).active }
      }
      const session = this.session
      if (session !== undefined) {
        return { active: foldPlanMode(session.events) }
      }
      return {
        error: planMode === undefined ? '计划服务未组合' : '会话未绑定',
      }
    } catch (error: unknown) {
      return { error: errorReason(error) }
    }
  }

  /**
   * Open the permission-preset overlay from the live host table. Missing
   * service yields an empty names list (title + error, not the welcome home).
   */
  private openPermissionPane(): void {
    this.closeOtherPanels()
    this.permissionConfirmDanger = false
    this.permissionSwitchError = undefined
    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined) {
      this.permissionNames = []
      this.permissionDescriptions = []
      this.permissionCurrentName = ''
      this.permissionSelectedIndex = 0
    } else {
      this.permissionNames = [...presets.names]
      const events = this.session?.events ?? []
      this.permissionCurrentName = presets.current(events)
      const currentIndex = this.permissionNames.indexOf(this.permissionCurrentName)
      this.permissionSelectedIndex = Math.max(0, currentIndex)
      this.permissionDescriptions = this.permissionNames.map(
        name => presets.optionOf(name).description,
      )
    }
    this.permissionOpen = true
    this.emit()
  }

  /**
   * Open the settings overlay on every top-level `describe()` field. Missing
   * `ctx.settings` yields an empty row list (title + empty reason, not the
   * welcome home).
   */
  private openSettingsPane(): void {
    this.closeOtherPanels()
    this.settingsEditing = false
    this.settingsUpdateError = undefined
    this.settingsRows = this.readSettingsRows()
    this.settingsSelectedIndex = 0
    this.settingsOpen = true
    this.emit()
  }

  /**
   * Flatten registered settings sections into overlay rows. Secret heads from
   * `describe({ redactSecrets: true })` are omitted; values come from `get()`.
   * @returns zero or more field rows.
   */
  private readSettingsRows(): SettingsFieldRow[] {
    const settings = this.ctx.get('settings')
    if (settings === undefined) return []
    return settingsRowsFromDescribe(
      settings.describe({ redactSecrets: true }),
      ns => settings.get(ns),
    )
  }

  /**
   * Persist the composer draft as the selected row's field. Onboarding writes
   * `ctx.credentials.set` and never logs the value. Success closes the overlay
   * and writes the status-row confirmation; failure stays on the overlay with
   * the ✗ pair. Does not write environment variables.
   * @param value - composer draft captured by the key reducer.
   */
  private applySettingsValue(value: string): void {
    if (!this.settingsOpen || !this.settingsEditing) return
    this.settingsEditing = false
    const row = this.settingsRows[this.settingsSelectedIndex]
    if (row === undefined) {
      this.settingsUpdateError = '无可用设置'
      this.emit()
      return
    }
    if (row.namespace === 'credentials') {
      this.applyOnboardingKey(row.field, value)
      return
    }
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      this.settingsUpdateError = '无可用设置'
      this.emit()
      return
    }
    let parsed: unknown
    try {
      parsed = parseSettingsFieldValue(
        row.namespace,
        row.field,
        fieldOf(settings.get(settingsNamespace(row.namespace)), row.field),
        value,
      )
    } catch (error: unknown) {
      this.settingsUpdateError = errorReason(error)
      this.emit()
      return
    }
    this.ownWork((async () => {
      try {
        await settings.update(settingsNamespace(row.namespace), { [row.field]: parsed })
        if (this.closed) return
        this.settingsOpen = false
        this.settingsEditing = false
        this.settingsOnboarding = false
        this.settingsUpdateError = undefined
        this.setFeedback(`✓ 已更新 ${row.field}`)
      } catch (error: unknown) {
        if (this.closed) return
        this.settingsUpdateError = errorReason(error)
        this.settingsRows = this.readSettingsRows()
        this.emit()
      }
    })(), 'settings update')
  }

  /**
   * Store the first-run API key, then open the model pane so the user can
   * pick a default. The value is never written to feedback or logs.
   * @param field - credential reference name (POSIX identifier).
   * @param value - composer draft.
   */
  private applyOnboardingKey(field: string, value: string): void {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      this.settingsUpdateError = '无可用设置'
      this.emit()
      return
    }
    if (value === '') {
      this.settingsUpdateError = '需要非空 API key'
      this.emit()
      return
    }
    this.ownWork((async () => {
      try {
        await credentials.set(credentialRef(field), value)
        if (this.closed) return
        this.settingsOnboarding = false
        this.settingsOpen = false
        this.settingsEditing = false
        this.settingsUpdateError = undefined
        this.setFeedback('✓ 已保存 API key')
        this.openModelPane()
      } catch (error: unknown) {
        if (this.closed) return
        this.settingsUpdateError = errorReason(error)
        this.emit()
      }
    })(), 'credentials set')
  }

  /**
   * Ask the host to materialize the settings document and report its path.
   * Leaves the overlay open.
   */
  private exportSettingsDocument(): void {
    if (!this.settingsOpen || this.settingsEditing || this.settingsOnboarding) return
    const settings = this.ctx.get('settings')
    if (settings === undefined || typeof settings.prepareDocument !== 'function') {
      this.setFeedback('无可用设置文件')
      return
    }
    this.ownWork((async () => {
      try {
        const path = await settings.prepareDocument()
        if (this.closed) return
        this.setFeedback(
          path === undefined || path === '' ? '无可用设置文件' : `✓ 设置文件 ${path}`,
        )
      } catch (error: unknown) {
        if (this.closed) return
        this.setFeedback(`✗ ${errorReason(error)}`)
      }
    })(), 'settings export')
  }

  /**
   * Reread overlay rows from the live host without closing the overlay.
   */
  private reloadSettingsRows(): void {
    if (!this.settingsOpen || this.settingsEditing || this.settingsOnboarding) return
    this.settingsRows = this.readSettingsRows()
    if (this.settingsSelectedIndex >= this.settingsRows.length) {
      this.settingsSelectedIndex = Math.max(0, this.settingsRows.length - 1)
    }
    this.settingsUpdateError = undefined
    this.setFeedback('✓ 已重载设置')
  }

  /**
   * Register the `tui` user-settings section when the host exposes `register`.
   * Unit stubs that only implement `describe`/`get`/`update` are left alone.
   */
  private installTuiSettings(): void {
    const settings = this.ctx.get('settings')
    if (settings === undefined || typeof settings.register !== 'function') return
    installSettingsSection(this.ctx, TUI_SETTINGS_NS, TuiUserSettings, {}, {
      setSource: (read) => {
        this.readTuiSettings = read
      },
      onChange: () => {
        const next = this.readTuiSettings?.()
        if (next?.colorTier !== undefined) applyTheme(next.colorTier)
        this.emit()
      },
    })
  }

  /**
   * Open the first-run API-key overlay when idle boot has no configured
   * `DEEPSEEK_API_KEY`. Approval or ask-user already open skips (K2′).
   */
  private async maybeOpenOnboarding(): Promise<void> {
    if (this.closed) return
    if (
      this.getApprovalPane().open
      || this.getAskUserPane().open
      || this.getPlanReviewPane().open
    ) return
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return
    try {
      const info = await credentials.describe(credentialRef(ONBOARDING_KEY))
      // Disposal may land while credential state is loading.
      if (this.lifecycleAbort.signal.aborted || info.configured) return
      if (
        this.getApprovalPane().open
        || this.getAskUserPane().open
        || this.getPlanReviewPane().open
      ) return
      this.closeOtherPanels()
      this.settingsOnboarding = true
      this.settingsEditing = true
      this.settingsUpdateError = undefined
      this.settingsRows = [{
        namespace: 'credentials',
        field: ONBOARDING_KEY,
        value: '',
      }]
      this.settingsSelectedIndex = 0
      this.settingsOpen = true
    } catch (error: unknown) {
      // A broken credentials probe must not block idle boot.
      this.ctx.logger.warn(`onboarding credential probe failed: ${errorReason(error)}`)
    }
  }

  /**
   * The `/help` sheet: every directory command as `name — description` plus
   * its input hint, then the key binding cheat sheet. Rendered into plain
   * lines for the overlay help panel (the render layer escapes control bytes).
   * @returns the help lines, one terminal row each.
   */
  private renderHelpLines(): string[] {
    const commands = this.commandDirectory().map((command) => {
      const hint =
        command.input === undefined ? '' : ` 输入: ${command.input.hint}`
      return `/${command.name} — ${command.description}${hint}`
    })
    return [
      '/help — 命令与键位速查',
      ...commands,
      '',
      '键位: Ctrl+C 停止/退出 · Ctrl+O 展开/收起推理 · Ctrl+N 新会话 · Ctrl+K 搜索 · Ctrl+T 时间线',
      'Ctrl+E 工具卡 · y/n 审批 · /permission · /settings · e/r 导出重载',
      'g a 子代理 · g t 工作区 · g f 反馈 · g w 工作流',
      '↑↓/jk 滚动 · g s 会话列表 · Tab 补全 · Esc 关闭 · / 命令 · @ 提及',
      '滚轮滚动 · 点击打开链接 · 拖选复制',
      '/plan 计划 · /goal 目标 · /compact 压缩',
      '/model 模型选择 · /help 帮助 · /export 导出会话 · /settings 设置 · /resume 会话 · /reload 重载',
    ]
  }

  /**
   * Open the help sheet: render the command directory plus the key bindings
   * into lines and close every competing overlay (K2 mutual exclusion).
   */
  private openHelpPane(): void {
    this.helpLines = this.renderHelpLines()
    this.closeOtherPanels()
    this.helpOpen = true
    this.emit()
  }

  /**
   * Open the model-selection panel: close every competing overlay (K2), reset
   * the panel transients, then load the provider/model catalog concurrently.
   */
  private openModelPane(): void {
    this.resetModelState()
    this.closeOtherPanels()
    this.modelOpen = true
    this.emit()
    this.ownWork(this.loadModelCatalog(), 'model catalog load')
  }

  /**
   * The catalog rows narrowed by the live filter: case-insensitive substring
   * over the provider route, the model id, and the display name.
   * @returns the filtered rows, in catalog order.
   */
  private filteredModelRows(): readonly ModelRow[] {
    const needle = this.modelFilter.toLowerCase()
    if (needle === '') return this.modelRows
    return this.modelRows.filter(row =>
      `${row.provider} ${row.model} ${row.name}`.toLowerCase().includes(needle),
    )
  }

  /**
   * Load the provider/model catalog. Each open takes a monotonic request id;
   * only the newest response may land, so an in-flight older load can never
   * clobber a newer catalog (K7/S1). Every provider is fetched concurrently;
   * one without a catalog (no listModels, empty list, or a failed call)
   * degrades to a single `provider 当前默认` row carrying the live default
   * model when the provider is the current one.
   */
  private async loadModelCatalog(): Promise<void> {
    const seq = ++this.modelSeq
    const llm = this.ctx.get('llm')
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (llm === undefined || defaultModel === undefined) {
      this.modelStatus = 'error'
      this.modelError = '模型服务不可用'
      this.emit()
      return
    }
    this.modelStatus = 'loading'
    this.emit()
    const current = defaultModel.currentSelection()
    try {
      const providers = llm.listProviders()
      const groups = await Promise.all(providers.map(async (provider) => {
        let models: readonly LlmModelInfo[]
        try {
          models = await llm.listModels(provider.id)
        } catch (error: unknown) {
          // A failed catalog degrades to the provider's default row.
          this.ctx.logger.warn(
            `model catalog for "${provider.id}" failed: ${String(error)}`,
          )
          models = []
        }
        if (models.length === 0) {
          return [this.fallbackModelRow(provider.id, provider.name, current)]
        }
        return models.map(model =>
          this.catalogRow(provider.id, model.id, model.name, current),
        )
      }))
      if (seq !== this.modelSeq) return
      this.modelRows = groups.flat()
      if (this.modelSelectedIndex >= this.modelRows.length) {
        this.modelSelectedIndex = Math.max(0, this.modelRows.length - 1)
      }
      this.modelStatus = 'idle'
      this.emit()
    } catch (error: unknown) {
      if (seq !== this.modelSeq) return
      this.ctx.logger.warn(`model catalog load failed: ${String(error)}`)
      this.modelRows = []
      this.modelStatus = 'error'
      this.modelError =
        error instanceof Error ? error.message : String(error)
      this.emit()
    }
  }

  /** Fold one advertised model into a catalog row. */
  private catalogRow(
    provider: string,
    model: string,
    name: string,
    current: ModelSelection,
  ): ModelRow {
    return {
      id: `${provider}:${model}`,
      provider,
      model,
      name,
      fallback: false,
      current: current.provider === provider && current.model === model,
    }
  }

  /**
   * The degraded row for a provider with no discoverable catalog: the live
   * default model when the provider is the current one, else the provider
   * route itself as the only known identity.
   */
  private fallbackModelRow(
    provider: string,
    providerName: string,
    current: ModelSelection,
  ): ModelRow {
    const isCurrentProvider = current.provider === provider
    const model = isCurrentProvider ? current.model : provider
    return {
      id: `default:${provider}`,
      provider,
      model,
      name: isCurrentProvider ? current.model : providerName,
      fallback: true,
      current: isCurrentProvider,
    }
  }

  /**
   * Enter on a highlighted model row: persist the selection, then apply it
   * live to the agent's next step through the mutable ref and update the
   * top-bar badge. A failed persist keeps the current selection untouched
   * (`✗ 切换失败…（当前保持）`), never a silent no-op.
   * @param rowId - the highlighted row's stable id.
   */
  private async switchModel(rowId: string): Promise<void> {
    const row = this.modelRows.find(candidate => candidate.id === rowId)
    const ref = this.modelSelectionRef
    const defaultModel = this.ctx.get('agentDefaultModel')
    if (row === undefined || ref === undefined || defaultModel === undefined) {
      return
    }
    const next: ModelSelection = { provider: row.provider, model: row.model }
    try {
      await defaultModel.saveSelection(next)
    } catch (error: unknown) {
      // K8-style: a failed persist keeps the current selection usable.
      this.ctx.logger.warn(`model selection persist failed: ${String(error)}`)
      this.setFeedback(
        `✗ 切换失败：${error instanceof Error ? error.message : String(error)}（当前保持）`,
      )
      this.emit()
      return
    }
    ref.current = next
    this.badge = `${row.provider} · ${row.model}`
    this.modelOpen = false
    this.resetModelState()
    this.setFeedback('✓ 已切换模型')
    this.emit()
  }

  /**
   * Return the workspace base directory `@` mention queries resolve under.
   * @returns the configured run cwd, else the process cwd.
   */
  getCwd(): string {
    return this.config.cwd ?? process.cwd()
  }

  /**
   * Resolve `@` mention candidates for one base path and typed query: a
   * one-level workspace listing through ctx.fs (prefix-filtered), skill
   * summaries through ctx.skills (name/description-filtered), and running
   * child labels through ctx.get('subagents') when the service and a bound
   * agent exist. A failed backend lookup degrades to an empty list — a
   * completer never surfaces an error into the input slot. Missing
   * `subagents` omits the 子代理 section (no throw).
   * @param basePath - workspace path to list; empty lists the run cwd.
   * @param query - text typed after `@`.
   * @param signal - cancellation owned by the mention request.
   * @returns matching file/directory/skill/subagent candidates.
   */
  async listMentions(
    basePath: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<MentionCandidate[]> {
    const candidates: MentionCandidate[] = []
    const needle = query.toLowerCase()
    const fs = this.ctx.get('fs')
    if (fs !== undefined && basePath.trim() !== '') {
      try {
        const target = await fs.resolve(basePath, {
          ...(this.config.cwd === undefined ? {} : { cwd: this.config.cwd }),
          ...(signal === undefined ? {} : { signal }),
        })
        const entries = await fs.listDir(target, signal)
        for (const entry of entries) {
          if (entry.type === 'other') continue
          if (!entry.name.toLowerCase().startsWith(needle)) continue
          candidates.push({
            kind: entry.type,
            name: entry.name,
            target: entry.target.displayPath,
          })
        }
      } catch (error: unknown) {
        // A missing or unreadable workspace must not break the completer.
        this.ctx.logger.warn(
          `@ mention directory listing failed: ${String(error)}`,
        )
      }
    }
    const skills = this.ctx.get('skills')
    if (skills !== undefined) {
      try {
        const summaries = await skills.list({ signal })
        for (const skill of summaries) {
          if (
            !skill.name.toLowerCase().includes(needle)
            && !skill.description.toLowerCase().includes(needle)
          ) {
            continue
          }
          candidates.push({
            kind: 'skill',
            name: skill.name,
            description: skill.description,
          })
        }
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `@ mention skill listing failed: ${String(error)}`,
        )
      }
    }
    const subagents = this.ctx.get('subagents')
    if (
      subagents !== undefined
      && this.agentHandle !== undefined
      && this.session !== undefined
    ) {
      try {
        const entries = await subagents.listChildren(this.session.id, signal)
        for (const entry of entries) {
          if (entry.kind !== 'child' || entry.activity !== 'running') continue
          const name = entry.mode === 'continuable'
            ? entry.label
            : (entry.label ?? entry.id)
          if (!name.toLowerCase().includes(needle)) continue
          candidates.push({
            kind: 'subagent',
            name,
            target: `@${name} `,
          })
        }
      } catch (error: unknown) {
        // A listing failure must not break the completer or invent presets.
        this.ctx.logger.warn(
          `@ mention subagent listing failed: ${String(error)}`,
        )
      }
    }
    return candidates
  }

  /** Re-read the directory and optionally keep one persisted identity selected. */
  private async refreshList(preferredId?: SessionId): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) return
    try {
      const headers = await persistence.list()
      const rows: SessionRow[] = []
      for (const header of headers) {
        rows.push(
          this.session?.id === header.id
            ? this.rowForLiveSession(this.session)
            : await this.rowFor(header.id),
        )
      }
      if (
        this.session !== undefined
        && !rows.some(row => row.id === this.session?.id)
      ) {
        rows.push(this.rowForLiveSession(this.session))
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt)
      if (this.closed) return
      this.sessionList = rows
      const preferredIndex = preferredId === undefined
        ? -1
        : rows.findIndex(row => row.id === preferredId)
      if (preferredIndex >= 0) {
        this.selectedIndex = preferredIndex
      } else if (this.selectedIndex >= rows.length) {
        this.selectedIndex = Math.max(0, rows.length - 1)
      }
      this.confirmDelete = false
      this.emit()
    } catch (error: unknown) {
      // A refresh failure must not kill the loop; keep the last snapshot.
      this.ctx.logger.warn(`session list refresh failed: ${errorReason(error)}`)
      this.setFeedback(`✗ 会话列表刷新失败：${errorReason(error)}`)
    }
  }

  /** Fold the bound live session into a directory row without waiting for persistence. */
  private rowForLiveSession(session: Session): SessionRow {
    return {
      id: session.id,
      title: listTitleOf(session.events),
      updatedAt: session.events.at(-1)?.time ?? session.header.createdAt,
    }
  }

  /** Fold one listed session into a directory row; corrupt logs degrade to the id. */
  private async rowFor(id: SessionId): Promise<SessionRow> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      return { id, title: id, updatedAt: 0 }
    }
    try {
      const inspection = await persistence.inspect(id)
      return {
        id,
        title: listTitleOf(inspection.events),
        updatedAt: inspection.events.at(-1)?.time ?? inspection.meta.createdAt,
      }
    } catch {
      return { id, title: id, updatedAt: Date.now() }
    }
  }

  /** Queue the newest query and enter loading before its debounce delay. */
  private scheduleSearch(query: string): void {
    const seq = this.invalidateSearch()
    this.searchQuery = query
    this.searchResults = []
    this.searchSelectedIndex = 0
    if (query === '') {
      this.searchStatus = 'idle'
      this.emit()
      return
    }
    this.searchStatus = 'searching'
    this.searchTimer = setTimeout(() => {
      this.searchTimer = undefined
      this.ownWork(this.runSearch(query, seq), 'session search')
    }, SEARCH_DEBOUNCE_MS)
    this.emit()
  }

  /** Whether one captured query still owns the open search panel. */
  private isCurrentSearch(query: string, seq: number): boolean {
    return this.searchOpen
      && query === this.searchQuery
      && seq === this.searchSeq
  }

  /**
   * Run one debounced full-text search through the session-query service.
   * Every settlement rechecks both the captured query and monotonic request
   * id before publishing, including the async candidate-folding interval.
   * @param query - the raw search term (parameter-bound by the service).
   * @param seq - request id captured when the debounce timer was installed.
   */
  private async runSearch(query: string, seq: number): Promise<void> {
    if (!this.isCurrentSearch(query, seq)) return
    const engine = this.ctx.get('sessionQuery')
    if (engine === undefined) {
      this.searchResults = []
      this.searchStatus = 'idle'
      this.emit()
      return
    }
    try {
      const page = await engine.searchSessions({
        query,
        matchMode: 'literal-substring',
        eventFilters: [{ kind: 'transcript-role', values: ['user', 'assistant'] }],
        limit: SEARCH_LIMIT + 1,
      })
      if (!this.isCurrentSearch(query, seq)) return
      const candidates: SearchCandidate[] = []
      for (const hit of page.items) {
        candidates.push(await this.candidateFor(hit))
        if (!this.isCurrentSearch(query, seq)) return
      }
      this.searchResults = candidates
      if (this.searchSelectedIndex >= candidates.length) {
        this.searchSelectedIndex = Math.max(0, candidates.length - 1)
      }
      this.searchStatus = 'idle'
      this.emit()
    } catch (error: unknown) {
      if (!this.isCurrentSearch(query, seq)) return
      this.ctx.logger.warn(`session search failed: ${String(error)}`)
      this.searchResults = []
      this.searchStatus = 'error'
      this.emit()
    }
  }

  /** Fold one search hit into a candidate row; corrupt logs degrade to the id. */
  private async candidateFor(hit: SessionSearchHit): Promise<SearchCandidate> {
    const persistence = this.ctx.get('sessionPersistence')
    let title: string = hit.header.id
    if (persistence !== undefined) {
      try {
        const inspection = await persistence.inspect(hit.header.id)
        title = listTitleOf(inspection.events)
      } catch {
        // Keep the id as the row's title when the log is unavailable.
      }
    }
    return {
      id: hit.header.id,
      title,
      snippet: hit.bestMatch.snippet,
    }
  }

  /**
   * Queue one claimed request and paint it when it reaches the head.
   * @param request - the live agent's pending approval.
   * @returns the user's one-shot outcome, or `'cancelled'` if the signal aborts.
   */
  private enqueueApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
    return new Promise((resolve) => {
      const entry: QueuedApproval = {
        request,
        resolve,
        seq: ++this.slotSeq,
        settled: false,
        detailsOpen: false,
        onAbort: () => {
          this.settleApproval(entry, 'cancelled')
        },
      }
      request.signal?.addEventListener('abort', entry.onAbort, { once: true })
      this.approvalQueue.push(entry)
      this.notifyAttention({ kind: 'approval', toolName: request.toolName })
      this.emit()
    })
  }

  /**
   * Resolve the head of the queue. A second call after the latch is a no-op.
   * @param outcome - `'allowed-once'` or `'rejected'` from the keymap.
   */
  private answerHead(outcome: 'allowed-once' | 'rejected'): void {
    const head = this.blockingHead()
    if (head?.kind !== 'approval') return
    this.settleApproval(head.entry, outcome)
  }

  /**
   * Settle one queued entry exactly once and promote the next head.
   * @param entry - the claimed request to finish.
   * @param outcome - `'allowed-once'`, `'rejected'`, or `'cancelled'`. Live TUI
   *   never resolves `'unavailable'`.
   */
  private settleApproval(entry: QueuedApproval, outcome: ApprovalOutcome): void {
    if (entry.settled) return
    entry.settled = true
    this.approvalQueue.splice(this.approvalQueue.indexOf(entry), 1)
    entry.resolve(outcome)
    this.emit()
  }

  /** Withdraw every queued ask as `'cancelled'` (session switch or teardown). */
  private cancelQueuedApprovals(): void {
    for (const entry of [...this.approvalQueue]) {
      this.settleApproval(entry, 'cancelled')
    }
  }

  /**
   * Build the composer-slot snapshot from the queue head.
   * @returns a closed constant when idle, otherwise the head's fields.
   */
  private buildApprovalPane(): ApprovalPaneState {
    const head = this.blockingHead()
    if (head?.kind !== 'approval') return EMPTY_APPROVAL_PANE
    return {
      open: true,
      toolName: head.entry.request.toolName,
      reason: head.entry.request.reason ?? '',
      arguments: this.argumentsFor(head.entry.request.callId),
      detailsOpen: head.entry.detailsOpen,
    }
  }

  /**
   * The older of the two blocking queues: only that head occupies the composer.
   * @returns the live approval or ask-user head, or undefined while idle.
   */
  private blockingHead():
    | { kind: 'approval'; entry: QueuedApproval }
    | { kind: 'ask-user'; entry: QueuedAskUser }
    | undefined {
    const approval = this.approvalQueue[0]
    const ask = this.askUserQueue[0]
    if (ask === undefined) {
      return approval === undefined
        ? undefined
        : { kind: 'approval', entry: approval }
    }
    if (approval === undefined) return { kind: 'ask-user', entry: ask }
    return approval.seq <= ask.seq
      ? { kind: 'approval', entry: approval }
      : { kind: 'ask-user', entry: ask }
  }

  /**
   * The ask-user entry that currently occupies the composer, if any.
   * @returns the FIFO head when it is an ask-user request.
   */
  private askUserHead(): QueuedAskUser | undefined {
    const head = this.blockingHead()
    return head?.kind === 'ask-user' ? head.entry : undefined
  }

  /**
   * Queue one claimed ask and paint it when it reaches the shared FIFO head.
   * @param request - questions, optional live agent, and abort signal.
   * @returns the user's selected labels, or rejects with ASK_ABORTED.
   */
  private enqueueAskUser(
    request: AskUserQuestionRequest,
  ): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted === true) {
      return Promise.reject(askAborted())
    }
    return new Promise((resolve, reject) => {
      const entry: QueuedAskUser = {
        request,
        resolve,
        reject,
        seq: ++this.slotSeq,
        settled: false,
        selectedIndex: 0,
        onAbort: () => {
          this.finishAskUser(entry, { error: askAborted() })
        },
      }
      request.signal?.addEventListener('abort', entry.onAbort, { once: true })
      this.askUserQueue.push(entry)
      this.notifyAttention({ kind: 'ask-user', questionText: request.questions[0]?.question })
      this.planReviewDeliveryError = undefined
      this.emit()
    })
  }

  /**
   * Replace the ask-user listener with one owned by the published runtime root.
   * @param agent - exact live root whose scoped requests this controller accepts.
   */
  private bindUserQuestions(agent: Agent): void {
    this.disposeUserQuestions()
    this.disposeUserQuestions = agent.ctx.on(
      'user-questions/request',
      (request, next) => {
        if (this.closed || this.agent !== agent || request.agent !== agent) {
          return next()
        }
        if (request.signal?.aborted === true) {
          return Promise.reject(askAborted())
        }
        return this.enqueueAskUser(request)
      },
    )
  }

  /** Submit the highlighted original label for the first question. */
  private submitAskUserHead(): void {
    const head = this.askUserHead()
    if (head === undefined) return
    if (planReviewOf(head.request.questions) !== undefined) return
    // UserQuestionService rejects an empty batch before the listener runs.
    const question = (head.request.questions as [AskUserQuestionItem])[0]
    const options = question.options ?? []
    const selected = options[head.selectedIndex]
    if (selected === undefined) return
    this.answerAskUserHead(head, selected.label)
  }

  /**
   * Submit a host plan-review option label. Chrome 批准 / 继续规划 is never
   * sent. Missing host options paint the delivery-error pair and stay open.
   * @param label - host `Approve` or `Keep planning`.
   */
  private submitPlanReview(label: 'Approve' | 'Keep planning'): void {
    const head = this.askUserHead()
    if (head === undefined) return
    const review = planReviewOf(head.request.questions)
    if (review === undefined) return
    const option = head.request.questions[0]?.options?.find(
      candidate => candidate.label === label,
    )
    if (option === undefined) {
      this.planReviewDeliveryError = '选项缺失'
      this.emit()
      return
    }
    this.answerAskUserHead(head, option.label)
  }

  /**
   * Resolve the FIFO ask-user head once with one original option label.
   * @param head - the occupied question.
   * @param label - host option.label, never chrome copy.
   */
  private answerAskUserHead(head: QueuedAskUser, label: string): void {
    const question = (head.request.questions as [AskUserQuestionItem])[0]
    this.finishAskUser(head, {
      answer: { answers: [{ id: question.id, selected: [label] }] },
    })
  }

  /** Esc on the occupied ask-user slot: reject ASK_ABORTED. */
  private cancelAskUserHead(): void {
    const head = this.askUserHead()
    if (head === undefined) return
    this.finishAskUser(head, { error: askAborted() })
  }

  /**
   * Settle one queued question exactly once, release every owned resource,
   * and promote the next head.
   * @param entry - the claimed request to finish.
   * @param settlement - answer or ASK_ABORTED outcome.
   */
  private finishAskUser(entry: QueuedAskUser, settlement: AskUserSettlement): void {
    if (entry.settled) return
    entry.settled = true
    entry.request.signal?.removeEventListener('abort', entry.onAbort)
    const index = this.askUserQueue.indexOf(entry)
    if (index >= 0) this.askUserQueue.splice(index, 1)
    if ('answer' in settlement) entry.resolve(settlement.answer)
    else entry.reject(settlement.error)
    this.planReviewDeliveryError = undefined
    this.approvalPaneSnapshot = undefined
    this.askUserPaneSnapshot = undefined
    this.planReviewPaneSnapshot = undefined
    this.emit()
  }

  /** Withdraw every queued question as ASK_ABORTED (session switch or teardown). */
  private cancelQueuedAskUsers(): void {
    for (const entry of [...this.askUserQueue]) {
      this.finishAskUser(entry, { error: askAborted() })
    }
  }

  /**
   * Build the composer-slot snapshot from the shared FIFO head.
   * @returns a closed constant when idle or when an approval occupies the slot.
   */
  private buildAskUserPane(): AskUserPaneState {
    const head = this.askUserHead()
    if (head === undefined) return EMPTY_ASK_USER_PANE
    if (planReviewOf(head.request.questions) !== undefined) return EMPTY_ASK_USER_PANE
    // UserQuestionService rejects an empty batch before the listener runs.
    const question = (head.request.questions as [AskUserQuestionItem])[0]
    return {
      open: true,
      header: question.header ?? question.question,
      options: (question.options ?? []).map(option => option.label),
      selectedIndex: head.selectedIndex,
    }
  }

  /**
   * Build the plan-review composer snapshot from the shared FIFO head.
   * @returns a closed constant when the head is not a plan-review batch.
   */
  private buildPlanReviewPane(): PlanReviewPaneState {
    const head = this.askUserHead()
    if (head === undefined) return EMPTY_PLAN_REVIEW_PANE
    const review = planReviewOf(head.request.questions)
    if (review === undefined) return EMPTY_PLAN_REVIEW_PANE
    return {
      open: true,
      plan: review.plan,
      ...(this.planReviewDeliveryError === undefined
        ? {}
        : { deliveryError: this.planReviewDeliveryError }),
    }
  }

  /**
   * Look up streamed tool-call arguments by `callId` for the details body.
   * @param callId - the pending call, when the ask named one.
   * @returns the raw arguments string, or empty when none is projected yet.
   */
  private argumentsFor(callId: ToolCallId | undefined): string {
    if (callId === undefined) return ''
    const model = this.projector.snapshot()
    const live = model.activeTurn?.toolCalls.find(call => call.callId === callId)
    if (live !== undefined) return live.arguments
    for (const message of model.history) {
      if (message.content === undefined) continue
      for (const item of message.content) {
        if (item.kind === 'tool-call' && item.callId === callId) return item.arguments
      }
    }
    return ''
  }

  private reduce(event: MachineEvent): void {
    const next = reduceInteraction(
      this.machine,
      event.kind === 'send'
        ? {
          kind: 'send',
          text: this.draftToComposerText(event.draft),
        }
        : event,
    )
    this.machine = next.state
    switch (next.effect.kind) {
      case 'followup':
        this.agentHandle?.followup(
          this.messageFromDraft(
            (event as Extract<MachineEvent, { kind: 'send' }>).draft,
          ),
        )
        break
      case 'cancel-generation':
        this.agentHandle?.cancel()
        break
      case 'exit':
        this.requestExit()
        break
      case 'arm-exit':
      case 'none':
        break
      /* v8 ignore next -- InteractionEffect is closed; retain compile-time exhaustiveness. */
      default:
        assertNever(next.effect, 'InteractionEffect')
    }
    this.emit()
  }

  private statusOf(): ViewModel['status'] {
    if (this.machine === 'generating') return 'generating'
    if (this.machine === 'stopped') return 'stopped'
    return 'idle'
  }

  /** Notify every subscriber without letting one callback starve the rest. */
  private notifyListeners(): void {
    this.emitLastRun = Date.now()
    this.emitPending = false
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        this.ctx.logger.warn(`TUI subscriber failed: ${errorReason(error)}`)
      }
    }
  }

  private emit(): void {
    if (this.closed) return
    // Drop the cached snapshots at the mutation point (not at the throttled
    // listener call), so any read after a change rebuilds current state.
    this.modelSnapshot = undefined
    this.sessionPaneSnapshot = undefined
    this.searchPaneSnapshot = undefined
    this.modelPaneSnapshot = undefined
    this.helpPaneSnapshot = undefined
    this.approvalPaneSnapshot = undefined
    this.askUserPaneSnapshot = undefined
    this.planReviewPaneSnapshot = undefined
    this.permissionPaneSnapshot = undefined
    this.settingsPaneSnapshot = undefined
    this.agentHubPaneSnapshot = undefined
    this.planDirectoryPaneSnapshot = undefined
    this.workspacePaneSnapshot = undefined
    this.feedbackPaneSnapshot = undefined
    this.workflowOverlaySnapshot = undefined
    this.goalFooterSnapshot = undefined
    this.adaptiveInfoFooterSnapshot = undefined
    this.todoHudSnapshot = undefined
    this.sessionStatsSnapshot = undefined
    this.jobsHudSnapshot = undefined
    this.workflowHudSnapshot = undefined
    if (this.emitTimer !== undefined) {
      this.emitPending = true
      return
    }
    const delay = 20 - (Date.now() - this.emitLastRun)
    if (delay <= 0) {
      this.notifyListeners()
      return
    }
    this.emitPending = true
    this.emitTimer = setTimeout(() => {
      this.emitTimer = undefined
      if (!this.closed && this.emitPending) this.notifyListeners()
    }, delay)
  }
}

/**
 * Title shown in the AppShell top bar. A fallback `session/title` that
 * coexists with a human `user/message` is the first prompt's directory
 * label and duplicates the visible user row, so it is omitted and the
 * loop shows the mount app name. Provider and user (rename) titles always
 * replace the app name. Directory rows still use {@link foldTitle}.
 * @param events - the live session log.
 * @returns the top-bar title, or '' when the mount app name should show.
 */
function topBarTitle(events: readonly SessionEvent[]): string {
  const folded = foldSessionTitle(events)
  if (folded === undefined) return ''
  if (folded.source.kind === 'fallback' && events.some(isHumanUserMessage)) {
    return ''
  }
  return folded.title
}

/**
 * Resolve the session display title for one notification body. Prefers the
 * persisted `session/title` event so renamed or provider-titled sessions
 * keep their stable identifier, then falls back to the deterministic
 * first-user-text fallback title so an unpersisted session still gets a
 * distinguishable suffix. Returns undefined only when no eligible input
 * exists yet, in which case the notification omits the ` · {title}` suffix.
 * @param events - the live session log.
 * @returns the title text to append, or undefined when no suffix applies.
 */
function notifySessionTitle(events: readonly SessionEvent[]): string | undefined {
  return foldTitle(events)
}

/**
 * Fold a live or inspected log into a display title: the folded
 * `session/title` event, else the first human user message's fallback title,
 * else undefined when no title exists yet. Internal context messages never
 * become a terminal title.
 * @param events - the inspected session log.
 * @returns a terminal-safe one-line title, or undefined when none exists.
 */
function foldTitle(events: readonly SessionEvent[]): string | undefined {
  const folded = foldSessionTitle(events)
  if (folded !== undefined) return folded.title
  const firstUser = events.find(isHumanUserMessage)
  if (firstUser !== undefined) {
    const text = joinTextBlocks(firstUser.data.content, ' ')
    const fallback = fallbackSessionTitle(
      text,
      LIST_TITLE_MAX_WORDS,
      LIST_TITLE_MAX_BYTES,
    )
    if (fallback !== '') return fallback
  }
  return undefined
}

/**
 * One directory display title: {@link foldTitle}, else the untitled label.
 * @param events - the inspected session log.
 * @returns a terminal-safe one-line title.
 */
function listTitleOf(events: readonly SessionEvent[]): string {
  return foldTitle(events) ?? '未命名会话'
}

/**
 * Fold a command result to one feedback row: the first line with trailing
 * whitespace trimmed. The full result stays in the session log (`command/done`).
 * @param text - the handler's verbatim result text.
 * @returns the single feedback line.
 */
function firstLine(text: string): string {
  const line = text.split('\n', 1)[0]
  return (line as string).trimEnd()
}

/**
 * Narrow an ask-user batch to a plan-review decision: one question whose
 * intent is `plan-review`. Copied locally; do not import the client module.
 * @param questions - the request's whole question batch.
 * @returns the plan markdown when this batch is a plan review.
 */
function planReviewOf(
  questions: readonly AskUserQuestionItem[],
): { plan: string } | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0]
  if (question === undefined || question.intent?.kind !== 'plan-review') {
    return undefined
  }
  return { plan: question.detail as string }
}

/** Esc, abort, and teardown all reject with this code. */
function askAborted(): UserQuestionError {
  return new UserQuestionError(
    'ask_user_question was aborted before the user answered',
    'ASK_ABORTED',
  )
}

/**
 * Option count of the first question in a queued ask; zero when none exist.
 * @param entry - the occupied ask-user slot.
 * @returns the label count used for digit bounds and j/k enablement.
 */
function askUserOptionCount(entry: QueuedAskUser): number {
  return entry.request.questions[0]?.options?.length ?? 0
}

/**
 * Resolve `--frame-stats <path>` to an absolute target that can receive the
 * exit JSON. An existing directory is rejected; an existing file must be
 * writable; a new file needs an available, writable parent directory. The
 * probe uses stat/access only, so validation never creates or truncates the
 * output, and every failure fails loud at startup (never silently skipped).
 * @param input - the raw path from the command line.
 * @returns the resolved absolute path.
 * @throws when the target is an existing directory or is not writable.
 */
async function frameStatsTarget(input: string): Promise<string> {
  const absolute = resolve(input)
  let target: Stats | undefined
  try {
    target = await stat(absolute)
  } catch {
    // The target does not exist yet; the parent directory decides.
  }
  if (target !== undefined) {
    if (target.isDirectory()) {
      throw new Error(`--frame-stats target is a directory: ${absolute}`)
    }
    try {
      await access(absolute, constants.W_OK)
    } catch {
      throw new Error(`--frame-stats target is not writable: ${absolute}`)
    }
    return absolute
  }
  try {
    await access(dirname(absolute), constants.W_OK)
  } catch {
    throw new Error(
      `--frame-stats target is not writable: ${absolute} (parent directory is unavailable)`,
    )
  }
  return absolute
}

/** The `--frame-stats` JSON contract: render cost plus pacing and environment context. */
interface FrameStatsFile {
  renderMs: { count: number; mean: number; max: number; p95: number }
  brandRenderMs: { count: number; mean: number; max: number; p95: number }
  pacing: { commits: number; elapsedMs: number }
  brandRevealTimers: number
  environment: { platform: NodeJS.Platform; node: string; arch: string }
  path: string
}

/**
 * Write the frame-stats JSON on orderly exit. File-only by contract: nothing
 * reaches stdout, and the payload carries no session content.
 * @param path - the resolved output path.
 * @param probe - the probe store the render tree recorded into.
 * @param io - process-facing effects (stderr for a write failure).
 * @param brandProbe - optional dedicated generated-home render probe.
 */
async function writeFrameStatsFile(
  path: string,
  probe: FrameProbeHandle,
  io: TuiIo,
  brandProbe?: FrameProbeHandle,
): Promise<void> {
  const snapshot = frameStatsSnapshot(probe)
  const brandSnapshot = brandProbe === undefined
    ? { count: 0, mean: 0, max: 0, p95: 0 }
    : frameStatsSnapshot(brandProbe)
  const payload: FrameStatsFile = {
    renderMs: {
      count: snapshot.count,
      mean: snapshot.mean,
      max: snapshot.max,
      p95: snapshot.p95,
    },
    brandRenderMs: {
      count: brandSnapshot.count,
      mean: brandSnapshot.mean,
      max: brandSnapshot.max,
      p95: brandSnapshot.p95,
    },
    pacing: { commits: probe.commits, elapsedMs: probe.elapsedMs() },
    brandRevealTimers: activeBrandRevealTimerCount(),
    environment: {
      platform: process.platform,
      node: process.version,
      arch: process.arch,
    },
    path,
  }
  try {
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  } catch (error) {
    io.stderr.write(`dsh: --frame-stats write failed: ${String(error)}\n`)
  }
}

/**
 * Start the terminal loop under one reversible root-effect lifetime. Ordinary
 * unload hands launcher signals back before removing TUI hooks, unmounts, and
 * awaits controller quiescence. A declared process exit instead retains the TUI
 * hooks, finishes the Session flush and frame-stats write while mounted, then
 * restores the terminal and requests exit; cleanup joins that exit work.
 * @param ctx - plugin context carrying core services and launcher host values.
 * @param config - validated startup task, resume, cwd, and frame-stats values.
 * @param io - process output and exit effects.
 * @returns an idempotent asynchronous disposer for ordinary unload or exit join.
 * @throws when terminal validation, frame-stats validation, loader settlement,
 * or initial Session creation/resume fails.
 */
async function run(
  ctx: Context,
  config: Config,
  io: TuiIo,
): Promise<() => Promise<void>> {
  assertInteractiveTerminal(internals.environment, io.stderr, (code) => {
    io.exit(code)
  })
  // --frame-stats fails loud before any render tree mounts: a target that
  // cannot be written is a usage error, not a silent no-op.
  const frameStatsPath =
    config.frameStats === undefined
      ? undefined
      : await frameStatsTarget(config.frameStats)
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const sessions = ctx.get('sessions')
  if (sessions === undefined) {
    throw new Error('tui-runtime: session store is unavailable after loader settlement')
  }

  const releaseSignals = ctx.get('releaseSignals')
  const lifecycle = createRuntimeLifecycle(
    releaseSignals === undefined ? 'unavailable' : 'generic-owned',
  )
  const frameProbe =
    frameStatsPath === undefined ? undefined : createFrameProbe()
  const brandFrameProbe =
    frameStatsPath === undefined ? undefined : createFrameProbe()
  let unmount: (() => void) | undefined
  let disposeSignalHooks: (() => void) | undefined
  let handbackSignals: (() => void) | undefined
  let processExitRequested = false
  let exitWork: Promise<void> | undefined
  let cleanupWork: Promise<void> | undefined
  let externalEditorWork: Promise<void> | undefined

  const unmountOnce = (): void => {
    const current = unmount
    unmount = undefined
    current?.()
  }

  let controller: RuntimeController | undefined
  const mountController = (): (() => void) => internals.mountLoop(
    controller as RuntimeController,
    {
      title: BRAND_APP_TITLE,
      stdout: process.stdout,
      stdin: internals.stdin,
      ...(frameProbe === undefined ? {} : { frameProbe }),
      ...(brandFrameProbe === undefined ? {} : { brandFrameProbe }),
    },
  )

  const requestExternalEditor = (
    draft: string,
    settle: (result: ExternalEditorSettlement) => void,
  ): boolean => {
    if (processExitRequested || externalEditorWork !== undefined) {
      return false
    }
    let command
    try {
      command = resolveEditorCommand(internals.editorEnv)
    } catch (error: unknown) {
      settle({ kind: 'error', reason: errorReason(error) })
      return false
    }
    if (command === undefined) {
      settle({ kind: 'unconfigured' })
      return false
    }
    let suspended = false
    const operation = Promise.resolve().then(async () => {
      try {
        const edited = await internals.editDraftExternally(command, draft, {
          suspend: () => {
            unmountOnce()
            internals.stdin.setRawMode(false)
            suspended = true
          },
          spawn: internals.editorSpawn,
          tempParent: internals.editorTempParent,
          ttyPath: internals.editorTtyPath,
        })
        settle(edited === null
          ? { kind: 'unchanged' }
          : { kind: 'success', text: edited })
      } catch (error: unknown) {
        settle({ kind: 'error', reason: errorReason(error) })
      } finally {
        if (suspended && cleanupWork === undefined && !processExitRequested) {
          unmount = mountController()
          controller?.redraw()
        }
      }
    })
    externalEditorWork = operation.finally(() => {
      externalEditorWork = undefined
    })
    return true
  }
  /**
   * `/reload` process replacement: shares the single-flight process-exit
   * latch with SIGTERM, then flushes the live session, writes frame stats,
   * unmounts (restoring the terminal), disposes the bound Agent so session
   * files are released, and respawns `[…execArgv, …argv]` with the child's
   * exit code becoming ours.
   */
  const requestReload = (): void => {
    if (processExitRequested) return
    processExitRequested = true
    lifecycle.update({
      phase: 'process-exit',
      tuiSignals: 'retained',
      runWork: 'quiescing',
    })
    // `/reload` is dispatched only after the controller's Agent/session tuple binds.
    const liveController = controller as RuntimeController
    const liveSession = liveController.session as Session
    const sessionId = liveSession.id
    exitWork = (async () => {
      try {
        await sessions.flush(liveSession)
      } catch (error: unknown) {
        ctx.logger.warn(`session flush before reload failed: ${String(error)}`)
      }
      if (frameStatsPath !== undefined && frameProbe !== undefined) {
        await internals.writeFrameStatsFile(frameStatsPath, frameProbe, io, brandFrameProbe)
      }
      unmountOnce()
      await liveController.dispose()
      const argv = rebuildReloadArgv(
        internals.processArgv,
        ctx.get('cmdlineArgs')?.get() ?? [],
        {
          sessionId,
          ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
          ...(config.frameStats === undefined ? {} : { frameStats: config.frameStats }),
        },
      )
      let code = 1
      try {
        code = await relaunchProcess(argv, {
          spawn: internals.spawn,
          execPath: process.execPath,
          execArgv: process.execArgv,
          env: process.env,
        })
      } catch {
        // A failed spawn still exits the parent, with the failure code.
        code = 1
      }
      io.exit(code)
    })().catch((error: unknown) => {
      fail(io, error)
    })
  }
  // Single-flight exit: the machine can reach the exit effect from a second
  // Ctrl+C, a SIGTERM/SIGHUP, or a Ctrl+C key while exit is already draining.
  // Only the first request flushes and writes frame stats; late signals land
  // on the still-installed hooks and request nothing new.
  const exitLoop = (): void => {
    if (processExitRequested) return
    processExitRequested = true
    lifecycle.update({
      phase: 'process-exit',
      tuiSignals: 'retained',
      runWork: 'quiescing',
    })
    exitWork = (async () => {
      // The flush and the frame-stats JSON complete while the loop is still
      // mounted and its hooks are still installed, so the terminal restore
      // and the exit request happen only after both settle. A failed flush
      // is logged and the exit continues: durability must not truncate it.
      try {
        if (controller?.session !== undefined) {
          await sessions.flush(controller.session)
        }
      } catch (error: unknown) {
        ctx.logger.warn(`session flush before exit failed: ${String(error)}`)
      }
      if (frameStatsPath !== undefined && frameProbe !== undefined) {
        await internals.writeFrameStatsFile(frameStatsPath, frameProbe, io, brandFrameProbe)
      }
      unmountOnce()
      // The signal hooks stay installed until the process exits. The
      // launcher's generic handlers were already released at the claim, so
      // removing the hooks here would open a no-handler window during final
      // tree disposal where a late signal falls to the default handler; with
      // them installed, processExitRequested keeps any late signal a
      // single-flight no-op.
      io.exit(0)
    })().catch((error: unknown) => {
      fail(io, error)
    })
  }

  const cleanup = (): Promise<void> => {
    cleanupWork ??= (async () => {
      lifecycle.update({
        phase: processExitRequested ? 'process-exit' : 'ordinary-unload',
        ...(processExitRequested ? { tuiSignals: 'retained' as const } : {}),
        runWork: 'quiescing',
      })

      if (!processExitRequested) {
        // The handback and hook removal are intentionally synchronous and in
        // this order. The launcher owns both generic signals before the TUI
        // releases either of its handlers.
        handbackSignals?.()
        if (handbackSignals !== undefined) {
          lifecycle.update({ launcherSignals: 'generic-owned' })
        }
        disposeSignalHooks?.()
        lifecycle.update({ tuiSignals: 'disposed' })
      }

      unmountOnce()
      if (exitWork !== undefined) await exitWork
      if (externalEditorWork !== undefined) await externalEditorWork
      await controller?.dispose()
      lifecycle.update({
        phase: processExitRequested ? 'process-exit' : 'settled',
        runWork: 'settled',
      })
      if (!processExitRequested) lifecycle.retire()
    })()
    return cleanupWork
  }

  try {
    controller = new RuntimeController(
      ctx,
      io,
      config,
      exitLoop,
      requestReload,
      requestExternalEditor,
    )
    unmount = mountController()
    disposeSignalHooks = installSignalHooks((signal) => {
      if (processExitRequested) return
      if (signal === 'SIGINT') {
        controller?.dispatch({ kind: 'sigint' })
      } else {
        controller?.dispatchExit()
      }
    })
    lifecycle.update({ tuiSignals: 'owned' })
    // The terminal surface claims exclusive process-signal ownership here:
    // the launcher's generic SIGINT/SIGTERM handlers are released in the same
    // synchronous block after the TUI hooks are installed, so no signal can
    // land on both owners. The returned handback stays with this root effect
    // for ordinary unload.
    handbackSignals = releaseSignals?.()
    if (releaseSignals !== undefined) {
      lifecycle.update({ launcherSignals: 'consumer-owned' })
    }
    // No raw startup line is printed beside the mounted loop: the full-screen
    // app header is the only identity carrier, and a direct stdout write
    // between Ink frames leaves a stale duplicate header.
    await controller.start()
    lifecycle.update({ phase: 'active' })
    return cleanup
  } catch (error: unknown) {
    await cleanup()
    throw error
  }
}

/**
 * Mount the terminal runtime as one Cordis root effect. A launcher-provided
 * `appReady` delays terminal ownership until the complete Loader tree commits;
 * hand-built contexts without readiness start immediately. A missing `appExit`
 * host value throws before registration, while asynchronous startup or cleanup
 * failures are written to stderr and request exit code 1.
 * @param ctx - plugin context carrying core services and launcher host values.
 * @param config - validated startup task, resume, cwd, and frame-stats values.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error(
      'tui-runtime: the launcher must provide ctx.appExit before the tree mounts',
    )
  }
  const io: TuiIo = {
    stdout: internals.stdout,
    stderr: internals.stderr,
    exit,
  }
  ctx.effect(() => {
    let retired = false
    let disposeRuntime: (() => Promise<void>) | undefined
    let startWork: Promise<void> | undefined
    const start = (): void => {
      if (retired || startWork !== undefined) return
      startWork = run(ctx, config, io).then((dispose) => {
        disposeRuntime = dispose
      }, (error: unknown) => {
        fail(io, error)
      })
    }
    const ready = ctx.get('appReady')
    const cancelReady = ready?.onReady(start) ?? (() => {})
    if (ready === undefined) start()
    return async () => {
      retired = true
      cancelReady()
      await startWork
      if (disposeRuntime === undefined) return
      try {
        await disposeRuntime()
      } catch (error: unknown) {
        fail(io, error)
      }
    }
  }, 'tuiRuntime.run')
}
