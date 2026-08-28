import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  EMPTY_VIEW,
  OSC52_MAX_CHARS,
  type FrozenMessage,
  type ViewModel,
} from '@deepseek-ai/dsh-tui-render'
import { internals, RuntimeController } from '../src/index.ts'

const originalCopyText = internals.copyText

afterEach(() => {
  internals.copyText = originalCopyText
})

function row(id: number, text: string): FrozenMessage {
  return { id, kind: 'assistant', text, timestamp: id }
}

function bench(history: readonly FrozenMessage[]): {
  ctx: Context
  controller: RuntimeController
  output: string[]
} {
  const ctx = new Context()
  const output: string[] = []
  const controller = new RuntimeController(
    ctx,
    {
      stdout: { write: (chunk) => { output.push(chunk); return true } },
      stderr: { write: () => true },
      exit: () => {},
    },
    { task: '' },
    () => {},
  )
  const model: ViewModel = { ...EMPTY_VIEW, history }
  const state = controller as unknown as {
    agentHandle: { followup(message: never): void; cancel(): void }
    projector: { snapshot(): ViewModel }
  }
  state.agentHandle = { followup: () => {}, cancel: () => {} }
  state.projector = { snapshot: () => model }
  return { ctx, controller, output }
}

describe('RuntimeController copy-message', () => {
  it('reports the locked empty-state feedback without writing', async () => {
    const { ctx, controller } = bench([])
    const copy = vi.fn()
    internals.copyText = copy
    controller.dispatch({ kind: 'copy-message' })
    expect(copy).not.toHaveBeenCalled()
    expect(controller.getFeedback()).toBe('无消息可复制')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('copies and caps the latest message without reflecting model control bytes', async () => {
    const text = `\u001b[2J${'a'.repeat(OSC52_MAX_CHARS + 20)}`
    const { ctx, controller, output } = bench([row(1, text)])
    const copy = vi.fn((payload: string, write: (chunk: string) => void) => {
      write('OSC52-STUB')
      expect(payload.length).toBe(OSC52_MAX_CHARS)
    })
    internals.copyText = copy
    controller.dispatch({ kind: 'copy-message' })
    expect(copy).toHaveBeenCalledOnce()
    expect(output).toEqual(['OSC52-STUB'])
    expect(controller.getFeedback()).toBe('已复制最近消息')
    expect(controller.getFeedback()).not.toContain('\u001b')
    await controller.dispose()
    await ctx.fiber.dispose()
  })

  it('copies the final fenced body and leaves blocking queues unchanged', async () => {
    const { ctx, controller } = bench([
      row(1, 'text\n```ts\nconst copied = true\n```'),
    ])
    const copy = vi.fn()
    internals.copyText = copy
    const state = controller as unknown as {
      approvalQueue: unknown[]
      askUserQueue: unknown[]
    }
    const approval = {}
    const question = {}
    state.approvalQueue = [approval]
    state.askUserQueue = [question]
    controller.dispatch({ kind: 'copy-message' })
    expect(copy).toHaveBeenCalledWith('const copied = true', expect.any(Function))
    expect(controller.getFeedback()).toBe('已复制代码块')
    expect(state.approvalQueue).toEqual([approval])
    expect(state.askUserQueue).toEqual([question])
    state.approvalQueue = []
    state.askUserQueue = []
    await controller.dispose()
    await ctx.fiber.dispose()
  })
})
