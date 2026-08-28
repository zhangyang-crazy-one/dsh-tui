import { describe, expect, it } from 'vitest'
import {
  BRAND_ASCII,
  BRAND_APP_TITLE,
  BRAND_FULL_BLOCK,
  BRAND_HALF_BLOCK,
  BRAND_HALF_BLOCK_FRAMES,
  BRAND_HOME_LINE,
  BRAND_PLAIN_WORDMARK,
} from '../src/brand.ts'

describe('DeepSeek brand copy', () => {
  it('keeps only generated official tiers, the wordmark, prompt, and compact title', () => {
    expect(BRAND_PLAIN_WORDMARK).toBe('DeepSeek')
    expect(BRAND_HOME_LINE).toBe('有什么可以帮忙的')
    expect(BRAND_APP_TITLE).toBe('DeepSeek · deepseek-tui')
    expect(BRAND_HALF_BLOCK).toHaveLength(16)
    expect(BRAND_HALF_BLOCK_FRAMES).toHaveLength(4)
    expect(BRAND_FULL_BLOCK).toHaveLength(16)
    expect(BRAND_ASCII).toHaveLength(16)
    expect(JSON.stringify({
      BRAND_HALF_BLOCK,
      BRAND_HALF_BLOCK_FRAMES,
      BRAND_FULL_BLOCK,
      BRAND_ASCII,
    })).not.toContain('🐋')
  })
})
