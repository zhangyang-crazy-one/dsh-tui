/** React timing cleanup preserves other observers, unrelated names, and mount disposal. */
import { performance, PerformanceObserver } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { observeReactTiming } from '../src/react-timing.ts'

it('consumes React timeline entries without hiding them from observers or clearing unrelated measures', async () => {
  const observed: string[] = []
  const other = new PerformanceObserver((list) => { observed.push(...list.getEntries().map(entry => entry.name)) })
  other.observe({ entryTypes: ['measure'] })
  const dispose = observeReactTiming()
  const component = { start: 0, end: 1, detail: { devtools: { track: 'Components ⚛', properties: [['source', 'long text']] } } }
  const names = ['\u200bTestComponent', 'dsh-unrelated-test', 'dsh-name-collision', 'dsh-scheduler-test']
  try {
    for (let index = 0; index < 200; index += 1) performance.measure(names[0]!, component)
    performance.measure(names[1]!, { start: 0, end: 1 })
    performance.measure(names[2]!, { start: 0, end: 1 })
    performance.measure(names[2]!, component)
    performance.measure(names[3]!, { start: 0, end: 1, detail: { devtools: { trackGroup: 'Scheduler ⚛' } } })
    await expect.poll(() => observed.length).toBe(204)
    expect(performance.getEntriesByName(names[0]!)).toHaveLength(0)
    expect(performance.getEntriesByName(names[3]!)).toHaveLength(0)
    expect(performance.getEntriesByName(names[1]!)).toHaveLength(1)
    expect(performance.getEntriesByName(names[2]!)).toHaveLength(2)
    performance.measure(names[0]!, component)
    dispose()
    expect(performance.getEntriesByName(names[0]!)).toHaveLength(0)
    performance.measure(names[0]!, component)
    await new Promise(resolve => setImmediate(resolve))
    expect(performance.getEntriesByName(names[0]!)).toHaveLength(1)
  } finally {
    dispose(); other.disconnect()
    for (const name of names) performance.clearMeasures(name)
  }
})
