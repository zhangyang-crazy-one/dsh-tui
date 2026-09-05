/**
 * Render-layer entry: mounts the Ink screen over the alternate screen with a
 * symmetric unmount disposer, and re-exports every terminal surface the host
 * consumes: theme, projection, render loop, markdown, reasoning, input,
 * palettes, the interactive loop, and the FrameProbe instrumentation.
 * @module @deepseek-ai/dsh-tui-render
 */

import { render, renderToString, Text } from 'ink'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { AppShell } from './app-shell.tsx'
import { StreamView } from './stream-view.tsx'
import { TuiLoop, STATUS_HINT } from './loop.tsx'
import type { TuiController } from './loop.tsx'
import type { ViewModel } from './projection.ts'
import { FrameProbe } from './frame-stats.ts'
import type { FrameProbeHandle } from './frame-stats.ts'
import type { FrameMetricsHandle } from './frame-metrics.ts'
import { currentTier, installTheme } from './theme.ts'
import { wrapStdoutForFrameBg } from './frame-fill.ts'
import { attachMouseIo } from './mouse-io.ts'
import { detectHyperlinks, setHyperlinks } from './hyperlink.ts'
import { detectBrandRenderTier } from './terminal-capabilities.ts'
import type { RenderPolicy } from './render-policy.ts'
import { renderPolicyDefaults } from './render-policy.ts'
import { observeReactTiming } from './react-timing.ts'
export { ToolDetailsPane, EMPTY_TOOL_DETAILS_PANE } from './tool-details-pane.tsx'
export type { ToolDetailsPaneState, ToolDetailsInput } from './tool-details-pane.tsx'
export { createToolBodyDocument, planToolBodyWindow, toolCardOriginalText } from './tool-body.ts'
export type { ToolBodyCursor } from './tool-body.ts'
export { ToolPresenterCache } from './tool-presenter-cache.ts'

