import { createRequire } from 'node:module'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { setFrameCaret, wrapStdoutForFrameBg } from '../src/frame-fill.ts'
import { setVisibleFrameSnapshot } from '../src/frame-snapshot.ts'

// Use the terminal dependency's independent VT implementation, not our atlas.
let workspace = dirname(fileURLToPath(import.meta.url))
while (!existsSync(resolve(workspace, 'node_modules/.pnpm'))) {
  const parent = dirname(workspace)
  if (parent === workspace) throw new Error('Missing installed DSH test dependencies')
  workspace = parent
}
const terminalRequire = createRequire(resolve(dirname(realpathSync(resolve(workspace, 'node_modules'))), 'packages/terminal/terminal-bash/package.json'))
const { Terminal } = terminalRequire('@xterm/headless') as { Terminal: new (options: { cols: number; rows: number; allowProposedApi: boolean }) => {
  write(chunk: string | Uint8Array, done: () => void): void
  buffer: { active: { cursorX: number; cursorY: number; getLine(row: number): { translateToString(trim: boolean): string; getCell(col: number): { getBgColor(): number } } } }
  dispose(): void
} }

async function replay(chunks: readonly (string | Buffer)[], wrapped: boolean) {
  const writes: Buffer[] = []
  const sink = new Writable({ write(chunk, _encoding, done) { writes.push(Buffer.from(chunk)); done() } }) as NodeJS.WriteStream
  Object.assign(sink, { isTTY: true, columns: 80, rows: 24 })
  const stream = wrapped ? wrapStdoutForFrameBg(sink, () => 'truecolor') : sink
  for (const chunk of chunks) stream.write(chunk)
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
  try {
    for (const chunk of writes) await new Promise<void>(done => term.write(chunk, done))
    const line = term.buffer.active.getLine(0)
    return { text: line.translateToString(true).trimEnd(), background: line.getCell(0).getBgColor(), cursor: [term.buffer.active.cursorX, term.buffer.active.cursorY] }
  } finally { term.dispose() }
}

afterEach(() => { setFrameCaret(undefined); setVisibleFrameSnapshot(undefined) })

describe('terminal output chunk boundaries', () => {
  const color = '\x1b[48;2;21;22;24m'
  it('keeps the three-way regression: whole wrapped, split direct, split wrapped', async () => {
    const split = color.indexOf('1;22')
    const whole = await replay([color + 'OK'], true)
    expect(whole.text).toBe('OK')
    expect(await replay([color.slice(0, split), color.slice(split) + 'OK'], false)).toEqual(whole)
    expect(await replay([color.slice(0, split), color.slice(split) + 'OK'], true)).toEqual(whole)
  })

  it('preserves every CSI/OSC boundary and background across separate writes', async () => {
    const text = '\x1b[48;2;91;92;93m\x1b]8;;https://example.com\x1b\\OK\x1b]8;;\x07'
    const whole = await replay([text], true)
    for (let index = 1; index < text.length; index++) {
      expect(await replay([text.slice(0, index), text.slice(index)], true), `split ${index}`).toEqual(whole)
    }
  })

  it('preserves UTF-8 split buffers followed by string content', async () => {
    const text = Buffer.from(color + '中🙂')
    const whole = await replay([text.toString('utf8') + 'OK'], true)
    for (let index = 1; index < text.length; index++) {
      expect(await replay([text.subarray(0, index), text.subarray(index), 'OK'], true), `byte ${index}`).toEqual(whole)
    }
  })
})
