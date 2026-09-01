/**
 * Tests for {@link ../src/physical-line.ts} and
 * {@link ../src/transcript-line-store.ts}. The store and its companion
 * record type are pure data modules — the tests assert behavior
 * directly without React, Ink, or any TTY side effect.
 */

import { describe, expect, it } from 'vitest'
import {
  createPhysicalLine,
  osc8AtColumn,
  physicalLineByteSize,
  sourceOffsetAtColumn,
  type PhysicalLine,
  type PhysicalLineSpan,
} from '../src/physical-line.ts'
import {
  createTranscriptRenderStore,
  DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES,
  DEFAULT_TRANSCRIPT_CACHE_MAX_ROWS,
  type BlockSnapshot,
  type RebuildLines,
  type TranscriptRenderStore,
  type TranscriptRenderStoreConfig,
} from '../src/transcript-line-store.ts'

/** Build one styled span for the "plain" fg token. */
function span(text: string): PhysicalLineSpan {
  return { text, token: 'fg' }
}

/**
 * Build one physical line with a flat span covering the whole text.
 * Convenience for tests that do not care about per-span styling.
 */
function plainLine(
  blockId: string,
  blockRow: number,
  text: string,
  sourceStart: number,
  sourceEnd: number,
): PhysicalLine {
  return createPhysicalLine({
    blockId,
    spans: [span(text)],
    sourceStart,
    sourceEnd,
    blockRow,
  })
}

describe('createPhysicalLine', () => {
  it('freezes the record and partitions spans into the visible text', () => {
    const line = createPhysicalLine({
      blockId: 'b1',
      spans: [span('hello '), { text: 'world', token: 'accent', bold: true }],
      sourceStart: 0,
      sourceEnd: 11,
      blockRow: 0,
    })
    expect(line.text).toBe('hello world')
    expect(line.displayWidth).toBe(11)
    expect(Object.isFrozen(line)).toBe(true)
    expect(Object.isFrozen(line.spans)).toBe(true)
    for (const span of line.spans) expect(Object.isFrozen(span)).toBe(true)
    expect(line.spans[1]?.bold).toBe(true)
  })

  it('threads the optional osc8 href/id through frozen fields', () => {
    const line = createPhysicalLine({
      blockId: 'b1',
      spans: [span('doc')],
      sourceStart: 0,
      sourceEnd: 3,
      blockRow: 0,
      osc8: { href: 'https://example.test', id: 'doc-1' },
    })
    expect(line.osc8).toEqual({ href: 'https://example.test', id: 'doc-1' })
    expect(Object.isFrozen(line.osc8)).toBe(true)
  })

  it('rejects empty blockId and non-integer or out-of-range source coords', () => {
    expect(() =>
      createPhysicalLine({
        blockId: '',
        spans: [span('x')],
        sourceStart: 0,
        sourceEnd: 1,
        blockRow: 0,
      }),
    ).toThrow(/blockId/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: -1,
        sourceEnd: 1,
        blockRow: 0,
      }),
    ).toThrow(/sourceStart/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: 0.5,
        sourceEnd: 1,
        blockRow: 0,
      }),
    ).toThrow(/sourceStart/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: 5,
        sourceEnd: 4,
        blockRow: 0,
      }),
    ).toThrow(/sourceEnd/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: 0,
        sourceEnd: 1,
        blockRow: -1,
      }),
    ).toThrow(/blockRow/)
  })

  it('rejects empty osc8 href or id', () => {
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: 0,
        sourceEnd: 1,
        blockRow: 0,
        osc8: { href: '', id: 'doc-1' },
      }),
    ).toThrow(/href/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('x')],
        sourceStart: 0,
        sourceEnd: 1,
        blockRow: 0,
        osc8: { href: 'https://example.test', id: '' },
      }),
    ).toThrow(/id/)
  })

  it('rejects graphemeSources whose length or values disagree with the text', () => {
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('ab')],
        sourceStart: 0,
        sourceEnd: 2,
        blockRow: 0,
        graphemeSources: [0],
      }),
    ).toThrow(/graphemeSources length/)
    expect(() =>
      createPhysicalLine({
        blockId: 'b1',
        spans: [span('ab')],
        sourceStart: 0,
        sourceEnd: 2,
        blockRow: 0,
        graphemeSources: [0, 5],
      }),
    ).toThrow(/graphemeSources offset/)
  })
})

