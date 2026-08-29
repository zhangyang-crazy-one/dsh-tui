import { describe, expect, it } from 'vitest'
import {
  applyTheme,
  bgSequence,
  currentTier,
  inkColor,
  installTheme,
  paintBackgroundRow,
  styled,
  THEME_LEVELS,
} from '../src/theme.ts'

describe('THEME_LEVELS', () => {
  it('declares DeepSeek logo blue as truecolor accent', () => {
    expect(THEME_LEVELS.truecolor.accent).toBe('#4D6BFE')
    expect(THEME_LEVELS.truecolor.accentDim).toBe('#34415B')
    expect(THEME_LEVELS['256'].accent).toBe('69')
    expect(THEME_LEVELS['256'].accentDim).toBe('60')
  })

  it('declares every token at every tier', () => {
    for (const tier of ['truecolor', '256', '16', 'none'] as const) {
      expect(THEME_LEVELS[tier].accent).toBeDefined()
      expect(THEME_LEVELS[tier].bg).toBeDefined()
    }
  })

  it('disables all styling at none', () => {
    for (const value of Object.values(THEME_LEVELS.none)) {
      expect(value).toBe('')
    }
  })
})

describe('styled', () => {
  it('wraps text in paired truecolor sequences', () => {
    const output = styled('hi', 'accent', 'truecolor')
    expect(output.startsWith('\x1b[38;2;77;107;254m')).toBe(true)
    expect(output.endsWith('hi\x1b[0m')).toBe(true)
  })

  it('maps background tokens to 48;2 form', () => {
    expect(styled('x', 'bg', 'truecolor')).toBe('\x1b[48;2;0;0;0mx\x1b[0m')
  })

  it('maps 256-color tokens through 38;5 form', () => {
    expect(styled('x', 'accent', '256')).toBe('\x1b[38;5;69mx\x1b[0m')
  })

  it('maps 16-color tokens to ANSI SGR codes', () => {
    expect(styled('x', 'accent', '16')).toBe('\x1b[94mx\x1b[0m')
    expect(styled('x', 'fgDim', '16')).toBe('\x1b[90mx\x1b[0m')
    expect(styled('x', 'success', '16')).toBe('\x1b[32mx\x1b[0m')
    expect(styled('x', 'error', '16')).toBe('\x1b[31mx\x1b[0m')
    expect(styled('x', 'fg', '16')).toBe('\x1b[37mx\x1b[0m')
    expect(styled('x', 'codeBg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'bg', '16')).toBe('\x1b[40mx\x1b[0m')
  })

  it('fails loudly if the closed 16-color table drifts to an unknown name', () => {
    const tokens = THEME_LEVELS['16'] as { accent: string }
    const original = tokens.accent
    tokens.accent = 'unknown-color'
    try {
      expect(() => styled('x', 'accent', '16')).toThrow('unknown 16-color value')
    } finally {
      tokens.accent = original
    }
  })

  it('passes text through unchanged at none', () => {
    expect(styled('hi', 'accent', 'none')).toBe('hi')
  })
})

describe('inkColor', () => {
  it('maps package tokens into Ink color properties', () => {
    expect(inkColor('bg', 'truecolor')).toBe('#000000')
    expect(inkColor('bg', '256')).toBe('ansi256(16)')
    expect(inkColor('fgDim', '256')).toBe('ansi256(245)')
    expect(inkColor('bg', '16')).toBe('black')
    expect(inkColor('bg', 'none')).toBeUndefined()
  })
})

describe('paintBackgroundRow', () => {
  it('reopens the panel background around reset-terminated parts', () => {
    const output = paintBackgroundRow([
      styled('x', 'fg', 'truecolor'),
      styled('y', 'accent', 'truecolor'),
    ], 'codeBg', 4, 'truecolor')
    expect(output.match(/\x1b\[48;2;15;17;21m/gu)).toHaveLength(3)
    expect(output).toContain('  \x1b[0m')
    expect(output).not.toContain('\x1b[K')
  })

  it('adds no ANSI at the none tier', () => {
    expect(paintBackgroundRow(['x'], 'codeBg', 80, 'none')).toBe('x')
  })
})

describe('applyTheme', () => {
  it('switches the tier styled maps at', () => {
    applyTheme('none')
    expect(styled('hi', 'accent')).toBe('hi')
    expect(currentTier()).toBe('none')
    applyTheme('truecolor')
    expect(styled('hi', 'accent')).toContain('\x1b[38;2;')
  })

  it('maps the active and explicit background tiers without a reset pair', () => {
    applyTheme('256')
    expect(bgSequence()).toBe('\x1b[48;5;16m')
    expect(bgSequence('none')).toBe('')
    applyTheme('truecolor')
  })
})

describe('installTheme', () => {
  it('installs the tier detected from the environment snapshot', () => {
    expect(
      installTheme({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }),
    ).toBe('truecolor')
    expect(currentTier()).toBe('truecolor')
    expect(styled('hi', 'accent')).toContain('\x1b[38;2;')
    expect(installTheme({ TERM: 'xterm-256color' })).toBe('256')
    expect(styled('hi', 'accent')).toBe('\x1b[38;5;69mhi\x1b[0m')
    expect(installTheme({ TERM: 'xterm' })).toBe('16')
    expect(installTheme({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe('none')
    expect(styled('hi', 'accent')).toBe('hi')
    applyTheme('truecolor')
  })
})