export { renderToString }
export { AppShell, layoutTitleBar } from './app-shell.tsx'
export type { AppShellProps, TitleBarLayout } from './app-shell.tsx'
export * from './theme.ts'
export {
  BRAND_HALF_BLOCK,
  BRAND_HALF_BLOCK_FRAMES,
  BRAND_FULL_BLOCK,
  BRAND_ASCII,
  BRAND_PLAIN_WORDMARK,
  BRAND_HOME_LINE,
  BRAND_APP_TITLE,
} from './brand.ts'
export { detectBrandRenderTier, detectNotifyCapability, notifyBytes } from './terminal-capabilities.ts'
export type { BrandRenderTier, NotifyTransport } from './terminal-capabilities.ts'
export {
  activeBrandRevealTimerCount,
  BRAND_ART_ROWS,
  BRAND_FRAME_MS,
  BRAND_HOME_ROWS,
  PixelFishHome,
  selectBrandRenderTier,
} from './pixel-fish-home.tsx'
export type { PixelFishHomeProps } from './pixel-fish-home.tsx'
export { escapeContent, displayWidth, wcwidthSafeSlice } from './content.ts'
export { isHumanUserMessage } from './message-visibility.ts'
export { StreamView } from './stream-view.tsx'
export type { StreamViewProps } from './stream-view.tsx'
export { conversationLeft, conversationWidth } from './conversation-layout.ts'
export {
  createFrameSnapshotRow,
  diffVisibleFrameSnapshots,
  physicalLineIdentity,
  setVisibleFrameSnapshot,
  visibleFrameSnapshot,
} from './frame-snapshot.ts'
export type {
  FrameGeometry,
  FrameRowChange,
  FrameSnapshotDiff,
  FrameSnapshotRow,
  VisibleFrameSnapshot,
} from './frame-snapshot.ts'
export {
  EMPTY_TRANSCRIPT_VIEWPORT,
  physicalScrollRailGeometry,
  reduceTranscriptViewport,
} from './transcript-viewport.ts'
export type {
  PhysicalScrollRailGeometry,
  TranscriptBlockLayout,
  TranscriptViewportAction,
  TranscriptViewportAnchor,
  TranscriptViewportCommand,
  TranscriptViewportState,
} from './transcript-viewport.ts'
export { TranscriptLayoutCache } from './transcript-layout-cache.ts'
export type { TranscriptLayoutCacheInput } from './transcript-layout-cache.ts'
export { SessionPane, relativeTime } from './session-pane.tsx'
export { tuiCopy } from './ui-copy.ts'
export type { TuiCopyKey, TuiLocale } from './ui-copy.ts'
export type {
  SessionRow,
  SessionPaneProps,
  SessionPaneState,
} from './session-pane.tsx'
export { SearchPane, SEARCH_WINDOW } from './search-pane.tsx'
export type {
  SearchCandidate,
  SearchPaneProps,
  SearchPaneState,
  SearchStatus,
} from './search-pane.tsx'
export { ModelPane, MODEL_WINDOW } from './model-pane.tsx'
export type {
  ModelRow,
  ModelPaneProps,
  ModelPaneState,
  ModelPaneStatus,
} from './model-pane.tsx'
export { HelpPane, HELP_WINDOW } from './help-pane.tsx'
export type { HelpPaneProps, HelpPaneState } from './help-pane.tsx'
export { ApprovalPane, EMPTY_APPROVAL_PANE } from './approval-pane.tsx'
export type { ApprovalPaneProps, ApprovalPaneState } from './approval-pane.tsx'
export { AskUserPane, EMPTY_ASK_USER_PANE } from './ask-user-pane.tsx'
export type { AskUserPaneProps, AskUserPaneState } from './ask-user-pane.tsx'
export { PermissionPane, EMPTY_PERMISSION_PANE } from './permission-pane.tsx'
export type { PermissionPaneProps, PermissionPaneState } from './permission-pane.tsx'
export { SettingsPane, EMPTY_SETTINGS_PANE, SETTINGS_WINDOW } from './settings-pane.tsx'
export type {
  SettingsFieldRow,
  SettingsPaneProps,
  SettingsPaneState,
} from './settings-pane.tsx'
export { OverlayShell, EMPTY_OVERLAY_PANE } from './overlay-shell.tsx'
export type {
  OverlayPaneState,
  OverlayShellProps,
  OverlayShellTitle,
} from './overlay-shell.tsx'
export { AgentHubPane } from './agent-hub-pane.tsx'
export type {
  AgentHubPaneProps,
  AgentHubPaneState,
  AgentHubRow,
  AgentHubView,
} from './agent-hub-pane.tsx'
export { PlanDirectoryPane, EMPTY_PLAN_DIRECTORY_PANE } from './plan-directory-pane.tsx'
export type {
  PlanDirectoryPaneProps,
  PlanDirectoryPaneState,
} from './plan-directory-pane.tsx'
export { PlanReviewPane, EMPTY_PLAN_REVIEW_PANE, PLAN_REVIEW_WINDOW } from './plan-review-pane.tsx'
export type {
  PlanReviewPaneProps,
  PlanReviewPaneState,
} from './plan-review-pane.tsx'
export { TimelineView, TIMELINE_WINDOW } from './timeline-view.tsx'
export type { TimelineViewProps } from './timeline-view.tsx'
export {
  MarkdownBlock,
  CodeBlock,
  HighlightedLine,
  tokenize,
} from './markdown.tsx'
export { ReasoningBlock, formatSeconds } from './reasoning.tsx'
export { ToolCard } from './tool-card.tsx'
export type { ToolCardProps } from './tool-card.tsx'
export {
  cardsFrom,
  cardsFromActiveTurn,
  cardsFromTurn,
  collapsedCardSummary,
  truncateDisplay,
  attachPresenterViews,
} from './tool-cards.ts'
export type { ToolCardModel, ToolCardStatus, ToolPresenterLookup } from './tool-cards.ts'
export { createProjector, EMPTY_VIEW, latestAssistantCopyTarget } from './projection.ts'
export type {
  Projector,
  ViewModel,
  ActiveTurn,
  FrozenMessage,
  AssistantCopyTarget,
  CompactionDivider,
  ProjectedToolCall,
} from './projection.ts'
export { copyText, encodeOsc52, hostClipboardCommand, OSC52_MAX_CHARS } from './clipboard.ts'
export type { ClipboardSpec, SpawnFn } from './clipboard.ts'
export { createRenderLoop, withThrottle } from './render-loop.ts'
export {
  hideFrameCaret,
  setFrameCaret,
  setFrameRail,
  transformFrameChunk,
  writePublishedFrameRail,
  wrapStdoutForFrameBg,
} from './frame-fill.ts'
export type { FrameCaret, FrameRail } from './frame-fill.ts'
export { goalFooterHead, goalFooterRuns, formatGoalFooter } from './goal-footer.ts'
export type { GoalFooterRuns, GoalFooterView } from './goal-footer.ts'
export {
  formatAdaptiveInfoFooter,
  formatAdaptiveInfoFooterRows,
  formatQuietStatusRow,
  formatCompactTokens,
} from './adaptive-info-footer.ts'
export type {
  AdaptiveInfoFooterRow,
  AdaptiveInfoFooterRun,
} from './adaptive-info-footer.ts'
export type {
  AdaptiveContextPressure,
  AdaptiveInfoFooterView,
  AdaptiveRetryView,
  AdaptiveTokenUsage,
} from './adaptive-info-footer.ts'
export { TodoHud } from './todo-hud.tsx'
export type { TodoHudItem } from './todo-hud.tsx'
export { JobsHud } from './jobs-hud.tsx'
export type { JobHudItem } from './jobs-hud.tsx'
export { WorkflowHud } from './workflow-hud.tsx'
export type { WorkflowHudMember, WorkflowHudState } from './workflow-hud.tsx'
export { WorkflowOverlay, EMPTY_WORKFLOW_OVERLAY, WORKFLOW_OVERLAY_WINDOW } from './workflow-overlay.tsx'
export type { WorkflowOverlayState } from './workflow-overlay.tsx'
export { WorkspacePane, EMPTY_WORKSPACE_PANE } from './workspace-pane.tsx'
export type { WorkspaceNode, WorkspacePaneState } from './workspace-pane.tsx'
export { FeedbackPane, EMPTY_FEEDBACK_PANE } from './feedback-pane.tsx'
export type { FeedbackPaneState, FeedbackWriteError } from './feedback-pane.tsx'
export { QueueChip, queueChipText } from './queue-chip.tsx'
export type { RenderLoop } from './render-loop.ts'
export { composerCursorPosition, composerFrameAnchor } from './composer-cursor.ts'
export type {
  ComposerCaretPosition,
  ComposerFrameAnchor,
  ComposerFrameAnchorOptions,
} from './composer-cursor.ts'
export {
  createFrameProbe,
  frameStatsSnapshot,
  FrameProbe,
  FRAME_STATS_CAPACITY,
} from './frame-stats.ts'
export type {
  FrameProbeHandle,
  FrameProbeProps,
  FrameStatsSnapshot,
} from './frame-stats.ts'
export { createFrameMetrics, FRAME_METRICS_CAPACITY } from './frame-metrics.ts'
export type {
  FrameMetricsCounterSnapshot,
  FrameMetricsHandle,
  FrameMetricsSnapshot,
  RenderQueueSnapshot,
} from './frame-metrics.ts'
export {
  renderPolicyDefaults,
  toolPolicyDefaults,
  RENDER_POLICY_DEFAULT_CACHE_MAX_BYTES,
  RENDER_POLICY_DEFAULT_CACHE_MAX_ROWS,
  RENDER_POLICY_DEFAULT_SCROLL_CATCH_UP_THRESHOLD,
  RENDER_POLICY_DEFAULT_SCROLL_FRAME_INTERVAL_MS,
  RENDER_POLICY_DEFAULT_SCROLL_MAX_CATCH_UP_STEP,
  RENDER_POLICY_DEFAULT_SCROLL_STEP_PER_FRAME,
  RENDER_POLICY_DEFAULT_SCROLL_WHEEL_ROWS,
  RENDER_POLICY_DEFAULT_STREAM_CATCH_UP_ROWS_PER_FRAME,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_DEPTH,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_DRAIN_BACKPRESSURE_MS,
  RENDER_POLICY_DEFAULT_STREAM_ENTRY_OLDEST_AGE_MS,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_DEPTH,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_DRAIN_BACKPRESSURE_MS,
  RENDER_POLICY_DEFAULT_STREAM_EXIT_OLDEST_AGE_MS,
  RENDER_POLICY_DEFAULT_STREAM_FRAME_INTERVAL_MS,
  RENDER_POLICY_DEFAULT_TRANSCRIPT_OVERSCAN,
  RENDER_POLICY_MAX_CACHE_BYTES,
  RENDER_POLICY_MAX_CACHE_ROWS,
  RENDER_POLICY_MAX_OVERSCAN,
} from './render-policy.ts'
export type {
  RenderPolicy,
  RenderPolicyCache,
  RenderPolicyTools,
  RenderPolicyScroll,
  RenderPolicyStream,
} from './render-policy.ts'
export { reduceInteraction } from './interaction-state.ts'
export type {
  InteractionState,
  InteractionEffect,
  InteractionEvent,
} from './interaction-state.ts'
export { TuiLoop } from './loop.tsx'
export type { TuiLoopProps, TuiController, LoopAction, LoopMode } from './loop.tsx'
export { InputBar, handleInput, EMPTY_INPUT } from './input-bar.tsx'
export type {
  InputBarProps,
  InputState,
  InputEvent,
  InputCommand,
} from './input-bar.tsx'
export {
  CommandMenu,
  filterCommands,
  completeFirst,
  resolveEnterQuery,
} from './command-menu.tsx'
export type { CommandItem } from './command-menu.tsx'
export { Mention } from './mention.tsx'
export type {
  MentionCandidate,
  ListMentions,
  MentionProps,
} from './mention.tsx'

