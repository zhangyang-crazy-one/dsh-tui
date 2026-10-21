/** Display-only masking; the composer owner retains the exact editable value. */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Match the runtime's /key and /login argument grammar, preserving reference names. */
function secretStart(text: string): number | undefined {
  const command = /^\/(?:key|login)\s+/u.exec(text)
  if (command === null) return undefined
  const rest = text.slice(command[0].length)
  const named = /^([A-Za-z_][A-Za-z0-9_]*)(\s+)/u.exec(rest)
  if (named !== null) return command[0].length + named[0].length
  // A lone reference opens its editor; a lone sk-* token is the default key.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(rest) && !rest.startsWith('sk-')) return undefined
  return command[0].length
}

/** Replace each secret grapheme with one bullet and translate its visible caret. */
export function maskComposerInput(text: string, caretIndex: number, secret = false): {
  text: string; caretIndex: number
} {
  const caret = Math.max(0, Math.min(caretIndex, text.length))
  const start = secret ? 0 : secretStart(text)
  if (start === undefined) return { text, caretIndex: caret }
  let display = text.slice(0, start)
  let displayedCaret = Math.min(start, caret)
  for (const item of graphemes.segment(text.slice(start))) {
    const masked = item.segment.includes('\n') ? '\n' : '•'
    display += masked
    if (start + item.index + item.segment.length <= caret) displayedCaret += masked.length
  }
  return { text: display, caretIndex: displayedCaret }
}
