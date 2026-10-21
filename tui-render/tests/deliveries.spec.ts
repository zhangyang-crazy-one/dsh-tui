/** Explicit file deliveries remain available independently of editing tool cards. */
import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { createProjector } from '../src/projection.ts'

it('projects live and replayed deliveries, deduplicates paths, and keeps the source descriptions', () => {
  const session = Session.create(SessionId('delivery-projection'))
  session.append('turn/start', { turn: 1 })
  session.append('deliverables/presented', { turn: 1, callId: ToolCallId('present-1'), files: [{ path: '/ws/报告.pdf', description: 'Final report' }] })
  const projector = createProjector()
  projector.seed(session.snapshotEvents())
  expect(projector.snapshot().deliveries).toEqual([{ path: '/ws/报告.pdf', description: 'Final report' }])
  const reading = projector.snapshot().deliveries
  expect(projector.snapshot().deliveries).toBe(reading)
  const event = session.append('deliverables/presented', { turn: 1, callId: ToolCallId('present-2'), files: [
    { path: '/ws/报告.pdf', description: 'Revised report' }, { path: '/ws/data.csv' },
  ] })
  projector.push(event)
  expect(reading).toEqual([{ path: '/ws/报告.pdf', description: 'Final report' }])
  expect(projector.snapshot().deliveries).toEqual([{ path: '/ws/报告.pdf', description: 'Revised report' }, { path: '/ws/data.csv' }])
  projector.push(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  expect(projector.snapshot().history.at(-1)?.presentedFiles).toEqual(projector.snapshot().deliveries)
  const replay = createProjector();replay.seed(session.snapshotEvents())
  expect(replay.snapshot().deliveries).toEqual(projector.snapshot().deliveries)
  expect(replay.snapshot().history).toEqual(projector.snapshot().history)
})

it('renders complete delivery paths and descriptions within the terminal width', async () => {
  const { deliveryLines } = await import('../src/delivery-lines.ts')
  const path = `/ws/${'中文报告'.repeat(12)}.pdf`
  const lines = deliveryLines([{ path, description: 'This is the final report' }], 20)
  const joined = lines.map(row => row.text).join('')
  expect(joined).toContain(path)
  expect(joined).toContain('This is the final report')
  expect(lines.filter(row => row.href !== undefined).every(row => row.href === new URL(`file://${path}`).href)).toBe(true)
  const { displayWidth } = await import('../src/content.ts')
  expect(lines.every(row => displayWidth(row.text) <= 20)).toBe(true)
})