/** Mount options for the terminal screen. */
export interface TuiRenderOptions {
  /** Output stream; defaults to process.stdout. */
  stdout?: NodeJS.WriteStream
  /** Input stream for key events; defaults to process.stdin. Tests inject a TTY-shaped fake. */
  stdin?: NodeJS.ReadStream
  /** Whether Ink intercepts Ctrl+C to exit (Phase 2 keeps it off: the signal table owns Ctrl+C). */
  exitOnCtrlC?: boolean
  /** When set, wrap the tree in a FrameProbe that records commit render costs into this store. */
  frameProbe?: FrameProbeHandle
  /** Renderer metrics shared by StreamView and the host frame-stats writer. */
  frameMetrics?: FrameMetricsHandle
  /**
   * Environment snapshot for color-tier detection; defaults to process.env.
   * Tests inject a fixed snapshot so the installed tier is deterministic.
   */
  env?: NodeJS.ProcessEnv
  /** Resolved, host-validated transcript, stream, scroll, and cache policy. */
  renderPolicy?: RenderPolicy
}

/**
 * Mount an Ink element tree on the alternate screen. The color tier is
 * installed from the environment once, before the first render, so every
 * {@link styled} call in the tree maps through the detected tier (P14
 * three-tier fallback). When a frame probe is provided, the tree is wrapped
 * in a {@link FrameProbe} so every commit records its render cost.
 * @param node - the element tree to render.
 * @param options - mount options.
 * @returns a disposer that unmounts the tree and restores the terminal.
 */