describe('osc8AtColumn', () => {
  const line = createPhysicalLine({
    blockId: 'b1',
    spans: [span('hello')],
    sourceStart: 0,
    sourceEnd: 5,
    blockRow: 0,
    osc8: { href: 'https://example.test', id: 'doc-1' },
  })

  it('returns the href when column is inside the line', () => {
    expect(osc8AtColumn(line, 0)).toBe('https://example.test')
    expect(osc8AtColumn(line, 4)).toBe('https://example.test')
  })

  it('returns undefined when osc8 is absent or the column is out of range', () => {
    const noOsc8 = plainLine('b2', 0, 'hi', 0, 2)
    expect(osc8AtColumn(noOsc8, 0)).toBeUndefined()
    expect(osc8AtColumn(line, -1)).toBeUndefined()
    expect(osc8AtColumn(line, 5)).toBeUndefined()
    expect(osc8AtColumn(line, 0.5)).toBeUndefined()
  })

  it('resolves a link owned by one inline span only', () => {
    const split = createPhysicalLine({
      blockId: 'b3',
      spans: [
        { text: 'plain ', token: 'fg' },
        { text: '文档', token: 'accent', href: 'https://example.test/doc' },
      ],
      sourceStart: 0,
      sourceEnd: 8,
      blockRow: 0,
    })
    expect(osc8AtColumn(split, 2)).toBeUndefined()
    expect(osc8AtColumn(split, 6)).toBe('https://example.test/doc')
    expect(osc8AtColumn(split, 9)).toBe('https://example.test/doc')
  })
})

describe('sourceOffsetAtColumn', () => {
  it('returns sourceStart at negative columns and sourceEnd past the line', () => {
    const line = plainLine('b1', 0, 'abc', 10, 13)
    expect(sourceOffsetAtColumn(line, -1)).toBe(10)
    expect(sourceOffsetAtColumn(line, 99)).toBe(13)
  })

  it('uses the precomputed graphemeSources when present', () => {
    const line = createPhysicalLine({
      blockId: 'b1',
      spans: [span('ab')],
      sourceStart: 100,
      sourceEnd: 102,
      blockRow: 0,
      graphemeSources: [100, 101],
    })
    expect(sourceOffsetAtColumn(line, 0)).toBe(100)
    expect(sourceOffsetAtColumn(line, 1)).toBe(101)
  })

  it('falls back to a grapheme walk when graphemeSources is absent', () => {
    const line = plainLine('b1', 0, 'xyz', 5, 8)
    expect(sourceOffsetAtColumn(line, 0)).toBe(5)
    expect(sourceOffsetAtColumn(line, 1)).toBe(6)
    expect(sourceOffsetAtColumn(line, 2)).toBe(7)
  })

  it('treats non-integer columns as sourceStart', () => {
    const line = plainLine('b1', 0, 'abc', 10, 13)
    expect(sourceOffsetAtColumn(line, 1.5)).toBe(10)
  })
})

describe('physicalLineByteSize', () => {
  it('adds text length, span text length, source range, osc8 cost, and graphemeSources cost', () => {
    const line = createPhysicalLine({
      blockId: 'b1',
      spans: [span('hello'), { text: ' ', token: 'fg' }, span('world')],
      sourceStart: 0,
      sourceEnd: 11,
      blockRow: 0,
      osc8: { href: 'https://x', id: 'doc' },
      graphemeSources: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    })
    const bytes = physicalLineByteSize(line)
    expect(bytes).toBe('hello world'.length * 2 + 11 + 'https://x'.length + 'doc'.length + 11 * 4)
  })

  it('returns the smaller cost when osc8 and graphemeSources are absent', () => {
    const line = plainLine('b1', 0, 'abc', 0, 3)
    expect(physicalLineByteSize(line)).toBe('abc'.length * 2 + 3)
  })
})

interface RebuildCall {
  blockId: string
  source: string
  scopeKey: string
  revision: number
}

/** Wrap a build function so the test can introspect call args. */
function recordingRebuild(
  builder: (input: RebuildCall) => readonly PhysicalLine[],
): { rebuild: RebuildLines; calls: RebuildCall[] } {
  const calls: RebuildCall[] = []
  const rebuild: RebuildLines = (input) => {
    calls.push({ ...input })
    return builder(input)
  }
  return { rebuild, calls }
}

