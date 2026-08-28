import { describe, expect, it, vi } from 'vitest'
import { createRenderLoop, withThrottle } from '../src/render-loop.ts'

describe('createRenderLoop', () => {
  it('renders the latest model at the flush interval (P13 drop-frame)', () => {
    vi.useFakeTimers()
    const render = vi.fn()
    const loop = createRenderLoop(render, 20)
    loop.enqueue('a')
    loop.enqueue('b')
    loop.enqueue('c')
    vi.advanceTimersByTime(20)
    expect(render).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith('c')
    loop.stop()
    vi.useRealTimers()
  })

  it('stop flushes once and disables the timer', () => {
    vi.useFakeTimers()
    const render = vi.fn()
    const loop = createRenderLoop(render, 20)
    loop.enqueue('a')
    loop.stop()
    expect(render).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(render).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stop is idempotent after the timer is cleared', () => {
    vi.useFakeTimers()
    const render = vi.fn()
    const loop = createRenderLoop(render, 20)
    loop.enqueue('a')
    loop.stop()
    loop.stop()
    expect(render).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('withThrottle', () => {
  it('fires the leading edge immediately and coalesces the tail', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const throttled = withThrottle(fn, 20)
    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1)
    vi.advanceTimersByTime(20)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)
    vi.useRealTimers()
  })
})
