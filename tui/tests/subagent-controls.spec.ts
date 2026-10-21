import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { deliverSubagentPrompt, type HostPromptDeliverer } from '@deepseek-ai/dsh-subagent/internal'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { TerminalSubagentControls } from '../src/subagent-controls.ts'

const ROW = { id: SessionId('child'), parentSessionId: SessionId('direct-parent'), mode: 'continuable' as const }

function fixture() {
  const ctx = new Context()
  const prompt = vi.fn<SubagentRuntime['prompt']>().mockResolvedValue({ messageId: 'accepted' as MessageId })
  const interrupt = vi.fn<SubagentRuntime['interrupt']>()
  ctx.provide('subagents', { prompt, interrupt } as unknown as SubagentRuntime)
  const changed = vi.fn()
  return { controls: new TerminalSubagentControls(ctx, changed), prompt, interrupt, changed }
}

describe('terminal human subagent controls', () => {
  it('reaches the real DSH prompt admission and records a human user source', async () => {
    const ctx = new Context()
    ctx.provide('workingDirectory', { get: () => '/fixture', ensure: async () => '/fixture' } as never)
    ctx.provide('agents', { get: (id: string) => id === ROW.parentSessionId
      ? { id, status: 'idle', session: { header: { createdAt: 1 } } } : undefined } as never)
    await ctx.plugin(SubagentRuntime)
    const delivered = vi.spyOn(ctx.subagents as unknown as HostPromptDeliverer, deliverSubagentPrompt)
      .mockResolvedValue('real-admission' as MessageId)
    const controls = new TerminalSubagentControls(ctx, () => {})
    try {
      controls.compose(ROW)
      controls.edit('human followup', 14)
      await controls.submit(ROW, 'steer')
      expect(controls.get().error).toBeUndefined()
      expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ id: ROW.parentSessionId }), ROW.id,
        [{ type: 'text', text: 'human followup' }],
        { kind: 'user', rpcId: expect.any(String) }, expect.any(AbortSignal), 'steer')
    } finally { controls.close();await ctx.fiber.dispose() }
  })

  it.each(['queue', 'steer'] as const)('uses the official human prompt request with exact direct-parent address for %s', async delivery => {
    const f = fixture()
    f.controls.compose(ROW)
    f.controls.edit('继续\n审查', 5)
    await f.controls.submit(ROW, delivery)
    expect(f.prompt).toHaveBeenCalledWith(expect.objectContaining({
      requestId: expect.any(String), parentSessionId: ROW.parentSessionId, childSessionId: ROW.id,
      mode: 'continuable', delivery, content: [{ type: 'text', text: '继续\n审查' }],
    }), expect.any(AbortSignal))
    expect(f.controls.get().busy).toBe(false)
    expect(f.controls.get().prompt).toBeUndefined()
    expect(f.controls.get().notice).toContain('已接收')
  })

  it('refuses missing parent, unknown mode, one-shot, external and self addresses', async () => {
    const f = fixture()
    for (const row of [
      { id: ROW.id, mode: ROW.mode }, { id: ROW.id, parentSessionId: ROW.parentSessionId },
      { ...ROW, mode: 'one-shot' as const }, { ...ROW, mode: 'external' as const },
      { ...ROW, parentSessionId: ROW.id },
    ]) {
      f.controls.compose(row)
      f.controls.edit('continue', 8)
      await f.controls.submit(row, 'queue')
      expect(f.controls.get().error).toBeTruthy()
    }
    expect(f.prompt).not.toHaveBeenCalled()
  })

  it('requires the same composed child and parent and refuses empty or repeated submissions', async () => {
    const f = fixture()
    let finish!: (value: { messageId: MessageId }) => void
    f.prompt.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.controls.compose(ROW)
    await f.controls.submit(ROW, 'queue')
    expect(f.prompt).not.toHaveBeenCalled()
    f.controls.edit('continue', 8)
    await f.controls.submit({ ...ROW, parentSessionId: SessionId('other') }, 'queue')
    expect(f.prompt).not.toHaveBeenCalled()
    const pending = f.controls.submit(ROW, 'queue')
    expect(f.controls.get().busy).toBe(true)
    await f.controls.submit(ROW, 'steer')
    expect(f.prompt).toHaveBeenCalledTimes(1)
    finish({ messageId: 'accepted' as MessageId })
    await pending
  })

  it.each(['close', 'compose'] as const)('aborts and ignores an old receipt after %s', async action => {
    const f = fixture()
    let finish!: (value: { messageId: MessageId }) => void
    f.prompt.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.controls.compose(ROW)
    f.controls.edit('old draft', 9)
    const pending = f.controls.submit(ROW, 'queue')
    const signal = f.prompt.mock.calls[0]?.[1]
    if (action === 'close') f.controls.close()
    else { f.controls.compose({ ...ROW, id: SessionId('new-child') });f.controls.edit('new draft', 9) }
    const snapshot = f.controls.get()
    const changes = f.changed.mock.calls.length
    finish({ messageId: 'late' as MessageId })
    await pending
    expect(signal?.aborted).toBe(true)
    expect(f.controls.get()).toBe(snapshot)
    expect(f.changed).toHaveBeenCalledTimes(changes)
  })

  it('preserves a rejected draft and exposes the service ownership refusal without reporting delivery', async () => {
    const f = fixture()
    f.prompt.mockRejectedValue(new Error('subagent belongs to another parent'))
    f.controls.compose(ROW)
    f.controls.edit('preserve me', 3)
    await f.controls.submit(ROW, 'steer')
    expect(f.controls.get()).toMatchObject({ prompt: 'preserve me', caretIndex: 3, busy: false })
    expect(f.controls.get().error).toContain('another parent')
    expect(f.controls.get().notice).toBeUndefined()
  })

  it('requests Stop with human direct-parent authority without claiming execution has stopped', () => {
    const f = fixture()
    f.controls.stop(ROW)
    expect(f.interrupt).toHaveBeenCalledWith(ROW.id, { kind: 'user', parentSessionId: ROW.parentSessionId })
    expect(f.controls.get().notice).toContain('已请求停止')
    expect(f.controls.get()).not.toHaveProperty('activity')
    expect(f.controls.get()).not.toHaveProperty('execution')
    f.controls.toggleSplit()
    expect(f.controls.get().split).toBe(true)
    f.controls.close()
    expect(f.controls.get().split).toBe(false)
  })

  it('returns to full width before composing so the existing terminal caret stays correct', () => {
    const f = fixture()
    f.controls.toggleSplit()
    expect(f.controls.get().split).toBe(true)
    f.controls.compose(ROW)
    expect(f.controls.get()).toMatchObject({ split: false, prompt: '', busy: false })
  })

  it('ignores a late rejection after cancellation without replacing the closed snapshot', async () => {
    const f = fixture()
    let reject!: (reason: unknown) => void
    f.prompt.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    f.controls.compose(ROW)
    f.controls.edit('old draft', 9)
    const pending = f.controls.submit(ROW, 'queue')
    f.controls.close()
    const snapshot = f.controls.get()
    const changes = f.changed.mock.calls.length
    reject(new Error('late rejection'))
    await pending
    expect(f.controls.get()).toBe(snapshot)
    expect(f.changed).toHaveBeenCalledTimes(changes)
  })

  it('does not make a pending request editable when a bad Stop address is rejected', async () => {
    const f = fixture()
    let finish!: (value: { messageId: MessageId }) => void
    f.prompt.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.controls.compose(ROW)
    f.controls.edit('pending', 7)
    const pending = f.controls.submit(ROW, 'queue')
    f.controls.stop({ id: ROW.id })
    expect(f.controls.get().busy).toBe(true)
    f.controls.edit('must not replace pending', 3)
    expect(f.controls.get().prompt).toBe('pending')
    finish({ messageId: 'accepted' as MessageId })
    await pending
  })

  it('refuses a Stop address without a parent and reports a missing service', async () => {
    const f = fixture()
    f.controls.stop({ id: ROW.id })
    expect(f.interrupt).not.toHaveBeenCalled()
    const controls = new TerminalSubagentControls(new Context(), () => {})
    controls.compose(ROW)
    controls.edit('continue', 8)
    await controls.submit(ROW, 'queue')
    expect(controls.get().error).toContain('未组合')
  })
})