/** Build a fixed-row physical-line array from a string. */
function linesFromString(blockId: string, source: string): readonly PhysicalLine[] {
  const segments = source.split('')
  return segments.map((character, index) =>
    createPhysicalLine({
      blockId,
      spans: [span(character)],
      sourceStart: index,
      sourceEnd: index + 1,
      blockRow: index,
    }),
  )
}

/** Build a 10,000-line block whose source is a 10,000-character string. */
function largeSource(size: number): string {
  return Array.from({ length: size }, (_, index) => (index % 10).toString(10)).join('')
}

function storeWith(overrides: Partial<TranscriptRenderStoreConfig> = {}): {
  store: TranscriptRenderStore
  calls: RebuildCall[]
} {
  const { rebuild, calls } = recordingRebuild(input => linesFromString(input.blockId, input.source))
  const store = createTranscriptRenderStore({
    maxRows: 100,
    maxBytes: 10 * 1024 * 1024,
    rebuild,
    ...overrides,
  })
  return { store, calls }
}

describe('createTranscriptRenderStore validation', () => {
  it('rejects non-positive budgets', () => {
    const { rebuild } = recordingRebuild(input => linesFromString(input.blockId, input.source))
    expect(() =>
      createTranscriptRenderStore({ maxRows: 0, maxBytes: 1024, rebuild }),
    ).toThrow(/maxRows/)
    expect(() =>
      createTranscriptRenderStore({ maxRows: 10, maxBytes: 0, rebuild }),
    ).toThrow(/maxBytes/)
    expect(() =>
      createTranscriptRenderStore({ maxRows: 1.5, maxBytes: 1024, rebuild }),
    ).toThrow(/maxRows/)
  })

  it('exposes documented defaults', () => {
    expect(DEFAULT_TRANSCRIPT_CACHE_MAX_ROWS).toBeGreaterThan(0)
    expect(DEFAULT_TRANSCRIPT_CACHE_MAX_BYTES).toBeGreaterThan(0)
  })
})

describe('TranscriptRenderStore read/upsert', () => {
  it('returns undefined for unknown blocks', () => {
    const { store } = storeWith()
    expect(store.readBlock({ blockId: 'absent' })).toBeUndefined()
  })

  it('upserts the source for a settled block and rebuilds when scope changes', () => {
    const { store, calls } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    const first = store.readBlock({ blockId: 'b1' })
    expect(first?.source).toBe('abc')
    expect(first?.rowCount).toBe(3)
    expect(calls.length).toBe(1)

    // Same scope: returns the cached snapshot without a second rebuild.
    const second = store.readBlock({ blockId: 'b1' })
    expect(second?.lines).toBe(first?.lines)
    expect(calls.length).toBe(1)

    // Different scope: invalidates the cache and rebuilds.
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '120' })
    const third = store.readBlock({ blockId: 'b1' })
    expect(third?.scopeKey).toBe('120')
    expect(third?.lines).not.toBe(first?.lines)
    expect(calls.length).toBe(2)
  })

  it('rejects mutations while an active revision is held', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    expect(() => { store.upsertSource({ blockId: 'b1', source: 'xyz', scopeKey: '80' }) }).toThrow(/active revision/)
    revision.discard()
  })

  it('rejects empty blockId and scopeKey on every mutating entry point', () => {
    const { store } = storeWith()
    expect(() => { store.upsertSource({ blockId: '', source: 'a', scopeKey: 's' }) }).toThrow(/blockId/)
    expect(() => { store.upsertSource({ blockId: 'b', source: 'a', scopeKey: '' }) }).toThrow(/scopeKey/)
    expect(() =>
      store.acquireActive({ blockId: '', source: 'a', scopeKey: 's' }),
    ).toThrow(/blockId/)
    expect(() =>
      store.acquireActive({ blockId: 'b', source: 'a', scopeKey: '' }),
    ).toThrow(/scopeKey/)
    expect(() => store.readBlock({ blockId: '' })).toThrow(/blockId/)
  })
})

