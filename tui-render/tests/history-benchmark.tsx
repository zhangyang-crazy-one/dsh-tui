/** Standalone synthetic benchmark; runs current TSX directly, without building or touching upstream. */
import { PassThrough } from 'node:stream'
import { createElement } from 'react'
import { render, Text } from 'ink'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeHeapSnapshot } from 'node:v8'
import { pathToFileURL } from 'node:url'
import type { ViewModel } from '../src/projection.ts'
import type { HistoryWorkStats } from '../src/history-data.ts'
import { AppShell } from '../src/app-shell.tsx'
import { projectBlockRows, computeBlockRowsScopeKey, createMarkdownProjectorState, type BlockRowsScope } from '../src/block-rows.ts'

const sourceRoot = process.env.DSH_HISTORY_SOURCE_ROOT
const { StreamView } = await import(sourceRoot === undefined ? '../src/stream-view.tsx'
  : pathToFileURL(resolve(sourceRoot, 'stream-view.tsx')).href)
const { wrapStdoutForFrameBg } = await import(sourceRoot === undefined ? '../src/frame-fill.ts'
  : pathToFileURL(resolve(sourceRoot, 'frame-fill.ts')).href)
const { visibleFrameSnapshot } = await import(sourceRoot === undefined ? '../src/frame-snapshot.ts'
  : pathToFileURL(resolve(sourceRoot, 'frame-snapshot.ts')).href)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const view = (history: ViewModel['history'], text = 'seed'): ViewModel => ({ history, status: 'generating',
  activeTurn: { turn: 99999, assistantText: text, reasoningText: '', reasoningDurationMs: 0, toolCalls: [] },
  reasoningExpanded: false, toolCardsExpanded: false })
const fixture = (count: number): ViewModel['history'] => Array.from({ length: count }, (_, i) => ({
  id: i + 1, kind: 'assistant', text: `HISTORY_${i} 中文 👩‍💻 **bold**\n\nsecond paragraph`, timestamp: i,
}))

// Keep transient initial React elements off the suspended benchmark coroutine's stack.
function startRenderer(factory: () => ReturnType<typeof createElement>, stdout: NodeJS.WriteStream, stdin: NodeJS.ReadStream) {
  return render(factory(), { stdout: wrapStdoutForFrameBg(stdout), stdin,
    exitOnCtrlC: false, patchConsole: false, interactive: true })
}

async function mounted(count: number, heapDir?: string) {
  let history = fixture(count)
  const oldest = new WeakRef(history[0]!)
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream
  stdout.isTTY = true; stdout.columns = 80; stdout.rows = 24; stdout.resume()
  let diagnostics = ''
  stdout.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-20_000) })
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream
  stdin.isTTY = true; stdin.isRaw = false; stdin.setRawMode = () => stdin; stdin.ref = () => stdin; stdin.unref = () => stdin
  let latest: HistoryWorkStats | undefined
  let first: { ms: number; indexedEntries: number; pendingEntries: number } | undefined
  const started = performance.now()
  const element = (text = 'seed') => createElement(AppShell, { title: 'BENCH', badge: '',
    input: createElement(Text, null, '> INPUT'), status: createElement(Text, null, 'STATUS'),
    children: createElement(StreamView, { model: view(history, text), onHistoryWork: (stats: HistoryWorkStats) => {
      latest = stats
      if (first === undefined && stats.firstInteractive) first = { ms: performance.now() - started,
        indexedEntries: stats.indexedEntries, pendingEntries: stats.pendingEntries }
    } }),
  })
  const instance = startRenderer(element, stdout, stdin)
  let initialStats: HistoryWorkStats | undefined
  try {
    await instance.waitUntilRenderFlush()
    if (process.env.DSH_HISTORY_DEBUG) process.stderr.write(JSON.stringify({latest, diagnostics}) + '\n')
    if (sourceRoot === undefined) {
      while (latest === undefined || latest.pendingEntries !== 0) {
        if (performance.now() - started > 30_000) throw new Error(`History indexing did not finish: ${diagnostics}`)
        await sleep(1)
      }
      await instance.waitUntilRenderFlush()
    }
    const indexedMs = performance.now() - started
    if (sourceRoot !== undefined) first = { ms: indexedMs, indexedEntries: count, pendingEntries: 0 }
    initialStats = latest
    const counts = { descriptorIteratorVisits: 0, descriptorValueVisits: 0, jsonCalls: 0 }
    const iterator = Map.prototype[Symbol.iterator]
    const values = Map.prototype.values
    const stringify = JSON.stringify
    const isDescriptor = (value: unknown) => value !== null && typeof value === 'object'
      && 'ownerId' in value && 'entry' in value && 'scope' in value
    Map.prototype[Symbol.iterator] = function* () {
      for (const pair of iterator.call(this)) {
        if (isDescriptor(pair[1])) counts.descriptorIteratorVisits++
        yield pair
      }
      return undefined
    }
    Map.prototype.values = function* () {
      for (const value of values.call(this)) {
        if (isDescriptor(value)) counts.descriptorValueVisits++
        yield value
      }
      return undefined
    }
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => { counts.jsonCalls++; return stringify(...args) }) as typeof JSON.stringify
    const deltaTimes = []
    try {
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        instance.rerender(element(`seed ${i}`))
        await instance.waitUntilRenderFlush()
        await sleep(20)
        await instance.waitUntilRenderFlush()
        deltaTimes.push(performance.now() - start)
      }
    } finally {
      Map.prototype[Symbol.iterator] = iterator
      Map.prototype.values = values
      JSON.stringify = stringify
    }
    if (!visibleFrameSnapshot()?.rows.some((row: { line: { text: string } }) => row.line.text.includes('seed 4'))) {
      throw new Error('Newest canonical presentation did not paint')
    }
    const result: Record<string, unknown> = { count, firstInteractive: first, indexedMs, initial: initialStats,
      delta: { samples: deltaTimes, externalCounters: counts,
        settledSignatures: latest === undefined ? undefined : latest.settledSignatures - initialStats!.settledSignatures,
        descriptorVisits: latest === undefined ? undefined : latest.descriptorVisits - initialStats!.descriptorVisits,
        projectedRequests: latest === undefined ? undefined : latest.projectedActiveRequests - initialStats!.projectedActiveRequests } }
    if (heapDir !== undefined) {
      if (global.gc === undefined) throw new Error('Heap inspection requires node --expose-gc')
      mkdirSync(heapDir, { recursive: true })
      global.gc()
      const populated = writeHeapSnapshot(resolve(heapDir, 'history-populated.heapsnapshot'))
      result.heapBefore = { used: process.memoryUsage().heapUsed, file: populated, stats: latest }
      for (let cycle = 0; cycle < 5; cycle++) {
        history = fixture(1).map(entry => ({ ...entry, text: `REPLACEMENT_${cycle}` }))
        stdout.columns = cycle % 2 ? 80 : 120
        stdout.emit('resize')
        instance.rerender(element('current'))
        await instance.waitUntilRenderFlush()
        await sleep(20)
      }
      await sleep(0)
      global.gc(); await sleep(0); global.gc()
      const retired = writeHeapSnapshot(resolve(heapDir, 'history-retired.heapsnapshot'))
      result.heapAfter = { used: process.memoryUsage().heapUsed, file: retired, stats: latest,
        oldCanonicalOwnerCollected: oldest.deref() === undefined }
    }
    return result
  } finally {
    const exited = instance.waitUntilExit()
    instance.unmount()
    await exited
  }
}

