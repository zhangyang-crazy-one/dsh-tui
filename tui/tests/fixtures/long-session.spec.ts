/**
 * Long-session fixture verification (03-09 SC4 prep): byte determinism,
 * the 2000-message persist → load → seed-rebuild round trip, first/last
 * message content, and a headless FrameProbe snapshot smoke. The render-path
 * (useInsertionEffect) smoke lives in tui-render's frame-stats.spec.ts; the
 * tui package cannot resolve ink/react directly (strict pnpm layout), so this
 * spec drives the probe headlessly with an injected clock and asserts shape
 * and non-negativity without fabricating render numbers.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  createFrameProbe,
  frameStatsSnapshot,
} from '@deepseek-ai/dsh-tui-render'
import {
  LONG_SESSION_ID,
  LONG_SESSION_MESSAGES,
  LONG_SESSION_TURNS,
  longSessionEvents,
  longSessionText,
  writeLongSession,
} from './long-session.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** The user/assistant text of one message event, or undefined for markers. */
function messageText(event: SessionEvent): string | undefined {
  if (event.type === 'user/message') {
    const text = event.data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    return text === '' ? undefined : text
  }
  if (event.type === 'assistant/message') {
    const text = event.data.message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    return text === '' ? undefined : text
  }
  return undefined
}

describe('long-session fixture (SC4 prep)', () => {
  it('generates byte-identical events for the same seed', () => {
    const first = longSessionEvents(7)
    const second = longSessionEvents(7)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first).toHaveLength(LONG_SESSION_TURNS * 4)
    const messages = first.filter(
      event => event.type === 'user/message' || event.type === 'assistant/message',
    )
    expect(messages).toHaveLength(LONG_SESSION_MESSAGES)
  })

  it('persists and reloads exactly 2000 messages with first/last content intact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-long-'))
    roots.push(root)
    const fixture = await writeLongSession(root)
    expect(fixture.id).toBe(LONG_SESSION_ID)
    expect(fixture.jsonlPath.length).toBeGreaterThan(0)

    const reader = new Context()
    await reader.plugin(SessionStore)
    await reader.plugin(JsonlSessionPersistence, { root })
    const loaded = await reader.sessionPersistence.load(SessionId(fixture.id))
    // create() seals the seed with one session/end-seed boundary, so the
    // durable log holds the 4000 fixture events plus that marker.
    expect(loaded.events).toHaveLength(LONG_SESSION_TURNS * 4 + 1)
    const loadedMessages = loaded.events.filter(
      event =>
        event.type === 'user/message' || event.type === 'assistant/message',
    )
    expect(loadedMessages).toHaveLength(LONG_SESSION_MESSAGES)
    // Seed-rebuild: a fresh session replayed from the durable log.
    const rebuilt = reader.sessions.create(SessionId(fixture.id), {
      seed: loaded.events.map(event => structuredClone(event)),
    })
    const messages = rebuilt.events.filter(
      event => event.type === 'user/message' || event.type === 'assistant/message',
    )
    expect(messages).toHaveLength(LONG_SESSION_MESSAGES)
    expect(messageText(messages[0]!)).toBe(longSessionText(0, 'user'))
    expect(messageText(messages.at(-1)!)).toBe(
      longSessionText(LONG_SESSION_MESSAGES - 1, 'assistant'),
    )
    await reader.fiber.dispose()
  })

  it('drives a headless FrameProbe snapshot smoke (shape non-empty, non-negative)', () => {
    let now = 1_000
    const clock = {
      now: () => now,
      advance: (ms: number) => {
        now += ms
      },
    }
    const probe = createFrameProbe(clock.now)
    clock.advance(8)
    probe.record(8)
    clock.advance(12)
    probe.record(12)
    clock.advance(5)
    probe.record(5)
    const snapshot = frameStatsSnapshot(probe)
    expect(snapshot.count).toBe(3)
    expect(snapshot.samples).toHaveLength(3)
    for (const sample of snapshot.samples) {
      expect(sample).toBeGreaterThanOrEqual(0)
    }
    expect(snapshot.mean).toBeGreaterThanOrEqual(0)
    expect(snapshot.max).toBeGreaterThanOrEqual(0)
    expect(snapshot.p95).toBeGreaterThanOrEqual(0)
  })
})