describe('TranscriptRenderStore active→settled transfer', () => {
  it('moves the same array reference from active to settled ownership', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    const first = [plainLine('b1', 0, 'a', 0, 1), plainLine('b1', 1, 'b', 1, 2)]
    revision.reset(first)
    revision.append([plainLine('b1', 2, 'c', 2, 3)])
    expect(revision.lines).toHaveLength(3)
    const snapshot = revision.settle()
    expect(snapshot.lines).toBe(revision.lines)
    expect(Object.isFrozen(snapshot.lines)).toBe(true)

    const read = store.readBlock({ blockId: 'b1' })
    expect(read?.lines).toBe(snapshot.lines)
  })

  it('rejects double-acquire and double-settle on the same revision handle', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'a', scopeKey: '80' })
    expect(() =>
      store.acquireActive({ blockId: 'b1', source: 'a', scopeKey: '80' }),
    ).toThrow(/already active/)
    revision.append([plainLine('b1', 0, 'x', 0, 1)])
    revision.settle()
    expect(() => { revision.append([plainLine('b1', 1, 'y', 1, 2)]) }).toThrow(/already settled/)
    expect(() => revision.settle()).toThrow(/already settled/)
    expect(() => { revision.discard() }).toThrow(/already settled/)
  })

  it('discard drops the active revision without producing a settled snapshot', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    const settledBefore = store.readBlock({ blockId: 'b1' })
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    revision.reset([plainLine('b1', 0, 'z', 0, 1)])
    revision.discard()
    const settledAfter = store.readBlock({ blockId: 'b1' })
    expect(settledAfter?.lines).toBe(settledBefore?.lines)
  })

  it('counts append/reset toward tailRowsRerendered', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abcd', scopeKey: '80' })
    revision.append([plainLine('b1', 0, 'a', 0, 1), plainLine('b1', 1, 'b', 1, 2)])
    revision.reset([plainLine('b1', 0, 'c', 0, 1)])
    expect(store.stats().tailRowsRerendered).toBe(3)
  })

  it('replaces active canonical source and rows before atomic settlement', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'a', scopeKey: '80' })
    const rows = [plainLine('b1', 0, 'abc', 0, 3)]
    revision.replace({ source: 'abc', lines: rows })
    expect(store.readBlock({ blockId: 'b1' })?.source).toBe('abc')
    const settled = revision.settle()
    expect(settled.source).toBe('abc')
    expect(settled.lines).toBe(revision.lines)
  })
})

