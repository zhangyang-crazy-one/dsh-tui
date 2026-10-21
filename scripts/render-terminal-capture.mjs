/** Replay real PTY bytes with xterm's terminal parser and export its cells to PNG. */
import { createRequire } from 'node:module'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
async function workspaceDependency(name) {
  const store = resolve(root, 'node_modules/.pnpm')
  const prefix = `${name.replace('/', '+')}@`
  const directory = (await readdir(store)).find(entry => entry.startsWith(prefix))
  if (directory === undefined) throw new Error(`Development workspace dependency unavailable: ${name}`)
  return require(resolve(store, directory, 'node_modules', name))
}
const { Terminal } = await workspaceDependency('@xterm/headless')
const sharp = await workspaceDependency('sharp')
const [source, target, columnArg, rowArg] = process.argv.slice(2)
if (!source || !target) throw new Error('Usage: render-terminal-capture.mjs INPUT.ansi OUTPUT.png COLS ROWS')
const columns = Number(columnArg || 120)
const rows = Number(rowArg || 40)
const terminal = new Terminal({ cols: columns, rows, allowProposedApi: true, scrollback: 0 })
const capture = await readFile(source)
await new Promise(resolveWrite => terminal.write(capture, resolveWrite))
const colors = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']
function palette(index) {
  if (index < 16) return colors[index]
  if (index >= 232) { const n = 8 + (index - 232) * 10; return `rgb(${n},${n},${n})` }
  const cube = [0, 95, 135, 175, 215, 255]
  const n = index - 16
  return `rgb(${cube[Math.floor(n / 36)]},${cube[Math.floor(n / 6) % 6]},${cube[n % 6]})`
}
const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const backgrounds = []
const glyphs = []
const lines = []
for (let y = 0; y < rows; y += 1) {
  const line = terminal.buffer.active.getLine(y)
  lines.push(line?.translateToString(true) || '')
  for (let x = 0; x < columns; x += 1) {
    const cell = line?.getCell(x)
    if (!cell) continue
    let fg = '#d8dbe2'
    let bg = '#151618'
    if (cell.isFgRGB()) fg = `#${cell.getFgColor().toString(16).padStart(6, '0')}`
    else if (cell.isFgPalette()) fg = palette(cell.getFgColor())
    if (cell.isBgRGB()) bg = `#${cell.getBgColor().toString(16).padStart(6, '0')}`
    else if (cell.isBgPalette()) bg = palette(cell.getBgColor())
    if (cell.isInverse()) [fg, bg] = [bg, fg]
    backgrounds.push(`<rect x="${x * 10}" y="${y * 20}" width="10" height="20" fill="${bg}"/>`)
    if (cell.getChars() && cell.getWidth() > 0) {
      glyphs.push(`<text x="${x * 10}" y="${y * 20 + 16}" fill="${fg}"${cell.isBold() ? ' font-weight="bold"' : ''}>${escapeXml(cell.getChars())}</text>`)
    }
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * 10}" height="${rows * 20}"><g font-family="DejaVu Sans Mono,Noto Sans Mono CJK SC,monospace" font-size="16">${backgrounds.join('')}${glyphs.join('')}</g></svg>`
await sharp(Buffer.from(svg)).png().toFile(target)
await writeFile(target.replace(/\.png$/, '.txt'), `${lines.join('\n')}\n`)
terminal.dispose()
