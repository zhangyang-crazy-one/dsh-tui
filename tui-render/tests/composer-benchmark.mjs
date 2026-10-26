/** Run with: tsx --tsconfig tui-render/tsconfig.json tui-render/tests/composer-benchmark.mjs
 * Optional COMPOSER_SOURCE_ROOT selects an isolated baseline source directory.
 * Outputs distinct cold/warm SSR, operation counts and actual PTY acknowledgement latency.
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
const root = resolve(import.meta.dirname, '../..')
const source = process.env.COMPOSER_SOURCE_ROOT ?? resolve(root, 'tui-render/src')
const require = createRequire(resolve(root, 'tui-render/package.json'))
const React = await import(require.resolve('react'))
const { createElement } = React
// tsx can compile an isolated baseline outside the project with classic JSX.
globalThis.React = React
const { renderToString } = await import(require.resolve('ink'))
const { InputBar } = await import(pathToFileURL(resolve(source, 'input-bar.tsx')).href)
const { composerLineWindow, moveCaretByGrapheme } = await import(pathToFileURL(resolve(source, 'composer-cursor.ts')).href)
const store = resolve(root, 'node_modules/.pnpm')
const ptyPackage = readdirSync(store).find(name => name.startsWith('node-pty@'))
if (!ptyPackage) throw Error('node-pty dependency unavailable')
const pty = require(resolve(store, ptyPackage, 'node_modules/node-pty'))
const result = { node: process.version, source, ptyMetric: 'PTY input write to post-waitUntilRenderFlush acknowledgement; fixture settles pending throttle, maxFps 120; not physical terminal latency', geometry: [], hashes: {}, ssr: [], operations: [], pty: [] }
for (const name of ['input-bar.tsx', 'composer-cursor.ts', 'composer-index.ts']) {
  try { result.hashes[name] = createHash('sha256').update(readFileSync(resolve(source, name))).digest('hex') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function measurePty(units, columns, rows) {
  const terminal = pty.spawn(resolve(root, 'node_modules/.bin/tsx'), [
    '--tsconfig', resolve(root, 'tui-render/tsconfig.json'), resolve(import.meta.dirname, 'composer-pty-fixture.tsx'), String(units),
  ], { name: 'xterm-256color', cols: columns, rows, cwd: root,
    env: { ...process.env, COMPOSER_SOURCE_ROOT: source, COLORTERM: 'truecolor' } })
  let buffer = ''
  let waiting
  let ready
  const initial = new Promise((yes, no) => { ready = { yes, no } })
  const subscription = terminal.onData(data => {
    buffer += data
    const matches = [...buffer.matchAll(/\x1b\]777;composer;(\d+);(\d+);(\d+)\x07/gu)]
    if (!matches.length) return
    const last = matches.at(-1)
    buffer = buffer.slice(last.index + last[0].length)
    const ack = { sequence: Number(last[1]), length: Number(last[2]), caret: Number(last[3]) }
    if (ack.sequence === 0) ready.yes(ack)
    else if (waiting) { const pending = waiting; waiting = undefined; pending.yes({ ...ack, ms: performance.now() - pending.start }) }
  })
  const deadline = setTimeout(() => { ready.no(Error('PTY ready timeout')); waiting?.no(Error('PTY input timeout')) }, 30000)
  const samples = []
  try {
    await initial
    let expectedLength = units
    let expectedCaret = units
    const reference = '中文🙂abc'.repeat(units / 7)
    const boundaries = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(reference)].map(part => part.index)
    for (let i = 0; i < 10; i++) {
      const action = i < 5 ? 'left' : 'insert'
      if (action === 'left') expectedCaret = boundaries.filter(at => at < expectedCaret).at(-1)
      else { expectedLength += 1; expectedCaret += 1 }
      const ack = await new Promise((yes, no) => {
        waiting = { yes, no, start: performance.now() }
        terminal.write(action === 'left' ? '\x1b[D' : 'x')
      })
      if (ack.sequence !== i + 1 || ack.length !== expectedLength || ack.caret !== expectedCaret) {
        throw Error(`PTY lossless draft mismatch: ${JSON.stringify(ack)}`)
      }
      samples.push({ action, ...ack })
    }
    return { codeUnits: units, columns, rows, samples,
      moveMedianMs: median(samples.filter(s => s.action === 'left').map(s => s.ms)),
      insertMedianMs: median(samples.filter(s => s.action === 'insert').map(s => s.ms)) }
  } finally { clearTimeout(deadline); subscription.dispose(); terminal.kill() }
}

renderToString(createElement(InputBar, { text: 'warmup', commandMode: false, mentionMode: false }))
for (const [columns, rows] of [[80,24], [120,40]]) {
  result.geometry.push({ columns, rows })
  for (const units of [700,7000,70000]) {
    const text = '中文🙂abc'.repeat(units / 7)
    const samples = []
    for (let i = 0; i < 6; i++) {
      const started = performance.now()
      renderToString(createElement(InputBar, { text, caretIndex: text.length - i, commandMode: false, mentionMode: false }), { columns })
      samples.push(performance.now() - started)
    }
    result.ssr.push({ codeUnits: units, columns, rows: 24, note: 'Ink renderToString uses a 24-row mock regardless of PTY rows',
      coldMs: samples[0], warmSamplesMs: samples.slice(1), warmMedianMs: median(samples.slice(1)) })
    // Warm the index before counting. Source lengths are workload, not time.
    composerLineWindow(text, text.length, columns - 4)
    let calls = 0
    let sourceUnits = 0
    const segment = Intl.Segmenter.prototype.segment
    Intl.Segmenter.prototype.segment = function (source) {
      calls += 1; sourceUnits += source.length
      return segment.call(this, source)
    }
    try {
      let caret = text.length
      for (let step = 0; step < 40; step++) {
        caret = moveCaretByGrapheme(text, caret, -1)
        composerLineWindow(text, caret, columns - 4)
      }
    } finally { Intl.Segmenter.prototype.segment = segment }
    result.operations.push({ codeUnits: units, columns, movements: 40, segmentCalls: calls, segmentedSourceUnits: sourceUnits })
    result.pty.push(await measurePty(units, columns, rows))
  }
}
const output = process.argv[2] ?? '/tmp/dsh-composer-benchmark.json'
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ output, ssr: result.ssr.map(({codeUnits, columns, coldMs, warmMedianMs}) => ({codeUnits,columns,coldMs,warmMedianMs})),
  operations: result.operations, pty: result.pty.map(({codeUnits,columns,rows,moveMedianMs,insertMedianMs}) => ({codeUnits,columns,rows,moveMedianMs,insertMedianMs})) }, null, 2))