/** Same-width exact-layout-cache candidate: cold construction vs warm reuse of identical immutable rows. */
function layoutCacheCandidate(count: number) {
  const history = fixture(count)
  const scope: BlockRowsScope = { width: 74, theme: 'none', fold: { reasoning: false, tools: false }, renderMode: 'settled',
    scopeKey: computeBlockRowsScopeKey(74, 'none', { reasoning: false, tools: false }, 'settled') }
  const cache = new Map<number, { source: string; height: number }>()
  let projected = 0
  let retainedRows = 0
  const started = performance.now()
  for (const message of history) {
    const height = projectBlockRows({ id: `message-${message.id}`, kind: 'assistant-prose', source: message.text }, scope, createMarkdownProjectorState(`message-${message.id}`, scope)).lines.length
    projected++; retainedRows += height
    cache.set(message.id, { source: message.text, height })
  }
  const coldMs = performance.now() - started
  const warmStart = performance.now()
  let warmLookups = 0
  for (const message of history) {
    const cached = cache.get(message.id)
    warmLookups++
    if (cached?.source !== message.text) throw new Error('Invalid width-cache candidate')
  }
  return { count, cold: { projections: projected, ms: coldMs }, warm: { lookups: warmLookups, projections: 0,
    ms: performance.now() - warmStart }, retainedHeightMetadata: cache.size, representedRows: retainedRows,
    note: 'Pure projector prototype; warm timing is not a mounted interactive-frame measurement.' }
}

const counts = (process.env.DSH_HISTORY_COUNTS ?? '100,1000,10000').split(',').map(Number)
const repeat = Number(process.env.DSH_HISTORY_REPEAT ?? 3)
const report: Record<string, unknown> = { node: process.version, sourceRoot: sourceRoot ?? 'current',
  geometry: [80, 24], repeat, samples: [], cacheCandidate: [] }
for (const count of counts) {
  for (let sample = 0; sample < repeat; sample++) {
    (report.samples as unknown[]).push(await mounted(count, process.env.DSH_HISTORY_HEAP_DIR))
  }
  ;(report.cacheCandidate as unknown[]).push(layoutCacheCandidate(count))
}
const output = JSON.stringify(report, null, 2)
if (process.env.DSH_HISTORY_REPORT) writeFileSync(process.env.DSH_HISTORY_REPORT, output + '\n')
process.stdout.write(output + '\n')
