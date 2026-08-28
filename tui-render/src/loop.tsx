/**
 * Owns terminal key routing and composes the active TUI panel. Every Ink key event
 * passes through the pure {@link mapKeyEvent} reducer before the resulting action
 * is dispatched to the injected controller. Bracketed paste enters through Ink's
 * paste channel without arming chords.
 *
 * Modal panels capture their documented keys before the composer. Session
 * transitions remain controller-owned; the loop suppresses repeated transition
 * keystrokes whenever the controller reports an in-flight transition.
 * @module @deepseek-ai/dsh-tui-render/loop
 */

import { homedir } from 'node:os'
import { Box, Text, useInput, usePaste, useWindowSize } from 'ink'
import {
  createElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { Key } from 'ink'
import { AppShell } from './app-shell.tsx'
import { StreamView } from './stream-view.tsx'
import { SessionPane } from './session-pane.tsx'
import type { SessionPaneState } from './session-pane.tsx'
import { SearchPane } from './search-pane.tsx'
import type { SearchPaneState } from './search-pane.tsx'
import { ModelPane } from './model-pane.tsx'
import type { ModelPaneState } from './model-pane.tsx'
import { HelpPane } from './help-pane.tsx'
import type { HelpPaneState } from './help-pane.tsx'
import { ApprovalPane } from './approval-pane.tsx'
import type { ApprovalPaneState } from './approval-pane.tsx'
import { PermissionPane } from './permission-pane.tsx'
import type { PermissionPaneState } from './permission-pane.tsx'
import { SettingsPane } from './settings-pane.tsx'
import type { SettingsPaneState } from './settings-pane.tsx'
import { AgentHubPane } from './agent-hub-pane.tsx'
import type { AgentHubPaneState } from './agent-hub-pane.tsx'
import { PlanDirectoryPane } from './plan-directory-pane.tsx'
import type { PlanDirectoryPaneState } from './plan-directory-pane.tsx'
import { PlanReviewPane, PLAN_REVIEW_WINDOW } from './plan-review-pane.tsx'
import type { PlanReviewPaneState } from './plan-review-pane.tsx'
import { AskUserPane } from './ask-user-pane.tsx'
import type { AskUserPaneState } from './ask-user-pane.tsx'
import { TimelineView } from './timeline-view.tsx'
import { TIMELINE_WINDOW } from './timeline-view.tsx'
import { HELP_WINDOW } from './help-pane.tsx'
import { InputBar } from './input-bar.tsx'
import { CommandMenu, completeFirst, completeSelected, filterCommands, moveSelectionIndex, resolveEnterQuery, COMMAND_MENU_WINDOW } from './command-menu.tsx'
import type { CommandItem } from './command-menu.tsx'
import { Mention, normalizeMentionInsertion } from './mention.tsx'
import type { ListMentions, MentionCandidate, MentionPhase } from './mention.tsx'
import { clampCaretIndex, moveCaretByGrapheme } from './composer-cursor.ts'
import { setMouseScrollListener } from './mouse-io.ts'
import { escapeContent, displayWidth } from './content.ts'
import { paintRow, styled } from './theme.ts'
import { HISTORY_WINDOW_SIZE } from './projection.ts'
import type { ViewModel } from './projection.ts'
import type { InteractionState } from './interaction-state.ts'
import type { ToolPresenterLookup } from './tool-cards.ts'
import { truncateDisplay } from './tool-cards.ts'
import { goalFooterHead, goalFooterRuns } from './goal-footer.ts'
import type { GoalFooterRuns, GoalFooterView } from './goal-footer.ts'
import { formatAdaptiveInfoFooter } from './adaptive-info-footer.ts'
import type { AdaptiveInfoFooterView } from './adaptive-info-footer.ts'
import type { BrandRenderTier } from './terminal-capabilities.ts'
import type { FrameProbeHandle } from './frame-stats.ts'
import { TodoHud } from './todo-hud.tsx'
import type { TodoHudItem } from './todo-hud.tsx'
import { JobsHud } from './jobs-hud.tsx'
import type { JobHudItem } from './jobs-hud.tsx'
import { WorkflowHud } from './workflow-hud.tsx'
import type { WorkflowHudState } from './workflow-hud.tsx'
import { WorkflowOverlay } from './workflow-overlay.tsx'
import type { WorkflowOverlayState } from './workflow-overlay.tsx'
import { WorkspacePane } from './workspace-pane.tsx'
import type { WorkspacePaneState } from './workspace-pane.tsx'
import { FeedbackPane } from './feedback-pane.tsx'
import type { FeedbackPaneState } from './feedback-pane.tsx'
import { keyActionFor } from './keymap.ts'
import { QueueChip } from './queue-chip.tsx'

/** The g-s chord window: a lone `g` arms the list toggle for this long. */
export const CHORD_WINDOW_MS = 600

/** Runtime actions the loop requests from its controller. */
export type LoopAction =
  | { kind: 'send'; text: string }
  | { kind: 'sigint' }
  | { kind: 'toggle-reasoning' }
  | { kind: 'toggle-tool-cards' }
  | { kind: 'copy-message' }
  | { kind: 'intake-clipboard-image' }
  | { kind: 'edit-external'; text: string }
  | { kind: 'toggle-compaction-divider' }
  | { kind: 'take-queued-draft' }
  | { kind: 'scroll'; delta: number }
  | { kind: 'scroll-edge'; edge: 'oldest' | 'latest' }
  | { kind: 'command'; query: string }
  | { kind: 'session-pane' }
  | { kind: 'session-pane-move'; delta: number }
  | { kind: 'new-session' }
  | { kind: 'select-session'; id: string }
  | { kind: 'rename-session'; title: string }
  | { kind: 'delete-session' }
  | { kind: 'search-pane' }
  | { kind: 'search'; query: string }
  | { kind: 'toggle-timeline' }
  | { kind: 'timeline-scroll'; delta: number }
  | { kind: 'session-pane-idle' }
  | { kind: 'model-pane' }
  | { kind: 'model-move'; delta: number }
  | { kind: 'model-filter'; query: string }
  | { kind: 'select-model'; id: string }
  | { kind: 'help-pane' }
  | { kind: 'help-scroll'; delta: number }
  | { kind: 'approval-allow' }
  | { kind: 'approval-deny' }
  | { kind: 'approval-detail' }
  | { kind: 'ask-user-digit'; index: number }
  | { kind: 'ask-user-move'; delta: number }
  | { kind: 'ask-user-submit' }
  | { kind: 'ask-user-cancel' }
  | { kind: 'permission-escape' }
  | { kind: 'permission-move'; delta: number }
  | { kind: 'permission-jump'; index: number }
  | { kind: 'permission-apply' }
  | { kind: 'settings-escape' }
  | { kind: 'settings-move'; delta: number }
  | { kind: 'settings-edit' }
  | { kind: 'settings-cancel-edit' }
  | { kind: 'settings-apply'; value: string }
  | { kind: 'settings-export' }
  | { kind: 'settings-reload' }
  | { kind: 'agent-hub' }
  | { kind: 'agent-hub-escape' }
  | { kind: 'agent-hub-move'; delta: number }
  | { kind: 'agent-hub-enter' }
  | { kind: 'plan-directory' }
  | { kind: 'plan-directory-escape' }
  | { kind: 'plan-directory-move'; delta: number }
  | { kind: 'plan-directory-apply' }
  | { kind: 'plan-review-approve' }
  | { kind: 'plan-review-keep' }
  | { kind: 'plan-review-scroll'; delta: number }
  | { kind: 'workspace-pane' }
  | { kind: 'workspace-escape' }
  | { kind: 'workspace-move'; delta: number }
  | { kind: 'workspace-enter' }
  | { kind: 'workspace-edit' }
  | { kind: 'workspace-apply'; value: string }
  | { kind: 'workspace-cancel-edit' }
  | { kind: 'feedback-pane' }
  | { kind: 'feedback-escape' }
  | { kind: 'feedback-rate'; rating: 'positive' | 'negative' }
  | { kind: 'feedback-note-edit' }
  | { kind: 'feedback-note-apply'; value: string }
  | { kind: 'feedback-note-cancel' }
  | { kind: 'workflow-overlay' }
  | { kind: 'workflow-overlay-escape' }
  | { kind: 'workflow-overlay-scroll'; delta: number }

/** The controller seam: model access, subscription, and action dispatch. */
export interface TuiController {
  /** Latest folded view model. */
  getModel(): ViewModel
  /** Latest interaction state. */
  getInteraction(): InteractionState
  /** Top-bar badge (provider/model), resolved once the agent exists. */
  getBadge(): string
  /** Live session display title for the top bar, or '' before one binds. */
  getTitle(): string
  /** Latest session-directory state (rows, selection, open flag). */
  getSessionPane(): SessionPaneState
  /** Latest full-text search-panel state (query, candidates, open flag). */
  getSearchPane(): SearchPaneState
  /** Whether the read-only timeline view is open. */
  getTimelineOpen(): boolean
  /** Latest model-selection panel state (rows, filter, open flag). */
  getModelPane(): ModelPaneState
  /** Latest help-panel state (lines, open flag). */
  getHelpPane(): HelpPaneState
  /** Latest approval-slot state (open flag and pending request fields). */
  getApprovalPane(): ApprovalPaneState
  /** Latest ask-user slot (header, labels, selection). */
  getAskUserPane(): AskUserPaneState
  /** Latest permission-preset overlay (host names, selection, confirm). */
  getPermissionPane(): PermissionPaneState
  /** Latest settings overlay (host fields, selection, editing). */
  getSettingsPane(): SettingsPaneState
  /** Agent Hub overlay (`子代理`); browse replaces children and sets input null. */
  getAgentHubPane(): AgentHubPaneState
  /** Plan-directory overlay (`计划`). */
  getPlanDirectoryPane(): PlanDirectoryPaneState
  /** Workspace-tree overlay (`工作区`). */
  /** Workspace-tree overlay (`工作区`). */
  getWorkspacePane(): WorkspacePaneState
  /** Message-feedback overlay (`反馈`). */
  getFeedbackPane(): FeedbackPaneState
  /** Workflow-run overlay (`工作流`). */
  getWorkflowOverlay(): WorkflowOverlayState
  /** Jobs HUD rows; undefined or an empty list hides the HUD (S18). */
  getJobsHud?(): readonly JobHudItem[] | undefined
  /** Live workflow HUD snapshot; undefined hides the HUD (S18). */
  getWorkflowHud?(): WorkflowHudState | undefined
  /** Whole-log session stats for the idle status splice; undefined while absent. */
  getSessionStats?(): { turns: number; decodeTokens: number; llmMs: number } | undefined
  getWorkflowHud?(): WorkflowHudState | undefined
  /** Plan-review dialog (`计划评审`); occupies input like ask-user, not OverlayShell. */
  getPlanReviewPane(): PlanReviewPaneState
  /**
   * Composer-adjacent HUD strip. Undefined or empty means absent; a non-empty
   * strip never sets `input === null`.
   */
  getComposerHud(): string | undefined
  /**
   * Current goal view for the status-row footer; undefined hides the fragment.
   * @returns the goal view, or undefined.
   */
  getGoalFooter?(): GoalFooterView | undefined
  /** Provider, usage, context, and retry values for the adaptive footer. */
  getAdaptiveInfoFooter?(): AdaptiveInfoFooterView | undefined
  /**
   * Todo HUD rows; undefined or an empty list hides the HUD (S18).
   * @returns the todo rows, or undefined.
   */
  getTodoHud?(): readonly TodoHudItem[] | undefined
  /** Tools-registry lookup for presenter titles; absent or undefined keeps generic cards. */
  getToolPresenters?(): ToolPresenterLookup | undefined
  /** Whether Enter sends a chat message; false makes Enter insert a newline. */
  getSubmitOnEnter(): boolean
  /** Persisted generated-brand reveal mode; omitted controllers keep it off. */
  getBrandAnimation?(): 'auto' | 'on' | 'off'
  /** Session-transition progress or transient feedback for the status row. */
  getFeedback(): string | undefined
  /** Draft restored across an external-editor unmount/remount cycle. */
  getComposerDraft?(): string
  /** Number of later-turn drafts not yet handed to the Agent. */
  getQueuedDraftCount?(): number
  /** Plain-text projection of the oldest later-turn draft. */
  getQueuedDraftText?(): string | undefined
  /** Admit one clipboard image into the composer as a pending token. */
  intakeClipboardImage(): Promise<{ ok: true; token: string } | { ok: false; reason: string }>
  /** Admit one local image path pasted into the composer. */
  intakeImagePath(raw: string): Promise<{ ok: true; token: string } | { ok: false; reason: string }>
  /** Surface one transient status line (image-intake refusals). */
  note(text: string): void
  /** Record local user input for the notification quiet window. */
  noteUserActivity(): void
  /** Subscribe to store changes; returns an unsubscribe. */
  subscribe(callback: () => void): () => void
  /** Dispatch one runtime action. */
  dispatch(action: LoopAction): void
  /** The command directory for the `/` palette. */
  commands: readonly CommandItem[]
  /** The workspace base directory `@` mention queries resolve under. */
  getCwd(): string
  /** The runtime-injected `@` mention data source. */
  listMentions: ListMentions
}

/** TuiLoop props. */
export interface TuiLoopProps {
  /** Fallback top-bar title (app name), shown until the live session binds one. */
  title: string
  /** The controller seam. */
  controller: TuiController
  /** Strongest generated FishLogo glyph tier supported by the mounted terminal. */
  brandTier?: BrandRenderTier | undefined
  /** Whether `brandAnimation=auto` may animate this interactive mount. */
  brandAutoEligible?: boolean | undefined
  /** Optional dedicated render-cost probe for the generated home subtree. */
  brandFrameProbe?: FrameProbeHandle | undefined
}

/** Buffered input state the key reducer folds over. */
export interface LoopInputState {
  text: string
  commandQuery: string | undefined
  /** Controlled `/` palette row; omitted is the first match. */
  commandSelectedIndex?: number | undefined
  /** Escape hides the current `/` palette until the composer changes. */
  commandDismissed?: boolean | undefined
  /** True after a lone `g` key, awaiting the `s` half of the list toggle. */
  prefixG: boolean
  /** True while renaming the selected session row (the buffer holds the new title). */
  renaming: boolean
  /** Mention popup selected row, owned by the shipping TUI loop. */
  mentionSelectedIndex: number
  /** Whether Escape dismissed the current mention query until the next edit. */
  mentionDismissed: boolean
  /** Caret offset into `text`; omitted means the end of the buffer. */
  caretIndex?: number | undefined
}

/** One keyed action the reducer asks the owner to perform. */
export type LoopKeyEffect =
  | { kind: 'none' }
  | {
    kind: 'dispatch'
    action: LoopAction
    text: string
    commandQuery: string | undefined
    prefixG: boolean
    renaming: boolean
    mentionSelectedIndex?: number | undefined
    mentionDismissed?: boolean | undefined
    commandSelectedIndex?: number | undefined
    commandDismissed?: boolean | undefined
    /** Next caret offset; omitted means the end of the (possibly new) text. */
    caretIndex?: number | undefined
  }

interface MentionKeyState {
  readonly open: boolean
  readonly candidateCount: number
  readonly selectedIndex: number
  readonly selectedCandidate?: MentionCandidate | undefined
}

export function activeMentionQuery(text: string): string | undefined {
  if (!text.startsWith('@')) return undefined
  const query = text.slice(1)
  if (query === '') return ''
  return /\s/u.test(query) ? undefined : query
}

/**
 * Whether an Ink delivery is composable text — including multi-character IME
 * commits, which Ink passes through as one `sequence` string — rather than a
 * control, modified, or escape-residue key. Broken CSI sequences arrive with
 * the ESC byte already stripped by useInput, so they surface as `[`-prefixed
 * text and are rejected here; single letters and CJK characters pass.
 * @param key - the raw input string Ink delivers.
 * @param keyInfo - Ink's structured key info.
 * @returns true when the delivery should append to the active text buffer.
 */
/** Whether one string carries a C0/C1 control or DEL code point. */
function hasControlCodepoint(value: string): boolean {
  for (const char of value) {
    // A `for...of` character is never empty.
    const code = char.codePointAt(0) as number
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function isTextInput(key: string, keyInfo: Key): boolean {
  return (
    key.length > 0 &&
    !keyInfo.ctrl &&
    !keyInfo.meta &&
    !key.startsWith('[') &&
    !hasControlCodepoint(key)
  )
}

/**
 * Dispatch an action without mutating the composer buffer (approval keys, and
 * the existing `{ kind: 'none' }` hold pattern).
 * @param state - current buffered state.
 * @param action - controller action to emit.
 * @returns a dispatch effect that preserves text and commandQuery.
 */
function holdComposer(
  state: LoopInputState,
  action: LoopAction,
): LoopKeyEffect {
  return {
    kind: 'dispatch',
    action,
    text: state.text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming,
    mentionSelectedIndex: state.mentionSelectedIndex,
    mentionDismissed: state.mentionDismissed,
    commandSelectedIndex: state.commandSelectedIndex,
    commandDismissed: state.commandDismissed,
    caretIndex: state.caretIndex,
  }
}

/**
 * Draft-mode key routing shared by the settings field editor and the
 * workspace path draft: Esc cancels, Enter applies, arrows/backspace/text
 * edit the composer buffer in place, everything else is swallowed.
 * @param state - current buffered state.
 * @param key - the printable key, if any.
 * @param keyInfo - Ink's key flags.
 * @param actions - the cancel action and the apply-action factory.
 * @returns the key effect.
 */
function draftKeyEffect(
  state: LoopInputState,
  key: string,
  keyInfo: Key,
  actions: { cancel: LoopAction; apply: (text: string) => LoopAction },
): LoopKeyEffect {
  if (keyInfo.escape) {
    return {
      kind: 'dispatch',
      action: actions.cancel,
      text: '',
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.return) {
    return {
      kind: 'dispatch',
      action: actions.apply(state.text),
      text: '',
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.backspace) {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    const previous = moveCaretByGrapheme(state.text, caret, -1)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text.slice(0, previous) + state.text.slice(caret),
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: previous,
    }
  }
  if (keyInfo.leftArrow || keyInfo.rightArrow) {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text,
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: moveCaretByGrapheme(state.text, caret, keyInfo.leftArrow ? -1 : 1),
    }
  }
  if (isTextInput(key, keyInfo)) {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text.slice(0, caret) + key + state.text.slice(caret),
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: caret + key.length,
    }
  }
  return { kind: 'none' }
}

/**
 * K20 overlay chord for an armed `g`. `a`/`t`/`f`/`w` map to the four
 * browse overlays; undefined means the key is not an overlay chord.
 * @param key - the second half of the g-prefix chord.
 * @returns the overlay toggle action, or undefined.
 */
function overlayChordAction(key: string): LoopAction | undefined {
  switch (key) {
    case 'a':
      return { kind: 'agent-hub' }
    case 't':
      return { kind: 'workspace-pane' }
    case 'f':
      return { kind: 'feedback-pane' }
    case 'w':
      return { kind: 'workflow-overlay' }
    default:
      return undefined
  }
}

/**
 * Whether the armed `g` plus this key is a K2 overlay chord (K2′ refuses it
 * while a dialog occupies the composer).
 * @param state - current buffered state.
 * @param key - the candidate second-half key.
 * @returns true when the pair is `g a` / `g t` / `g f` / `g w` inside the window.
 */
function isArmedOverlayChord(state: LoopInputState, key: string): boolean {
  return state.prefixG && state.text === 'g' && overlayChordAction(key) !== undefined
}

/**
 * Fold one Ink key event over the composer and modal-panel state. Trailing
 * `{ approval, askUser, permission, settings }` default closed so existing
 * callers stay composer-only. A trailing overlays bag
 * `{ agentHub, planDirectory, workspace, feedback, workflowOverlay, planReview }`
 * defaults all `{ open: false }`. While `approval.open`, y/a/n/d/Esc/i map to
 * approval actions and printable keys do not append; while approval or
 * ask-user is open, browse chords (g s, Ctrl+K, Ctrl+T, /help, empty
 * /permission, empty /settings) stay inert.
 * @param state - current buffered state.
 * @param key - the raw input string Ink delivers.
 * @param keyInfo - Ink's structured key info.
 * @param commands - the command directory for Tab completion.
 * @param pane - session-directory open flag and highlighted row id.
 * @param search - search-panel open flag and highlighted candidate id.
 * @param timeline - timeline open flag.
 * @param modelPane - model-panel open flag and highlighted row id.
 * @param helpPane - help-panel open flag.
 * @param approval - approval-slot open flag.
 * @param askUser - ask-user-slot open flag (keys land in 04-06).
 * @param permission - permission-panel open flag; j/k, 1-3, Enter, and Esc
 *   stay on the overlay and do not append to the composer.
 * @param settings - settings-panel open flag; browse keys stay on the overlay,
 *   and while `editing` the composer holds the draft field value. `onboarding`
 *   keeps the composer in edit mode for the first API key.
 * @param submitOnEnter - when false, Enter inserts a newline and Ctrl+Enter sends.
 * @param overlays - K2 overlay and plan-review open flags; omitted fields are closed.
 * @returns the next buffered state and, when applicable, the controller action.
 */
export function mapKeyEvent(
  state: LoopInputState,
  key: string,
  keyInfo: Key,
  commands: readonly CommandItem[],
  pane: { open: boolean; selectedId: string | undefined },
  search: { open: boolean; selectedId: string | undefined },
  timeline: { open: boolean } = { open: false },
  modelPane: { open: boolean; selectedId: string | undefined } = {
    open: false,
    selectedId: undefined,
  },
  helpPane: { open: boolean } = { open: false },
  approval: { open: boolean } = { open: false },
  askUser: { open: boolean; optionCount?: number } = { open: false },
  permission: { open: boolean } = { open: false },
  settings: {
    open: boolean
    editing?: boolean | undefined
    editValue?: string | undefined
    onboarding?: boolean | undefined
  } = {
    open: false,
  },
  submitOnEnter = true,
  overlays: {
    agentHub?: { open: boolean }
    planDirectory?: { open: boolean }
    workspace?: {
      open: boolean
      editing?: boolean | undefined
      rootPath?: string | undefined
      selectedKind?: 'directory' | 'file' | 'other' | undefined
      selectedPath?: string | undefined
    }
    feedback?: {
      open: boolean
      editing?: boolean | undefined
      note?: string | undefined
    }
    workflowOverlay?: { open: boolean }
    planReview?: { open: boolean }
  } = {},
  mention: MentionKeyState = {
    open: false,
    candidateCount: 0,
    selectedIndex: 0,
    selectedCandidate: undefined,
  },
  queuedDraft: { readonly headText?: string | undefined } = {},
  compaction: { readonly available: boolean } = { available: false },
): LoopKeyEffect {
  const commandMode =
    (state.commandQuery !== undefined || state.text.startsWith('/'))
    && state.commandDismissed !== true
  const mentionMode = activeMentionQuery(state.text) !== undefined
  const agentHubOpen = overlays.agentHub?.open === true
  const planDirectoryOpen = overlays.planDirectory?.open === true
  const workspaceOpen = overlays.workspace?.open === true
  const feedbackOpen = overlays.feedback?.open === true
  const workflowOverlayOpen = overlays.workflowOverlay?.open === true
  const planReviewOpen = overlays.planReview?.open === true
  const overlayBrowseOpen =
    agentHubOpen
    || planDirectoryOpen
    || workspaceOpen
    || feedbackOpen
    || workflowOverlayOpen
  const dialogOpen = approval.open || askUser.open || planReviewOpen
  if (keyActionFor(key, keyInfo) === 'copy-message') {
    return holdComposer(state, { kind: 'copy-message' })
  }
  if (keyActionFor(key, keyInfo) === 'intake-clipboard-image') {
    return holdComposer(state, { kind: 'intake-clipboard-image' })
  }
  if (keyActionFor(key, keyInfo) === 'edit-external') {
    return holdComposer(state, { kind: 'edit-external', text: state.text })
  }
  if (
    keyActionFor(key, keyInfo) === 'toggle-compaction-divider'
    && compaction.available
  ) {
    return holdComposer(state, { kind: 'toggle-compaction-divider' })
  }
  if (keyInfo.ctrl && key === 'c') {
    return {
      kind: 'dispatch',
      action: { kind: 'sigint' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.ctrl && key === 'o') {
    return {
      kind: 'dispatch',
      action: { kind: 'toggle-reasoning' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.ctrl && key === 'e') {
    return {
      kind: 'dispatch',
      action: { kind: 'toggle-tool-cards' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.ctrl && key === 'n') {
    return {
      kind: 'dispatch',
      action: { kind: 'new-session' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: false,
    }
  }
  if (keyInfo.ctrl && key === 'k') {
    if (dialogOpen) return { kind: 'none' }
    // Toggle the search panel; the query buffer starts and ends empty.
    return {
      kind: 'dispatch',
      action: { kind: 'search-pane' },
      text: '',
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.ctrl && key === 't') {
    if (dialogOpen) return { kind: 'none' }
    return {
      kind: 'dispatch',
      action: { kind: 'toggle-timeline' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (approval.open) {
    if (isArmedOverlayChord(state, key)) {
      return { kind: 'none' }
    }
    if (key === 'y' || key === 'a') {
      return holdComposer(state, { kind: 'approval-allow' })
    }
    if (key === 'n' || key === 'd' || keyInfo.escape) {
      return holdComposer(state, { kind: 'approval-deny' })
    }
    if (key === 'i') {
      return holdComposer(state, { kind: 'approval-detail' })
    }
    return { kind: 'none' }
  }
  if (askUser.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: 'ask-user-cancel' })
    }
    if (keyInfo.return) {
      if ((askUser.optionCount ?? 0) === 0) return { kind: 'none' }
      return holdComposer(state, { kind: 'ask-user-submit' })
    }
    if (key >= '1' && key <= '9') {
      const index = Number(key) - 1
      if (index >= (askUser.optionCount ?? 0)) return { kind: 'none' }
      return holdComposer(state, { kind: 'ask-user-digit', index })
    }
    if ((askUser.optionCount ?? 0) > 0 && !keyInfo.ctrl) {
      if (key === 'j' || keyInfo.downArrow) {
        return holdComposer(state, { kind: 'ask-user-move', delta: 1 })
      }
      if (key === 'k' || keyInfo.upArrow) {
        return holdComposer(state, { kind: 'ask-user-move', delta: -1 })
      }
    }
    return { kind: 'none' }
  }
  if (planReviewOpen) {
    if (isArmedOverlayChord(state, key)) {
      return { kind: 'none' }
    }
    if (key === 'y') {
      return holdComposer(state, { kind: 'plan-review-approve' })
    }
    if (key === 'n') {
      return holdComposer(state, { kind: 'plan-review-keep' })
    }
    if (keyInfo.escape) {
      return holdComposer(state, { kind: 'ask-user-cancel' })
    }
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'plan-review-scroll', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'plan-review-scroll', delta: -1 })
    }
    return { kind: 'none' }
  }
  if (permission.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: 'permission-escape' })
    }
    if (keyInfo.return) {
      return holdComposer(state, { kind: 'permission-apply' })
    }
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'permission-move', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'permission-move', delta: -1 })
    }
    if (key === '1' || key === '2' || key === '3') {
      return holdComposer(state, {
        kind: 'permission-jump',
        index: Number(key) - 1,
      })
    }
    return { kind: 'none' }
  }
  if (settings.open && (settings.editing === true || settings.onboarding === true)) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel:
        settings.onboarding === true
          ? { kind: 'settings-escape' }
          : { kind: 'settings-cancel-edit' },
      apply: text => ({ kind: 'settings-apply', value: text }),
    })
  }
  if (workspaceOpen && overlays.workspace?.editing === true) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel: { kind: 'workspace-cancel-edit' },
      apply: text => ({ kind: 'workspace-apply', value: text }),
    })
  }
  if (feedbackOpen && overlays.feedback?.editing === true) {
    return draftKeyEffect(state, key, keyInfo, {
      cancel: { kind: 'feedback-note-cancel' },
      apply: text => ({ kind: 'feedback-note-apply', value: text }),
    })
  }
  if (settings.open) {
    if (keyInfo.escape) {
      return holdComposer(state, { kind: 'settings-escape' })
    }
    if (keyInfo.return) {
      return {
        kind: 'dispatch',
        action: { kind: 'settings-edit' },
        text: settings.editValue ?? '',
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'settings-move', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'settings-move', delta: -1 })
    }
    if (key === 'e') {
      return holdComposer(state, { kind: 'settings-export' })
    }
    if (key === 'r') {
      return holdComposer(state, { kind: 'settings-reload' })
    }
    return { kind: 'none' }
  }
  if (keyInfo.escape) {
    if (commandMode) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: state.text,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        commandSelectedIndex: 0,
        commandDismissed: true,
        caretIndex: state.caretIndex,
      }
    }
    if (mention.open) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: state.text,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        mentionDismissed: true,
      }
    }
    if (agentHubOpen) {
      return holdComposer(state, { kind: 'agent-hub-escape' })
    }
    if (planDirectoryOpen) {
      return holdComposer(state, { kind: 'plan-directory-escape' })
    }
    if (workspaceOpen) {
      return holdComposer(state, { kind: 'workspace-escape' })
    }
    if (feedbackOpen) {
      return holdComposer(state, { kind: 'feedback-escape' })
    }
    if (workflowOverlayOpen) {
      return holdComposer(state, { kind: 'workflow-overlay-escape' })
    }
    if (modelPane.open) {
      // Close the model panel; the composer buffer stays empty as it was
      // when `/model` opened it (K4: focus returns to the input).
      return {
        kind: 'dispatch',
        action: { kind: 'model-pane' },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (helpPane.open) {
      return {
        kind: 'dispatch',
        action: { kind: 'help-pane' },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (search.open) {
      return {
        kind: 'dispatch',
        action: { kind: 'search-pane' },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (state.renaming) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false,
      }
    }
    if (pane.open) {
      return {
        kind: 'dispatch',
        action: { kind: 'session-pane' },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false,
      }
    }
    if (timeline.open) {
      return {
        kind: 'dispatch',
        action: { kind: 'toggle-timeline' },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text,
      commandQuery: undefined,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.return) {
    if (mention.open) {
      if (mention.selectedCandidate === undefined) return { kind: 'none' }
      const inserted = normalizeMentionInsertion(mention.selectedCandidate)
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: inserted,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: 0,
        mentionDismissed: false,
        caretIndex: inserted.length,
      }
    }
    if (agentHubOpen) {
      return holdComposer(state, { kind: 'agent-hub-enter' })
    }
    if (planDirectoryOpen) {
      return holdComposer(state, { kind: 'plan-directory-apply' })
    }
    if (workspaceOpen) {
      if (overlays.workspace?.selectedKind === 'file') {
        // File Enter inserts the displayPath at the caret; the controller closes.
        const caret = clampCaretIndex(state.text, state.caretIndex)
        const path = overlays.workspace.selectedPath ?? ''
        return {
          kind: 'dispatch',
          action: { kind: 'workspace-enter' },
          text: state.text.slice(0, caret) + path + state.text.slice(caret),
          commandQuery: undefined,
          prefixG: false,
          renaming: state.renaming,
          caretIndex: caret + path.length,
        }
      }
      return holdComposer(state, { kind: 'workspace-enter' })
    }
    if (modelPane.open) {
      if (modelPane.selectedId === undefined) return { kind: 'none' }
      return {
        kind: 'dispatch',
        action: { kind: 'select-model', id: modelPane.selectedId },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (helpPane.open) {
      // Enter closes the help sheet like Escape.
      return {
        kind: 'dispatch',
        action: { kind: 'help-pane' },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (search.open) {
      if (search.selectedId === undefined) return { kind: 'none' }
      return {
        kind: 'dispatch',
        action: { kind: 'select-session', id: search.selectedId },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (state.renaming) {
      return {
        kind: 'dispatch',
        action: { kind: 'rename-session', title: state.text },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false,
      }
    }
    if (pane.open) {
      if (pane.selectedId === undefined) return { kind: 'none' }
      return {
        kind: 'dispatch',
        action: { kind: 'select-session', id: pane.selectedId },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: false,
      }
    }
    if (keyInfo.shift || (!submitOnEnter && !keyInfo.ctrl && !commandMode)) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: `${state.text}\n`,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (commandMode) {
      const query = resolveEnterQuery(
        commands,
        state.commandQuery ?? state.text.slice(1),
        state.commandSelectedIndex ?? 0,
      )
      return {
        kind: 'dispatch',
        action: { kind: 'command', query },
        text: '',
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        commandSelectedIndex: 0,
        commandDismissed: false,
      }
    }
    return {
      kind: 'dispatch',
      action: { kind: 'send', text: state.text },
      text: '',
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (keyInfo.backspace) {
    if (modelPane.open) {
      const shortened = state.text.slice(0, -1)
      return {
        kind: 'dispatch',
        action: { kind: 'model-filter', query: shortened },
        text: shortened,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    if (helpPane.open) {
      // The help sheet is static; the backspace key stays inert.
      return { kind: 'none' }
    }
    if (search.open) {
      const shortened = state.text.slice(0, -1)
      return {
        kind: 'dispatch',
        action: { kind: 'search', query: shortened },
        text: shortened,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    const caret = clampCaretIndex(state.text, state.caretIndex)
    const previous = moveCaretByGrapheme(state.text, caret, -1)
    const shortened = state.text.slice(0, previous) + state.text.slice(caret)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: shortened,
      commandQuery: shortened.startsWith('/') ? shortened.slice(1) : undefined,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: previous,
    }
  }
  if (key === '\t' || keyInfo.tab) {
    if (mention.open) {
      if (mention.selectedCandidate === undefined) return { kind: 'none' }
      const inserted = normalizeMentionInsertion(mention.selectedCandidate)
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: inserted,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: 0,
        mentionDismissed: false,
        commandSelectedIndex: 0,
        commandDismissed: false,
        caretIndex: inserted.length,
      }
    }
    if (commandMode) {
      const query = state.commandQuery ?? state.text.slice(1)
      const completed = completeSelected(commands, query, state.commandSelectedIndex ?? 0)
      if (completed !== undefined) {
        return {
          kind: 'dispatch',
          action: { kind: 'none' as never },
          text: `/${completed.name}`,
          commandQuery: completed.name,
          prefixG: false,
          renaming: state.renaming,
          commandSelectedIndex: 0,
          commandDismissed: false,
          caretIndex: completed.name.length + 1,
        }
      }
    }
    // Tab outside command mode is an intervening key: it disarms the chord.
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (commandMode && (key === 'j' || keyInfo.downArrow || key === 'k' || keyInfo.upArrow)) {
    const query = state.commandQuery ?? state.text.slice(1)
    const count = filterCommands(commands, query).length
    const delta = key === 'j' || keyInfo.downArrow ? 1 : -1
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text,
      commandQuery: state.commandQuery ?? query,
      prefixG: false,
      renaming: state.renaming,
      commandSelectedIndex: moveSelectionIndex(state.commandSelectedIndex ?? 0, delta, count),
      commandDismissed: false,
      caretIndex: state.caretIndex,
    }
  }
  if (state.renaming) {
    // Rename mode captures every printable key into the title buffer —
    // including multi-character IME commits; Escape/Enter/Backspace already
    // returned above and non-text keys stay inert.
    if (!isTextInput(key, keyInfo)) {
      return { kind: 'none' }
    }
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text + key,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (mention.open) {
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: moveSelectionIndex(mention.selectedIndex, 1, mention.candidateCount),
        mentionDismissed: false,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        mentionSelectedIndex: moveSelectionIndex(mention.selectedIndex, -1, mention.candidateCount),
        mentionDismissed: false,
        caretIndex: state.caretIndex,
      }
    }
  }
  if (search.open) {
    // Search mode owns the keymap: j/k move the candidate highlight, every
    // other printable key filters the query. Escape/Enter/Backspace already
    // returned above; `g s` is inert here.
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'session-pane-move', delta: 1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'session-pane-move', delta: -1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (isTextInput(key, keyInfo)) {
      const appended = state.text + key
      return {
        kind: 'dispatch',
        action: { kind: 'search', query: appended },
        text: appended,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    return { kind: 'none' }
  }
  if (timeline.open) {
    // Timeline mode owns j/k (scroll the 60-row window) and Escape (close,
    // handled above); every other key is inert.
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'timeline-scroll', delta: 1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'timeline-scroll', delta: -1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    return { kind: 'none' }
  }
  if (modelPane.open) {
    // Model pane owns the keymap: j/k move the highlight, every printable key
    // filters the catalog (mirroring search mode). Escape/Enter/Backspace
    // already returned above; `g s` stays inert here.
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'model-move', delta: 1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'model-move', delta: -1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (isTextInput(key, keyInfo)) {
      const appended = state.text + key
      return {
        kind: 'dispatch',
        action: { kind: 'model-filter', query: appended },
        text: appended,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    return { kind: 'none' }
  }
  if (helpPane.open) {
    // Help pane owns j/k (scroll the sheet window) and Escape/Enter (close,
    // handled above); every other key is inert.
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'help-scroll', delta: 1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'help-scroll', delta: -1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    return { kind: 'none' }
  }
  if (key === 'g' && state.text === '') {
    // Buffer-preserving chord: the `g` enters the buffer first and arms the
    // 600ms window (CHORD_WINDOW_MS); the owner clears it on timeout. The
    // chord arms only on an empty composer, so `/settings` and the ordinary
    // word `settings` never fire the session-list toggle (K1).
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: 'g',
      commandQuery: state.commandQuery,
      prefixG: true,
      renaming: state.renaming,
      caretIndex: 1,
    }
  }
  if (key === 's' && state.prefixG && state.text === 'g') {
    // Chord wins inside the window: remove the armed `g` from the buffer and
    // toggle the session list.
    return {
      kind: 'dispatch',
      action: { kind: 'session-pane' },
      text: '',
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  const overlayAction = overlayChordAction(key)
  if (overlayAction !== undefined && state.prefixG && state.text === 'g') {
    return {
      kind: 'dispatch',
      action: overlayAction,
      text: '',
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  if (agentHubOpen) {
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'agent-hub-move', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'agent-hub-move', delta: -1 })
    }
  }
  if (planDirectoryOpen) {
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'plan-directory-move', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'plan-directory-move', delta: -1 })
    }
  }
  if (workflowOverlayOpen) {
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'workflow-overlay-scroll', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'workflow-overlay-scroll', delta: -1 })
    }
  }
  if (workspaceOpen) {
    if (key === 'j' || keyInfo.downArrow) {
      return holdComposer(state, { kind: 'workspace-move', delta: 1 })
    }
    if (key === 'k' || keyInfo.upArrow) {
      return holdComposer(state, { kind: 'workspace-move', delta: -1 })
    }
    if (key === 'e') {
      // The path draft prefills the composer with the current root (D-09).
      const draft = overlays.workspace?.rootPath ?? ''
      return {
        kind: 'dispatch',
        action: { kind: 'workspace-edit' },
        text: draft,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: draft.length,
      }
    }
  }
  if (feedbackOpen) {
    if (key === 'l') {
      return holdComposer(state, { kind: 'feedback-rate', rating: 'positive' })
    }
    if (key === 'd') {
      return holdComposer(state, { kind: 'feedback-rate', rating: 'negative' })
    }
    if (key === 'e') {
      // The note draft prefills with the current note (settings edit analog).
      const draft = overlays.feedback?.note ?? ''
      return {
        kind: 'dispatch',
        action: { kind: 'feedback-note-edit' },
        text: draft,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: draft.length,
      }
    }
  }
  if (overlayBrowseOpen) {
    return { kind: 'none' }
  }
  if (pane.open) {
    if (key === 'j' || keyInfo.downArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'session-pane-move', delta: 1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'k' || keyInfo.upArrow) {
      return {
        kind: 'dispatch',
        action: { kind: 'session-pane-move', delta: -1 },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: state.caretIndex,
      }
    }
    if (key === 'r') {
      return {
        kind: 'dispatch',
        action: { kind: 'none' as never },
        text: '',
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: true,
      }
    }
    if (key === 'd') {
      return {
        kind: 'dispatch',
        action: { kind: 'delete-session' },
        text: state.text,
        commandQuery: state.commandQuery,
        prefixG: false,
        renaming: state.renaming,
      }
    }
    // Any other key in list mode cancels an armed delete without closing the
    // list (K6); the pane itself ignores the key.
    return {
      kind: 'dispatch',
      action: { kind: 'session-pane-idle' },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
    }
  }
  // ←/→ move the composer caret one grapheme; ↑/↓ scroll the conversation
  // even while the composer holds a draft (j/k stay ordinary letters then).
  if (keyInfo.leftArrow || keyInfo.rightArrow) {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: moveCaretByGrapheme(
        state.text,
        caret,
        keyInfo.leftArrow ? -1 : 1,
      ),
    }
  }
  if (keyInfo.pageUp) {
    return holdComposer(state, { kind: 'scroll', delta: HISTORY_WINDOW_SIZE })
  }
  if (keyInfo.pageDown) {
    return holdComposer(state, { kind: 'scroll', delta: -HISTORY_WINDOW_SIZE })
  }
  if (keyInfo.home) {
    return holdComposer(state, { kind: 'scroll-edge', edge: 'oldest' })
  }
  if (keyInfo.end) {
    return holdComposer(state, { kind: 'scroll-edge', edge: 'latest' })
  }
  if (keyInfo.upArrow) {
    if (state.text === '' && queuedDraft.headText !== undefined) {
      return {
        kind: 'dispatch',
        action: { kind: 'take-queued-draft' },
        text: queuedDraft.headText,
        commandQuery: undefined,
        prefixG: false,
        renaming: state.renaming,
        caretIndex: queuedDraft.headText.length,
      }
    }
    return {
      kind: 'dispatch',
      action: { kind: 'scroll', delta: 1 },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: state.caretIndex,
    }
  }
  if (keyInfo.downArrow) {
    return {
      kind: 'dispatch',
      action: { kind: 'scroll', delta: -1 },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: state.caretIndex,
    }
  }
  // j/k scroll only while the composer is empty (j newer, k older); with
  // text buffered they are ordinary letters (02-UI-SPEC §3 scrolling vs K4).
  if (key === 'j' && state.text === '') {
    return {
      kind: 'dispatch',
      action: { kind: 'scroll', delta: -1 },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: state.caretIndex,
    }
  }
  if (key === 'k' && state.text === '') {
    return {
      kind: 'dispatch',
      action: { kind: 'scroll', delta: 1 },
      text: state.text,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: state.caretIndex,
    }
  }
  if (key === 'G' && state.text === '') {
    return holdComposer(state, { kind: 'scroll-edge', edge: 'latest' })
  }
  if (key === '/') {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    const text = `${state.text.slice(0, caret)}/${state.text.slice(caret)}`
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text,
      commandQuery: text.startsWith('/') ? text.slice(1) : state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      caretIndex: caret + 1,
      commandSelectedIndex: 0,
      commandDismissed: false,
    }
  }
  if (key === '@') {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: `${state.text.slice(0, caret)}@${state.text.slice(caret)}`,
      commandQuery: state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + 1,
    }
  }
  if (isTextInput(key, keyInfo)) {
    const caret = clampCaretIndex(state.text, state.caretIndex)
    const appended = state.text.slice(0, caret) + key + state.text.slice(caret)
    return {
      kind: 'dispatch',
      action: { kind: 'none' as never },
      text: appended,
      commandQuery: appended.startsWith('/') ? appended.slice(1) : state.commandQuery,
      prefixG: false,
      renaming: state.renaming,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + key.length,
    }
  }
  void mentionMode
  // Any other printable-or-unknown key is an intervening key: keep the text,
  // disarm the chord, and stay in normal mode.
  return {
    kind: 'dispatch',
    action: { kind: 'none' as never },
    text: state.text,
    commandQuery: state.commandQuery,
    prefixG: false,
    renaming: state.renaming,
  }
}

/**
 * The status-row feedback string with control bytes neutralized. Every
 * failure reason may carry user/model/storage payload, so the render seam
 * escapes before the terminal sees it (A1).
 * @param feedback - the raw feedback text, or undefined when clear.
 * @returns the terminal-safe label, or undefined when clear.
 */
export function feedbackLabel(
  feedback: string | undefined,
): string | undefined {
  return feedback === undefined ? undefined : escapeContent(feedback)
}

/** Whether the status row currently carries a session-transition progress label. */
function isSessionTransitionStatus(value: string | undefined): boolean {
  return value !== undefined && value.startsWith('正在') && value.endsWith('会话…')
}

/** Whether an action would begin another session lifecycle chain. */
function isSessionTransitionAction(action: LoopAction): boolean {
  return action.kind === 'new-session' || action.kind === 'select-session'
}

/**
 * The status row styled against the installed tier. The status text is
 * static copy, so escaping is identity; the accent token marks the current
 * interactive affordance (02-UI-SPEC §1.3).
 * @param interaction - the interaction state.
 * @returns the styled status text.
 */
export function statusLine(interaction: InteractionState): string {
  return styled(escapeContent(statusText(interaction)), 'accent')
}

/** The fgDim key-hint line beside the generation status (02-UI-SPEC §1.3 L3);
 * `/` and `@` stay on the idle composer and `/help`, not the status row. */
export const STATUS_HINT = '↑↓/jk 滚动'

/**
 * The fgDim key hint, shown only beside the generating/stopped status rows
 * (W2-T6); the exit-armed and idle states carry no hint.
 * @param interaction - the interaction state.
 * @returns the styled hint, or '' when the state shows none.
 */
export function statusHint(interaction: InteractionState, occupied = false): string {
  if (occupied) return ''
  if (interaction !== 'generating' && interaction !== 'stopped') return ''
  return styled(escapeContent(STATUS_HINT), 'fgDim')
}

/**
 * The composed status row for the AppShell slot: the accent status label
 * plus the fgDim key hint where the state carries one, painted through the
 * bg strip per part so the pure-black frame leaves no SGR gap (gap audit
 * blocker#1). A current goal prepends its `目标 …` fragment ahead of the label.
 * @param interaction - the interaction state.
 * @param occupied - whether a dialog owns input (suppresses the scroll hint).
 * @param goal - the goal footer runs, when a goal is current.
 * @returns the full painted row.
 */
export function statusSlot(
  interaction: InteractionState,
  occupied = false,
  goal?: GoalFooterRuns,
): string {
  const parts: string[] = []
  if (goal !== undefined) {
    parts.push(styled(goal.head, 'fg'), styled(` · ${goal.objective} · `, 'fgDim'))
  }
  parts.push(statusLine(interaction))
  const hint = statusHint(interaction, occupied)
  if (hint !== '') parts.push(` · ${hint}`)
  return paintRow(parts)
}

/**
 * Shorten one cwd against the user's home directory for the idle composer
 * status row.
 * @param cwd - the working directory to display.
 * @param home - the user's home directory.
 * @returns `~`-shortened cwd, or the input when it lives outside home.
 */
export function shortenHomePath(cwd: string, home: string): string {
  if (cwd === home) return '~'
  if (home !== '' && cwd.startsWith(`${home}/`)) return `~${cwd.slice(home.length)}`
  return cwd
}

/**
 * The idle status slot copy: home-shortened cwd, the provider/model badge,
 * and the `/` `@` palette hints joined by ` · `. An empty badge drops its
 * segment (I1: no invented placeholder).
 * @param cwd - the working directory shown first.
 * @param badge - the provider · model badge, or '' when unresolved.
 * @param home - the home directory used for `~` shortening.
 * @returns the plain idle status text.
 */
export function formatIdleComposerStatus(cwd: string, badge: string, home: string): string {
  const parts = [shortenHomePath(cwd, home)]
  if (badge !== '') parts.push(badge)
  parts.push('/ 命令 · @ 提及')
  return parts.join(' · ')
}

/**
 * Width-safe idle footer copy. Keeps cwd/provider-model before whole-session
 * stats and `/` `@` hints; low-priority segments drop before the row wraps.
 * @param columns - available terminal columns.
 * @param cwd - working directory.
 * @param badge - provider/model badge.
 * @param home - home directory for `~` shortening.
 * @param statsText - aggregate session statistics, when available.
 * @returns one physical-row plain text.
 */
export function composeIdleComposerStatus(
  columns: number,
  cwd: string,
  badge: string,
  home: string,
  statsText?: string,
): string {
  const base = badge === ''
    ? shortenHomePath(cwd, home)
    : `${shortenHomePath(cwd, home)} · ${badge}`
  const hints = '/ 命令 · @ 提及'
  let line = base
  if (statsText !== undefined && displayWidth(`${line} · ${statsText}`) <= columns) {
    line = `${line} · ${statsText}`
  }
  if (displayWidth(`${line} · ${hints}`) <= columns) {
    line = `${line} · ${hints}`
  }
  return truncateDisplay(line, Math.max(1, columns))
}

/** Loop-owned conversation view-shift cap in rows (↑/k paging a tall turn). */
export const MAX_VIEW_SHIFT = 400

/**
 * Clamp one loop-owned view-shift delta into [0, {@link MAX_VIEW_SHIFT}].
 * @param current - current shift in rows.
 * @param delta - +1 older (up), -1 newer (down).
 * @returns the clamped next shift.
 */
export function clampViewShift(current: number, delta: number): number {
  return Math.max(0, Math.min(current + delta, MAX_VIEW_SHIFT))
}


/**
 * The feedback row styled against the installed tier. The glyph is the
 * state symbol (03-UI-SPEC §5): a `✓`-prefixed line renders in success, any
 * other failure line in error. Content is escaped by {@link feedbackLabel}
 * before styling (A1/A3). The `neutral` variant renders plain foreground
 * for informational lines that carry no ✓/✗ state symbol (the old `/help`
 * `✓ ` prefix was a workaround for this missing variant).
 * @param feedback - the raw feedback text, or undefined when clear.
 * @param style - `auto` maps the ✓/✗ prefix, `neutral` uses plain `fg`.
 * @returns the styled feedback line, or undefined when clear.
 */
export function feedbackLine(
  feedback: string | undefined,
  style: 'auto' | 'neutral' = 'auto',
): string | undefined {
  const label = feedbackLabel(feedback)
  if (label === undefined) return undefined
  if (style === 'neutral') return styled(label, 'fg')
  if (isSessionTransitionStatus(feedback)) return styled(label, 'accent')
  return styled(label, label.startsWith('✓') ? 'success' : 'error')
}

/** Status-line text per interaction state (02-UI-SPEC §1.3 L3 / I1). */
function statusText(interaction: InteractionState): string {
  switch (interaction) {
    case 'generating':
      return '⏹ Ctrl+C 停止'
    case 'stopped':
      return '继续生成'
    case 'exit-armed':
      return '再按一次 Ctrl+C 退出'
    case 'idle':
      return ''
  }
}

/**
 * Compose the shell, one active content panel, status row, and composer while
 * routing keyboard and paste input through the injected controller. Panel focus
 * is exclusive, chord timeout ownership stays local, and session lifecycle state
 * remains owned by the controller.
 * @param props - fallback title and controller-backed stores, commands, mentions, and dispatch.
 * @returns the subscribed Ink element tree for the current controller state.
 */
export function TuiLoop({
  title,
  controller,
  brandTier = 'plain',
  brandAutoEligible = false,
  brandFrameProbe,
}: TuiLoopProps): ReactNode {
  const [state, setState] = useState<LoopInputState>({
    text: controller.getComposerDraft?.() ?? '',
    commandQuery: undefined,
    commandSelectedIndex: 0,
    commandDismissed: false,
    prefixG: false,
    renaming: false,
    mentionSelectedIndex: 0,
    mentionDismissed: false,
  })
  const [mentionPhase, setMentionPhase] = useState<MentionPhase>('ready')
  const [mentionCandidates, setMentionCandidates] = useState<
    readonly MentionCandidate[]
  >([])
  const [timelineOffset, setTimelineOffset] = useState(0)
  const [helpOffset, setHelpOffset] = useState(0)
  const [planReviewOffset, setPlanReviewOffset] = useState(0)
  const [viewShift, setViewShift] = useState(0)
  const brandRevealStartedRef = useRef(false)
  const brandRevealStoppedRef = useRef(false)
  // The input and paste handlers fold and write the loop buffer. React runs
  // setState updaters during render, so dispatching, notifying the store, or
  // starting timers inside one would schedule updates mid-render ("Cannot
  // update a component while rendering"); handlers therefore perform side
  // effects directly and route state through this write-through ref, mirrored
  // on commit so back-to-back events never fold on stale state.
  const stateRef = useRef(state)
  const mentionSeqRef = useRef(0)
  const mentionAbortRef = useRef<AbortController | undefined>(undefined)
  stateRef.current = state
  const model = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getModel(),
  )
  const interaction = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getInteraction(),
  )
  const badge = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getBadge(),
  )
  const liveTitle = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getTitle(),
  )
  const pane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getSessionPane(),
  )
  const search = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getSearchPane(),
  )
  const timelineOpen = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getTimelineOpen(),
  )
  const modelPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getModelPane(),
  )
  const helpPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getHelpPane(),
  )
  const approvalPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getApprovalPane(),
  )
  const askUserPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getAskUserPane(),
  )
  const permissionPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getPermissionPane(),
  )
  const settingsPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getSettingsPane(),
  )
  const agentHubPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getAgentHubPane(),
  )
  const planDirectoryPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getPlanDirectoryPane(),
  )
  const workspacePane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getWorkspacePane(),
  )
  const feedbackPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getFeedbackPane(),
  )
  const workflowOverlay = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getWorkflowOverlay(),
  )
  const planReviewPane = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getPlanReviewPane(),
  )
  const composerHud = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getComposerHud(),
  )
  const queuedDraftText = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getQueuedDraftText?.(),
  )
  const queuedDraftCount = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getQueuedDraftCount?.() ?? 0,
  )
  const goalFooter = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getGoalFooter?.(),
  )
  const adaptiveInfoFooter = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getAdaptiveInfoFooter?.(),
  )
  const todoHud = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getTodoHud?.(),
  )
  const jobsHud = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getJobsHud?.(),
  )
  const workflowHud = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getWorkflowHud?.(),
  )
  const sessionStats = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getSessionStats?.(),
  )
  const brandAnimationMode = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getBrandAnimation?.() ?? 'off',
  )
  const { columns } = useWindowSize()
  // Reopening the help sheet starts at the top (K4 focus returns to the input).
  useEffect(() => {
    if (helpPane.open) setHelpOffset(0)
  }, [helpPane.open])
  useEffect(() => {
    if (planReviewPane.open) setPlanReviewOffset(0)
  }, [planReviewPane.open])
  const feedback = useSyncExternalStore(
    callback => controller.subscribe(callback),
    () => controller.getFeedback(),
  )
  const feedbackRef = useRef(feedback)
  feedbackRef.current = feedback
  // The input handler runs outside render; the refs keep its closure fresh.
  const paneRef = useRef(pane)
  paneRef.current = pane
  const searchRef = useRef(search)
  searchRef.current = search
  const timelineOpenRef = useRef(timelineOpen)
  timelineOpenRef.current = timelineOpen
  const modelPaneRef = useRef(modelPane)
  modelPaneRef.current = modelPane
  const helpPaneRef = useRef(helpPane)
  helpPaneRef.current = helpPane
  const approvalPaneRef = useRef(approvalPane)
  approvalPaneRef.current = approvalPane
  const askUserPaneRef = useRef(askUserPane)
  askUserPaneRef.current = askUserPane
  const permissionPaneRef = useRef(permissionPane)
  permissionPaneRef.current = permissionPane
  const settingsPaneRef = useRef(settingsPane)
  settingsPaneRef.current = settingsPane
  const agentHubPaneRef = useRef(agentHubPane)
  agentHubPaneRef.current = agentHubPane
  const planDirectoryPaneRef = useRef(planDirectoryPane)
  planDirectoryPaneRef.current = planDirectoryPane
  const workspacePaneRef = useRef(workspacePane)
  workspacePaneRef.current = workspacePane
  const feedbackPaneRef = useRef(feedbackPane)
  feedbackPaneRef.current = feedbackPane
  const workflowOverlayRef = useRef(workflowOverlay)
  workflowOverlayRef.current = workflowOverlay
  const planReviewPaneRef = useRef(planReviewPane)
  planReviewPaneRef.current = planReviewPane
  const helpLinesRef = useRef(helpPane.lines)
  helpLinesRef.current = helpPane.lines
  const historyLengthRef = useRef(model.history.length)
  historyLengthRef.current = model.history.length
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )
  const clearChord = () => {
    if (chordTimerRef.current !== undefined) {
      clearTimeout(chordTimerRef.current)
      chordTimerRef.current = undefined
    }
  }
  useEffect(() => clearChord, [])
  // Wheel events share each visible pane's j/k action: the settings list
  // moves (edit/onboarding capture nothing), help and timeline scroll their
  // loop-owned windows, and everything else scrolls the conversation.
  useEffect(() => {
    const listener = (delta: number): void => {
      const settingsState = settingsPaneRef.current
      if (settingsState.open) {
        if (settingsState.editing || settingsState.onboarding === true) return
        controller.dispatch({ kind: 'settings-move', delta: -delta })
        return
      }
      if (helpPaneRef.current.open) {
        const maxOffset = Math.max(0, helpLinesRef.current.length - HELP_WINDOW)
        setHelpOffset(previous =>
          Math.max(0, Math.min(previous - delta, maxOffset)),
        )
        return
      }
      if (timelineOpenRef.current) {
        const maxOffset = Math.max(
          0,
          historyLengthRef.current - TIMELINE_WINDOW,
        )
        setTimelineOffset(previous =>
          Math.max(0, Math.min(previous - delta, maxOffset)),
        )
        return
      }
      // Mirror the key-scroll path: viewShift pages a tall visible turn before
      // the 60-row projector window has anything to scroll.
      setViewShift(previous => clampViewShift(previous, delta))
      controller.dispatch({ kind: 'scroll', delta })
    }
    setMouseScrollListener(listener)
    return () => {
      setMouseScrollListener(undefined)
    }
  }, [controller])
  useInput((key, keyInfo) => {
    controller.noteUserActivity()
    const current = stateRef.current
    const effect = mapKeyEvent(
      current,
      key,
      keyInfo,
      controller.commands,
      {
        open: paneRef.current.open,
        selectedId:
          paneRef.current.selectedIndex < paneRef.current.rows.length
            ? paneRef.current.rows[paneRef.current.selectedIndex]?.id
            : undefined,
      },
      {
        open: searchRef.current.open,
        selectedId:
          searchRef.current.selectedIndex < searchRef.current.results.length
            ? searchRef.current.results[searchRef.current.selectedIndex]?.id
            : undefined,
      },
      { open: timelineOpenRef.current },
      {
        open: modelPaneRef.current.open,
        selectedId:
          modelPaneRef.current.selectedIndex < modelPaneRef.current.rows.length
            ? modelPaneRef.current.rows[modelPaneRef.current.selectedIndex]?.id
            : undefined,
      },
      { open: helpPaneRef.current.open },
      { open: approvalPaneRef.current.open },
      {
        open: askUserPaneRef.current.open,
        optionCount: askUserPaneRef.current.options.length,
      },
      { open: permissionPaneRef.current.open },
      {
        open: settingsPaneRef.current.open,
        editing: settingsPaneRef.current.editing,
        onboarding: settingsPaneRef.current.onboarding,
        editValue:
          settingsPaneRef.current.rows[settingsPaneRef.current.selectedIndex]
            ?.value,
      },
      controller.getSubmitOnEnter(),
      {
        agentHub: { open: agentHubPaneRef.current.open },
        planDirectory: { open: planDirectoryPaneRef.current.open },
        workspace: {
          open: workspacePaneRef.current.open,
          editing: workspacePaneRef.current.editing,
          rootPath: workspacePaneRef.current.root,
          selectedKind:
            workspacePaneRef.current.nodes[workspacePaneRef.current.selectedIndex]?.kind,
          selectedPath:
            workspacePaneRef.current.nodes[workspacePaneRef.current.selectedIndex]?.path,
        },
        feedback: {
          open: feedbackPaneRef.current.open,
          editing: feedbackPaneRef.current.editing,
          note: feedbackPaneRef.current.note,
        },
        workflowOverlay: { open: workflowOverlayRef.current.open },
        planReview: { open: planReviewPaneRef.current.open },
      },
      {
        open: mentionMode,
        candidateCount: mentionCandidates.length,
        selectedIndex: current.mentionSelectedIndex,
        selectedCandidate: mentionCandidates[current.mentionSelectedIndex],
      },
      { headText: queuedDraftText },
      { available: (model.compactionDividers?.length ?? 0) > 0 },
    )
    if (effect.kind === 'dispatch') {
      const action = effect.action
      if (
        isSessionTransitionAction(action)
        && isSessionTransitionStatus(feedbackRef.current)
      ) {
        // The controller is the authoritative single-flight owner; the loop
        // also suppresses repeated lifecycle keystrokes while it advertises
        // that operation so no redundant action crosses the render seam.
      } else if (action.kind === 'timeline-scroll') {
        const maxOffset = Math.max(
          0,
          historyLengthRef.current - TIMELINE_WINDOW,
        )
        setTimelineOffset(previous =>
          Math.max(0, Math.min(previous + action.delta, maxOffset)),
        )
      } else if (action.kind === 'help-scroll') {
        const maxOffset = Math.max(0, helpLinesRef.current.length - HELP_WINDOW)
        setHelpOffset(previous =>
          Math.max(0, Math.min(previous + action.delta, maxOffset)),
        )
      } else if (action.kind === 'plan-review-scroll') {
        const lines = (planReviewPaneRef.current.plan ?? '').split('\n')
        const maxOffset = Math.max(0, lines.length - PLAN_REVIEW_WINDOW)
        setPlanReviewOffset(previous =>
          Math.max(0, Math.min(previous + action.delta, maxOffset)),
        )
      } else if (action.kind === 'scroll') {
        // A loop-owned view-shift pages a tall turn before the 60-row
        // projector window can; the controller still windows history.
        setViewShift(previous => clampViewShift(previous, action.delta))
        controller.dispatch(action)
      } else if (
        action.kind === 'scroll-edge'
        || action.kind === 'send'
        || action.kind === 'new-session'
      ) {
        setViewShift(0)
        controller.dispatch(action)
      } else if (action.kind === 'intake-clipboard-image') {
        void controller.intakeClipboardImage().then((result) => {
          if (result.ok) insertImageToken(result.token)
          else controller.note(result.reason)
        })
      } else if (action.kind !== ('none' as never)) {
        controller.dispatch(action)
      }
      // Single-timer chord bookkeeping: arming starts the 600ms window;
      // any other outcome (chord won, timeout, intervening key, paste)
      // clears it.
      clearChord()
      if (effect.prefixG && !current.prefixG) {
        chordTimerRef.current = setTimeout(() => {
          // Every input or paste that disarms the chord cancels this timer first.
          const cleared: LoopInputState = {
            ...stateRef.current,
            prefixG: false,
          }
          stateRef.current = cleared
          setState(cleared)
        }, CHORD_WINDOW_MS)
      }
    }
    const next: LoopInputState =
      effect.kind === 'dispatch'
        ? {
          text: effect.text,
          commandQuery: effect.commandQuery,
          prefixG: effect.prefixG,
          renaming: effect.renaming,
          mentionSelectedIndex:
            effect.mentionSelectedIndex ?? current.mentionSelectedIndex,
          mentionDismissed:
            effect.mentionDismissed ?? current.mentionDismissed,
          commandSelectedIndex:
            effect.commandSelectedIndex ?? current.commandSelectedIndex,
          commandDismissed:
            effect.commandDismissed ?? current.commandDismissed,
          caretIndex:
            effect.caretIndex
            ?? (effect.text === current.text ? current.caretIndex : undefined),
        }
        : current
    stateRef.current = next
    setState(next)
  })

  const insertImageToken = (token: string): void => {
    const current = stateRef.current
    const caret = clampCaretIndex(current.text, current.caretIndex)
    const next: LoopInputState = {
      ...current,
      text: current.text.slice(0, caret) + token + current.text.slice(caret),
      prefixG: false,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + token.length,
    }
    stateRef.current = next
    setState(next)
  }

  usePaste((pasted: string) => {
    controller.noteUserActivity()
    const current = stateRef.current
    if (
      approvalPaneRef.current.open
      || askUserPaneRef.current.open
      || planReviewPaneRef.current.open
      || permissionPaneRef.current.open
      || (settingsPaneRef.current.open && !settingsPaneRef.current.editing)
      || agentHubPaneRef.current.open
      || planDirectoryPaneRef.current.open
      || (workspacePaneRef.current.open && !workspacePaneRef.current.editing)
      || (feedbackPaneRef.current.open && !feedbackPaneRef.current.editing)
      || workflowOverlayRef.current.open
    ) return
    const trimmed = pasted.trim()
    const extension = trimmed.slice(trimmed.lastIndexOf('.')).toLowerCase()
    if (trimmed !== '' && !trimmed.includes('\n') && !/[\u0000-\u001f]/.test(trimmed)
      && ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension)) {
      // A single local image path becomes a pending token instead of text.
      clearChord()
      void controller.intakeImagePath(pasted).then((result) => {
        if (result.ok) insertImageToken(result.token)
        else controller.note(result.reason)
      })
      return
    }
    const caret = clampCaretIndex(current.text, current.caretIndex)
    const appended = current.text.slice(0, caret) + pasted + current.text.slice(caret)
    clearChord()
    if (searchRef.current.open) {
      controller.dispatch({ kind: 'search', query: appended })
    }
    // A paste never arms the chord: the pasted text stays in the buffer.
    const next: LoopInputState = {
      ...current,
      text: appended,
      commandQuery: appended.startsWith('/') ? appended.slice(1) : current.commandQuery,
      prefixG: false,
      mentionSelectedIndex: 0,
      mentionDismissed: false,
      commandSelectedIndex: 0,
      commandDismissed: false,
      caretIndex: caret + pasted.length,
    }
    stateRef.current = next
    setState(next)
  })

  const commandMode =
    (state.commandQuery !== undefined || state.text.startsWith('/'))
    && state.commandDismissed !== true
  const mentionQuery = activeMentionQuery(state.text)
  const mentionMode = mentionQuery !== undefined && !state.mentionDismissed

  useEffect(() => {
    mentionAbortRef.current?.abort()
    if (!mentionMode) {
      setMentionCandidates([])
      setMentionPhase('ready')
      return
    }
    const seq = ++mentionSeqRef.current
    const controllerAbort = new AbortController()
    mentionAbortRef.current = controllerAbort
    setMentionCandidates([])
    setMentionPhase('loading')
    void controller.listMentions(
      controller.getCwd(),
      mentionQuery,
      controllerAbort.signal,
    ).then(
      (results) => {
        if (controllerAbort.signal.aborted || seq !== mentionSeqRef.current) return
        setMentionCandidates(results)
        setMentionPhase('ready')
      },
      () => {
        if (controllerAbort.signal.aborted || seq !== mentionSeqRef.current) return
        setMentionCandidates([])
        setMentionPhase('ready')
      },
    )
    return () => {
      controllerAbort.abort()
    }
  }, [controller, mentionMode, mentionQuery])
  const statusLabel = statusText(interaction)
  const statusOccupied = approvalPane.open || askUserPane.open
  const identityStatus = badge === ''
    ? shortenHomePath(controller.getCwd(), homedir())
    : `${shortenHomePath(controller.getCwd(), homedir())} · ${badge}`
  // Whole-log stats splice after the goal fragment (D-12); omitted while the
  // sessionStats projection is absent — never painted as invented 0.
  const statsText =
    sessionStats === undefined
      ? undefined
      : `${sessionStats.turns} turns · ${sessionStats.decodeTokens} tok · ${sessionStats.llmMs} ms`
  const scrollHint = statusHint(interaction, statusOccupied)
  let restPlain = identityStatus
  if (statusLabel !== '') {
    restPlain = scrollHint === '' ? statusLabel : `${statusLabel} · ${scrollHint}`
  }
  // The goal fragment shares the status row: the objective budget is the row
  // width minus the `目标 …` head and the plain text of the remaining status.
  let goalRuns: GoalFooterRuns | undefined
  if (goalFooter !== undefined && feedback === undefined) {
    const budget = Math.max(
      1,
      columns - displayWidth(`${goalFooterHead(goalFooter)} · `) - displayWidth(restPlain),
    )
    goalRuns = goalFooterRuns(goalFooter, budget)
  }
  // The idle row never wraps: goal stays first, then cwd/provider-model, with
  // aggregate stats and `/` `@` hints dropping before the row truncates.
  const goalWidth =
    goalRuns === undefined ? 0 : displayWidth(`${goalRuns.head} · ${goalRuns.objective} · `)
  const idleTail = composeIdleComposerStatus(
    Math.max(1, columns - goalWidth),
    controller.getCwd(),
    badge,
    homedir(),
    statsText,
  )
  const adaptiveLines = adaptiveInfoFooter === undefined
    ? []
    : formatAdaptiveInfoFooter({
      ...adaptiveInfoFooter,
      environment: shortenHomePath(controller.getCwd(), homedir()),
      tip: statusLabel === '' ? '/ 命令 · @ 提及' : scrollHint,
    }, columns)
  let status: ReactNode
  if (feedback !== undefined) {
    status = createElement('ink-text', null, paintRow([feedbackLine(feedback) as string]))
  } else if (adaptiveLines.length > 0) {
    const goalLine = goalRuns === undefined
      ? undefined
      : `${goalRuns.head} · ${goalRuns.objective}`
    const primaryAdaptiveLine = adaptiveLines[0]
    const visibleLines = goalLine === undefined
      ? adaptiveLines
      : [
        goalLine,
        primaryAdaptiveLine,
        adaptiveLines.find(line => line.startsWith('重试 ')) ?? adaptiveLines[1],
      ].filter((line): line is string => line !== undefined)
    status = createElement(
      Box,
      { flexDirection: 'column', width: '100%' },
      ...visibleLines.map((line, index) => createElement(
        Text,
        { key: `adaptive-footer-${String(index)}` },
        paintRow([styled(line, line.startsWith('重试 ') ? 'accent' : 'fgDim')]),
      )),
    )
  } else if (statusLabel === '') {
    status = createElement(
      'ink-text',
      null,
      paintRow([
        ...(goalRuns === undefined
          ? []
          : [styled(goalRuns.head, 'fg'), styled(` · ${goalRuns.objective} · `, 'fgDim')]),
        styled(escapeContent(idleTail), 'fgDim'),
      ]),
    )
  } else {
    status = createElement('ink-text', null, statusSlot(interaction, statusOccupied, goalRuns))
  }
  const brandBlocked =
    state.text !== ''
    || model.status !== 'idle'
    || pane.open
    || search.open
    || timelineOpen
    || modelPane.open
    || helpPane.open
    || approvalPane.open
    || askUserPane.open
    || permissionPane.open
    || settingsPane.open
    || agentHubPane.open
    || planDirectoryPane.open
    || workspacePane.open
    || feedbackPane.open
    || workflowOverlay.open
    || planReviewPane.open
  const brandLifecycleAllowed = !brandBlocked
    && (brandAnimationMode === 'on'
      || (brandAnimationMode === 'auto' && brandAutoEligible))
  if (brandRevealStartedRef.current && !brandLifecycleAllowed) {
    brandRevealStoppedRef.current = true
  } else if (
    brandLifecycleAllowed
    && !brandRevealStartedRef.current
    && !brandRevealStoppedRef.current
  ) {
    brandRevealStartedRef.current = true
  }
  const brandAnimation = brandLifecycleAllowed
    && brandRevealStartedRef.current
    && !brandRevealStoppedRef.current
  const streamView = createElement(StreamView, {
    model,
    presenters: controller.getToolPresenters?.(),
    brandTier,
    brandAnimation,
    brandFrameProbe,
    viewShift,
  })
  const hudRows: ReactNode[] = []
  if (todoHud !== undefined && todoHud.length > 0) {
    hudRows.push(createElement(TodoHud, { todos: todoHud, maxCols: columns }))
  }
  if (jobsHud !== undefined && jobsHud.length > 0) {
    hudRows.push(createElement(JobsHud, { jobs: jobsHud, maxCols: columns }))
  }
  if (workflowHud !== undefined) {
    hudRows.push(createElement(WorkflowHud, { run: workflowHud, maxCols: columns }))
  }
  if (composerHud !== undefined && composerHud !== '') {
    hudRows.push(createElement(Text, null, paintRow([styled(escapeContent(composerHud), 'fg')])))
  }
  if (queuedDraftCount > 0) {
    hudRows.push(createElement(QueueChip, { count: queuedDraftCount }))
  }
  const conversation =
    hudRows.length === 0
      ? streamView
      : createElement(Box, { flexDirection: 'column', width: '100%' }, streamView, ...hudRows)
  const overlayBrowseOpen =
    agentHubPane.open
    || planDirectoryPane.open
    || workspacePane.open
    || feedbackPane.open
    || workflowOverlay.open
  let content: ReactNode
  if (approvalPane.open || askUserPane.open || planReviewPane.open) {
    content = conversation
  } else if (permissionPane.open) {
    content = createElement(PermissionPane, {
      names: permissionPane.names,
      selectedIndex: permissionPane.selectedIndex,
      currentName: permissionPane.currentName,
      confirmDanger: permissionPane.confirmDanger,
      descriptions: permissionPane.descriptions,
      switchError: permissionPane.switchError,
    })
  } else if (settingsPane.open) {
    content = createElement(SettingsPane, {
      rows: settingsPane.rows,
      selectedIndex: settingsPane.selectedIndex,
      editing: settingsPane.editing,
      ...(settingsPane.onboarding === undefined
        ? {}
        : { onboarding: settingsPane.onboarding }),
      ...(settingsPane.updateError === undefined
        ? {}
        : { updateError: settingsPane.updateError }),
    })
  } else if (modelPane.open) {
    content = createElement(ModelPane, {
      filter: modelPane.filter,
      rows: modelPane.rows,
      selectedIndex: modelPane.selectedIndex,
      status: modelPane.status,
      ...(modelPane.error === undefined ? {} : { error: modelPane.error }),
    })
  } else if (helpPane.open) {
    content = createElement(HelpPane, {
      lines: helpPane.lines,
      offset: helpOffset,
    })
  } else if (pane.open) {
    content = createElement(SessionPane, {
      rows: pane.rows,
      selectedIndex: pane.selectedIndex,
      currentId: pane.currentId,
      confirmDelete: pane.confirmDelete,
    })
  } else if (search.open) {
    content = createElement(SearchPane, {
      query: search.query,
      results: search.results,
      selectedIndex: search.selectedIndex,
    })
  } else if (timelineOpen) {
    content = createElement(TimelineView, {
      history: model.history,
      offset: timelineOffset,
    })
  } else if (agentHubPane.open) {
    content = createElement(AgentHubPane, {
      rows: agentHubPane.rows,
      selectedIndex: agentHubPane.selectedIndex,
      view: agentHubPane.view,
      error: agentHubPane.error,
      transcript: agentHubPane.transcript,
      missing: agentHubPane.missing,
    })
  } else if (planDirectoryPane.open) {
    content = createElement(PlanDirectoryPane, {
      selectedIndex: planDirectoryPane.selectedIndex,
      currentActive: planDirectoryPane.currentActive,
      switchError: planDirectoryPane.switchError,
      statusError: planDirectoryPane.statusError,
    })
  } else if (workspacePane.open) {
    content = createElement(WorkspacePane, { state: workspacePane, maxCols: columns })
  } else if (feedbackPane.open) {
    content = createElement(FeedbackPane, { state: feedbackPane })
  } else if (workflowOverlay.open) {
    content = createElement(WorkflowOverlay, { state: workflowOverlay })
  } else {
    content = conversation
  }
  let inputSlot: ReactNode
  if (approvalPane.open) {
    inputSlot = createElement(ApprovalPane, {
      toolName: approvalPane.toolName,
      reason: approvalPane.reason,
      arguments: approvalPane.arguments,
      detailsOpen: approvalPane.detailsOpen,
      deliveryError: approvalPane.deliveryError,
    })
  } else if (askUserPane.open) {
    inputSlot = createElement(AskUserPane, {
      header: askUserPane.header,
      options: askUserPane.options,
      selectedIndex: askUserPane.selectedIndex,
    })
  } else if (planReviewPane.open) {
    inputSlot = createElement(PlanReviewPane, {
      plan: planReviewPane.plan,
      offset: planReviewOffset,
      deliveryError: planReviewPane.deliveryError,
    })
  } else if (
    (permissionPane.open || overlayBrowseOpen)
    && !(workspacePane.open && workspacePane.editing)
    && !(feedbackPane.open && feedbackPane.editing)
  ) {
    inputSlot = null
  } else if (settingsPane.open && !settingsPane.editing) {
    inputSlot = null
  } else if (
    modelPane.open
    || (pane.open && state.renaming)
    || search.open
    || settingsPane.editing
    || (workspacePane.open && workspacePane.editing)
    || (feedbackPane.open && feedbackPane.editing)
  ) {
    // The model-panel filter, the search query, and the workspace path draft
    // live in the composer slot.
    inputSlot = createElement(InputBar, {
      text: state.text,
      commandMode: false,
      mentionMode: false,
      caretIndex: state.caretIndex,
    })
  } else if (helpPane.open) {
    inputSlot = null
  } else if (pane.open) {
    inputSlot = null
  } else if (commandMode) {
    // Command mode stacks the composer above the palette: the typed query
    // stays on the prompt line and prefix matches list below; the caret
    // anchor counts the palette rows below the composer.
    const query = state.commandQuery ?? state.text.slice(1)
    const menuRows = Math.min(
      filterCommands(controller.commands, query).length,
      COMMAND_MENU_WINDOW,
    )
    inputSlot = createElement(
      Box,
      { flexDirection: 'column', width: '100%' },
      createElement(InputBar, {
        text: state.text,
        commandMode,
        mentionMode,
        caretIndex: state.caretIndex,
        rowsBelow: menuRows,
      }),
      createElement(CommandMenu, {
        items: controller.commands,
        query,
        selectedIndex: state.commandSelectedIndex,
      }),
    )
  } else if (mentionMode) {
    inputSlot = createElement(Mention, {
      phase: mentionPhase,
      candidates: mentionCandidates,
      selectedIndex: state.mentionSelectedIndex,
    })
  } else {
    inputSlot = createElement(InputBar, {
      text: state.text,
      commandMode,
      mentionMode,
      caretIndex: state.caretIndex,
    })
  }

  return createElement(AppShell, {
    title: liveTitle === '' ? title : liveTitle,
    badge,
    status,
    children: content,
    input: inputSlot,
  })
}

/** Re-export for consumers that build their own palettes. */
export { completeFirst, resolveEnterQuery }
export { Box }
