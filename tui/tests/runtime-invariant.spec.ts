import { describe, expect, it, vi } from 'vitest'
import { validateTuiRuntimeLifecycle } from '../src/invariant.ts'
import type { TuiRuntimeLifecycleSnapshot } from '../src/index.ts'

function snapshot(
  phase: TuiRuntimeLifecycleSnapshot['phase'],
  overrides: Partial<TuiRuntimeLifecycleSnapshot> = {},
): TuiRuntimeLifecycleSnapshot {
  const valid: Record<TuiRuntimeLifecycleSnapshot['phase'], TuiRuntimeLifecycleSnapshot> = {
    starting: { phase: 'starting', launcherSignals: 'generic-owned', tuiSignals: 'absent', runWork: 'open' },
    active: { phase: 'active', launcherSignals: 'consumer-owned', tuiSignals: 'owned', runWork: 'open' },
    'ordinary-unload': { phase: 'ordinary-unload', launcherSignals: 'consumer-owned', tuiSignals: 'owned', runWork: 'quiescing' },
    'process-exit': { phase: 'process-exit', launcherSignals: 'consumer-owned', tuiSignals: 'retained', runWork: 'quiescing' },
    settled: { phase: 'settled', launcherSignals: 'generic-owned', tuiSignals: 'disposed', runWork: 'settled' },
  }
  return { ...valid[phase], ...overrides }
}

describe('validateTuiRuntimeLifecycle', () => {
  it('accepts every valid phase snapshot', () => {
    const fail = vi.fn((_message: string): never => {
      throw new Error('valid lifecycle unexpectedly failed')
    })
    for (const phase of ['starting', 'active', 'ordinary-unload', 'process-exit', 'settled'] as const) {
      validateTuiRuntimeLifecycle(snapshot(phase), fail)
    }
    expect(fail).not.toHaveBeenCalled()
  })

  it.each([
    [snapshot('starting', { launcherSignals: 'consumer-owned' }), 'protective hooks'],
    [snapshot('starting', { launcherSignals: 'consumer-owned', tuiSignals: 'disposed' }), 'protective hooks'],
    [snapshot('starting', { runWork: 'settled' }), 'starting'],
    [snapshot('active', { runWork: 'quiescing' }), 'active'],
    [snapshot('active', { tuiSignals: 'absent' }), 'protective hooks'],
    [snapshot('active', { launcherSignals: 'generic-owned' }), 'active'],
    [snapshot('ordinary-unload', { runWork: 'open' }), 'ordinary TUI unload'],
    [snapshot('ordinary-unload', { tuiSignals: 'disposed' }), 'protective hooks'],
    [snapshot('process-exit', { tuiSignals: 'owned' }), 'process-exit'],
    [snapshot('process-exit', { launcherSignals: 'generic-owned' }), 'process-exit'],
    [snapshot('process-exit', { runWork: 'open' }), 'process-exit'],
    [snapshot('settled', { runWork: 'quiescing' }), 'settled ordinary unload'],
    [snapshot('settled', { tuiSignals: 'retained' }), 'settled ordinary unload'],
    [snapshot('settled', { launcherSignals: 'consumer-owned' }), 'protective hooks'],
  ] as const)('reports an invalid ownership relationship', (value, message) => {
    const fail = vi.fn((reason: string): never => {
      throw new Error(reason)
    })
    expect(() => { validateTuiRuntimeLifecycle(value, fail) }).toThrow(message)
    expect(fail).toHaveBeenCalledWith(expect.stringContaining(message))
  })
})
