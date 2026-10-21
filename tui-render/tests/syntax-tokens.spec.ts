import { expect, it } from 'vitest'
import { syntaxTokens } from '../src/syntax-tokens.ts'

it('preserves exact source, escaped quotes, indentation, newlines and multiline comments', () => {
  const source = '  const name = "a\\\"b"; /* first\nsecond */ return name\n'
  const tokens = syntaxTokens(source, 'typescript')
  expect(tokens.map(token => token.text).join('')).toBe(source)
  expect(tokens.find(token => token.kind === 'string')?.text).toBe('"a\\\"b"')
  expect(tokens.filter(token => token.kind === 'comment').map(token => token.text).join('')).toBe('/* first\nsecond */')
})
it.each([
  ['python', 'def f(): return True # note', 'def', '# note'],
  ['go', 'func main() { defer close(c) } // note', 'func', '// note'],
  ['rust', 'pub fn main() { let x = 1; } // note', 'fn', '// note'],
  ['sh', 'if true; then echo ok; fi # note', 'then', '# note'],
  ['sql', 'SELECT col FROM tab -- note', 'SELECT', '-- note'],
])('uses %s grammar rather than a universal keyword set', (lang, source, keyword, comment) => {
  const tokens = syntaxTokens(source, lang)
  expect(tokens.map(token => token.text).join('')).toBe(source)
  expect(tokens).toContainEqual({ kind: 'keyword', text: keyword })
  expect(tokens).toContainEqual({ kind: 'comment', text: comment })
})
it('keeps unknown languages and oversized source plain without evaluating anything', () => {
  for (const [source, lang] of [['const value = 3 // text', 'unknown'], ['x'.repeat(40000), 'js']]) {
    expect(syntaxTokens(source!, lang!)).toEqual([{ kind: 'plain', text: source }])
  }
  expect(syntaxTokens('def value = 1', 'js').some(token => token.kind === 'keyword' && token.text === 'def')).toBe(false)
})
