import { createElement } from 'react'
import { renderToString } from 'ink'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { maskComposerInput } from '../src/secret-input.ts'
import { InputBar } from '../src/input-bar.tsx'

describe('credential display masking', () => {
  it('preserves command and reference names, while hiding default and named secret arguments', () => {
    for (const command of ['/key', '/login']) {
      const named = `${command} OPENAI_API_KEY sk-fixture-secret`
      const display = maskComposerInput(named, named.length)
      expect(display.text).toBe(`${command} OPENAI_API_KEY ${'•'.repeat('sk-fixture-secret'.length)}`)
      expect(display.caretIndex).toBe(display.text.length)
      expect(maskComposerInput(`${command} OPENAI_API_KEY`, 5).text).toBe(`${command} OPENAI_API_KEY`)
      expect(maskComposerInput(`${command} sk-fixture`, 7).text).not.toContain('sk-fixture')
    }
    expect(maskComposerInput('ordinary /key example', 3).text).toBe('ordinary /key example')
  })

  it('maps grapheme caret positions and preserves line breaks without exposing secret characters', () => {
    const text = '中e\u0301🧑‍💻\nabc'
    const display = maskComposerInput(text, '中e\u0301🧑‍💻'.length, true)
    expect(display).toEqual({ text: '•••\n•••', caretIndex: 3 })
    expect(maskComposerInput(text, 1, true).caretIndex).toBe(1)
    expect(maskComposerInput(text, text.length, true).caretIndex).toBe(7)
  })

  it('emits only masked text from credential editors and slash commands', () => {
    const secret = 'sk-fixture_DO_NOT_RENDER'
    for (const props of [
      { text: secret, secret: true, commandMode: false },
      { text: `/key OPENAI_API_KEY ${secret}`, commandMode: true },
    ]) {
      const raw = renderToString(createElement(InputBar, { ...props, mentionMode: false }))
      expect(raw).not.toContain(secret)
      expect(stripVTControlCharacters(raw)).toContain('••••')
    }
  })
})
