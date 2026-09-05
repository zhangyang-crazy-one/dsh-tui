/**
 * Fake TTY streams for Ink component tests: PassThrough instances carrying the
 * seam Ink's useStdin touches on mount. The plumbing lives in a .ts module
 * because oxlint's type-aware .tsx program cannot resolve node:stream module
 * types (the repo's tsx facade config is not a TS program), so specs import
 * only the structural interfaces below.
 */

import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { wrapStdoutForFrameBg } from '../src/frame-fill.ts'
import type { ColorTier } from '../src/terminal-capabilities.ts'

/**
 * Remove terminal controls without exposing Node declarations to TSX test programs.
 * @param text - captured terminal output.
 * @returns printable text without ANSI sequences.
 */
export function stripTerminalControls(text: string): string {
  return stripVTControlCharacters(text)
}

/** The stdin seam Ink's input parser attaches to. */
export interface FakeTtyStdin {
  isTTY: boolean
  setRawMode(mode: boolean): void
  ref(): void
  unref(): void
  push(chunk: string): boolean
}

/** The stdout seam Ink writes frames to. */
export interface FakeTtyStdout {
  write(chunk: string): boolean
  /**
   * Ink's interactive write path attaches data/resize listeners; the fake
   * is a real PassThrough, so the event emitter seam is part of the type.
   * The payload is typed as string (the repo's tsx facade cannot resolve
   * node:stream/Buffer types in oxlint's type-aware program).
   */
  on(event: 'data', listener: (chunk: string) => void): void
}

/** A TTY-shaped stdin Ink can attach its input parser to. */
export function fakeTtyStdin(): FakeTtyStdin {
  const stream = new PassThrough() as unknown as FakeTtyStdin
  stream.isTTY = true
  stream.setRawMode = () => {}
  stream.ref = () => {}
  stream.unref = () => {}
  return stream
}

/** A writable stdout Ink can flush frames to. */
export function fakeTtyStdout(): FakeTtyStdout {
  return new PassThrough()
}

/**
 * Attach production frame painting while keeping Node stream types out of TSX tests.
 * @param stdout - the owned PassThrough-backed fake TTY.
 * @param getTier - optional frame color tier.
 * @returns the wrapped stream with the same fake TTY interface.
 */
export function frameTtyStdout(stdout: FakeTtyStdout, getTier?: () => ColorTier): FakeTtyStdout {
  return wrapStdoutForFrameBg(stdout as unknown as NodeJS.WriteStream, getTier)
}
