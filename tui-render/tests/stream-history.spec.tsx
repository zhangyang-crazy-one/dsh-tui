import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, Text } from 'ink'
import { StreamView } from '../src/stream-view.tsx'
import { AppShell } from '../src/app-shell.tsx'
import { visibleFrameSnapshot } from '../src/frame-snapshot.ts'
import type { ViewModel } from '../src/projection.ts'
import { createTestProjector, type ProjectorInput } from './projector-fixture.ts'
import type { HistoryWorkStats } from '../src/history-data.ts'
import type { TranscriptViewportCommand } from '../src/transcript-viewport.ts'
import { disposeRenderer, fakeTtyStdin, fakeTtyStdout, frameTtyStdout } from './helpers.ts'
import * as blockRows from '../src/block-rows.ts'

const historyRows = (count: number): ViewModel['history'] => Array.from({ length: count }, (_, i) => ({
  id: i + 1, kind: 'user', text: `HISTORY_${i}`, timestamp: i,
}))
const model = (history: ViewModel['history'], text?: string): ViewModel => ({
  history, status: text === undefined ? 'idle' : 'generating', reasoningExpanded: false, toolCardsExpanded: false,
  activeTurn: text === undefined ? undefined : {
    turn: 1, assistantText: text, reasoningText: '', reasoningDurationMs: 0, toolCalls: [],
  },
})

/** Counts plus exact shared physical rows, recorded after the renderer's paint effect. */
function harness(initial: ViewModel, columns = 80, rows = 24) {
  const stdout = fakeTtyStdout()
  stdout.isTTY = true
  stdout.columns = columns
  stdout.rows = rows
  stdout.resume()
  const samples: { stats: HistoryWorkStats; lines: string[] }[] = []
  const onHistoryWork = (stats: HistoryWorkStats) => samples.push({ stats,
    lines: visibleFrameSnapshot()?.rows.map(row => row.line.text) ?? [],
  })
  const commandRef: { current: ((command: TranscriptViewportCommand) => void) | undefined } = { current: undefined }
  const element = (view: ViewModel) => createElement(AppShell, { title: 'HISTORY', badge: '',
    status: createElement(Text, null, 'STATUS'), input: createElement(Text, null, '> INPUT'),
    children: createElement(StreamView, { model: view, onHistoryWork, viewportCommandRef: commandRef }),
  })
  const instance = render(element(initial), { stdout: frameTtyStdout(stdout), stdin: fakeTtyStdin(),
    exitOnCtrlC: false, patchConsole: false, interactive: true })
  return { instance, samples, stdout, commandRef,
    latest: () => samples.at(-1)!,
    rerender: (view: ViewModel) => instance.rerender(element(view)),
    async ready() {
      await instance.waitUntilRenderFlush()
      await vi.waitFor(() => expect(samples.at(-1)?.stats.pendingEntries).toBe(0), { timeout: 15_000, interval: 5 })
      await instance.waitUntilRenderFlush()
    },
  }
}

