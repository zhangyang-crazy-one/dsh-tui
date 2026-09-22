/** Shared HUD allocation, ordering, and physical geometry regression tests. */
import { describe, expect, it } from 'vitest'
import { displayWidth } from '../src/content.ts'
import { fitHudRow, hudRowBudget, layoutHud } from '../src/hud-layout.ts'
import { renderPolicyDefaults } from '../src/render-policy.ts'

const todos = [
  { content: 'pending-first', status: 'pending' as const },
  { content: 'active-first', status: 'in_progress' as const },
  { content: 'completed', status: 'completed' as const },
  { content: 'active-second', status: 'in_progress' as const },
]
const jobs = [
  { id: 'bash-9', status: 'running', label: 'first-job' },
  { id: 'bash-2', status: 'stopping', label: 'second-job' },
  { id: 'bash-1', status: 'completed', label: 'finished' },
]
const workflow = { phase: 'live-phase', current: { seq: 2, label: 'live-member' } }

describe('shared HUD allocation', () => {
  it('reserves both titles, then a job, active todo, and workflow', () => {
    const rows = layoutHud({ todos, jobs, workflow, rows: 5, columns: 120, locale: 'en-US' })
    expect(rows).toHaveLength(5)
    expect(rows.map(row => row.key)).toEqual(['plan-title', 'todo-0', 'workflow', 'jobs-title', 'job-bash-9'])
    expect(rows[0]?.text).toContain('+2 hidden')
    expect(rows[3]?.text).toContain('+1 hidden')
    expect(rows[1]?.text).toContain('active-first')
  })

  it('preserves group order and hides completed entries', () => {
    const rows = layoutHud({ todos, jobs, workflow, rows: 20, columns: 120 })
    expect(rows.filter(row => row.key.startsWith('todo-')).map(row => row.text)).toEqual([
      '▸ 进行中 active-first', '▸ 进行中 active-second', '· 待办 pending-first',
    ])
    expect(rows.filter(row => row.key.startsWith('job-')).map(row => row.key)).toEqual(['job-bash-9', 'job-bash-2'])
    expect(rows.map(row => row.text).join('\n')).not.toContain('completed')
  })

  it('collapses empty sections and handles zero, one, and two rows', () => {
    expect(layoutHud({ todos: [], rows: 8, columns: 80 })).toEqual([])
    expect(layoutHud({ todos, jobs, rows: 0, columns: 80 })).toEqual([])
    expect(layoutHud({ todos, jobs, rows: 1, columns: 80 })[0]?.key).toBe('summary')
    expect(layoutHud({ todos, jobs, rows: 2, columns: 80 }).map(row => row.key)).toEqual(['plan-title', 'jobs-title'])
    expect(layoutHud({ jobs, rows: 4, columns: 80 }).map(row => row.key)).not.toContain('plan-title')
    expect(layoutHud({ workflow: { current: { seq: 1, label: 'ended', outcome: 'failed' } }, rows: 4, columns: 80 })).toEqual([])
  })

  it.each([[120, 40, 8], [80, 24, 8], [80, 23, 4], [40, 12, 3], [39, 12, 3]])(
    'fits %i columns and %i terminal rows', (columns, height, expectedBudget) => {
      const budget = hudRowBudget(renderPolicyDefaults(), height, 9)
      expect(budget).toBe(expectedBudget)
      const rows = layoutHud({ todos, jobs: [{ id: 'bash-1', status: 'running', label: '中文\n\t\x1b[2J'.repeat(30) }], workflow, rows: budget, columns })
      expect(rows.length).toBeLessThanOrEqual(budget)
      for (const row of rows) {
        expect(displayWidth(row.text)).toBeLessThanOrEqual(columns)
        expect(row.text).not.toMatch(/[\n\t\x1b]/)
      }
    },
  )

  it('reserves controls before the mode limit', () => {
    const policy = renderPolicyDefaults()
    const budgets = [25, 24, 23, 22].map(reserved => hudRowBudget(policy, 24, reserved))
    expect(budgets).toEqual([0, 0, 1, 2])
  })

  it.each(['completed', 'killed', 'failed'])('retracts %s jobs and their title without changing the plan', (status) => {
    const settled = { id: 'bash-7', status, label: 'settled-worker' }
    const input = { todos, workflow, rows: 20, columns: 120, locale: 'en-US' as const }
    expect(layoutHud({ jobs: [settled], rows: 8, columns: 80 })).toEqual([])
    expect(layoutHud({ ...input, jobs: [settled] })).toEqual(layoutHud(input))
    const mixed = layoutHud({ ...input, jobs: [settled, ...jobs] })
    expect(mixed).toEqual(layoutHud({ ...input, jobs }))
    expect(mixed.find(row => row.key === 'jobs-title')?.text).toBe('─ Background 2')
  })

  it.each([
    ['running', 'Running'],
    ['stopping', 'Stopping'],
  ])('keeps %s jobs visible with their identity and localized state', (status, label) => {
    const rows = layoutHud({ jobs: [{ id: 'bash-7', status, label: 'worker' }], rows: 2, columns: 80, locale: 'en-US' })
    expect(rows.map(row => [row.key, row.text])).toEqual([
      ['jobs-title', '─ Background 1'],
      ['job-bash-7', `bash-7 · ${label} · worker`],
    ])
  })

  it.each([
    ['en-US', '─ Plan 3 Pending · 1 Workflow', '─ Background 2'],
    ['zh-CN', '─ 任务计划 3 待办 · 1 工作流', '─ 后台执行 2'],
  ] as const)('separates plan and execution with titled rows in %s', (locale, planTitle, jobsTitle) => {
    const rows = layoutHud({ todos, jobs, workflow, rows: 8, columns: 120, locale })
    expect(rows.map(row => row.key)).toEqual([
      'plan-title', 'todo-0', 'todo-1', 'todo-2', 'workflow', 'jobs-title', 'job-bash-9', 'job-bash-2',
    ])
    expect(rows[0]?.text).toBe(planTitle)
    expect(rows[5]?.text).toBe(jobsTitle)
    expect(rows.every(row => row.text.length > 0)).toBe(true)
  })

  it.each([
    [2, '─ Plan 3 Pending · 1 Workflow · +4 hidden (3/1)', '─ Background 2 · +2 hidden'],
    [3, '─ Plan 3 Pending · 1 Workflow · +4 hidden (3/1)', '─ Background 2 · +1 hidden'],
    [4, '─ Plan 3 Pending · 1 Workflow · +3 hidden (2/1)', '─ Background 2 · +1 hidden'],
    [5, '─ Plan 3 Pending · 1 Workflow · +2 hidden (2/0)', '─ Background 2 · +1 hidden'],
  ] as const)('includes exact todo/workflow and job overflow counts within %i rows', (limit, planTitle, jobsTitle) => {
    const rows = layoutHud({ todos, jobs, workflow, rows: limit, columns: 120, locale: 'en-US' })
    expect(rows).toHaveLength(limit)
    expect(rows.find(row => row.key === 'plan-title')?.text).toBe(planTitle)
    expect(rows.find(row => row.key === 'jobs-title')?.text).toBe(jobsTitle)
  })

  it('gives a single remaining section its full allocation without an empty divider', () => {
    const plan = layoutHud({ todos, workflow, rows: 5, columns: 120 })
    expect(plan.map(row => row.key)).toEqual(['plan-title', 'todo-0', 'todo-1', 'todo-2', 'workflow'])
    const execution = layoutHud({ jobs, rows: 3, columns: 120 })
    expect(execution.map(row => row.key)).toEqual(['jobs-title', 'job-bash-9', 'job-bash-2'])
  })

  it.each(['completed', 'killed', 'failed'])('removes a %s workflow member while preserving a live phase', (outcome) => {
    const input = { todos, jobs, rows: 8, columns: 120, locale: 'en-US' as const }
    const current = { ...workflow.current, outcome }
    const active = layoutHud({ ...input, workflow })
    expect(active.find(row => row.key === 'workflow')?.text).toBe('Workflow · Phase live-phase · 2 · live-member')
    const phaseOnly = layoutHud({ ...input, workflow: { phase: workflow.phase, current } })
    expect(phaseOnly.find(row => row.key === 'workflow')?.text).toBe('Workflow · Phase live-phase')
    expect(phaseOnly.filter(row => row.key !== 'workflow')).toEqual(active.filter(row => row.key !== 'workflow'))
    expect(layoutHud({ ...input, workflow: { current } })).toEqual(layoutHud(input))
    expect(layoutHud({ workflow: { current }, rows: 8, columns: 120 })).toEqual([])
  })

  it('releases workflow rows on run withdrawal without hiding active todos or jobs', () => {
    const input = { todos, jobs, rows: 8, columns: 120, locale: 'en-US' as const }
    const active = layoutHud({ ...input, workflow })
    const settled = layoutHud({ ...input, workflow: undefined })
    expect(settled).toHaveLength(active.length - 1)
    expect(settled.some(row => row.key === 'workflow')).toBe(false)
    expect(settled[0]?.text).toBe('─ Plan 3 Pending')
    expect(settled.slice(1)).toEqual(active.filter(row => row.key !== 'plan-title' && row.key !== 'workflow'))
    expect(layoutHud({ workflow: undefined, rows: 8, columns: 120 })).toEqual([])
  })

  it('reclaims rows across completion batches and preserves surviving job identities and order', () => {
    const initial = [
      { id: 'bash-9', status: 'running', label: 'first' },
      { id: 'bash-2', status: 'stopping', label: 'second' },
      { id: 'bash-7', status: 'running', label: 'third' },
    ]
    const input = { rows: 8, columns: 80 }
    expect(layoutHud({ ...input, jobs: initial }).map(row => row.key)).toEqual([
      'jobs-title', 'job-bash-9', 'job-bash-2', 'job-bash-7',
    ])
    const partial = initial.map(job => job.id === 'bash-9' ? { ...job, status: 'completed' } : job)
    expect(layoutHud({ ...input, jobs: partial }).map(row => row.key)).toEqual(['jobs-title', 'job-bash-2', 'job-bash-7'])
    const settled = partial.map(job => ({ ...job, status: job.id === 'bash-2' ? 'killed' : 'failed' }))
    expect(layoutHud({ ...input, jobs: settled })).toEqual([])
    expect(settled.map(job => job.id)).toEqual(initial.map(job => job.id))
    expect(initial.map(job => job.status)).toEqual(['running', 'stopping', 'running'])
  })

  it.each([0, 1, 2])('counts all HUD output within %i available rows after reservations', (available) => {
    const budget = hudRowBudget(renderPolicyDefaults(), 24, 24 - available)
    expect(budget).toBe(available)
    const rows = layoutHud({ todos, jobs, workflow, rows: budget, columns: 120, locale: 'en-US' })
    expect(rows.map(row => row.text)).toEqual(available === 0 ? [] : available === 1 ? [
      '─ Plan 3 Pending · 1 Workflow | Background 2',
    ] : [
      '─ Plan 3 Pending · 1 Workflow · +4 hidden (3/1)',
      '─ Background 2 · +2 hidden',
    ])
    expect(rows.length + 24 - available).toBe(24)
  })

  it('switches from eight to four rows at 23 terminal rows and restores the layout on resize', () => {
    const input = { todos, jobs, workflow, columns: 80, locale: 'en-US' as const }
    const frames = [24, 23, 24].map(height => layoutHud({ ...input, rows: hudRowBudget(renderPolicyDefaults(), height, 9) }))
    expect(frames.map(rows => rows.length)).toEqual([8, 4, 8])
    expect(frames[1]?.map(row => row.key)).toEqual(['plan-title', 'todo-0', 'jobs-title', 'job-bash-9'])
    expect(frames[2]).toEqual(frames[0])
  })

  it('uses configured mode limits and threshold before reserving controls', () => {
    const policy = { ...renderPolicyDefaults(), normalHudRows: 6, compactHudRows: 2, compactHeightThreshold: 30 }
    expect([29, 30, 40].map(height => hudRowBudget(policy, height, 9))).toEqual([2, 6, 6])
    expect([29, 30, 31].map(reserved => hudRowBudget(policy, 30, reserved))).toEqual([1, 0, 0])
  })

  it.each([[120, 40, 8], [80, 24, 8], [80, 23, 4], [40, 12, 3], [39, 12, 3]])(
    'counts titles and overflow as physical rows at %ix%i', (columns, height, expectedRows) => {
      const budget = hudRowBudget(renderPolicyDefaults(), height, 9)
      const rows = layoutHud({ todos, jobs, workflow, rows: budget, columns })
      expect(rows).toHaveLength(expectedRows)
      expect(rows.length + 9).toBeLessThanOrEqual(height)
      expect(rows.map(row => row.key)).toContain('plan-title')
      expect(rows.map(row => row.key)).toContain('jobs-title')
      for (const row of rows) expect(displayWidth(row.text)).toBeLessThanOrEqual(columns)
    },
  )
})

