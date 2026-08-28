import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { WorkflowOverlay, WORKFLOW_OVERLAY_WINDOW } from '../src/workflow-overlay.tsx'

function render(state: Parameters<typeof WorkflowOverlay>[0]['state']): string {
  return renderToString(createElement(WorkflowOverlay, { state }))
}

describe('WorkflowOverlay', () => {
  it('renders nothing while closed', () => {
    expect(render({ open: false, offset: 0 })).toBe('')
  })

  it('renders error and empty-run states', () => {
    expect(render({ open: true, offset: 0, error: 'unavailable' })).toContain('✗ unavailable')
    expect(render({ open: true, offset: 0 })).toContain('当前无工作流运行')
  })

  it('renders phase and a window of in-flight and settled members', () => {
    const members = Array.from({ length: WORKFLOW_OVERLAY_WINDOW + 2 }, (_, index) => ({
      seq: index + 1,
      label: `member-${String(index + 1)}`,
      ...(index === 2 ? { outcome: 'completed' } : {}),
    }))
    const out = render({
      open: true,
      offset: 1,
      run: { phase: 'verify\x1b[2J', members },
    })
    expect(out).toContain('阶段 verify\\x1b[2J')
    expect(out).toContain('2 · member-2')
    expect(out).toContain('3 · member-3 · completed')
    expect(out).not.toContain('1 · member-1')
    expect(out).not.toContain('10 · member-10')
  })

  it('accepts an empty phase and member list', () => {
    const out = render({ open: true, offset: 0, run: { phase: '', members: [] } })
    expect(out).toContain('j/k 滚动 · Esc 关闭')
    expect(out).not.toContain('阶段 ')
  })
})
