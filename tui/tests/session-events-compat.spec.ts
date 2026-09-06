import { describe, expect, it } from 'vitest'
import { createProjector } from '@deepseek-ai/dsh-tui-render'
import { ensureSessionEventsCompat, getSessionEvents } from '../src/index.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

describe('session events backwards compatibility', () => {
  it('handles undefined and empty session cleanly', () => {
    expect(getSessionEvents(undefined)).toEqual([])
    expect(getSessionEvents(null)).toEqual([])
    expect(getSessionEvents({})).toEqual([])
  })

  it('reads modern session.events array', () => {
    const mockEvents: readonly SessionEvent[] = [
      { seq: 0, time: 100, type: 'turn/start', data: {} } as unknown as SessionEvent,
    ]
    const session = { events: mockEvents }
    expect(getSessionEvents(session)).toBe(mockEvents)
  })

  it('reads legacy session.snapshotEvents() method', () => {
    const mockEvents: readonly SessionEvent[] = [
      { seq: 0, time: 100, type: 'turn/start', data: {} } as unknown as SessionEvent,
    ]
    const legacySession = {
      snapshotEvents: () => mockEvents,
    }
    expect(getSessionEvents(legacySession)).toBe(mockEvents)
  })

  it('polyfils session.events via ensureSessionEventsCompat', () => {
    const mockEvents: readonly SessionEvent[] = [
      { seq: 0, time: 100, type: 'turn/start', data: {} } as unknown as SessionEvent,
    ]
    class MockLegacySession {
      snapshotEvents() {
        return mockEvents
      }
    }
    const instance = new MockLegacySession()
    expect((instance as unknown as { events?: unknown }).events).toBeUndefined()

    ensureSessionEventsCompat(instance)
    expect((instance as unknown as { events?: readonly SessionEvent[] }).events).toEqual(mockEvents)
  })

  it('projector.seed does not throw on undefined or non-iterable events', () => {
    const projector = createProjector()
    expect(() => {
      projector.seed(undefined)
    }).not.toThrow()
    expect(() => {
      projector.seed(null as unknown as readonly SessionEvent[])
    }).not.toThrow()
    expect(() => {
      projector.seed({} as unknown as readonly SessionEvent[])
    }).not.toThrow()
  })
})
