import { afterEach, expect, it } from 'vitest'
import { applyTheme, bgSequence, inkColor, paintBackgroundRow, styled } from '../src/theme.ts'

afterEach(() => applyTheme('truecolor'))

it.each(['truecolor', '256', '16', 'none'] as const)('switches light/dark surfaces without stale cached padding at %s', tier => {
  applyTheme(tier, 'dark')
  const dark = { bg: bgSequence(), fg: inkColor('fg'), padding: paintBackgroundRow(['x'], 'inputBg', 12) }
  applyTheme(tier, 'light')
  const light = { bg: bgSequence(), fg: inkColor('fg'), padding: paintBackgroundRow(['x'], 'inputBg', 12) }
  if (tier === 'none') {
    expect(light).toEqual(dark)
    expect(styled('可读 text', 'fg')).toBe('可读 text')
  } else {
    expect(light.bg).not.toBe(dark.bg)
    expect(light.fg).not.toBe(dark.fg)
    expect(light.padding).not.toBe(dark.padding)
    expect(inkColor('fg')).not.toBe(inkColor('bg'))
  }
  applyTheme(tier, 'dark')
  expect(paintBackgroundRow(['x'], 'inputBg', 12)).toBe(dark.padding)
})
