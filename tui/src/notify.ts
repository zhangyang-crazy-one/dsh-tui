/**
 * Attention-driven desktop-notification decision for the TUI.
 *
 * The TUI notifies only on attention events — an approval ask, an ask-user
 * question, or a run settling to idle — never on intermediate turn ends. The
 * decision (whether to notify, bell-only suppression, and the exact copy) is a
 * pure function so the copy table and suppression rule are exhaustively unit
 * testable; the caller owns transport selection and byte writing.
 * @module
 */

import type { TurnEndCancelCause, TurnEndReason } from '@deepseek-ai/dsh-session'

/** Notification urgency, forwarded to `notify-send -u` where the transport can express it. */
export type NotifyUrgency = 'normal' | 'critical'

/** One decided desktop notification. */
export interface NotifyMessage {
  /** Application name shown as the notification title. */
  readonly title: string
  /** Summary body: outcome copy plus the optional ` · title` session suffix. */
  readonly body: string
  /** Delivery urgency. */
  readonly urgency: NotifyUrgency
  /**
   * Exact ` · {sessionTitle}` suffix appended to `body` when one was
   * resolved. Carried explicitly so the OSC transport preserves it under
   * the 80-code-point cap without inferring the boundary from the body
   * text itself — a summary that already contains ` · ` cannot be
   * disambiguated by delimiter search. Undefined when no suffix exists.
   */
  readonly titleSuffix?: string
}

/**
 * One notification decision. `undefined` means stay completely silent (policy
 * off, or a user-initiated abort in attention mode); `desktop: false` means
 * bell only — the quiet-input window downgraded the desktop popup.
 */
export type NotifyDecision =
  | undefined
  | { readonly desktop: false }
  | ({ readonly desktop: true } & NotifyMessage)

/** User-settings notification policy. */
export type NotifyMode = 'off' | 'attention' | 'every-turn'

/** Resolved notification settings the decision reads. */
export interface NotifySettings {
  /** Policy: `off` silences everything, `attention` notifies on attention events, `every-turn` keeps the legacy per-turn popup. */
  readonly mode: NotifyMode
  /** Local input within this many seconds downgrades desktop notifications to bell. */
  readonly quietInputSeconds: number
}

/** Which attention event is asking for a decision. */
export type NotifyTriggerKind = 'idle' | 'approval' | 'ask-user'

/** Inputs used to decide one attention-event notification's delivery and copy. */
export interface NotifyDecisionInput {
  /** Attention event kind. */
  readonly kind: NotifyTriggerKind
  /** Resolved notification settings. */
  readonly settings: NotifySettings
  /** Seconds since the most recent local keyboard input. */
  readonly secondsSinceLastInput: number
  /** `turn/end` reason kind, required for the `idle` summary. */
  readonly turnEndReason?: TurnEndReason['kind'] | undefined
  /**
   * Full cancellation cause for the `aborted` reason. Required when
   * `turn/end` reason is `aborted` so the decision can distinguish a
   * user-initiated abort (silent in attention mode, legacy cancel copy in
   * `every-turn`) from a parent, hook, disposed, or legacy abort (which
   * uses the interrupted copy in both modes because the user did not ask
   * to stop the run). Missing on cold-import logs whose coarse record
   * carried no cause; such runs default to the interrupted copy.
   */
  readonly abortCause?: TurnEndCancelCause | undefined
  /** Human-readable failure text for the `error` reason; truncated to the summary limit. */
  readonly errorText?: string | undefined
  /** Tool name for the `approval` ask. */
  readonly toolName?: string | undefined
  /** First question text for the `ask-user` ask; truncated to the summary limit. */
  readonly questionText?: string | undefined
  /** Live session display title appended as ` · title`; empty or absent omits the suffix. */
  readonly sessionTitle?: string | undefined
}

/** Application name used as the notification title on every transport. */
export const NOTIFY_TITLE = 'DeepSeek'

/** Default quiet-input window in seconds when the settings section omits it. */
export const DEFAULT_NOTIFY_QUIET_INPUT_SECONDS = 10

/** Hard cap for embedded failure and question text inside a notification body. */
export const NOTIFY_SUMMARY_LIMIT = 80

/**
 * Decide whether one attention event produces a desktop notification, a
 * bell-only downgrade, or silence.
 * @param input - the attention event plus resolved settings and input recency.
 * @returns the decision; `undefined` silences the event entirely.
 */
export function decideNotify(input: NotifyDecisionInput): NotifyDecision {
  if (input.settings.mode === 'off') return undefined
  const message = buildMessage(input)
  if (message === undefined) return undefined
  if (input.settings.mode === 'every-turn') return { desktop: true, ...message }
  if (input.secondsSinceLastInput < input.settings.quietInputSeconds) return { desktop: false }
  return { desktop: true, ...message }
}

