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
  it('keeps essential ANSI-16 text distinct from every panel background', () => {
    const theme = THEME_LEVELS['16']
    for (const foreground of ['fg', 'fgSoft', 'fgDim'] as const) {
      for (const background of ['bg', 'toolBg', 'inputBg', 'messageBg', 'codeBg'] as const) {
        expect(theme[foreground]).not.toBe(theme[background])
      }
    }
  })
  it('declares DeepSeek logo blue as truecolor accent', () => {
    expect(THEME_LEVELS.truecolor.accent).toBe('#4D6BFE')
    expect(THEME_LEVELS.truecolor.accentDim).toBe('#34415B')
    expect(THEME_LEVELS['256'].accent).toBe('69')
    expect(THEME_LEVELS['256'].accentDim).toBe('60')
  })

  it('pins the complete approved Soft Slate truecolor palette', () => {
    expect(THEME_LEVELS.truecolor).toEqual({
      bg: '#151618',
      messageBg: '#25282C',
      toolBg: '#1A1C1F',
      codeBg: '#202328',
      inputBg: '#23262B',
      fg: '#EEF0F2',
      fgSoft: '#D1D4D8',
      fgDim: '#A4A9B0',
      accent: '#4D6BFE',
      accentText: '#7589FF',
      accentDim: '#34415B',
      line: '#3A3E44',
      success: '#75B984',
      warning: '#D5AE6B',
      error: '#E27D77',
      codeKeyword: '#7EB6FF',
      codeString: '#B9A4E8',
      codeComment: '#A4A9B0',
      codeCommand: '#75B984',
      markdownStrong: '#E4C58A',
      markdownEmphasis: '#C4AEF2',
      markdownCode: '#9BC9B1',
      markdownLink: '#80C7D9',
    })
    expect(THEME_LEVELS['256'].inputBg).toBe('235')
    expect(THEME_LEVELS['256'].codeKeyword).toBe('111')
    expect(THEME_LEVELS['16'].codeKeyword).toBe('cyan')
    expect(THEME_LEVELS.none.codeKeyword).toBe('')
  })

  it('declares every token at every tier', () => {
    for (const tier of ['truecolor', '256', '16', 'none'] as const) {
      expect(THEME_LEVELS[tier].accent).toBeDefined()
      expect(THEME_LEVELS[tier].bg).toBeDefined()
    }
  })

  it.each(['truecolor', '256', '16'] as const)('distinguishes Markdown roles from prose and each other at %s', (tier) => {
    const tokens = THEME_LEVELS[tier]
    const colors = ['fg', 'accentText', 'markdownStrong', 'markdownEmphasis', 'markdownCode', 'markdownLink'] as const
    expect(new Set(colors.map(token => tokens[token])).size).toBe(colors.length)
    for (const token of colors) expect(styled('text', token, tier)).toContain('\x1b[')
  })

  it('disables all styling at none', () => {
    for (const value of Object.values(THEME_LEVELS.none)) {
      expect(value).toBe('')
    }
  })
})

describe('styled', () => {
  it('paints inline code foreground and background through the shared row styling path', () => {
    expect(styled('code', 'markdownCode', 'truecolor')).toBe('\x1b[48;2;32;35;40m\x1b[38;2;155;201;177mcode\x1b[0m')
    expect(styled('code', 'markdownCode', '16', true)).toBe('\x1b[40m\x1b[1m\x1b[92mcode\x1b[0m')
    expect(styled('code', 'markdownCode', 'none', true)).toBe('code')
  })
  it('wraps text in paired truecolor sequences', () => {
    const output = styled('hi', 'accent', 'truecolor')
    expect(output.startsWith('\x1b[38;2;77;107;254m')).toBe(true)
    expect(output.endsWith('hi\x1b[0m')).toBe(true)
  })

  it('maps background tokens to 48;2 form', () => {
    expect(styled('x', 'bg', 'truecolor')).toBe('\x1b[48;2;21;22;24mx\x1b[0m')
    expect(styled('x', 'messageBg', 'truecolor')).toBe('\x1b[48;2;37;40;44mx\x1b[0m')
    expect(styled('x', 'toolBg', 'truecolor')).toBe('\x1b[48;2;26;28;31mx\x1b[0m')
    expect(styled('x', 'inputBg', 'truecolor')).toBe('\x1b[48;2;35;38;43mx\x1b[0m')
  })

  it('maps 256-color tokens through 38;5 form', () => {
    expect(styled('x', 'accent', '256')).toBe('\x1b[38;5;69mx\x1b[0m')
  })

  it('maps 16-color tokens to ANSI SGR codes', () => {
    expect(styled('x', 'accent', '16')).toBe('\x1b[94mx\x1b[0m')
    expect(styled('x', 'fgDim', '16')).toBe('\x1b[37mx\x1b[0m')
    expect(styled('x', 'success', '16')).toBe('\x1b[32mx\x1b[0m')
    expect(styled('x', 'error', '16')).toBe('\x1b[31mx\x1b[0m')
    expect(styled('x', 'fg', '16')).toBe('\x1b[37mx\x1b[0m')
    expect(styled('x', 'codeBg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'messageBg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'toolBg', '16')).toBe('\x1b[40mx\x1b[0m')
    expect(styled('x', 'inputBg', '16')).toBe('\x1b[100mx\x1b[0m')
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
    expect(inkColor('bg', 'truecolor')).toBe('#151618')
    expect(inkColor('bg', '256')).toBe('ansi256(233)')
    expect(inkColor('fgDim', '256')).toBe('ansi256(248)')
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
    expect(output.match(/\x1b\[48;2;32;35;40m/gu)).toHaveLength(3)
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
    expect(bgSequence()).toBe('\x1b[48;5;233m')
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
