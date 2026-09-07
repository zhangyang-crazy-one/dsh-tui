import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import {
  GENERATION_TIPS_EN,
  GENERATION_TIPS_ZH,
  getBilingualTip,
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

  it('keeps all swimming fish frames at exactly 5 columns with zero jitter', () => {
    expect(SWIMMING_FISH_FRAMES.length).toBe(8)
    for (const frame of SWIMMING_FISH_FRAMES) {
      expect(displayWidth(frame)).toBe(5)
    }
  })

  it('animates swimming fish across all 8 frames based on live elapsed time', () => {
    expect(getSwimmingFishFrame(undefined)).toBe(SWIMMING_FISH_FRAMES[0])
    expect(getSwimmingFishFrame(0)).toBe(SWIMMING_FISH_FRAMES[0])
    expect(getSwimmingFishFrame(150)).toBe(SWIMMING_FISH_FRAMES[1])
    expect(getSwimmingFishFrame(300)).toBe(SWIMMING_FISH_FRAMES[2])
    expect(getSwimmingFishFrame(450)).toBe(SWIMMING_FISH_FRAMES[3])
    expect(getSwimmingFishFrame(600)).toBe(SWIMMING_FISH_FRAMES[4])
    expect(getSwimmingFishFrame(750)).toBe(SWIMMING_FISH_FRAMES[5])
    expect(getSwimmingFishFrame(900)).toBe(SWIMMING_FISH_FRAMES[6])
    expect(getSwimmingFishFrame(1050)).toBe(SWIMMING_FISH_FRAMES[7])
    expect(getSwimmingFishFrame(1200)).toBe(SWIMMING_FISH_FRAMES[0])
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
