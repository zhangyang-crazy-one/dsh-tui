/** Pure semantic tokenization for the terminal composer. */

/** One immutable composer segment; concatenated text always equals the input. */
export interface ComposerToken {
  /** Presentation category; submission ignores it. */
  readonly kind: 'text' | 'command' | 'mention' | 'image'
  /** Exact source slice. */
  readonly text: string
}

const IMAGE_TOKEN = /^\[图片 #[1-9]\d*\]/u
const COMMAND_TOKEN = /^\/[\p{L}\p{N}][\p{L}\p{N}._-]*/u
const MENTION_TOKEN = /^@\S+/u

function tokenAt(text: string, index: number): ComposerToken | undefined {
  const rest = text.slice(index)
  const image = IMAGE_TOKEN.exec(rest)?.[0]
  if (image !== undefined) return Object.freeze({ kind: 'image', text: image })
  const boundary = index === 0 || /\s/u.test(text[index - 1] ?? '')
  if (!boundary) return undefined
  const command = COMMAND_TOKEN.exec(rest)?.[0]
  if (command !== undefined) return Object.freeze({ kind: 'command', text: command })
  const mention = MENTION_TOKEN.exec(rest)?.[0]
  if (mention !== undefined) return Object.freeze({ kind: 'mention', text: mention })
  return undefined
}

/**
 * Split composer text into presentation-only semantic segments.
 * Malformed or incomplete fragments remain ordinary text, and concatenating
 * every returned `text` reproduces the input byte-for-byte.
 * @param text - raw composer buffer.
 * @returns frozen segments in source order.
 */
export function tokenizeComposer(text: string): readonly ComposerToken[] {
  if (text === '') return Object.freeze([])
  const tokens: ComposerToken[] = []
  let ordinaryStart = 0
  let index = 0
  while (index < text.length) {
    const token = tokenAt(text, index)
    if (token === undefined) {
      index += 1
      continue
    }
    if (ordinaryStart < index) {
      tokens.push(Object.freeze({ kind: 'text', text: text.slice(ordinaryStart, index) }))
    }
    tokens.push(token)
    index += token.text.length
    ordinaryStart = index
  }
  if (ordinaryStart < text.length) {
    tokens.push(Object.freeze({ kind: 'text', text: text.slice(ordinaryStart) }))
  }
  return Object.freeze(tokens)
}
