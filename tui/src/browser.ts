/** One owner for bounded terminal catalogs and cancellable source reads. */
import { EMPTY_BROWSER_PANE, type BrowserPaneState, type BrowserRow } from '@deepseek-ai/dsh-tui-render'

export interface BrowserOptions {
  id: string
  title: string
  load(signal: AbortSignal): Promise<readonly BrowserRow[]>
  detail?(row: BrowserRow, signal: AbortSignal): Promise<string>
  actions?: readonly { key: string; label: string; run(row: BrowserRow, signal: AbortSignal): Promise<string | void> }[]
}
export class TerminalBrowser {
  private state: BrowserPaneState = EMPTY_BROWSER_PANE
  private options: BrowserOptions | undefined
  private abort = new AbortController()
  private work: Promise<void> = Promise.resolve()
  constructor(private readonly changed: () => void) {}
  get(): BrowserPaneState { return this.state }
  settled(): Promise<void> { return this.work }
  open(options: BrowserOptions): void {
    this.close()
    this.options = options
    this.state = { ...EMPTY_BROWSER_PANE, open: true, id: options.id, title: options.title,
      actions: options.actions?.map(({ key, label }) => ({ key, label })) ?? [] }
    this.refresh()
  }
  close(): void {
    this.abort.abort()
    this.abort = new AbortController()
    this.options = undefined
    this.state = EMPTY_BROWSER_PANE
  }
  private run(operation: (signal: AbortSignal) => Promise<Partial<BrowserPaneState> | void>): void {
    if (!this.state.open || this.state.busy) return
    const signal = this.abort.signal
    this.state = { ...this.state, busy: true, error: undefined }
    this.changed()
    this.work = (async () => {
      try {
        const patch = await operation(signal)
        if (signal.aborted) return
        this.state = { ...this.state, ...patch, busy: false }
      } catch (error: unknown) {
        if (signal.aborted) return
        this.state = { ...this.state, busy: false, error: error instanceof Error ? error.message : String(error) }
      }
      if (!signal.aborted) this.changed()
    })()
  }
  refresh(): void {
    const options = this.options
    if (options === undefined) return
    const selected = this.state.rows[this.state.selectedIndex]?.id
    this.run(async signal => {
      const rows = await options.load(signal)
      return { rows, selectedIndex: Math.max(0, rows.findIndex(row => row.id === selected)) }
    })
  }
  move(delta: number): void {
    if (!this.state.open || this.state.busy) return
    if (this.state.detail !== undefined) this.offset(Math.max(0, this.state.offset + delta))
    else { this.state = { ...this.state, selectedIndex: Math.max(0, Math.min(this.state.rows.length - 1, this.state.selectedIndex + delta)) };this.changed() }
  }
  offset(offset: number): void { this.state = { ...this.state, offset };this.changed() }
  enter(): void {
    const row = this.state.rows[this.state.selectedIndex]
    const detail = this.options?.detail
    if (row !== undefined && detail !== undefined) this.run(async signal => ({ detail: await detail(row, signal), offset: 0 }))
  }
  action(key: string): void {
    const action = this.options?.actions?.find(action => action.key === key)
    const row = this.state.rows[this.state.selectedIndex]
    if (row !== undefined && action !== undefined) this.run(async signal => {
      const detail = await action.run(row, signal)
      return detail === undefined ? undefined : { detail, offset: 0 }
    })
  }
  back(): void {
    if (this.state.detail !== undefined) this.state = { ...this.state, detail: undefined, offset: 0 }
    else this.close()
    this.changed()
  }
}
