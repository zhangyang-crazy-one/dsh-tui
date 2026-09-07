/**
 * Todo HUD: one `{glyph} {statusWord} {content}` row per item with the three
 * states told apart by glyph plus copy, never color alone (A2/A3); hidden when
 * the list is empty (S18: no empty dock row); content escaped and truncated
 * to the row budget.
 */

import { renderToString } from 'ink'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { TodoHud } from '../src/todo-hud.tsx'
import type { TodoHudItem } from '../src/todo-hud.tsx'

/** Strip SGR/CSI sequences so content assertions read the painted text. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}

/** Render the HUD to plain text (no SGR) for content assertions. */
function renderPlain(todos: readonly TodoHudItem[], maxCols = 80): string {
  return stripAnsi(renderToString(createElement(TodoHud, { todos, maxCols })))
}

describe('TodoHud', () => {
  it('paints nothing for an empty list', () => {
    expect(renderPlain([])).toBe('')
  })

  it('paints nothing when all todos are completed', () => {
    const output = renderPlain([
      { content: '提交', status: 'completed' },
      { content: '发布', status: 'completed' },
    ])
    expect(output).toBe('')
  })

  it('paints glyph + status word + content row for pending and in_progress items while hiding completed items', () => {
    const output = renderPlain([
      { content: '写测试', status: 'pending' },
      { content: '改界面', status: 'in_progress' },
      { content: '提交', status: 'completed' },
    ])
    expect(output).toContain('· 待办 写测试')
    expect(output).toContain('▸ 进行中 改界面')
    expect(output).not.toContain('提交')
  })

  it('displays only the tail 5 incomplete todos by default', () => {
    const output = renderPlain([
      { content: '已完成1', status: 'completed' },
      { content: '任务1', status: 'pending' },
      { content: '任务2', status: 'pending' },
      { content: '已完成2', status: 'completed' },
      { content: '任务3', status: 'in_progress' },
      { content: '任务4', status: 'pending' },
      { content: '任务5', status: 'pending' },
      { content: '任务6', status: 'pending' },
    ])
    expect(output).not.toContain('已完成1')
    expect(output).not.toContain('已完成2')
    expect(output).not.toContain('任务1')
    expect(output).toContain('任务2')
    expect(output).toContain('任务3')
    expect(output).toContain('任务4')
    expect(output).toContain('任务5')
    expect(output).toContain('任务6')
  })

  it('respects custom limit for incomplete items', () => {
    const output = stripAnsi(renderToString(createElement(TodoHud, {
      todos: [
        { content: '任务1', status: 'pending' },
        { content: '任务2', status: 'pending' },
        { content: '任务3', status: 'pending' },
      ],
      maxCols: 80,
      limit: 2,
    })))
    expect(output).not.toContain('任务1')
    expect(output).toContain('任务2')
    expect(output).toContain('任务3')
  })

  it('handles non-positive limit defensively by painting nothing', () => {
    const output = stripAnsi(renderToString(createElement(TodoHud, {
      todos: [{ content: '任务1', status: 'pending' }],
      maxCols: 80,
      limit: 0,
    })))
    expect(output).toBe('')
  })

  it('escapes CSI in content instead of passing it through', () => {
    const output = renderPlain([{ content: '清屏\x1b[2J', status: 'pending' }])
    expect(output).toContain('清屏\\x1b[2J')
  })

  it('truncates the content to the row budget', () => {
    // The head stays whole; the content shrinks to fit the remaining columns.
    const output = renderPlain(
      [{ content: '一二三四五六', status: 'in_progress' }],
      10,
    )
    expect(output).toContain('▸ 进行中 ')
    expect(output).toContain('…')
    expect(output).not.toContain('一二三四五六')
  })
})