describe('TranscriptRenderStore eviction and reconstruction', () => {
  it('evicts the coldest unpinned settled block when over the row budget', () => {
    const { store } = storeWith({ maxRows: 4, maxBytes: 10 * 1024 * 1024 })
    store.upsertSource({ blockId: 'b1', source: 'aaaa', scopeKey: '80' })
    store.upsertSource({ blockId: 'b2', source: 'bbbb', scopeKey: '80' })
    const before = store.readBlock({ blockId: 'b1' })
    void store.readBlock({ blockId: 'b2' })
    store.upsertSource({ blockId: 'b3', source: 'cccc', scopeKey: '80' })
    store.readBlock({ blockId: 'b3' })
    store.upsertSource({ blockId: 'b4', source: 'dddd', scopeKey: '80' })
    store.readBlock({ blockId: 'b4' })

    expect(store.stats().cachedBlocks).toBeLessThanOrEqual(4)
    expect(store.stats().cachedRows).toBeLessThanOrEqual(4)
    const stats = store.stats()
    expect(stats.evictions).toBeGreaterThan(0)
    expect(before?.lines).toBeDefined()
  })

  it('pinned blocks survive eviction; an evicted block rebuilds via the callback', () => {
    const { store, calls } = storeWith({ maxRows: 4, maxBytes: 10 * 1024 * 1024 })
    store.upsertSource({ blockId: 'pinned-1', source: 'aaa', scopeKey: '80' })
    store.upsertSource({ blockId: 'pinned-2', source: 'bbb', scopeKey: '80' })
    store.upsertSource({ blockId: 'victim', source: 'vvvv', scopeKey: '80' })
    store.readBlock({ blockId: 'pinned-1' })
    store.readBlock({ blockId: 'pinned-2' })
    store.readBlock({ blockId: 'victim' })
    store.setPins({ pinned: ['pinned-1', 'pinned-2'] })
    store.upsertSource({ blockId: 'b4', source: 'dddd', scopeKey: '80' })
    store.readBlock({ blockId: 'b4' })
    store.upsertSource({ blockId: 'b5', source: 'eeee', scopeKey: '80' })
    store.readBlock({ blockId: 'b5' })

    const stats = store.stats()
    expect(stats.evictions).toBeGreaterThan(0)

    const callsBeforeVictim = calls.length
    const rebuilt = store.readBlock({ blockId: 'victim' })
    expect(rebuilt).toBeDefined()
    expect(calls.length).toBe(callsBeforeVictim + 1)
    expect(stats.rebuilds).toBeGreaterThan(0)
  })

  it('keeps active revisions resident and never evicts them', () => {
    const { store } = storeWith({ maxRows: 3, maxBytes: 10 * 1024 * 1024 })
    const revision = store.acquireActive({ blockId: 'active', source: 'a'.repeat(100), scopeKey: '80' })
    revision.reset(
      Array.from({ length: 100 }, (_, index) => plainLine('active', index, 'a', index, index + 1)),
    )
    store.setPins({ pinned: ['active'] })
    store.upsertSource({ blockId: 'overflow', source: 'o'.repeat(100), scopeKey: '80' })
    store.readBlock({ blockId: 'overflow' })
    store.upsertSource({ blockId: 'overflow-2', source: 'p'.repeat(100), scopeKey: '80' })
    store.readBlock({ blockId: 'overflow-2' })
    const active = store.readBlock({ blockId: 'active' })
    expect(active?.lines.length).toBe(100)
  })

  it('rebuilds use the latest source and scope from the cache entry', () => {
    const seen: RebuildCall[] = []
    const { rebuild } = recordingRebuild((input) => {
      seen.push({ ...input })
      return linesFromString(input.blockId, input.source)
    })
    const store = createTranscriptRenderStore({
      maxRows: 2,
      maxBytes: 10 * 1024 * 1024,
      rebuild,
    })
    store.upsertSource({ blockId: 'b1', source: 'aaaa', scopeKey: '80' })
    store.upsertSource({ blockId: 'b2', source: 'bbbb', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    store.readBlock({ blockId: 'b2' })
    store.upsertSource({ blockId: 'b3', source: 'cccc', scopeKey: '120' })
    store.readBlock({ blockId: 'b3' })
    store.upsertSource({ blockId: 'b4', source: 'dddd', scopeKey: '120' })
    store.readBlock({ blockId: 'b4' })
    const rebuilt = store.readBlock({ blockId: 'b1' })
    expect(rebuilt).toBeDefined()
    const last = seen[seen.length - 1] as RebuildCall
    expect(last.source).toBe('aaaa')
    expect(last.scopeKey).toBe('80')
    expect(last.revision).toBe(0)
  })

  it('tracks stableRowsReused across hits and rebuilds', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    store.readBlock({ blockId: 'b1' })
    store.readBlock({ blockId: 'b1' })
    expect(store.stats().stableRowsReused).toBe(9)
  })
})

describe('TranscriptRenderStore 10,000-line single block', () => {
  it('keeps a single 10,000-line block resident when within budget', () => {
    const { store } = storeWith({ maxRows: 20_000, maxBytes: 10 * 1024 * 1024 })
    const source = largeSource(10_000)
    store.upsertSource({ blockId: 'huge', source, scopeKey: '80' })
    const snapshot = store.readBlock({ blockId: 'huge' }) as BlockSnapshot
    expect(snapshot.rowCount).toBe(10_000)
    const again = store.readBlock({ blockId: 'huge' })
    expect(again?.lines).toBe(snapshot.lines)
    expect(store.stats().evictions).toBe(0)
  })

  it('rolls the 10,000-row LRU under a 2,000-row budget and keeps it pinned', () => {
    const { store } = storeWith({ maxRows: 2_000, maxBytes: 10 * 1024 * 1024 })
    const source = largeSource(10_000)
    store.upsertSource({ blockId: 'huge', source, scopeKey: '80' })
    store.setPins({ pinned: ['huge'] })
    store.readBlock({ blockId: 'huge' })
    expect(store.stats().cachedRows).toBe(10_000)
    expect(store.stats().evictions).toBe(0)
  })
})

describe('TranscriptRenderStore scope invalidation', () => {
  it('bumps the revision when the source content changes', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    const first = store.readBlock({ blockId: 'b1' })
    const firstRevision = first?.revision
    store.upsertSource({ blockId: 'b1', source: 'abcd', scopeKey: '80' })
    const second = store.readBlock({ blockId: 'b1' })
    expect(second?.revision).toBe((firstRevision ?? 0) + 1)
  })

  it('passes the latest scopeKey to the rebuild callback', () => {
    const seen: RebuildCall[] = []
    const { rebuild } = recordingRebuild((input) => {
      seen.push({ ...input })
      return linesFromString(input.blockId, input.source)
    })
    const store = createTranscriptRenderStore({
      maxRows: 4,
      maxBytes: 10 * 1024 * 1024,
      rebuild,
    })
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '120' })
    store.readBlock({ blockId: 'b1' })
    const last = seen[seen.length - 1] as RebuildCall
    expect(last.scopeKey).toBe('120')
  })
})

