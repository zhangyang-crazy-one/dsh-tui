/** Replay every completed synchronized PTY frame, including transient states. */
import { createRequire } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const store = resolve(root, 'node_modules/.pnpm')
const entry = (await readdir(store)).find(name => name.startsWith('@xterm+headless@'))
const { Terminal } = require(resolve(store, entry, 'node_modules/@xterm/headless'))
const [source, prefix, columnArg = '120', rowArg = '40', expectedPath] = process.argv.slice(2)
let columns = Number(columnArg), rows = Number(rowArg)
const terminal = new Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 })
const capture = await readFile(source)
const end = Buffer.from('\x1b[?2026l')
let offset = 0, frames = 0, bad = 0, firstBadSaved = false
const examples = []
const expectedWrites = expectedPath ? JSON.parse(await readFile(expectedPath, 'utf8')).events.filter(event => event.kind === 'write' && event.sync) : []
let mismatchedFrames = 0
let suppressedGeometryFrames = 0
let snapshotComparedFrames = 0
let comparedRows = 0
const mismatchExamples = []
while (offset < capture.length) {
  const next = capture.indexOf(end, offset)
  if (next < 0) break
  const stop = next + end.length
  const expectedWrite = expectedWrites[frames]
  if (expectedWrite?.columns && expectedWrite?.rows && (expectedWrite.columns !== columns || expectedWrite.rows !== rows)) {
    columns = expectedWrite.columns
    rows = expectedWrite.rows
    terminal.resize(columns, rows)
  }
  await new Promise(done => terminal.write(capture.subarray(offset, stop), done))
  offset = stop
  frames++
  const lines = Array.from({ length: rows }, (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '')
  const composer = lines.findIndex(line => line.includes('输入消息'))
  const staleGeometry = expectedWrite?.geometry && (expectedWrite.geometry.columns !== columns || expectedWrite.geometry.rows !== rows)
  if (staleGeometry) suppressedGeometryFrames++
  // Ink's resize erase can finish before React has measured the replacement
  // slot. No old-size transcript may be painted in that transitional frame.
  const expected = staleGeometry ? [] : expectedWrite?.expected ?? []
  if (expected.length) { snapshotComparedFrames++; comparedRows += expected.length }
  // Include trailing cells: a blank/short row also owns the rest of its slot.
  const mismatches = expected.filter(row => terminal.buffer.active.getLine(row.row-1)?.translateToString(false, row.col-1,
    row.col-1+Math.max(row.width, expectedWrite.geometry?.transcriptWidth ?? row.width)).trimEnd() !== row.text.trimEnd())
  if (mismatches.length) {
    mismatchedFrames++
    if (mismatchExamples.length < 5) mismatchExamples.push({ frame: frames, rows: mismatches.slice(0, 3).map(row => ({ ...row, actual: lines[row.row-1] })) })
    if (mismatchedFrames === 1) await writeFile(`${prefix}.first-mismatch.ansi`, capture.subarray(0, stop))
  }
  const transcriptEnd = !staleGeometry && expectedWrite?.geometry
    ? expectedWrite.geometry.transcriptTop + expectedWrite.geometry.transcriptRows - 1
    : rows - 5
  const leaks = lines.map((line, row) => ({ row: row+1, line })).filter(item => item.row > transcriptEnd && /Row \d|Second line|流式新增|LIVE_|HISTORY_|正确做法|逐面给出|映射表|12 个目标点/u.test(item.line))
  if (leaks.length) {
    bad++
    if (examples.length < 8) examples.push({ frame: frames, composerRow: composer+1, leaks })
    if (!firstBadSaved) {
      firstBadSaved = true
      await writeFile(`${prefix}.first-bad.ansi`, capture.subarray(0, stop))
      await writeFile(`${prefix}.first-bad.txt`, lines.join('\n')+'\n')
    }
  }
}
await writeFile(`${prefix}.json`, JSON.stringify({ source, columns, rows, frames, snapshotComparedFrames, comparedRows, suppressedGeometryFrames, badFrames: bad, examples, mismatchedFrames, mismatchExamples }, null, 2)+'\n')
console.log(JSON.stringify({ source, frames, snapshotComparedFrames, suppressedGeometryFrames, badFrames: bad, mismatchedFrames, firstExample: examples[0], firstMismatch: mismatchExamples[0] }))
terminal.dispose()
