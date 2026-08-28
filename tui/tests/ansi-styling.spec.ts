import { describe, expect, it } from 'vitest'
import {
  escapeContent as renderEscapeContent,
  styled,
} from '@deepseek-ai/dsh-tui-render'
import {
  escapeContent as hostEscapeContent,
  styled as hostStyled,
} from '../src/ansi-styling.ts'

describe('ansi-styling host shim', () => {
  it('re-exports escapeContent identically from the render layer', () => {
    expect(hostEscapeContent).toBe(renderEscapeContent)
    expect(hostEscapeContent('a\x1b[2Jb')).toBe('a\\x1b[2Jb')
  })

  it('re-exports the render-layer theme implementation', () => {
    expect(hostStyled).toBe(styled)
    expect(styled('hi', 'accent', 'truecolor')).toContain(
      '\x1b[38;2;77;107;254m',
    )
    expect(styled('hi', 'accent', 'none')).toBe('hi')
  })
})
