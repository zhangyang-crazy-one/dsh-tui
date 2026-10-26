/** Real production mount/output/input components; canonical fixture rows are independent of emitted bytes. */
import { writeFileSync, appendFileSync } from 'node:fs'
import { Writable } from 'node:stream'
import { createElement, useLayoutEffect, useState } from 'react'
import { Box, Text, useInput, useStdout, useWindowSize } from 'ink'
import { mountTuiRender } from '../../src/index.ts'
import { InputBar } from '../../src/input-bar.tsx'
import { paintBackgroundRow, styled } from '../../src/theme.ts'
import { createPhysicalLine } from '../../src/physical-line.ts'
import { createFrameSnapshotRow, setVisibleFrameSnapshot } from '../../src/frame-snapshot.ts'
import { setFrameRail, writePublishedFrameSnapshot } from '../../src/frame-fill.ts'
import { terminalOutputSnapshot, writeTerminalControl } from '../../src/terminal-output.ts'

const [output] = process.argv.slice(2)
if (!output) throw new Error('Pass an output prefix')
let offset = 0
let nativeWrites = 0
const nativeWrite = process.stdout.write.bind(process.stdout)
const sink = new Writable({ highWaterMark: 1024, write(chunk: Buffer, _encoding, done) {
  offset += chunk.length
  if (chunk.includes(Buffer.from('\x1b[?2026l'))) appendFileSync(`${output}.frames.jsonl`, JSON.stringify({ offset, columns: process.stdout.columns, rows: process.stdout.rows, expectedTick: latest }) + '\n')
  nativeWrite(chunk, error => {
    if (error) { done(error); return }
    // Brief deterministic stalls exercise the actual write(false)/drain path.
    if (++nativeWrites % 71 === 0) setTimeout(done, 80)
    else done()
  })
} }) as NodeJS.WriteStream
Object.defineProperties(sink, {
  isTTY: { value: true }, columns: { get: () => process.stdout.columns }, rows: { get: () => process.stdout.rows },
})
process.stdout.on('resize', () => sink.emit('resize'))
let latest = 0
let interval: ReturnType<typeof setInterval> | undefined
let maximumPending = 0
const intervals: ReturnType<typeof setInterval>[] = []

function Scene() {
  useInput(() => {})
  const [tick, setTick] = useState(0)
  const { columns, rows } = useWindowSize()
  const { stdout } = useStdout()
  const bodyRows = Math.max(1, rows - 4)
  latest = tick
  setFrameRail(undefined)
  const lines = Array.from({ length: bodyRows }, (_, index) => {
    const text = `TURN_${Math.floor(tick / 25)} TICK_${tick} ROW_${index}`
    return createFrameSnapshotRow({ id: `row-${index}`, row: index + 2, col: 3,
      line: createPhysicalLine({ blockId: `row-${index}`, spans: [{ text, token: 'fg' }], sourceStart: 0, sourceEnd: text.length, blockRow: 0 }) })
  })
  setVisibleFrameSnapshot({ revision: `${columns}:${rows}:${tick}`, repaintKey: `${columns}:${rows}`,
    geometry: { columns, rows, transcriptTop: 2, transcriptLeft: 3, transcriptWidth: columns - 4, transcriptRows: bodyRows }, rows: lines })
  useLayoutEffect(() => { writePublishedFrameSnapshot(stdout) })
  useLayoutEffect(() => {
    interval = setInterval(() => setTick(value => value + 1), 100)
    return () => { clearInterval(interval) }
  }, [])
  return createElement(Box, { height: rows, width: columns, flexDirection: 'column' },
    createElement(Text, null, paintBackgroundRow([styled('SOAK_GENERATING', 'fg')], 'bg', columns)),
    createElement(Box, { height: bodyRows, flexShrink: 0 }, createElement(Text, null, '\n'.repeat(bodyRows - 1))),
    createElement(InputBar, { text: 'DRAFT', caretIndex: 5, rowsBelow: 1, actionHint: 'SOAK_INPUT', commandMode: false, mentionMode: false }),
    createElement(Text, null, paintBackgroundRow([styled('SOAK_STATUS active', 'fg')], 'bg', columns)))
}

writeFileSync(`${output}.frames.jsonl`, '')
const dispose = mountTuiRender(createElement(Scene), { stdout: sink, env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
intervals.push(setInterval(() => writeTerminalControl(sink, '\x1b]9;soak tick\x07', 'notify'), 700))
intervals.push(setInterval(() => { maximumPending = Math.max(maximumPending, terminalOutputSnapshot(sink)?.pendingBytes ?? 0) }, 25))
writeFileSync(`${output}.ready`, 'ready')
process.once('SIGTERM', () => {
  for (const timer of intervals) clearInterval(timer)
  if (interval) clearInterval(interval)
  writeFileSync(`${output}.state.json`, JSON.stringify({ latest, maximumPending, output: terminalOutputSnapshot(sink) }))
  dispose()
  setTimeout(() => process.exit(0), 300)
})