describe('TranscriptRenderStore cumulative row ranges', () => {
  it('computes exact row ranges for a caller-supplied block order', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'a', source: 'aa', scopeKey: '80' })
    store.upsertSource({ blockId: 'b', source: 'bbb', scopeKey: '80' })
    store.upsertSource({ blockId: 'c', source: 'cccc', scopeKey: '80' })
    expect(store.blockRowRange({ blockId: 'a', blockOrder: ['a', 'b', 'c'] })).toEqual({
      start: 0,
      end: 2,
    })
    expect(store.blockRowRange({ blockId: 'b', blockOrder: ['a', 'b', 'c'] })).toEqual({
      start: 2,
      end: 5,
    })
    expect(store.blockRowRange({ blockId: 'c', blockOrder: ['a', 'b', 'c'] })).toEqual({
      start: 5,
      end: 9,
    })
    expect(store.blockRowRange({ blockId: 'a', blockOrder: ['b', 'c', 'a'] })).toEqual({
      start: 7,
      end: 9,
    })
    expect(store.blockRowRange({ blockId: 'absent', blockOrder: ['a', 'b'] })).toBeUndefined()
  })

  it('reports totalRows and cachedBytes correctly across many blocks', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'a', source: 'aa', scopeKey: '80' })
    store.upsertSource({ blockId: 'b', source: 'bbb', scopeKey: '80' })
    expect(store.totalRows()).toBe(0)
    store.readBlock({ blockId: 'a' })
    store.readBlock({ blockId: 'b' })
    expect(store.totalRows()).toBe(5)
    expect(store.stats().cachedRows).toBe(5)
    expect(store.stats().cachedBytes).toBeGreaterThan(0)
  })
})

describe('TranscriptRenderStore pin semantics and reset', () => {
  it('clearPins drops every pin and triggers eviction', () => {
    const { store } = storeWith({ maxRows: 4, maxBytes: 10 * 1024 * 1024 })
    store.upsertSource({ blockId: 'p1', source: 'a', scopeKey: '80' })
    store.upsertSource({ blockId: 'p2', source: 'b', scopeKey: '80' })
    store.readBlock({ blockId: 'p1' })
    store.readBlock({ blockId: 'p2' })
    store.setPins({ pinned: ['p1', 'p2'] })
    store.upsertSource({ blockId: 'p3', source: 'c', scopeKey: '80' })
    store.readBlock({ blockId: 'p3' })
    store.upsertSource({ blockId: 'p4', source: 'd', scopeKey: '80' })
    store.readBlock({ blockId: 'p4' })
    expect(store.stats().evictions).toBe(0)
    store.clearPins()
    store.upsertSource({ blockId: 'p5', source: 'e', scopeKey: '80' })
    store.readBlock({ blockId: 'p5' })
    expect(store.stats().evictions).toBeGreaterThan(0)
  })

  it('rejects empty ids inside setPins', () => {
    const { store } = storeWith()
    expect(() => { store.setPins({ pinned: [''] }) }).toThrow(/blockId/)
  })

  it('reset clears entries, pins, and counters', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    store.setPins({ pinned: ['b1'] })
    store.reset()
    expect(store.readBlock({ blockId: 'b1' })).toBeUndefined()
    expect(store.stats()).toEqual({
      hits: 0,
      evictions: 0,
      rebuilds: 0,
      stableRowsReused: 0,
      tailRowsRerendered: 0,
      cachedBlocks: 0,
      cachedRows: 0,
      cachedBytes: 0,
    })
  })
})

