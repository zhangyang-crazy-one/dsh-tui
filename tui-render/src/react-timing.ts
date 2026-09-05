/** Release React development User Timing entries after observers receive them. */
import { performance, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks'

/** React 19 development tracks are separate from the TUI's bounded duration histograms. */
function isReactTiming(entry: PerformanceEntry): boolean {
  if (entry.entryType !== 'measure' || !('detail' in entry)) return false
  const detail: unknown = entry.detail
  if (typeof detail !== 'object' || detail === null || !('devtools' in detail)) return false
  const devtools: unknown = detail.devtools
  return typeof devtools === 'object' && devtools !== null
    && (('track' in devtools && devtools.track === 'Components ⚛')
      || ('trackGroup' in devtools && devtools.trackGroup === 'Scheduler ⚛'))
}

/**
 * Consume React's development timeline without retaining component props for the session lifetime.
 * Other performance observers still receive these entries. Non-React measurements, including
 * any colliding name, are untouched; frame-stats use independent lifetime histograms.
 * @returns disposer that drains pending records and disconnects the observer.
 */
export function observeReactTiming(): () => void {
  const release = (entries: readonly PerformanceEntry[]): void => {
    const names = new Set(entries.filter(isReactTiming).map(entry => entry.name))
    for (const name of names) {
      if (performance.getEntriesByName(name, 'measure').every(isReactTiming)) performance.clearMeasures(name)
    }
  }
  const observer = new PerformanceObserver((list) => { release(list.getEntries()) })
  observer.observe({ entryTypes: ['measure'] })
  return () => { release(observer.takeRecords()); observer.disconnect() }
}
