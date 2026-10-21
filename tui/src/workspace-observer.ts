/** Bounded directory watching with coalesced refresh and late-init cleanup. */
export class WorkspaceObserver<Target> {
  private abort = new AbortController()
  private closes: (() => Promise<void>)[] = []
  private pending: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly changed: () => void, private readonly failed: (reason: string) => void) {}
  settled(): Promise<void> { return this.pending }
  observe(targets: readonly Target[], watch: (target: Target, changed: (error?: Error) => void, signal: AbortSignal) => Promise<() => Promise<void>>): void {
    this.close()
    const signal = this.abort.signal
    if (targets.length > 128) this.failed('目录较多：仅自动监控前 128 个展开目录，r 可手动刷新')
    const jobs = targets.slice(0, 128).map(async target => {
      try {
        const close = await watch(target, error => {
          if (signal.aborted) return
          if (error !== undefined) { this.failed(error.message);return }
          if (this.timer !== undefined) return
          this.timer = setTimeout(() => { this.timer = undefined;if (!signal.aborted) this.changed() }, 200)
          this.timer.unref?.()
        }, signal)
        if (signal.aborted) await close()
        else this.closes.push(close)
      } catch (error: unknown) {
        if (!signal.aborted) this.failed(`自动刷新不可用：${error instanceof Error ? error.message : String(error)} · r 手动重试`)
      }
    })
    this.pending = Promise.allSettled([this.pending, ...jobs]).then(() => {})
  }
  close(): void {
    this.abort.abort()
    this.abort = new AbortController()
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const closes = this.closes.splice(0)
    this.pending = Promise.allSettled([this.pending, ...closes.map(close => close())]).then(results => {
      for (const result of results) if (result.status === 'rejected') this.failed(`关闭目录监控失败：${String(result.reason)}`)
    })
  }
}
