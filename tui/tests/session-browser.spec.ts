import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { attachmentRows, trajectoryRows, eventJson } from '../src/session-browser.ts'

it('projects event granularity and real timing/usage facts without inventing measurements', () => {
  const events = [
    { type: 'turn/start', seq: SessionSeq(0), time: 100, data: { turn: 1 } },
    { type: 'tool/call', seq: SessionSeq(1), time: 120, data: { name: 'bash', arguments: { command: 'echo ok' } } },
    { type: 'turn/end', seq: SessionSeq(2), time: 180, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
  expect(trajectoryRows(events).map(row => row.id)).toEqual(['0','1','2'])
  expect(trajectoryRows(events)[1]?.title).toContain('bash')
  expect(trajectoryRows(events)[2]?.hint).toContain('80 ms')
  expect(eventJson(events[1]!)).toContain('echo ok')
})
it('enumerates typed image/file references in order, preserving duplicate names and opaque identities', () => {
  const events = [{ type: 'user/message', seq: SessionSeq(2), time: 1, data: { content: [
    { type: 'image', attachment: { attachmentId: 'opaque-image', name: 'same.png', width: 2, height: 3, mediaType: 'image/png', bytes: 10 } },
    { type: 'file', attachment: { attachmentId: 'opaque-file', name: 'same.png', bytes: 5 } },
  ] } }] as unknown as SessionEvent[]
  const rows = attachmentRows(events)
  expect(rows).toHaveLength(2)
  expect(rows.map(row => row.id)).toEqual(['2:0','2:1'])
  expect(rows[0]?.ref.attachmentId).toBe('opaque-image')
  expect(rows[1]?.kind).toBe('file')
  expect(rows[0]?.title).toContain('same.png')
})