/** Compose the copy for one attention event; `undefined` means nothing to say. */
function buildMessage(input: NotifyDecisionInput): NotifyMessage | undefined {
  const titleSuffix = input.sessionTitle ? ` · ${input.sessionTitle}` : undefined
  const suffix = titleSuffix ?? ''
  if (input.kind === 'approval') {
    return {
      title: NOTIFY_TITLE,
      body: `⏸ 需要批准:${input.toolName ?? '工具调用'}${suffix}`,
      urgency: 'critical',
      ...(titleSuffix === undefined ? {} : { titleSuffix }),
    }
  }
  if (input.kind === 'ask-user') {
    return {
      title: NOTIFY_TITLE,
      body: `❓ 需要回答:${truncateCodePoints(input.questionText ?? '请查看终端', NOTIFY_SUMMARY_LIMIT)}${suffix}`,
      urgency: 'critical',
      ...(titleSuffix === undefined ? {} : { titleSuffix }),
    }
  }
  return turnEndMessage(input.turnEndReason, input.abortCause, input.errorText, suffix, titleSuffix, input.settings.mode === 'every-turn')
}

/**
 * Map one `turn/end` reason to its summary copy. Every documented reason owns
 * a distinct line; the merge-extensible union falls through to the default
 * line so plugin-added kinds still notify. An `aborted` reason without a
 * recorded cause falls back to the interrupted copy (a missing cause is not
 * evidence that the user pressed Esc, and surfacing the interrupt protects
 * them from a silent disappearance). An explicit user abort keeps the
 * OpenSpec canonical `⏹ 回合已取消` line under `every-turn` and stays silent
 * under `attention` (the user caused it). Non-user aborts (parent, hook,
 * disposed, legacy) reuse the interrupted copy in both modes because the user
 * did not ask to stop the run.
 * @param reason - the `turn/end` reason kind to summarize.
 * @param abortCause - the cancellation cause for `aborted`; other reasons ignore it.
 * @param errorText - failure text for the `error` reason.
 * @param suffix - the ` · title` session suffix, or ''.
 * @param titleSuffix - explicit ` · title` suffix metadata, undefined when none.
 * @param escapeHatch - true under the `every-turn` policy.
 * @returns the message, or `undefined` when attention mode must stay silent.
 */
function turnEndMessage(
  reason: TurnEndReason['kind'] | undefined,
  abortCause: TurnEndCancelCause | undefined,
  errorText: string | undefined,
  suffix: string,
  titleSuffix: string | undefined,
  escapeHatch: boolean,
): NotifyMessage | undefined {
  const withSuffix = (body: string, urgency: NotifyUrgency): NotifyMessage => ({
    title: NOTIFY_TITLE,
    body: `${body}${suffix}`,
    urgency,
    ...(titleSuffix === undefined ? {} : { titleSuffix }),
  })
  switch (reason) {
    case 'completed':
      return withSuffix('✅ 任务完成', 'normal')
    case 'error':
      return {
        title: NOTIFY_TITLE,
        body: `❌ 回合失败:${truncateCodePoints(errorText ?? '未知错误', NOTIFY_SUMMARY_LIMIT)}${suffix}`,
        urgency: 'critical',
        ...(titleSuffix === undefined ? {} : { titleSuffix }),
      }
    case 'max-tokens':
      return withSuffix('⚠ 输出达到上限,回合被截断', 'normal')
    case 'blocked':
      return withSuffix('⛔ 回合被策略阻塞', 'critical')
    case 'interrupted':
      return withSuffix('⚠ 上次会话异常中断,回合已收尾', 'normal')
    case 'aborted': {
      // Missing cause → treat conservatively as non-user (interrupted copy).
      if (abortCause === undefined || abortCause.kind !== 'user') {
        return withSuffix('⚠ 上次会话异常中断,回合已收尾', 'normal')
      }
      // Explicit user abort: every-turn keeps the OpenSpec canonical
      // `⏹ 回合已取消` line — no suffix, no titleSuffix, even when the
      // session has a resolved title; attention stays silent.
      if (escapeHatch) return { title: NOTIFY_TITLE, body: '⏹ 回合已取消', urgency: 'normal' }
      return undefined
    }
    default:
      return withSuffix('⚠ 回合异常结束', 'normal')
  }
}

/**
 * Cut text to the limit so a provider failure or long question cannot flood
 * the popup. Operates on Unicode code points (Unicode scalar values) rather
 * than UTF-16 code units, so emoji and other supplementary-plane code points
 * never split mid-character.
 * @param text - raw text to truncate.
 * @param limit - maximum number of code points to keep.
 * @returns the longest leading code-point prefix within the limit.
 */
export function truncateCodePoints(text: string, limit: number): string {
  const codePoints = Array.from(text)
  if (codePoints.length <= limit) return text
  return codePoints.slice(0, limit).join('')
}
