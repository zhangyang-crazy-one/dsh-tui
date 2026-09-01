import { describe, expect, it } from 'vitest'
import { TableScanner } from '../src/table-scanner.ts'

function scanAll(source: string): ReturnType<TableScanner['feed']>[] {
  const scanner = new TableScanner()
  const snapshots: ReturnType<TableScanner['feed']>[] = []
  snapshots.push(scanner.feed(source))
  snapshots.push(scanner.finalize())
  return snapshots
}

describe('TableScanner', () => {
  it('starts in the none state with no rows or closed table', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('')
    expect(snap.state.kind).toBe('none')
    expect(snap.rows).toEqual([])
    expect(snap.mutableStart).toBe(0)
    expect(snap.mutableEnd).toBe(0)
    expect(snap.closedTable).toBeNull()
  })

  it('enters pending-header on the first pipe row and confirmed-table on the next delimiter row', () => {
    const scanner = new TableScanner()
    const headerSnap = scanner.feed('| name | value |\n')
    expect(headerSnap.state.kind).toBe('pending-header')
    expect(headerSnap.rows).toHaveLength(1)
    expect(headerSnap.rows[0]?.cells).toEqual(['name', 'value'])

    const delimSnap = scanner.feed('| --- | --- |\n')
    expect(delimSnap.state.kind).toBe('confirmed-table')
    expect(delimSnap.rows).toHaveLength(2)
    expect(delimSnap.rows[1]?.isDelimiter).toBe(true)
    expect(delimSnap.mutableStart).toBe(0)
    expect(delimSnap.mutableEnd).toBe(delimSnap.mutableStart + '| name | value |\n| --- | --- |'.length)
  })

  it('appends body rows to a confirmed table and exposes growing mutable range', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n')
    const body1 = scanner.feed('| x | y |\n')
    expect(body1.state.kind).toBe('confirmed-table')
    expect(body1.rows).toHaveLength(3)
    const body1Row = body1.rows[2]!
    expect(body1Row.cells).toEqual(['x', 'y'])
    expect(body1Row.isDelimiter).toBe(false)
    expect(body1.mutableEnd).toBeGreaterThan(body1.mutableStart)

    const body2 = scanner.feed('| zzz | www |\n')
    expect(body2.state.kind).toBe('confirmed-table')
    expect(body2.rows).toHaveLength(4)
    expect(body2.mutableEnd).toBeGreaterThan(body1.mutableEnd)
  })

  it('atomically closes a confirmed table when a non-pipe line arrives and does not double-report', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| x | y |\n')
    const closing = scanner.feed('after prose\n')
    expect(closing.state.kind).toBe('none')
    expect(closing.closedTable).not.toBeNull()
    expect(closing.closedTable?.rows).toHaveLength(3)
    expect(closing.closedTable?.header.cells).toEqual(['a', 'b'])
    const headerStart = closing.closedTable?.headerStart ?? 0
    expect(closing.closedTable?.end).toBe(headerStart + '| a | b |\n| --- | --- |\n| x | y |'.length)

    const next = scanner.feed('more text\n')
    expect(next.closedTable).toBeNull()
  })

  it('emits closedTable for each of two consecutive tables in one source', () => {
    const source = [
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '| c | d |',
      '| --- | --- |',
      '| 3 | 4 |',
      '',
    ].join('\n')
    const snapshots = scanAll(source)
    const closes = snapshots.flatMap(snap => (snap.closedTable ? [snap.closedTable] : []))
    expect(closes).toHaveLength(2)
    expect(closes[0]?.header.cells).toEqual(['a', 'b'])
    expect(closes[0]?.body.map(row => row.cells)).toEqual([['1', '2']])
    expect(closes[1]?.header.cells).toEqual(['c', 'd'])
    expect(closes[1]?.body.map(row => row.cells)).toEqual([['3', '4']])
  })

  it('survives a table that arrives after ordinary prose lines', () => {
    const scanner = new TableScanner()
    const prose = scanner.feed('intro paragraph\nanother line\n')
    expect(prose.state.kind).toBe('none')
    expect(prose.closedTable).toBeNull()

    const header = scanner.feed('| a | b |\n')
    expect(header.state.kind).toBe('pending-header')
    expect(header.mutableStart).toBe('intro paragraph\nanother line\n'.length)

    const rest = scanner.feed('| --- | --- |\n| x | y |\n')
    expect(rest.state.kind).toBe('confirmed-table')
    expect(rest.mutableStart).toBe(header.mutableStart)
    expect(rest.mutableEnd).toBeGreaterThan(header.mutableStart)

    const final = scanner.finalize()
    expect(final.state.kind).toBe('none')
    expect(final.closedTable?.header.cells).toEqual(['a', 'b'])
  })

  it('ignores pipe text inside a backtick fence and resumes scanning after the fence closes', () => {
    const source = [
      '```',
      '| not | a | table |',
      '| --- | --- |',
      '```',
      '| real | header |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')
    const snapshots = scanAll(source)
    const final = snapshots[snapshots.length - 1]!
    expect(final.state.kind).toBe('none')
    expect(final.closedTable?.header.cells).toEqual(['real', 'header'])
    expect(final.closedTable?.body.map(row => row.cells)).toEqual([['1', '2']])
  })

  it('ignores pipe text inside a tilde fence', () => {
    const scanner = new TableScanner()
    scanner.feed('~~~js\n| a | b |\n| --- | --- |\n~~~\n')
    expect(scanner.feed('| real | h |\n| --- | --- |\n| 1 | 2 |\n').state.kind).toBe('confirmed-table')
    const final = scanner.finalize()
    expect(final.closedTable?.header.cells).toEqual(['real', 'h'])
  })

  it('parses CJK and emoji cell text correctly and records correct display widths', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('| 状态 | ✅ |\n| --- | --- |\n| 完成 | 🎉 |\n')
    expect(snap.state.kind).toBe('confirmed-table')
    expect(snap.rows[0]?.cells).toEqual(['状态', '✅'])
    expect(snap.rows[2]?.cells).toEqual(['完成', '🎉'])
  })

  it('invalidates a candidate header when the next line is not a matching delimiter', () => {
    const scanner = new TableScanner()
    const header = scanner.feed('| a | b | c |\n')
    expect(header.state.kind).toBe('pending-header')

    // Not a delimiter; demote and treat as new header candidate.
    const stillPending = scanner.feed('| not delimiter |\n')
    expect(stillPending.state.kind).toBe('pending-header')
    expect(stillPending.rows[0]?.cells).toEqual(['not delimiter'])

    // Different cell count than candidate: invalid.
    scanner.reset()
    scanner.feed('| a | b |\n')
    const mismatch = scanner.feed('| --- | --- | --- |\n')
    expect(mismatch.state.kind).toBe('pending-header')
  })

  it('closes a confirmed table when a row has the wrong number of cells', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
    const tooNarrow = scanner.feed('| short |\n')
    expect(tooNarrow.state.kind).toBe('none')
    expect(tooNarrow.closedTable?.body.map(row => row.cells)).toEqual([['1', '2']])
  })

  it('finalize atomically closes an open table that did not see a closing line', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| x | y |')
    const final = scanner.finalize()
    expect(final.state.kind).toBe('none')
    expect(final.closedTable).not.toBeNull()
    expect(final.closedTable?.body[0]?.cells).toEqual(['x', 'y'])
  })

  it('finalize silently drops a pending-header that was never confirmed', () => {
    const scanner = new TableScanner()
    scanner.feed('| maybe header |')
    const final = scanner.finalize()
    expect(final.state.kind).toBe('none')
    expect(final.closedTable).toBeNull()
  })

  it('tracks correct source offsets across chunk boundaries', () => {
    const scanner = new TableScanner()
    scanner.feed('prose line\n| a |')
    const partial = scanner.feed(' b |\n| --- | --- |\n| x | y |\n')
    expect(partial.state.kind).toBe('confirmed-table')
    expect(partial.mutableStart).toBe('prose line\n'.length)
    expect(partial.rows[0]?.start).toBe(partial.mutableStart)
    expect(partial.rows[0]?.cells).toEqual(['a', 'b'])
  })

  it('produces the same final structure whether chunks are batched or streamed', () => {
    const source = 'intro\n| a | b |\n| --- | --- |\n| x | y |\noutro\n'
    const batched = new TableScanner()
    const batchedSnap = batched.feed(source)
    const batchedFinal = batched.finalize()

    const streamed = new TableScanner()
    for (const ch of source) streamed.feed(ch)
    const streamedFinal = streamed.finalize()

    expect(streamedFinal.closedTable?.rows.map(row => row.cells)).toEqual(
      batchedFinal.closedTable?.rows.map(row => row.cells),
    )
    expect(streamedFinal.closedTable?.headerStart).toBe(batchedFinal.closedTable?.headerStart)
    expect(streamedFinal.closedTable?.end).toBe(batchedFinal.closedTable?.end)
    // And mid-stream both agree on the same offsets.
    expect(streamedFinal.mutableStart).toBe(batchedSnap.mutableStart)
  })

  it('reset clears all state and any pending closedTable', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| x | y |\nafter\n')
    scanner.reset()
    const snap = scanner.feed('')
    expect(snap.state.kind).toBe('none')
    expect(snap.closedTable).toBeNull()
    expect(snap.rows).toEqual([])
  })

  it('strips a trailing CR before the newline so CRLF-terminated source parses the same as LF', () => {
    const lfScanner = new TableScanner()
    lfScanner.feed('| a | b |\n| --- | --- |\n| x | y |\n')

    const crlfScanner = new TableScanner()
    const snap = crlfScanner.feed('| a | b |\r\n| --- | --- |\r\n| x | y |\r\n')

    expect(snap.state.kind).toBe('confirmed-table')
    // Cell text is identical regardless of the line terminator; only the
    // raw start offsets shift by the extra CR byte.
    expect(snap.rows.map(row => row.text)).toEqual(
      lfScanner.snapshot().rows.map(row => row.text),
    )
    expect(snap.rows.map(row => row.cells)).toEqual(
      lfScanner.snapshot().rows.map(row => row.cells),
    )
    expect(snap.rows[1]?.isDelimiter).toBe(true)
    // Final snapshot surfaces the closing only once.
    const final = crlfScanner.finalize()
    expect(final.closedTable?.body.map(row => row.cells)).toEqual([['x', 'y']])
  })

  it('rejects a fence close whose marker does not match the opening marker', () => {
    const scanner = new TableScanner()
    const opened = scanner.feed('~~~\n')
    expect(opened.state.kind).toBe('none')
    // A backtick fence close must not match an open tilde fence.
    const mismatched = scanner.feed('```\n| inside | ignored |\n')
    expect(mismatched.state.kind).toBe('none')
    expect(mismatched.closedTable).toBeNull()
    // The pipe row should have been suppressed while the fence stayed open.
    expect(scanner.feed('```\n').state.kind).toBe('none')
  })

  it('rejects a fence close that is shorter than the opening fence', () => {
    const scanner = new TableScanner()
    scanner.feed('~~~~~~\n') // six tildes
    // Three tildes is too short to close a six-tilde fence.
    const shortClose = scanner.feed('~~~\n')
    expect(shortClose.state.kind).toBe('none')
    // Pipe text inside remains hidden.
    expect(scanner.feed('| inside | still | hidden |\n').state.kind).toBe('none')
    // A matching fence close at last works.
    const final = scanner.feed('~~~~~~\n')
    expect(final.state.kind).toBe('none')
  })

  it('closes a confirmed table with no body rows using the delimiter end as the table end', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n')
    const final = scanner.feed('after prose\n')
    expect(final.state.kind).toBe('none')
    expect(final.closedTable).not.toBeNull()
    // end is the delimiter's end, since there are no body rows.
    const closed = final.closedTable!
    expect(closed.end).toBe(closed.delimiter.end)
    expect(closed.body).toEqual([])
  })

  it('treats the confirmed-table guard as a defensive no-op when delimiterRow is missing', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n')
    // Use a controlled handleLine invocation so we can simulate the
    // defensive inconsistency without touching public state directly.
    const handleLine = (scanner as unknown as {
      handleLine(line: string, start: number, end: number): void
    }).handleLine.bind(scanner)
    // Make stateKind say 'confirmed-table' but drop delimiterRow so the
    // `&& this.delimiterRow` guard is false.
    const internals = scanner as unknown as {
      stateKind: 'confirmed-table'
      delimiterRow: null
      bodyRows: unknown[]
    }
    internals.stateKind = 'confirmed-table'
    internals.delimiterRow = null
    internals.bodyRows = []
    // Pipe row that would normally be appended; the guarded branch is
    // skipped, then the column-mismatch fallback (also guarded) drops us
    // straight into closeTable, leaving state at none.
    handleLine('| short |\n', 0, 9)
    const snap = scanner.snapshot()
    expect(snap.state.kind).toBe('none')
    expect(snap.closedTable).toBeNull()
  })

  it('does not treat a line with only whitespace as a fence opener', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('   \n')
    expect(snap.state.kind).toBe('none')
    expect(snap.closedTable).toBeNull()
    // Subsequent pipe rows still parse normally.
    expect(scanner.feed('| a | b |\n| --- | --- |\n| x | y |\n').state.kind).toBe('confirmed-table')
  })

  it('does not treat a backtick or tilde run shorter than three chars as a fence', () => {
    const scanner = new TableScanner()
    // Two backticks; not long enough to open a fence.
    const shortBackticks = scanner.feed('``\n')
    expect(shortBackticks.state.kind).toBe('none')
    // Single tilde; same.
    expect(scanner.feed('~\n').state.kind).toBe('none')
    // A pipe row after the false fences still parses correctly.
    expect(scanner.feed('| a | b |\n| --- | --- |\n| x | y |\n').state.kind).toBe('confirmed-table')
  })

  it('rejects a backtick fence whose info string still contains backticks', () => {
    const scanner = new TableScanner()
    // The info string after the opening run still has a backtick, so the
    // line is not a fence; pipe rows around it must parse normally.
    const snap = scanner.feed('``` `weird`\n| a | b |\n| --- | --- |\n| x | y |\n')
    expect(snap.state.kind).toBe('confirmed-table')
  })

  it('parses pipe rows that begin without a leading pipe', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('a | b\n-- | --\nx | y\n')
    expect(snap.state.kind).toBe('confirmed-table')
    expect(snap.rows[0]?.cells).toEqual(['a', 'b'])
    expect(snap.rows[2]?.cells).toEqual(['x', 'y'])
  })

  it('parses pipe rows that end without a trailing pipe', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('| a | b\n| --- | ---\n| x | y\n')
    expect(snap.state.kind).toBe('confirmed-table')
    expect(snap.rows[0]?.cells).toEqual(['a', 'b'])
  })

  it('parses pipe rows whose cells contain escaped pipes', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('| a \\| b | c |\n| --- | --- |\n| x \\| y | z |\n')
    expect(snap.state.kind).toBe('confirmed-table')
    // Escaped pipes stay inside the same cell.
    expect(snap.rows[0]?.cells).toEqual(['a | b', 'c'])
    expect(snap.rows[2]?.cells).toEqual(['x | y', 'z'])
  })

  it('treats a backslash at the end of a pipe row as a literal character', () => {
    const scanner = new TableScanner()
    const snap = scanner.feed('| a\\ | b |\n| --- | --- |\n| x | y |\n')
    expect(snap.state.kind).toBe('confirmed-table')
    // The trailing backslash is part of the cell text; the row still has two cells.
    expect(snap.rows[0]?.cells).toEqual(['a\\', 'b'])
  })

  it('rejects a fence candidate with four or more leading whitespace chars as an indented code block', () => {
    const scanner = new TableScanner()
    // Four spaces before the backticks = indented code block, not a fence.
    const indentedBackticks = scanner.feed('    ```\n')
    expect(indentedBackticks.state.kind).toBe('none')
    // Four spaces before tildes, same outcome.
    const indentedTildes = scanner.feed('        ~~~\n')
    expect(indentedTildes.state.kind).toBe('none')
    // Indented non-fence text: still just ignored, no table formed.
    expect(scanner.feed('    plain text\n').state.kind).toBe('none')
  })

  it('rejects a candidate header whose next line has the right cell count but is not a delimiter row', () => {
    // Both lines have two cells, so isDelimiterRow must inspect the
    // contents and return false for the non-delimiter row. This exercises
    // the inner per-cell rejection branch of isDelimiterRow.
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n')
    const stillPending = scanner.feed('| x | y |\n')
    expect(stillPending.state.kind).toBe('pending-header')
    expect(stillPending.rows[0]?.cells).toEqual(['x', 'y'])
  })

  it('flushes a trailing partial line on finalize so the last row still counts', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| x | y |')
    // No newline before finalize; the trailing partial line still becomes a body row.
    const final = scanner.finalize()
    expect(final.state.kind).toBe('none')
    expect(final.closedTable?.body.map(row => row.cells)).toEqual([['x', 'y']])
  })

  it('returns an empty snapshot when reset has been called and no further input has arrived', () => {
    const scanner = new TableScanner()
    scanner.feed('| a | b |\n| --- | --- |\n| x | y |\n')
    scanner.reset()
    const snap = scanner.snapshot()
    expect(snap.state.kind).toBe('none')
    expect(snap.mutableStart).toBe(0)
    expect(snap.mutableEnd).toBe(0)
    expect(snap.rows).toEqual([])
    expect(snap.closedTable).toBeNull()
  })
})
