/** Bounded terminal task catalog; storage and mutations stay in the controller. */
import { Text, useWindowSize } from 'ink'
import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { escapeContent, wrapDisplayLines } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'

export interface SchedulePaneRow {
  readonly id: string
  readonly sessionId: string
  readonly title: string
  readonly prompt: string
  readonly timing: string
  readonly scheduledAt: string
  readonly active: boolean
  readonly lastDelivery?: string
}
export interface SchedulePaneState {
  readonly open: boolean
  readonly rows: readonly SchedulePaneRow[]
  readonly selectedIndex: number
  readonly details: boolean
  readonly offset: number
  readonly loading: boolean
  readonly busy: boolean
  readonly confirmDelete: boolean
  readonly error?: string | undefined
}
export const EMPTY_SCHEDULE_PANE: SchedulePaneState = {
  open: false, rows: [], selectedIndex: 0, details: false, offset: 0,
  loading: false, busy: false, confirmDelete: false,
}

/** Keep navigation and destructive-action confirmation visible at small terminal sizes. */
export function SchedulePane({ state, onOffsetChange }: {
  state: SchedulePaneState
  onOffsetChange?: (offset: number) => void
}): ReactNode {
  const { columns, rows } = useWindowSize()
  const width = Math.max(1, columns - 4)
  const capacity = Math.max(1, rows - 9)
  const selected = state.rows[state.selectedIndex]
  const detail = useMemo(() => selected === undefined ? [] : wrapDisplayLines([
    selected.title, `任务: ${selected.id}`, `会话: ${selected.sessionId}`,
    `状态: ${selected.active ? '等待触发' : '已结束'}`, `规则: ${selected.timing}`,
    `计划时间: ${selected.scheduledAt}`, ...(selected.lastDelivery === undefined ? [] : [`最近交付: ${selected.lastDelivery}`]),
    '', selected.prompt,
  ].map(escapeContent).join('\n'), width), [selected, width])
  const offset = Math.min(Math.max(0, state.offset), Math.max(0, detail.length - capacity))
  useLayoutEffect(() => {
    if (state.details && state.offset !== offset) onOffsetChange?.(offset)
  }, [state.details, state.offset, offset, onOffsetChange])
  let lines: string[]
  if (state.confirmDelete && selected !== undefined) {
    lines = wrapDisplayLines(`取消并删除任务：${escapeContent(selected.title)}\n${escapeContent(selected.id)}\n已进入会话的提醒消息不会删除。`, width).slice(0, capacity)
  } else if (state.details && selected !== undefined) {
    lines = detail.slice(offset, offset + capacity)
  } else {
    const start = Math.max(0, Math.min(state.selectedIndex - Math.floor(capacity / 2), state.rows.length - capacity))
    lines = state.rows.slice(start, start + capacity).map((row, index) => truncateDisplay(
      `${index + start === state.selectedIndex ? '›' : ' '} ${row.active ? '待触发' : '已结束'} · ${escapeContent(row.title)}`, width))
    if (lines.length === 0) lines = [state.loading ? '正在读取任务…' : '暂无任务；可让模型创建定时提醒。']
  }
  const footnote = state.busy ? '正在取消任务…' : state.confirmDelete ? 'y 确认取消 · n/Esc 保留'
    : state.details ? '↑↓/PgUp/PgDn 阅读 · Enter 原会话 · d 取消任务 · Esc 列表'
      : '↑↓ 选择 · Enter 详情 · d 取消任务 · r 刷新 · Esc 返回'
  return <OverlayShell title={`定时任务 · ${state.rows.length}`} footnote={footnote}>
    {state.error === undefined ? null : <Text wrap="truncate">{paintRow([styled(truncateDisplay(escapeContent(state.error), width), 'fg')])}</Text>}
    {lines.slice(0, Math.max(0, capacity - (state.error === undefined ? 0 : 1))).map((line, index) =>
      <Text key={index} wrap="truncate">{paintRow([styled(line || ' ', 'fg')])}</Text>)}
  </OverlayShell>
}
