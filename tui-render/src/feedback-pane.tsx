/**
 * Feedback overlay (`反馈`, `g f`): rate the last finalized assistant message
 * with `l 赞` / `d 踩`, edit a note with `e`. The current rating row carries
 * `· 当前`. Empty target, missing service, and write failures each paint
 * their D-10 copy pair; the note draft owns the composer like a settings
 * field (edit footnote `Enter 写入 · Esc 取消`).
 * @module @deepseek-ai/dsh-tui-render/feedback-pane
 */

import { Text } from 'ink'
import type { ReactNode } from 'react'
import { OverlayShell } from './overlay-shell.tsx'
import { escapeContent } from './content.ts'
import { paintRow, styled } from './theme.ts'

/** Write-failure kinds mapped to their copy pairs (D-10). */
export type FeedbackWriteError = 'write-failure' | 'version-conflict' | 'note-too-large'

/** Controller snapshot for the feedback overlay. */
export interface FeedbackPaneState {
  /** Whether this overlay currently replaces the conversation column. */
  readonly open: boolean
  /** Whether a finalized assistant message exists to target. */
  readonly hasTarget: boolean
  /** The target's current rating (drives the `· 当前` marker). */
  readonly rating?: 'positive' | 'negative' | undefined
  /** The target's current note (prefills the `e` draft). */
  readonly note?: string | undefined
  /** True while the note draft owns the composer. */
  readonly editing: boolean
  /** S19 opener error when the message-feedback service is not composed. */
  readonly error?: string | undefined
  /** The last write failure kind. */
  readonly writeError?: FeedbackWriteError | undefined
  /** Failure reason for `write-failure` (`{原因}`). */
  readonly writeErrorReason?: string | undefined
}

/** Closed overlay snapshot: TuiLoop keeps StreamView in children. */
export const EMPTY_FEEDBACK_PANE: FeedbackPaneState = {
  open: false,
  hasTarget: false,
  editing: false,
}

/** The error + recovery lines for each write-failure kind. */
const WRITE_FAILURE_COPY: Record<FeedbackWriteError, { next: string }> = {
  'write-failure': { next: '当前评分保持不变 · 可重试' },
  'version-conflict': { next: '已刷新当前版本 · 可重试' },
  'note-too-large': { next: '缩短后 Enter 再写入 · Esc 取消编辑' },
}

/**
 * The feedback overlay: title `反馈`, the two rating rows, and the
 * mode-appropriate footnote.
 * @param props - the pane state.
 * @returns the element tree, or null when closed.
 */
export function FeedbackPane({
  state,
}: {
  /** The overlay snapshot. */
  state: FeedbackPaneState
}): ReactNode {
  if (!state.open) return null
  if (state.error !== undefined) {
    return <OverlayShell title="反馈" error={state.error} footnote="Esc 关闭" />
  }
  if (!state.hasTarget) {
    return (
      <OverlayShell
        title="反馈"
        body="暂无助手消息可反馈"
        footnote="等待助手回复后再打开 · Esc 关闭"
      />
    )
  }
  const writeError = state.writeError
  const errorText =
    writeError === undefined
      ? undefined
      : writeError === 'write-failure'
        ? `反馈未能写入：${state.writeErrorReason ?? ''}`
        : writeError === 'version-conflict'
          ? '版本冲突'
          : '备注过长'
  const rows: ReactNode[] = (
    [
      { key: 'positive', label: '赞' },
      { key: 'negative', label: '踩' },
    ] as const
  ).map(row => (
    <Text key={row.key}>
      {paintRow([
        styled(
          escapeContent(`${row.label}${state.rating === row.key ? ' · 当前' : ''}`),
          state.rating === row.key ? 'fg' : 'fgDim',
        ),
      ])}
    </Text>
  ))
  return (
    <OverlayShell
      title="反馈"
      footnote={state.editing ? 'Enter 写入 · Esc 取消' : 'l 赞 · d 踩 · e 备注 · Esc 关闭'}
      error={errorText}
      errorNext={writeError === undefined ? undefined : WRITE_FAILURE_COPY[writeError].next}
    >
      {rows}
    </OverlayShell>
  )
}