describe('incremental history in the mounted renderer', () => {
  it.each([100, 1_000, 10_000])('publishes an exact interactive tail before indexing %i offscreen entries and keeps delta work bounded', async (count) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const history = historyRows(count)
    const h = harness(model(history, 'seed'))
    try {
      await h.ready()
      const first = h.samples.find(sample => sample.stats.firstInteractive)!
      expect(first.stats.indexedEntries).toBeLessThan(count)
      expect(first.lines.join('\n')).toContain('● seed')
      expect(first.lines.join('\n')).toContain(`HISTORY_${count - 1}`)
      expect(h.latest().lines).toEqual(first.lines)
      const before = h.latest().stats
      const project = vi.spyOn(blockRows, 'projectBlockRows')
      try {
        for (let i = 0; i < 8; i++) {
          h.rerender(model(history, `seed ${i}`))
          await h.instance.waitUntilRenderFlush()
        }
        // All eight requests reached React, but none reached the projector before the frame clock.
        expect(project).not.toHaveBeenCalled()
        expect(h.latest().stats.pendingPresentations).toBe(1)
        await vi.advanceTimersByTimeAsync(16)
        await h.instance.waitUntilRenderFlush()
        const after = h.latest().stats
        expect(after.projectedActiveRequests - before.projectedActiveRequests).toBe(1)
        expect(after.descriptorVisits - before.descriptorVisits).toBe(1)
        expect(after.settledSignatures - before.settledSignatures).toBe(0)
        expect(after.settledMapCopies).toBe(0)
        expect(project.mock.calls.every(([entry]) => entry.kind === 'assistant-prose')).toBe(true)
        expect(h.latest().lines.join('\n')).toContain('● seed 7')
      } finally { project.mockRestore() }
    } finally {
      await disposeRenderer(h.instance)
      vi.useRealTimers()
    }
  })

  it.each([[80, 24], [120, 40]])('keeps a detached physical anchor while the exact prefix grows at %ix%i', async (columns, rows) => {
    const h = harness(model(historyRows(1_000)), columns, rows)
    try {
      await h.instance.waitUntilRenderFlush()
      h.commandRef.current?.({ sequence: 1, kind: 'scroll', delta: 3, source: 'wheel' })
      await vi.waitFor(() => expect(h.latest().lines.join('\n')).toContain('↓ 底部'))
      const before = h.latest().lines
      await h.ready()
      expect(h.latest().lines).toEqual(before)
      h.commandRef.current?.({ sequence: 2, kind: 'edge', edge: 'oldest' })
      await vi.waitFor(() => expect(h.latest().lines.join('\n')).toContain('HISTORY_0'))
      expect(h.latest().lines.join('\n')).not.toContain('HISTORY_999')
    } finally { await disposeRenderer(h.instance) }
  })

  it('resolves an unindexed oldest edge accurately before consuming its command', async () => {
    const h = harness(model(historyRows(10_000)))
    try {
      await h.instance.waitUntilRenderFlush()
      expect(h.latest().stats.pendingEntries).toBeGreaterThan(0)
      h.commandRef.current?.({ sequence: 1, kind: 'edge', edge: 'oldest' })
      await h.ready()
      expect(h.latest().lines.join('\n')).toContain('HISTORY_0')
    } finally { await disposeRenderer(h.instance) }
  })

  it('preserves every canonical delta in a coalesced burst and settles identically to full projection', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const projector = createTestProjector()
    const event = (type: string, data: unknown): ProjectorInput => ({ seq: 1, time: 1, type, data }) as ProjectorInput
    projector.push(event('turn/start', { turn: 1 }))
    projector.push(event('test/stream-chunk', { chunk: { type: 'block-start', index: 0, blockType: 'text' } }))
    const h = harness(projector.snapshot())
    const deltas = ['中文 ', '**bold**', ' 👩‍💻', '\n\n', 'final']
    try {
      await h.ready()
      for (const [index, text] of deltas.entries()) {
        projector.push(event('test/stream-chunk', { chunk: { type: 'text-delta', index: 0, text } }))
        expect(projector.snapshot().activeTurn?.assistantText).toBe(deltas.slice(0, index + 1).join(''))
        h.rerender(projector.snapshot())
        await h.instance.waitUntilRenderFlush()
      }
      const text = deltas.join('')
      projector.push(event('assistant/message', { turn: 1, step: 1, message: {
        role: 'assistant', content: [{ type: 'text', text }],
      } }))
      projector.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }))
      expect(projector.snapshot().history.at(-1)?.text).toBe(text)
      h.rerender(projector.snapshot())
      await h.ready()
      const actual = h.latest().lines
      // Independent synchronous oracle: no StreamView window, presentation queue or history cache.
      const scope = { width: 72, theme: 'none' as const, fold: { reasoning: false, tools: false },
        renderMode: 'settled' as const, scopeKey: blockRows.computeBlockRowsScopeKey(72, 'none', { reasoning: false, tools: false }, 'settled') }
      const entry = { id: 'full-reference', kind: 'assistant-prose' as const, source: text }
      const full = blockRows.projectBlockRows(entry, scope, blockRows.createMarkdownProjectorState(entry.id, scope))
      const expected = full.lines.map(line => line.text.trim()).filter(Boolean)
      const body = actual.filter(line => /^(● | {2})/u.test(line))
        .map(line => line.replace(/^(● | {2})/u, '').trim()).filter(Boolean)
      expect(body).toEqual(expected)
      const reference = harness(projector.snapshot())
      try {
        await reference.ready()
        expect(actual).toEqual(reference.latest().lines)
        expect(actual.join('\n')).toContain('中文 bold 👩‍💻')
        expect(actual.join('\n')).toContain('final')
        await vi.advanceTimersByTimeAsync(64)
        await h.instance.waitUntilRenderFlush()
        expect(h.latest().lines).toEqual(actual)
      } finally { await disposeRenderer(reference.instance) }
    } finally {
      await disposeRenderer(h.instance)
      vi.useRealTimers()
    }
  })

  it('invalidates queued source/width work and releases retired owner and scope indexes through repeated replacements', async () => {
    const h = harness(model(historyRows(1_000)))
    try {
      await h.instance.waitUntilRenderFlush()
      for (let cycle = 0; cycle < 4; cycle++) {
        h.stdout.columns = cycle % 2 === 0 ? 120 : 80
        h.stdout.emit('resize')
        const history: ViewModel['history'] = [{ id: 1, kind: 'assistant', timestamp: 0,
          text: `CURRENT_${cycle}\n\n**中文 👩‍💻**`, reasoningText: 'PRIVATE', reasoningDurationMs: 0 }]
        h.rerender(model(history))
        await h.ready()
        const stats = h.latest().stats
        expect(stats.canonicalEntries).toBe(1)
        expect(stats.projectionOwners).toBe(1)
        expect(stats.rebuildDescriptors).toBeLessThanOrEqual(2)
        expect(stats.lineEntries).toBe(stats.rebuildDescriptors)
        expect(stats.revisionOwners).toBe(0)
        expect(stats.signatures).toBe(stats.projectionOwners)
        expect(stats.projectorStates).toBe(1)
        expect(h.latest().lines.join('\n')).toContain(`CURRENT_${cycle}`)
        expect(h.latest().lines.join('\n')).not.toContain('HISTORY_')
        await new Promise(resolve => setTimeout(resolve, 5))
        expect(h.latest().stats.canonicalEntries).toBe(1)
      }
    } finally { await disposeRenderer(h.instance) }
  })
})
