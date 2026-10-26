/** One finite queue at the physical terminal boundary, shared by every writer. */
export const MAX_PENDING_OUTPUT_BYTES = 4 * 1024 * 1024
export const MAX_PENDING_OUTPUT_WRITES = 256
export const OUTPUT_TRACE_CAPACITY = 128
export type OutputSource = 'ink' | 'transcript' | 'caret' | 'selection' | 'notify' | 'clipboard' | 'lifecycle'
type Callback = (error?: Error | null) => void
interface PendingWrite {
  bytes: string
  source: OutputSource
  callback?: Callback
}
export interface OutputContext {
  columns?: number | undefined
  rows?: number | undefined
  parserPendingBytes?: number
  sequenceOpen?: boolean
  caret?: { readonly row: number; readonly col: number } | 'hide' | undefined
}
export interface OutputTrace extends OutputContext {
  sequence: number
  source: OutputSource
  bytes: number
  pendingBytes: number
  state: 'accepted' | 'written' | 'failed' | 'coalesced'
  synchronized: boolean
  at: number
}

export class TerminalOutput {
  private queue: PendingWrite[] = []
  private queuedBytes = 0
  private blocked = false
  private closed = false
  private sequence = 0
  private traces: OutputTrace[] = []
  private afterDrain = new Map<string, () => void>()
  private readonly drain = (): void => {
    this.blocked = false
    this.flush()
  }
  private readonly failure = (error: Error): void => {
    this.onError()
    const pending = this.queue
    this.queue = []
    this.queuedBytes = 0
    this.afterDrain.clear()
    for (const job of pending) { this.record(job, 'failed'); job.callback?.(error) }
    if (this.closed) this.detach()
  }
  constructor(private readonly stream: NodeJS.WriteStream, private readonly onError: () => void,
    private readonly context: () => OutputContext = () => ({})) {
    stream.on?.('drain', this.drain)
    stream.on?.('error', this.failure)
  }

  get pressured(): boolean { return this.blocked }
  get pendingBytes(): number { return this.queuedBytes }
  snapshot(): { pendingBytes: number; pendingWrites: number; pressured: boolean; bundle: string; trace: readonly OutputTrace[] } {
    return { pendingBytes: this.queuedBytes, pendingWrites: this.queue.length, pressured: this.blocked, bundle: import.meta.url, trace: [...this.traces] }
  }

  /** Lazy absolute overlays can be replaced before they ever mutate paint state. */
  latest(key: string, paint: () => void): void {
    if (this.closed) return
    if (!this.blocked && this.queue.length === 0) { paint(); return }
    if (!this.afterDrain.has(key) && this.afterDrain.size >= 16) throw new Error('TUI deferred paint budget exceeded')
    this.afterDrain.set(key, paint)
  }

  write(bytes: string, source: OutputSource, callback?: Callback): boolean {
    if (this.closed) {
      const error = new Error('TUI terminal output is closed')
      callback?.(error)
      return false
    }
    const job: PendingWrite = { bytes, source, ...(callback === undefined ? {} : { callback }) }
    if (!this.blocked && this.queue.length === 0) return this.send(job)
    const size = Buffer.byteLength(bytes)
    if (size + this.queuedBytes > MAX_PENDING_OUTPUT_BYTES || this.queue.length >= MAX_PENDING_OUTPUT_WRITES) {
      const error = new Error('TUI terminal output backlog exceeded its finite budget')
      this.record(job, 'failed')
      this.onError()
      callback?.(error)
      // Refuse instead of silently discarding an incremental Ink transaction.
      // The runtime's error path can tear down without corrupting its session.
      throw error
    }
    this.queue.push(job)
    this.queuedBytes += size
    this.record(job, 'accepted')
    return false
  }

  private record(job: PendingWrite, state: OutputTrace['state']): void {
    this.traces.push({ ...this.context(), sequence: ++this.sequence, source: job.source,
      bytes: Buffer.byteLength(job.bytes), pendingBytes: this.queuedBytes, state,
      synchronized: job.bytes.includes('\x1b[?2026h') || job.bytes.includes('\x1b[?2026l'), at: performance.now() })
    if (this.traces.length > OUTPUT_TRACE_CAPACITY) this.traces.shift()
  }

  private send(job: PendingWrite): boolean {
    try {
      const accepted = this.stream.write(job.bytes, (error?: Error | null) => {
        if (error) this.onError()
        this.record(job, error ? 'failed' : 'written')
        job.callback?.(error)
      })
      if (!accepted) this.blocked = true
      return accepted
    } catch (error) {
      this.record(job, 'failed')
      this.onError()
      throw error
    }
  }

  private flush(): void {
    while (!this.blocked && this.queue.length > 0) {
      const job = this.queue.shift() as PendingWrite
      this.queuedBytes -= Buffer.byteLength(job.bytes)
      this.send(job)
    }
    if (!this.blocked && this.queue.length === 0) {
      for (const [key, paint] of this.afterDrain) {
        this.afterDrain.delete(key)
        paint()
        if (this.blocked) break
      }
    }
    if (this.closed && this.queue.length === 0) this.detach()
  }

  dispose(): void {
    this.closed = true
    this.afterDrain.clear()
    // Mandatory accepted lifecycle/Ink bytes remain ordered until drain.
    if (this.queue.length === 0) this.detach()
  }

  private detach(): void {
    this.stream.off?.('drain', this.drain)
    this.stream.off?.('error', this.failure)
  }
}

interface RegisteredOutput {
  control: (bytes: string, source: OutputSource) => boolean
  output: TerminalOutput
  defer?: (key: string, paint: () => void) => boolean
}
const outputs = new WeakMap<object, RegisteredOutput>()

export function registerTerminalOutput(stream: NodeJS.WriteStream, value: RegisteredOutput): () => void {
  outputs.set(stream, value)
  return () => { if (outputs.get(stream) === value) outputs.delete(stream) }
}

/** Route side-channel writes through the mount's physical queue when present. */
export function writeTerminalControl(stream: { write(chunk: string): boolean }, bytes: string, source: OutputSource): boolean {
  const output = outputs.get(stream)
  return output === undefined ? stream.write(bytes) : output.control(bytes, source)
}

export function terminalOutputSnapshot(stream: NodeJS.WriteStream): ReturnType<TerminalOutput['snapshot']> | undefined {
  return outputs.get(stream)?.output.snapshot()
}

export function aliasTerminalOutput(source: NodeJS.WriteStream, alias: NodeJS.WriteStream): () => void {
  const output = outputs.get(source)
  return output === undefined ? () => {} : registerTerminalOutput(alias, output)
}

/** Return true when the caller should defer constructing a disposable overlay. */
export function deferTerminalPaint(stream: NodeJS.WriteStream, key: string, paint: () => void): boolean {
  const registered = outputs.get(stream)
  if (registered?.defer?.(key, paint)) return true
  const output = registered?.output
  if (output === undefined || !output.pressured) return false
  output.latest(key, paint)
  return true
}
