/**
 * FeedbackPane: title `反馈`, rating rows with the `· 当前` marker, mode
 * footnotes per D-10, and the empty/service/write-failure copy pairs.
 */

import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { FeedbackPane } from '../src/feedback-pane.tsx'
import type { FeedbackPaneState } from '../src/feedback-pane.tsx'

/** Strip SGR/CSI sequences so content assertions read the painted text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** An open state with a target and the given overrides. */
function openState(overrides: Partial<FeedbackPaneState> = {}): FeedbackPaneState {
  return { open: true, hasTarget: true, editing: false, ...overrides }
}

/** Render the pane to plain text (no SGR) for content assertions. */
function renderPlain(state: FeedbackPaneState): string {
  return stripAnsi(renderToString(createElement(FeedbackPane, { state })))
}

describe('FeedbackPane', () => {
  it('renders a write failure even when the provider supplies no reason', () => {
    expect(renderPlain(openState({ writeError: 'write-failure', writeErrorReason: undefined })))
      .toContain('反馈未能写入：')
  })
  it('paints nothing when closed', () => {
    expect(renderPlain({ ...openState(), open: false })).toBe('')
  })

  it('paints the S19 opener error when the service is not composed', () => {
    const output = renderPlain(openState({ error: '反馈服务未组合' }))
    expect(output).toContain('反馈')
    expect(output).toContain('✗ 反馈服务未组合')
    expect(output).toContain('Esc 关闭')
  })

  it('paints the empty-target copy with the wait next step', () => {
    const output = renderPlain(openState({ hasTarget: false }))
    expect(output).toContain('暂无助手消息可反馈')
    expect(output).toContain('等待助手回复后再打开 · Esc 关闭')
  })

  it('marks the current rating row with · 当前', () => {
    const positive = renderPlain(openState({ rating: 'positive' }))
    expect(positive).toContain('赞 · 当前')
    expect(positive).not.toContain('踩 · 当前')
    const negative = renderPlain(openState({ rating: 'negative' }))
    expect(negative).toContain('踩 · 当前')
    expect(negative).not.toContain('赞 · 当前')
  })

  it('switches the footnote between browse and note editing', () => {
    expect(renderPlain(openState())).toContain('l 赞 · d 踩 · e 备注 · Esc 关闭')
    expect(renderPlain(openState({ editing: true }))).toContain('Enter 写入 · Esc 取消')
  })

  it('paints the write-failure pair with the reason', () => {
    const output = renderPlain(
      openState({ writeError: 'write-failure', writeErrorReason: 'session-not-found' }),
    )
    expect(output).toContain('✗ 反馈未能写入：session-not-found')
    expect(output).toContain('当前评分保持不变 · 可重试')
  })

  it('paints the version-conflict pair', () => {
    const output = renderPlain(openState({ writeError: 'version-conflict' }))
    expect(output).toContain('✗ 版本冲突')
    expect(output).toContain('已刷新当前版本 · 可重试')
  })

  it('paints the note-too-large pair', () => {
    const output = renderPlain(openState({ writeError: 'note-too-large' }))
    expect(output).toContain('✗ 备注过长')
    expect(output).toContain('缩短后 Enter 再写入 · Esc 取消编辑')
  })
})