export function mountTuiRender(
  node: ReactNode,
  options: TuiRenderOptions = {},
): () => void {
  const env = options.env ?? process.env
  const policy = options.renderPolicy ?? renderPolicyDefaults()
  installTheme(env)
  setHyperlinks(detectHyperlinks(env))
  const wrapped =
    options.frameProbe === undefined
      ? node
      : createElement(FrameProbe, { probe: options.frameProbe }, node)
  // Mouse I/O wraps stdin/stdout before Ink sees them: SGR reports never
  // reach the key parser, and the cell atlas tracks post-frame-fill bytes.
  const mouse = attachMouseIo({
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    ...(options.renderPolicy === undefined
      ? {}
      : { wheelRows: options.renderPolicy.scroll.wheelRows }),
  })
  const releaseTiming = observeReactTiming()
  let instance: ReturnType<typeof render>
  try {
    instance = render(wrapped, {
      alternateScreen: true,
      incrementalRendering: false,
      patchConsole: false,
      exitOnCtrlC: options.exitOnCtrlC ?? false,
      maxFps: 1000 / Math.min(policy.scroll.frameIntervalMs, policy.stream.frameIntervalMs),
      stdout: wrapStdoutForFrameBg(mouse.stdout, currentTier, options.frameMetrics),
      stdin: mouse.stdin,
    })
  } catch (error) {
    releaseTiming()
    mouse.dispose()
    throw error
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    try { instance.unmount() } finally {
      releaseTiming()
      mouse.dispose()
    }
  }
}

