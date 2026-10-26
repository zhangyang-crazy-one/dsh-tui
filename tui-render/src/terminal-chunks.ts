import { StringDecoder } from 'node:string_decoder'

/** Larger controls are streamed undecorated until their terminator; never accumulated. */
export const MAX_PENDING_TERMINAL_BYTES = 64 * 1024
type State = 'text' | 'escape' | 'intermediate' | 'csi' | 'osc' | 'string' | 'osc-escape' | 'string-escape'
export interface TerminalChunk { text: string; decorate: boolean }

function advance(state: State, char: string): State {
  if (char === '\x18' || char === '\x1a') return 'text'
  if (state === 'osc' || state === 'string') {
    if (char === '\x1b') return state === 'osc' ? 'osc-escape' : 'string-escape'
    return char === '\x9c' || (state === 'osc' && char === '\x07') ? 'text' : state
  }
  if (state === 'osc-escape' || state === 'string-escape') {
    if (char === '\\') return 'text'
    return advance('escape', char)
  }
  if (char === '\x1b') return 'escape'
  if (state === 'text') {
    if (char === '\x9b') return 'csi'
    if (char === '\x9d') return 'osc'
    if ('\x90\x98\x9e\x9f'.includes(char)) return 'string'
    return 'text'
  }
  if (state === 'escape') {
    if (char === '[') return 'csi'
    if (char === ']') return 'osc'
    if ('PX^_'.includes(char)) return 'string'
    if (char >= ' ' && char <= '/') return 'intermediate'
    return char >= '0' && char <= '~' ? 'text' : 'escape'
  }
  if (state === 'csi') return char >= '@' && char <= '~' ? 'text' : 'csi'
  return char >= '0' && char <= '~' ? 'text' : 'intermediate'
}

/** One parser per mounted stream. Completed prefixes are safe decoration boundaries. */
export class TerminalChunks {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  private surrogate = ''
  private overflow: State = 'text'
  private decoderPending = 0

  get pendingBytes(): number { return Buffer.byteLength(this.pending + this.surrogate) }
  get incomplete(): boolean { return this.pending !== '' || this.surrogate !== '' || this.overflow !== 'text' || this.decoderPending > 0 }

  push(chunk: string | Uint8Array): TerminalChunk[] {
    // Strings do not complete a partial UTF-8 byte sequence. A pending decoder
    // suffix is flushed before text, matching Node's separate write encodings.
    let text = typeof chunk === 'string' ? this.decoder.end() + chunk : this.decoder.write(Buffer.from(chunk))
    this.decoderPending = typeof chunk === 'string' ? 0 : Math.max(0, this.decoderPending + chunk.byteLength - Buffer.byteLength(text))
    text = this.surrogate + text
    this.surrogate = ''
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) {
      this.surrogate = text.slice(-1)
      text = text.slice(0, -1)
    }
    const chunks: TerminalChunk[] = []
    if (this.overflow !== 'text') {
      let index = 0
      while (index < text.length && this.overflow !== 'text') this.overflow = advance(this.overflow, text[index++] as string)
      if (index > 0) chunks.push({ text: text.slice(0, index), decorate: false })
      text = text.slice(index)
      if (this.overflow !== 'text') return chunks
    }
    text = this.pending + text
    this.pending = ''
    let state: State = 'text'
    let complete = 0
    for (let index = 0; index < text.length; index++) {
      state = advance(state, text[index] as string)
      if (state === 'text') complete = index + 1
    }
    if (complete > 0) chunks.push({ text: text.slice(0, complete), decorate: true })
    const rest = text.slice(complete)
    if (Buffer.byteLength(rest) > MAX_PENDING_TERMINAL_BYTES) {
      this.overflow = state
      chunks.push({ text: rest, decorate: false })
    } else this.pending = rest
    return chunks
  }

  /** Cancel only a control already streamed to the terminal; buffered suffixes were never sent. */
  dispose(): string {
    const cancel = this.overflow === 'text' ? '' : '\x18'
    this.pending = ''
    this.surrogate = ''
    this.overflow = 'text'
    this.decoder = new StringDecoder('utf8')
    this.decoderPending = 0
    return cancel
  }
}

/** Persist the caller's background across wrapper-added background resets. */
export function terminalBackground(text: string, previous: string): string {
  let background = previous
  for (const match of text.matchAll(/\x1b\[([\d;:]*)m/gu)) {
    const parameters = (match[1] ?? '').split(';')
    for (let index = 0; index < parameters.length; index++) {
      const value = parameters[index] as string
      const code = Number(value.split(':')[0])
      if (code === 0 || code === 49) background = ''
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) background = `\x1b[${value}m`
      else if (code === 38 || code === 48 || code === 58) {
        if (value.includes(':')) {
          if (code === 48) background = `\x1b[${value}m`
          continue
        }
        const count = parameters[index + 1] === '2' ? 4 : parameters[index + 1] === '5' ? 2 : 0
        if (count > 0 && index + count < parameters.length && code === 48) background = `\x1b[${parameters.slice(index, index + count + 1).join(';')}m`
        index += count
      }
    }
  }
  return background
}
