/** Human subagent controls; execution and direct-parent authorization stay with DSH. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentPromptRequestId } from '@deepseek-ai/dsh-subagent'

export interface TerminalSubagentAddress {
  id: SessionId
  parentSessionId?: SessionId | undefined
  mode?: 'continuable' | 'one-shot' | 'external' | undefined
}

export interface TerminalSubagentControlState {
  prompt?: string | undefined
  caretIndex?: number | undefined
  busy: boolean
  error?: string | undefined
  notice?: string | undefined
  split: boolean
}

/** One terminal editor owns only its draft and outstanding admission request. */
export class TerminalSubagentControls {
  private state: TerminalSubagentControlState = { busy: false, split: false }
  private target: TerminalSubagentAddress | undefined
  private abort: AbortController | undefined
  private generation = 0

  constructor(private readonly ctx: Context, private readonly changed: () => void) {}

  /** Stable snapshots are replaced only when an active operation changes the UI. */
  get(): TerminalSubagentControlState { return this.state }

  compose(row: TerminalSubagentAddress): void {
    this.invalidate()
    this.target = undefined
    if (!this.address(row, true)) {
      this.publish({ busy: false, split: this.state.split, error: this.state.error });return
    }
    this.target = { ...row }
    this.publish({ prompt: '', caretIndex: 0, busy: false, split: false })
  }

  edit(text: string, caret: number): void {
    if (this.target === undefined || this.state.busy) return
    this.publish({ ...this.state, prompt: text, caretIndex: Math.max(0, Math.min(caret, text.length)),
      error: undefined, notice: undefined })
  }

  async submit(row: TerminalSubagentAddress, delivery: 'queue' | 'steer'): Promise<void> {
    if (this.state.busy || !this.address(row, true)) return
    if (this.target?.id !== row.id || this.target.parentSessionId !== row.parentSessionId) {
      this.publish({ ...this.state, error: '续聊目标已改变，请重新选择子代理' });return
    }
    const text = this.state.prompt
    if (text === undefined || text.trim() === '') {
      this.publish({ ...this.state, error: '请输入续聊内容' });return
    }
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) {
      this.publish({ ...this.state, error: '子代理服务未组合' });return
    }
    this.invalidate()
    const generation = this.generation
    const abort = new AbortController()
    this.abort = abort
    this.publish({ ...this.state, busy: true, error: undefined, notice: undefined })
    try {
      // prompt is DSH's human endpoint: it mints source.kind=user and validates
      // the exact live direct parent before continuation admission/cold resume.
      await subagents.prompt({ requestId: randomUUID() as SubagentPromptRequestId,
        parentSessionId: row.parentSessionId, childSessionId: row.id,
        mode: 'continuable', delivery, content: [{ type: 'text', text }] }, abort.signal)
      if (generation !== this.generation || abort.signal.aborted) return
      this.target = undefined
      this.abort = undefined
      this.publish({ busy: false, split: this.state.split, notice: '子代理已接收续聊请求' })
    } catch (error: unknown) {
      if (generation !== this.generation || abort.signal.aborted) return
      this.abort = undefined
      this.publish({ ...this.state, busy: false, error: this.reason(error), notice: undefined })
    }
  }

  stop(row: TerminalSubagentAddress): void {
    if (!this.address(row, false)) return
    const subagents = this.ctx.get('subagents')
    if (subagents === undefined) { this.publish({ ...this.state, error: '子代理服务未组合' });return }
    try {
      subagents.interrupt(row.id, { kind: 'user', parentSessionId: row.parentSessionId })
      this.publish({ ...this.state, error: undefined, notice: '已请求停止，等待子代理状态事件' })
    } catch (error: unknown) {
      this.publish({ ...this.state, error: this.reason(error), notice: undefined })
    }
  }

  toggleSplit(): void { this.publish({ ...this.state, split: !this.state.split }) }

  close(): void {
    this.invalidate()
    this.target = undefined
    this.publish({ busy: false, split: false })
  }

  private address(row: TerminalSubagentAddress, continuable: boolean): row is TerminalSubagentAddress & { parentSessionId: SessionId } {
    if (row.id === '' || row.parentSessionId === undefined || row.parentSessionId === '' || row.parentSessionId === row.id
      || row.mode === undefined || continuable && row.mode !== 'continuable') {
      this.publish({ ...this.state, error: '子代理缺少直接父会话地址或不支持续聊' });return false
    }
    return true
  }

  private invalidate(): void { this.generation += 1;this.abort?.abort();this.abort = undefined }
  private publish(state: TerminalSubagentControlState): void { this.state = state;this.changed() }
  private reason(error: unknown): string { return error instanceof Error ? error.message : String(error) }
}
