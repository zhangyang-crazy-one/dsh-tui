/**
 * Map session-writer contention onto explicit TUI retry copy. Logs keep the
 * original diagnostic; the terminal never paints `SessionAlreadyOwnedError` or
 * `session/writer-held` as an unknown IO failure.
 * @module @deepseek-ai/dsh-tui/session-errors
 */

/** User-facing retry copy matching the Web `error.sessionInUse` string. */
export const SESSION_WRITER_HELD_COPY
  = '当前会话已被占用，可能是其他正在运行的 DSH 导致的（如其他 dsh web、桌面端），请退出其他正在运行的 DSH 后重试。'

/** Copy when Host summaries or comparisons vanish after Session dispose. */
export const SESSION_CHANGES_DISPOSED_COPY = '会话已释放，无法对比该文件'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a caught value is session-writer contention from persistence or the
 * Gateway `session/writer-held` RemoteError.
 * @param error - a caught value.
 * @returns true when another DSH instance owns the write handle.
 */
export function isSessionWriterHeld(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some(isSessionWriterHeld)
  }
  if (!isRecord(error)) return false
  if (error.name === 'SessionAlreadyOwnedError') return true
  if (error.code === 'session/writer-held') return true
  if (error.cause !== undefined && isSessionWriterHeld(error.cause)) return true
  return false
}

/**
 * Terminal copy for one caught failure. Writer contention becomes the retry
 * sentence; every other Error keeps its message.
 * @param error - a caught value.
 * @returns user-visible reason text without a `✗ ` prefix.
 */
export function userErrorReason(error: unknown): string {
  if (isSessionWriterHeld(error)) return SESSION_WRITER_HELD_COPY
  return error instanceof Error ? error.message : String(error)
}
