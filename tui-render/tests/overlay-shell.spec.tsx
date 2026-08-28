/**
 * OverlayShell chrome: bold-fg titles, empty-state copy, CSI escaping, and
 * no accent on the heading.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { OverlayShell } from '../src/overlay-shell.tsx'
import { applyTheme } from '../src/theme.ts'

afterEach(() => {
  applyTheme('truecolor')
})

function render(
  overrides: Partial<Parameters<typeof OverlayShell>[0]> = {},
): string {
  return renderToString(
    createElement(OverlayShell, {
      title: '子代理',
      body: '暂无子代理',
      footnote: 'Esc 关闭 · 有运行中的子代理时再打开',
      ...overrides,
    }),
  )
}

describe('OverlayShell', () => {
  it('paints a bold-fg title and empty hub copy without accent', () => {
    applyTheme('truecolor')
    const out = render()
    expect(out).toContain('子代理')
    expect(out).toContain('暂无子代理')
    expect(out).toContain('Esc 关闭 · 有运行中的子代理时再打开')
    expect(out).toContain('\x1b[1m')
    expect(out).toContain('\x1b[38;2;247;247;248m')
    expect(out).not.toContain('\x1b[38;2;77;107;254m')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('paints workspace, feedback, and workflow empty chrome', () => {
    expect(render({
      title: '工作区',
      body: '此目录为空',
      footnote: 'e 输入路径 · Esc 关闭',
    })).toContain('此目录为空')
    expect(render({
      title: '反馈',
      body: '暂无助手消息可反馈',
      footnote: '等待助手回复后再打开 · Esc 关闭',
    })).toContain('暂无助手消息可反馈')
    expect(render({
      title: '工作流',
      body: '当前无工作流运行',
      footnote: 'Esc 关闭',
    })).toContain('当前无工作流运行')
    expect(render({
      title: '计划',
      body: undefined,
      footnote: 'j/k 选择 · Enter 切换 · Esc 关闭',
    })).toContain('计划')
  })

  it('paints an error line with ✗ and escapes CSI in title, body, and error', () => {
    const out = render({
      title: '子代理\x1b[2J',
      body: 'inject \x1b[2J body',
      error: '无法列出子代理：\x1b[2J',
      footnote: 'Esc 关闭 · 可重试',
    })
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('✗ 无法列出子代理：')
    expect(out).toContain('Esc 关闭 · 可重试')
  })
})
