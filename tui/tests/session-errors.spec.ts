/**
 * Session-writer contention maps to the Web retry sentence; other Errors keep
 * their message. Logs may still contain the original diagnostic.
 */
import { describe, expect, it } from 'vitest'
import {
  SESSION_WRITER_HELD_COPY,
  isSessionWriterHeld,
  userErrorReason,
} from '../src/session-errors.ts'

describe('isSessionWriterHeld / userErrorReason', () => {
  it('recognizes SessionAlreadyOwnedError, session/writer-held, and nested causes', () => {
    const owned = Object.assign(new Error('held'), { name: 'SessionAlreadyOwnedError' })
    expect(isSessionWriterHeld(owned)).toBe(true)
    expect(isSessionWriterHeld({ code: 'session/writer-held' })).toBe(true)
    expect(isSessionWriterHeld({ cause: owned })).toBe(true)
    expect(isSessionWriterHeld(new AggregateError([owned], 'wrapped'))).toBe(true)
    expect(isSessionWriterHeld(new Error('EIO'))).toBe(false)
    expect(isSessionWriterHeld('session/writer-held')).toBe(false)
  })

  it('returns the retry copy instead of a generic IO message', () => {
    const owned = Object.assign(new Error('EACCES: lock'), { name: 'SessionAlreadyOwnedError' })
    expect(userErrorReason(owned)).toBe(SESSION_WRITER_HELD_COPY)
    expect(userErrorReason(owned)).not.toContain('EACCES')
    expect(userErrorReason({ code: 'session/writer-held', message: 'held' }))
      .toBe(SESSION_WRITER_HELD_COPY)
    expect(userErrorReason(new Error('flush boom'))).toBe('flush boom')
  })
})
