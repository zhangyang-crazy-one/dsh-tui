/** Random-access transcript rows; concatenation does not materialize offscreen sources. */

/** Array-compatible reads over an exact row count, including lazy tool bodies. */
export interface RowSource<T> {
  readonly length: number
  /** Read one row; negative offsets count backward from the end. */
  at(index: number): T | undefined
  /** Materialize only the requested half-open interval, using array slice offsets. */
  slice(start?: number, end?: number): T[]
}

/**
 * Expose known-height data through bounded array-style reads.
 * @param length - exact non-negative row count.
 * @param read - materialize one in-range row.
 * @returns a source that reads no rows until at/slice is called.
 */
export function indexedRows<T>(length: number, read: (index: number) => T): RowSource<T> {
  const offset = (index: number): number => Math.min(length, Math.max(0, index < 0 ? length + Math.trunc(index) : Math.trunc(index)))
  return Object.freeze({
    length,
    at(index: number): T | undefined {
      const integer = Math.trunc(index)
      const absolute = integer < 0 ? length + integer : integer
      return absolute < 0 || absolute >= length ? undefined : read(absolute)
    },
    slice(start = 0, end = length): T[] {
      const out: T[] = []
      const last = offset(end)
      for (let index = offset(start); index < last; index += 1) out.push(read(index))
      return out
    },
  })
}

/** Builder for a transcript entry composed of already projected and lazy row segments. */
export class RowSequence<T> {
  private readonly segments: { start: number; end: number; rows: RowSource<T> }[] = []
  private size = 0

  /** Number of rows appended so far, without materializing them. */
  get length(): number { return this.size }

  /**
   * Append a source using its known height.
   * @param rows - immutable source or ordinary readonly array.
   */
  append(rows: RowSource<T>): void {
    if (rows.length === 0) return
    this.segments.push({ start: this.size, end: this.size + rows.length, rows })
    this.size += rows.length
  }

  /**
   * Append one already materialized spacer or heading.
   * @param row - the row to append.
   */
  push(row: T): void { this.append([row]) }

  /**
   * Publish an immutable segment directory independent of later builder edits.
   * @returns random-access rows; only at/slice invoke the underlying sources.
   */
  build(): RowSource<T> {
    const segments = this.segments.slice()
    const length = this.size
    const locate = (index: number): number => {
      let low = 0
      let high = segments.length
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if ((segments[middle] as (typeof segments)[number]).end <= index) low = middle + 1
        else high = middle
      }
      return low
    }
    const offset = (index: number): number => Math.min(length, Math.max(0, index < 0 ? length + Math.trunc(index) : Math.trunc(index)))
    return Object.freeze({
      length,
      at(index: number): T | undefined {
        const integer = Math.trunc(index)
        const absolute = integer < 0 ? length + integer : integer
        if (absolute < 0 || absolute >= length) return undefined
        const segment = segments[locate(absolute)] as (typeof segments)[number]
        return segment.rows.at(absolute - segment.start)
      },
      slice(start = 0, end = length): T[] {
        const first = offset(start)
        const last = offset(end)
        const out: T[] = []
        for (let index = locate(first); index < segments.length; index += 1) {
          const segment = segments[index] as (typeof segments)[number]
          if (segment.start >= last) break
          for (const row of segment.rows.slice(Math.max(0, first - segment.start), Math.min(segment.rows.length, last - segment.start))) {
            out.push(row)
          }
        }
        return out
      },
    })
  }
}
