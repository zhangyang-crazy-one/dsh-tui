import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  EMPTY_VIEW,
  OSC52_MAX_CHARS,
  type FrozenMessage,
  type ViewModel,
} from '@deepseek-ai/dsh-tui-render'
import { internals, RuntimeController } from '../src/index.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalCopyText = internals.copyText

afterEach(() => {
  internals.copyText = originalCopyText
})

function row(id: number, text: string): FrozenMessage {
  return { id, kind: 'assistant', text, timestamp: id }
}

function bench(history: readonly FrozenMessage[], cwd?: string): {
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
    { task: '', ...(cwd === undefined ? {} : { cwd }) },
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
  it('pages through a full tool result, keeps metadata explicit, and copies/exports the original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tool-source-'))
    const callId = ToolCallId('source-reader')
    const result = Array.from({ length: 5001 }, (_, index) => `result-${index}`).join('\n')
    const message: FrozenMessage = { ...row(1, 'done'), content: [
      { kind: 'tool-call', callId, name: 'generic', arguments: '{}' },
      { kind: 'tool-result', callId, isError: true, text: result, meta: { stdout: 'result-0', diagnosticId: 'unit' } },
    ] }
    const { ctx, controller } = bench([message], root)
    const copy = vi.fn<(text: string) => void>()
    internals.copyText = copy
    const input = (value: import('@deepseek-ai/dsh-tui-render').ToolDetailsInput) =>{  controller.dispatch({ kind: 'tool-details', input: value, width: 80, pageRows: 40 }) }
    try {
      controller.dispatch({ kind: 'command', query: 'tools' })
      expect(controller.getToolDetailsPane()).toMatchObject({ open: true, detail: false, diagnostics: false })
      expect(controller.getToolDetailsPane().cards).toHaveLength(1)
      input('select')
      for (let page = 0; page < 130; page += 1) input('next')
      expect(controller.getToolDetailsPane().cursor.line).toBeGreaterThan(4980)
      input('previous')
      expect(controller.getToolDetailsPane().cursor.line).toBeLessThan(4980)
      input('copy')
      const copied: string = copy.mock.calls[0]![0]
      expect(copied).toContain(result)
      expect(copied).not.toContain('stdout')
      input('export')
      await expect.poll(async () => (await readdir(root)).length).toBe(1)
      const path = join(root, (await readdir(root))[0]!)
      await expect.poll(() => readFile(path, 'utf8')).toBe(copied)
      input('diagnostics')
      expect(controller.getToolDetailsPane()).toMatchObject({ diagnostics: true, page: 0, cursor: { line: 0, offset: 0 } })
      input('copy')
      expect(copy.mock.calls[1]![0]).toContain('stdout')
      input('back')
      expect(controller.getToolDetailsPane().detail).toBe(false)
      input('back')
      expect(controller.getToolDetailsPane().open).toBe(false)
      controller.dispatch({ kind: 'command', query: 'tools' })
      controller.dispatch({ kind: 'help-pane' })
      expect(controller.getToolDetailsPane().open).toBe(false)
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an oversized tool clipboard payload instead of silently truncating it', async () => {
    const callId = ToolCallId('large-tool-copy')
    const { ctx, controller } = bench([{ ...row(1, 'done'), content: [
      { kind: 'tool-call', callId, name: 'generic', arguments: '{}' },
      { kind: 'tool-result', callId, isError: false, text: 'x'.repeat(OSC52_MAX_CHARS + 1) },
    ] }])
    const copy = vi.fn()
    internals.copyText = copy
    try {
      controller.dispatch({ kind: 'command', query: 'tools' })
      controller.dispatch({ kind: 'tool-details', input: 'select', width: 80, pageRows: 20 })
      controller.dispatch({ kind: 'tool-details', input: 'copy', width: 80, pageRows: 20 })
      expect(copy).not.toHaveBeenCalled()
      expect(controller.getFeedback()).toContain('导出完整原文')
    } finally { await controller.dispose(); await ctx.fiber.dispose() }
  })
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
