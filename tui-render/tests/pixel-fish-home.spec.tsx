/** Generated FishLogo tier selection and bounded reveal lifecycle. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement } from 'react'
import {
  activeBrandRevealTimerCount,
  BRAND_ART_ROWS,
  BRAND_FRAME_MS,
  BRAND_HOME_ROWS,
  PixelFishHome,
  selectBrandRenderTier,
} from '../src/pixel-fish-home.tsx'
import type { PixelFishHomeProps } from '../src/pixel-fish-home.tsx'
import { applyTheme } from '../src/theme.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

function props(overrides: Partial<PixelFishHomeProps> = {}): PixelFishHomeProps {
  return {
    tier: 'half-block',
    animate: false,
    visible: true,
    maxColumns: 88,
    maxRows: 38,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  applyTheme('truecolor')
})

describe('selectBrandRenderTier', () => {
  it('keeps the closed capability order and falls back to the wordmark on size failure', () => {
    expect(BRAND_ART_ROWS).toBe(16)
    expect(BRAND_HOME_ROWS).toBe(19)
    expect(selectBrandRenderTier('half-block', 88, 38)).toBe('half-block')
    expect(selectBrandRenderTier('full-block', 88, 38)).toBe('full-block')
    expect(selectBrandRenderTier('ascii', 88, 38)).toBe('ascii')
    expect(selectBrandRenderTier('plain', 88, 38)).toBe('plain')
    expect(selectBrandRenderTier('half-block', 43, 38)).toBe('plain')
    expect(selectBrandRenderTier('half-block', 88, 19)).toBe('half-block')
    expect(selectBrandRenderTier('half-block', 88, 18)).toBe('plain')
  })
})

describe('PixelFishHome', () => {
  it('renders every official tier without a generic whale fallback', () => {
    applyTheme('truecolor')
    for (const tier of ['half-block', 'full-block', 'ascii'] as const) {
      const out = renderToString(createElement(PixelFishHome, props({ tier })))
      const plain = stripAnsi(out)
      expect(plain).toContain('DeepSeek')
      expect(plain).toContain('有什么可以帮忙的')
      expect(plain).not.toContain('🐋')
      expect(out).toContain('\x1b[38;2;77;107;254m')
    }
    const plainOnly = stripAnsi(renderToString(createElement(
      PixelFishHome,
      props({ tier: 'plain' }),
    )))
    expect(plainOnly).toBe('DeepSeek\n \n有什么可以帮忙的')
  })

  it('keeps the generated ASCII contour literal under NO_COLOR', () => {
    applyTheme('none')
    const out = renderToString(createElement(PixelFishHome, props({ tier: 'ascii' })))
    expect(out).not.toContain('\x1b')
    expect(out).toContain('###@@@@@@@@@@@@@')
    expect(out).toContain('DeepSeek')
  })

  it('advances exactly four 320ms frames and clears the completion timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const instance = render(createElement(PixelFishHome, props({ animate: true })), {
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      await instance.waitUntilRenderFlush()
      expect(timeout.mock.calls.filter(call => call[1] === BRAND_FRAME_MS)).toHaveLength(1)
      expect(activeBrandRevealTimerCount()).toBe(1)
      for (let frame = 1; frame < 4; frame += 1) {
        await vi.advanceTimersByTimeAsync(BRAND_FRAME_MS)
        await instance.waitUntilRenderFlush()
        expect(timeout.mock.calls.filter(call => call[1] === BRAND_FRAME_MS)).toHaveLength(frame + 1)
        expect(activeBrandRevealTimerCount()).toBe(1)
      }
      await vi.advanceTimersByTimeAsync(BRAND_FRAME_MS)
      await instance.waitUntilRenderFlush()
      expect(timeout.mock.calls.filter(call => call[1] === BRAND_FRAME_MS)).toHaveLength(4)
      expect(activeBrandRevealTimerCount()).toBe(0)
    } finally {
      instance.unmount()
    }
  })

  it('clears the timer on visibility, permission, resize, and unmount stop paths', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    for (const stopped of [
      props({ animate: true, visible: false }),
      props({ animate: false }),
      props({ animate: true, maxRows: 18 }),
    ]) {
      const instance = render(createElement(PixelFishHome, props({ animate: true })), {
        stdout: fakeTtyStdout(),
        stdin: fakeTtyStdin(),
        exitOnCtrlC: false,
        patchConsole: false,
      })
      await instance.waitUntilRenderFlush()
      expect(activeBrandRevealTimerCount()).toBe(1)
      instance.rerender(createElement(PixelFishHome, stopped))
      await instance.waitUntilRenderFlush()
      expect(activeBrandRevealTimerCount()).toBe(0)
      instance.rerender(createElement(PixelFishHome, props({ animate: true })))
      await instance.waitUntilRenderFlush()
      expect(activeBrandRevealTimerCount()).toBe(0)
      instance.unmount()
    }

    const unmounted = render(createElement(PixelFishHome, props({ animate: true })), {
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
    })
    await unmounted.waitUntilRenderFlush()
    expect(activeBrandRevealTimerCount()).toBe(1)
    unmounted.unmount()
    expect(activeBrandRevealTimerCount()).toBe(0)
  })
})
