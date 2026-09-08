import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import {
  BRAILLE_SPINNER_FRAMES,
  GENERATION_TIPS_EN,
  GENERATION_TIPS_ZH,
  getBilingualTip,
  getBrailleSpinnerFrame,
  getSwimmingFishFrame,
  SWIMMING_FISH_FRAMES,
  tuiCopy,
} from '../src/ui-copy.ts'

describe('ui-copy', () => {
  it('resolves dictionary entries for zh-CN and en-US', () => {
    expect(tuiCopy('reasoning', 'zh-CN')).toBe('思考')
    expect(tuiCopy('reasoning', 'en-US')).toBe('Thinking')
    expect(tuiCopy('on')).toBe('开')
  })

  it('keeps all braille spinner frames at exactly 1 column with zero jitter', () => {
    expect(BRAILLE_SPINNER_FRAMES.length).toBe(10)
    for (const frame of BRAILLE_SPINNER_FRAMES) {
      expect(displayWidth(frame)).toBe(1)
    }
  })

  it('animates braille spinner across all 10 frames based on live elapsed time', () => {
    expect(getBrailleSpinnerFrame(undefined)).toBe(BRAILLE_SPINNER_FRAMES[0])
    expect(getBrailleSpinnerFrame(0)).toBe(BRAILLE_SPINNER_FRAMES[0])
    expect(getBrailleSpinnerFrame(100)).toBe(BRAILLE_SPINNER_FRAMES[1])
    expect(getBrailleSpinnerFrame(200)).toBe(BRAILLE_SPINNER_FRAMES[2])
    expect(getBrailleSpinnerFrame(300)).toBe(BRAILLE_SPINNER_FRAMES[3])
    expect(getBrailleSpinnerFrame(400)).toBe(BRAILLE_SPINNER_FRAMES[4])
    expect(getBrailleSpinnerFrame(500)).toBe(BRAILLE_SPINNER_FRAMES[5])
    expect(getBrailleSpinnerFrame(600)).toBe(BRAILLE_SPINNER_FRAMES[6])
    expect(getBrailleSpinnerFrame(700)).toBe(BRAILLE_SPINNER_FRAMES[7])
    expect(getBrailleSpinnerFrame(800)).toBe(BRAILLE_SPINNER_FRAMES[8])
    expect(getBrailleSpinnerFrame(900)).toBe(BRAILLE_SPINNER_FRAMES[9])
    expect(getBrailleSpinnerFrame(1000)).toBe(BRAILLE_SPINNER_FRAMES[0])
  })

  it('maintains backward compatibility with getSwimmingFishFrame', () => {
    expect(getSwimmingFishFrame(0)).toBe(BRAILLE_SPINNER_FRAMES[0])
    expect(SWIMMING_FISH_FRAMES).toBe(BRAILLE_SPINNER_FRAMES)
  })

  it('returns rotating bilingual tips for zh-CN and en-US', () => {
    expect(getBilingualTip(undefined, 'zh-CN')).toBe(GENERATION_TIPS_ZH[0])
    expect(getBilingualTip(0, 'en-US')).toBe(GENERATION_TIPS_EN[0])
    expect(getBilingualTip(4000, 'zh-CN')).toBe(GENERATION_TIPS_ZH[1])
    expect(getBilingualTip(8000, 'en-US')).toBe(GENERATION_TIPS_EN[2])
    expect(getBilingualTip(12000, 'zh-CN')).toBe(GENERATION_TIPS_ZH[3])
    expect(getBilingualTip(16000, 'en-US')).toBe(GENERATION_TIPS_EN[4])
    expect(getBilingualTip(20000, 'zh-CN')).toBe(GENERATION_TIPS_ZH[0])
  })
})