describe('HUD text geometry', () => {
  it('escapes controls into visible text before measuring or truncating a row', () => {
    expect(fitHudRow('中文\r\nnext\t\x1b[2J\x07', 80)).toBe('中文\\nnext\\t\\x1b[2J\\x07')
    expect(fitHudRow('中\n', 4)).toBe('中\\n')
    expect(fitHudRow('中\n', 3)).toBe('中…')
  })

  it.each([
    [0, ''], [1, '…'], [2, '…'], [3, '中…'], [4, '中文'],
  ] as const)('fits wide text into %i columns without splitting a glyph', (columns, expected) => {
    expect(fitHudRow('中文', columns)).toBe(expected)
  })

  it('omits all sections when no columns are available', () => {
    expect(layoutHud({ todos, jobs, workflow, rows: 8, columns: 0 })).toEqual([])
  })

  it.each([1, 2, 39, 40, 80, 120])('bounds every untrusted content field to %i columns', (columns) => {
    const label = '中👩‍💻e\u0301\n\r\t\x1b[2J\x1b]0;title\x07'.repeat(30)
    const rows = layoutHud({
      todos: [{ content: label, status: 'in_progress' }],
      jobs: [{ id: 'bash-1', status: 'running', label }],
      workflow: { phase: label, current: { seq: 1, label } },
      rows: 5,
      columns,
    })
    expect(rows.map(row => row.key)).toEqual(['plan-title', 'todo-0', 'workflow', 'jobs-title', 'job-bash-1'])
    for (const row of rows) {
      expect(displayWidth(row.text)).toBeLessThanOrEqual(columns)
      expect(row.text).not.toMatch(/[\x00-\x1f\x7f]/)
    }
    for (const key of ['todo-0', 'workflow', 'job-bash-1']) {
      expect(rows.find(row => row.key === key)?.text).toMatch(/…$/)
    }
    const memberOnly = layoutHud({ workflow: { current: { seq: 1, label } }, rows: 2, columns })
    expect(memberOnly).toHaveLength(2)
    expect(memberOnly[1]?.text).toMatch(/…$/)
    for (const row of memberOnly) {
      expect(displayWidth(row.text)).toBeLessThanOrEqual(columns)
      expect(row.text).not.toMatch(/[\x00-\x1f\x7f]/)
    }
  })
})
