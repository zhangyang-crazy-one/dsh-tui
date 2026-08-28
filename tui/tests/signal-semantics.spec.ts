import { describe, expect, it, vi } from 'vitest'
import { installSignalHooks, SIGNAL_TABLE, TRACKED_SIGNALS } from '../src/signal-semantics.ts'

describe('SIGNAL_TABLE', () => {
  it('maps the terminal surface signal semantics', () => {
    expect(SIGNAL_TABLE.SIGINT).toBe('stop-generation')
    expect(SIGNAL_TABLE.SIGTERM).toBe('exit')
    expect(SIGNAL_TABLE.SIGHUP).toBe('exit')
    expect(TRACKED_SIGNALS).toContain('SIGINT')
  })
})

describe('installSignalHooks', () => {
  it('routes every tracked signal into one cleanup callback with its name', () => {
    const cleanup = vi.fn()
    const dispose = installSignalHooks(cleanup)
    process.emit('SIGINT')
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(cleanup).toHaveBeenCalledWith('SIGINT')
    process.emit('SIGTERM')
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(cleanup).toHaveBeenLastCalledWith('SIGTERM')
    dispose()
    process.emit('SIGINT')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('removes the exact installed listeners once and leaves the captured baseline intact', () => {
    const trackedSignals = TRACKED_SIGNALS as readonly NodeJS.Signals[]
    const signalBaseline = Object.fromEntries(
      trackedSignals.map(signal => [signal, process.listeners(signal)]),
    ) as Record<string, NodeJS.SignalsListener[]>
    const exitBaseline = process.listeners('exit')
    const exceptionBaseline = process.listeners('uncaughtException')
    const cleanup = vi.fn()
    try {
      const dispose = installSignalHooks(cleanup)
      for (const signal of trackedSignals) {
        expect(process.listeners(signal)).toHaveLength(signalBaseline[signal]!.length + 1)
      }
      expect(process.listeners('exit')).toHaveLength(exitBaseline.length + 1)
      expect(process.listeners('uncaughtException')).toHaveLength(exceptionBaseline.length + 1)
      dispose()
      dispose()
      for (const signal of trackedSignals) {
        expect(process.listeners(signal)).toEqual(signalBaseline[signal])
      }
      expect(process.listeners('exit')).toEqual(exitBaseline)
      expect(process.listeners('uncaughtException')).toEqual(exceptionBaseline)
    } finally {
      for (const signal of trackedSignals) {
        for (const listener of process.listeners(signal)) {
          if (!signalBaseline[signal]!.includes(listener)) process.off(signal, listener)
        }
      }
      for (const listener of process.listeners('exit')) {
        if (!exitBaseline.includes(listener)) process.off('exit', listener)
      }
      for (const listener of process.listeners('uncaughtException')) {
        if (!exceptionBaseline.includes(listener)) process.off('uncaughtException', listener)
      }
    }
  })

  it('routes the installed exit and exception listeners through cleanup', () => {
    const exitBaseline = process.listeners('exit')
    const exceptionBaseline = process.listeners('uncaughtException')
    const cleanup = vi.fn()
    const dispose = installSignalHooks(cleanup)
    try {
      const onExit = process.listeners('exit').find(listener => !exitBaseline.includes(listener))
      const onException = process.listeners('uncaughtException')
        .find(listener => !exceptionBaseline.includes(listener))
      expect(onExit).toBeDefined()
      expect(onException).toBeDefined()
      ;(onExit as () => void)()
      ;(onException as () => void)()
      expect(cleanup).toHaveBeenCalledWith('exit')
      expect(cleanup).toHaveBeenCalledWith('uncaughtException')
    } finally {
      dispose()
    }
  })
})
