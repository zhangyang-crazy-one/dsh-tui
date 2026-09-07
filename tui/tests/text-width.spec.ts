import { describe, expect, it } from 'vitest'
import {
  displayWidth as renderDisplayWidth,
  formatSymbolSpacing as renderFormatSymbolSpacing,
  wcwidthSafeSlice as renderWcwidthSafeSlice,
} from '@deepseek-ai/dsh-tui-render'
import {
  displayWidth as hostDisplayWidth,
  formatSymbolSpacing as hostFormatSymbolSpacing,
  wcwidthSafeSlice as hostWcwidthSafeSlice,
} from '../src/text-width.ts'

describe('text-width host shim', () => {
  it('re-exports displayWidth identically from the render layer', () => {
    expect(hostDisplayWidth).toBe(renderDisplayWidth)
    expect(hostDisplayWidth('中文ab')).toBe(6)
    expect(hostDisplayWidth('😀')).toBe(2)
    expect(hostDisplayWidth('①')).toBe(1)
  })

  it('re-exports wcwidthSafeSlice identically from the render layer', () => {
    expect(hostWcwidthSafeSlice).toBe(renderWcwidthSafeSlice)
    expect(hostWcwidthSafeSlice('中文ab', 2)).toBe('中')
    expect(hostWcwidthSafeSlice('中文ab', 4)).toBe('中文')
  })

  it('re-exports formatSymbolSpacing identically from the render layer', () => {
    expect(hostFormatSymbolSpacing).toBe(renderFormatSymbolSpacing)
    expect(hostFormatSymbolSpacing('①和②')).toBe('① 和 ②')
  })
})
