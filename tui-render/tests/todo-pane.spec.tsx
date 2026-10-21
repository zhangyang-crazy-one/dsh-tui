import { createElement } from 'react'
import { render, renderToString } from 'ink'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TodoPane } from '../src/todo-pane.tsx'
import type { TodoHudItem } from '../src/todo-hud.tsx'
import { displayWidth, wrapDisplayLines } from '../src/content.ts'
import { disposeRenderer, fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

const windowSize = vi.hoisted(() => ({ columns: 80, rows: 24 }))
vi.mock('ink', async original => ({ ...await original<typeof import('ink')>(), useWindowSize: () => windowSize }))
vi.mock('../src/content.ts', async original => {
  const content = await original<typeof import('../src/content.ts')>()
  return { ...content, wrapDisplayLines: vi.fn(content.wrapDisplayLines) }
})
afterEach(() => { windowSize.columns = 80; windowSize.rows = 24; vi.clearAllMocks() })
function text(todos: readonly TodoHudItem[], offset = 0): string {
  return stripVTControlCharacters(renderToString(createElement(TodoPane, { todos, offset }), { columns: windowSize.columns }))
}

describe('TODO browser', () => {
  it('includes completed entries in original order with an explicit total', () => {
    const out = text([
      { content: 'First task', status: 'completed' },
      { content: 'Second task', status: 'in_progress' },
      { content: 'Third task', status: 'pending' },
    ])
    expect(out).toContain('共 3 项')
    expect(out).toContain('1. [已完成] First task')
    expect(out).toContain('2. [进行中] Second task')
    expect(out).toContain('3. [待办] Third task')
    expect(out.indexOf('First task')).toBeLessThan(out.indexOf('Second task'))
    expect(out).toContain('Esc 返回')
  })

  it('keeps an all-completed list and gives an honest current-turn empty state', () => {
    expect(text([{ content: 'Finished task', status: 'completed' }])).toContain('Finished task')
    expect(text([])).toContain('当前回合暂无待办清单')
  })

  it('windows thousands of rows without mounting the hidden items', () => {
    const todos = Array.from({ length: 2000 }, (_, index): TodoHudItem => ({ content: `Task-${index}`, status: 'pending' }))
    const out = text(todos, 1000)
    expect(out).toContain('1001. [待办] Task-1000')
    expect(out).not.toContain('Task-0\n')
    expect(out).not.toContain('Task-1999')
    expect(out.split('\n').length).toBeLessThanOrEqual(24)
  })

  it('wraps long Chinese and multiline text safely on a narrow terminal', () => {
    windowSize.columns = 32
    windowSize.rows = 12
    const item: TodoHudItem = { content: `${'长任务中文内容'.repeat(50)}\nTail marker \x1b[2J`, status: 'in_progress' }
    const out = text([item], Number.MAX_SAFE_INTEGER)
    expect(out).toContain('Tail marker')
    expect(out).toContain('\\x1b[2J')
    expect(out.split('\n').length).toBeLessThanOrEqual(12)
    for (const line of out.split('\n')) expect(displayWidth(line)).toBeLessThanOrEqual(32)
  })

  it('reuses wrapped text while scrolling and clamps only when the list shrinks', async () => {
    const todos = Array.from({ length: 1000 }, (_, index): TodoHudItem => ({ content: `Long task ${index} ${'中文'.repeat(20)}`, status: 'pending' }))
    const stdout = Object.assign(fakeTtyStdout(), { isTTY: true, columns: 80, rows: 24 })
    const clamp = vi.fn()
    const instance = render(createElement(TodoPane, { todos, offset: 100, onOffsetChange: clamp }), {
      stdout, stdin: fakeTtyStdin(), patchConsole: false, exitOnCtrlC: false,
    })
    try {
      await instance.waitUntilRenderFlush()
      const initialCalls = vi.mocked(wrapDisplayLines).mock.calls.length
      for (let offset = 101; offset < 110; offset += 1) {
        instance.rerender(createElement(TodoPane, { todos, offset, onOffsetChange: clamp }))
        await instance.waitUntilRenderFlush()
      }
      expect(vi.mocked(wrapDisplayLines).mock.calls.length).toBe(initialCalls)
      expect(clamp).not.toHaveBeenCalled()
      instance.rerender(createElement(TodoPane, { todos: todos.slice(0, 1), offset: 109, onOffsetChange: clamp }))
      await instance.waitUntilRenderFlush()
      expect(clamp).toHaveBeenCalledWith(0)
    } finally { await disposeRenderer(instance) }
  })
})