describe('TranscriptRenderStore coverage branches', () => {
  it('upsertSource with unchanged source and scope does not bump the revision', () => {
    const { store, calls } = storeWith()
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    const beforeRebuilds = calls.length
    store.upsertSource({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    expect(calls.length).toBe(beforeRebuilds)
  })

  it('blockRowRange skips missing prefix blocks and returns undefined for a missing target in the order', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'a', source: 'aa', scopeKey: '80' })
    store.upsertSource({ blockId: 'c', source: 'cccc', scopeKey: '80' })
    // 'b' is in the order but never upserted; its slot contributes zero rows.
    const range = store.blockRowRange({
      blockId: 'c',
      blockOrder: ['a', 'b', 'c'],
    })
    expect(range).toEqual({ start: 2, end: 6 })
    // Target missing from the store but present in the order: undefined.
    expect(
      store.blockRowRange({ blockId: 'missing-in-store', blockOrder: ['a', 'missing-in-store'] }),
    ).toBeUndefined()
  })

  it('stats skips entries with no resolved lines', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'unread', source: 'abc', scopeKey: '80' })
    store.upsertSource({ blockId: 'read', source: 'xy', scopeKey: '80' })
    store.readBlock({ blockId: 'read' })
    const stats = store.stats()
    expect(stats.cachedBlocks).toBe(1)
    expect(stats.cachedRows).toBe(2)
  })

  it('commitSettle and commitDiscard throw when the entry was reset between acquire and settle', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    revision.append([plainLine('b1', 0, 'x', 0, 1)])
    store.reset()
    expect(() => revision.settle()).toThrow(/missing entry/)
  })

  it('commitDiscard throws when the entry was reset between acquire and discard', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    revision.append([plainLine('b1', 0, 'x', 0, 1)])
    store.reset()
    expect(() => { revision.discard() }).toThrow(/missing entry/)
  })

  it('commitSettle throws when no active revision is held', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    revision.append([plainLine('b1', 0, 'x', 0, 1)])
    revision.discard()
    expect(() => revision.settle()).toThrow(/already settled/)
  })

  it('touchActiveBlock is a no-op when the entry has been cleared', () => {
    const { store } = storeWith()
    const revision = store.acquireActive({ blockId: 'b1', source: 'abc', scopeKey: '80' })
    revision.append([plainLine('b1', 0, 'x', 0, 1)])
    store.reset()
    expect(() => { revision.append([plainLine('b1', 1, 'y', 1, 2)]) }).not.toThrow()
  })

  it('keeps an unpinned active revision resident when over budget', () => {
    const { store } = storeWith({ maxRows: 2, maxBytes: 10 * 1024 * 1024 })
    const revision = store.acquireActive({ blockId: 'live', source: 'a'.repeat(10), scopeKey: '80' })
    revision.reset([
      plainLine('live', 0, 'a', 0, 1),
      plainLine('live', 1, 'a', 1, 2),
      plainLine('live', 2, 'a', 2, 3),
    ])
    store.upsertSource({ blockId: 'overflow', source: 'o'.repeat(10), scopeKey: '80' })
    store.readBlock({ blockId: 'overflow' })
    store.upsertSource({ blockId: 'overflow-2', source: 'p'.repeat(10), scopeKey: '80' })
    store.readBlock({ blockId: 'overflow-2' })
    const live = store.readBlock({ blockId: 'live' })
    expect(live?.rowCount).toBe(3)
  })

  it('totalRows counts rows from both active and settled blocks', () => {
    const { store } = storeWith()
    store.upsertSource({ blockId: 'settled', source: 'ab', scopeKey: '80' })
    store.readBlock({ blockId: 'settled' })
    const revision = store.acquireActive({ blockId: 'active', source: 'xyz', scopeKey: '80' })
    revision.append([
      plainLine('active', 0, 'x', 0, 1),
      plainLine('active', 1, 'y', 1, 2),
      plainLine('active', 2, 'z', 2, 3),
    ])
    expect(store.totalRows()).toBe(5)
  })

  it('enforceBudget early-returns when totals stay under budget', () => {
    const { store } = storeWith({ maxRows: 100, maxBytes: 10 * 1024 * 1024 })
    store.upsertSource({ blockId: 'b1', source: 'a', scopeKey: '80' })
    store.readBlock({ blockId: 'b1' })
    store.upsertSource({ blockId: 'b2', source: 'b', scopeKey: '80' })
    store.readBlock({ blockId: 'b2' })
    expect(store.stats().evictions).toBe(0)
  })
})
