import { createElement } from 'react'
import { renderToString } from 'ink'
import { stripVTControlCharacters } from 'node:util'
import { expect, it } from 'vitest'
import { SchedulePane, EMPTY_SCHEDULE_PANE } from '../src/schedule-pane.tsx'

const rows = Array.from({ length: 1000 }, (_, index) => ({
  id: `task-${index}`, sessionId: 'original', title: `TASK_${String(index).padStart(4, '0')}`,
  prompt: '完整说明\n'.repeat(200) + 'END_INSTRUCTION', timing: '每天 12:00 · Asia/Shanghai',
  scheduledAt: '2026-10-20T04:00:00Z', active: true,
}))
it('bounds a large task catalog and keeps the selected task visible', () => {
  const output = stripVTControlCharacters(renderToString(createElement(SchedulePane, { state: {
    ...EMPTY_SCHEDULE_PANE, open: true, rows, selectedIndex: 999,
  } })))
  expect(output).toContain('TASK_0999')
  expect(output).not.toContain('TASK_0000')
  expect(output).toContain('d 取消任务')
  expect(output.split('\n').length).toBeLessThanOrEqual(22)
})
it('pages the complete instruction and shows explicit cancellation choices', () => {
  const state = { ...EMPTY_SCHEDULE_PANE, open: true, rows, details: true, offset: Number.MAX_SAFE_INTEGER }
  const detail = stripVTControlCharacters(renderToString(createElement(SchedulePane, { state })))
  expect(detail).toContain('END_INSTRUCTION')
  const confirm = stripVTControlCharacters(renderToString(createElement(SchedulePane, { state: { ...state, confirmDelete: true } })))
  expect(confirm).toContain('y 确认取消')
  expect(confirm).toContain('n/Esc 保留')
  expect(confirm).toContain('TASK_0000')
})
