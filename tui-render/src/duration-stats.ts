/** Bounded recent samples plus full-run duration distributions with fixed histogram storage. */
import { createHistogram } from 'node:perf_hooks'

/** Full-run statistics; percentiles use microsecond buckets and three significant digits. */
export interface DurationDistribution {
  readonly count: number
  readonly mean: number
  readonly max: number
  readonly p95: number
  readonly p99: number
}

/** Exact recent-window statistics and a bounded-memory lifetime distribution. */
export interface DurationSnapshot extends DurationDistribution {
  /** Oldest-first samples from the bounded recent window, not the whole run. */
  readonly samples: readonly number[]
  /** All observations since creation/reset, including samples evicted from the recent window. */
  readonly run: DurationDistribution
}

/** Duration accumulator whose histogram cannot grow with the number of frames. */
export class DurationStats {
  private readonly histogram = createHistogram({ figures: 3 })
  private readonly recent: number[] = []
  private count = 0
  private sum = 0
  private max = 0

  /** @param capacity - number of exact recent samples retained for diagnostics. */
  constructor(private readonly capacity: number) {}

  /**
   * Record one duration in both the recent window and lifetime distribution.
   * @param milliseconds - non-negative monotonic-clock duration.
   */
  record(milliseconds: number): void {
    this.recent.push(milliseconds)
    if (this.recent.length > this.capacity) this.recent.shift()
    this.count += 1
    this.sum += milliseconds
    this.max = Math.max(this.max, milliseconds)
    this.histogram.record(Math.max(1, Math.round(milliseconds * 1000)))
  }

  /** Clear the recent diagnostic window while retaining every lifetime observation. */
  resetWindow(): void { this.recent.length = 0 }

  /** Start a new measured workload, discarding both startup samples and their distribution. */
  reset(): void {
    this.resetWindow()
    this.histogram.reset()
    this.count = 0
    this.sum = 0
    this.max = 0
  }

  /**
   * Read the recent window and complete measured workload without clearing either.
   * @returns recent exact quantiles plus full-run count, mean, max, and histogram quantiles.
   */
  snapshot(): DurationSnapshot {
    const samples = this.recent.slice()
    const sorted = samples.slice().sort((left, right) => left - right)
    const count = samples.length
    const percentile = (quantile: number): number => sorted[Math.ceil(count * quantile) - 1] ?? 0
    return {
      count, mean: count === 0 ? 0 : samples.reduce((sum, sample) => sum + sample, 0) / count,
      max: sorted.at(-1) ?? 0, p95: percentile(0.95), p99: percentile(0.99), samples,
      run: { count: this.count, mean: this.count === 0 ? 0 : this.sum / this.count, max: this.max,
        p95: this.max === 0 ? 0 : Math.min(this.max, this.histogram.percentile(95) / 1000),
        p99: this.max === 0 ? 0 : Math.min(this.max, this.histogram.percentile(99) / 1000) },
    }
  }
}