/** Minimal frame content for the pre-loop phase. */
export interface TuiFrameOptions {
  /** Session title shown in the top bar. */
  title: string
  /** Provider/model badge shown right-aligned in the top bar. */
  badge: string
  /** One plain-text line shown in the content area. */
  content: string
}

/**
 * Mount the minimal pre-loop frame: title, badge, one content line.
 * @param options - frame content.
 * @param mountOptions - mount options.
 * @returns a disposer that unmounts the tree and restores the terminal.
 */
export function mountTuiFrame(
  options: TuiFrameOptions,
  mountOptions?: TuiRenderOptions,
): () => void {
  return mountTuiRender(
    createElement(AppShell, {
      title: options.title,
      badge: options.badge,
      children: createElement(Text, null, options.content),
    }),
    mountOptions,
  )
}

/** The composite TuiApp: shell + stream view + status line (input lands 02-03). */
export interface TuiAppProps {
  /** Session title for the top bar. */
  title: string
  /** Provider/model badge for the top bar. */
  badge: string
  /** The folded view model snapshot. */
  model: ViewModel
}

/**
 * The interactive composite: shell frame, stream view, and the generation
 * status line per 02-UI-SPEC §2.
 * @param props - composite slots.
 * @returns the element tree.
 */
export function TuiApp(props: TuiAppProps): ReactNode {
  const { title, badge, model } = props
  return createElement(AppShell, {
    title,
    badge,
    children: createElement(StreamView, { model }),
    status: createElement(
      Text,
      null,
      model.status === 'generating'
        ? `⏹ Ctrl+C 停止 · ${STATUS_HINT}`
        : model.status === 'stopped'
          ? `继续生成 · ${STATUS_HINT}`
          : '',
    ),
  })
}

/**
 * Mount the interactive loop: TuiLoop wired to a controller, over the
 * alternate screen. Keeps react out of the host package.
 * @param controller - the runtime controller seam.
 * @param options - title plus mount options.
 * @returns a disposer that unmounts the tree and restores the terminal.
 */
export function mountTuiLoop(
  controller: TuiController,
  options: { title: string; brandFrameProbe?: FrameProbeHandle | undefined } & TuiRenderOptions,
): () => void {
  const {
    title,
    brandFrameProbe,
    renderPolicy,
    frameMetrics,
    ...mountOptions
  } = options
  const env = mountOptions.env ?? process.env
  const stdout = mountOptions.stdout ?? process.stdout
  const stdin = mountOptions.stdin ?? process.stdin
  return mountTuiRender(
    createElement(TuiLoop, {
      title,
      controller,
      brandTier: detectBrandRenderTier(env),
      brandAutoEligible: stdout.isTTY && stdin.isTTY,
      brandFrameProbe,
      frameProbe: mountOptions.frameProbe,
      renderPolicy,
      frameMetrics,
    }),
    {
      ...mountOptions,
      ...(frameMetrics === undefined ? {} : { frameMetrics }),
    },
  )
}
