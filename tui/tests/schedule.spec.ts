/** Durable reminders use the real official tools, JSON backend and Agent Loop. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import Typert from '@deepseek-ai/dsh-typert-registry'
import * as ToolSchedule from '@deepseek-ai/dsh-tool-schedule'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-schedule/src/runtime.ts'
import { expect, it, vi } from 'vitest'
import * as TuiSchedule from '../src/schedule.ts'
import { RuntimeController } from '../src/index.ts'

class Reply extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Reminder received.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function bench(root: string) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(AgentDefaultModel, { provider: 'reminder-test', model: 'offline' })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(Typert)
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new Reply()
  ctx.llm.registerAdapter(['reminder-test'], adapter)
  await ctx.plugin(TuiSchedule, {})
  await ctx.plugin(ToolSchedule)
  const controller = new RuntimeController(ctx, {
    stdout: { write: () => true }, stderr: { write: () => true }, exit() {},
  }, { task: '', cwd: root }, () => {})
  await controller.start()
  const agent = ctx.agents.get(controller.session!.id)!
  let call = 0
  const execute = (name: string, args: object, owner: Agent = agent) => ctx.tools.execute({
    name, arguments: args, agent: owner, callId: ToolCallId(`schedule-${++call}`), signal: new AbortController().signal,
  })
  return { ctx, controller, agent, adapter, execute,
    close: async () => {
      if (controller.session !== undefined) await ctx.sessions.flush(controller.session)
      await controller.dispose();await ctx.fiber.dispose()
    },
  }
}

it('exposes all four tools, updates and deletes within the calling Session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-schedule-tools-'))
  const b = await bench(root)
  try {
    expect(b.ctx.get('sessionController')).toBeUndefined()
    for (const name of ['schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete']) {
      expect(b.ctx.tools.get(name, b.agent)).toBeDefined()
    }
    expect((await b.execute('schedule_create', { title: 'Review report', prompt: 'Review the finished report', after_seconds: 3600 })).isError).toBe(false)
    const [record] = await b.ctx.schedule.list({ sessionId: b.agent.id })
    expect(record?.title).toBe('Review report')
    expect((await b.execute('schedule_list', {})).isError).toBe(false)
    expect((await b.execute('schedule_update', { id: record!.id, title: 'Review revised report' })).isError).toBe(false)
    expect((await b.ctx.schedule.list({ sessionId: b.agent.id }))[0]?.title).toBe('Review revised report')
    expect((await b.execute('schedule_delete', { id: record!.id })).isError).toBe(false)
    expect(await b.ctx.schedule.list({ sessionId: b.agent.id })).toEqual([])
    expect(b.adapter.requests).toHaveLength(0)
  } finally { await b.close();await rm(root, { recursive: true, force: true }) }
})

it('restores the original Session after a switch and lets the UI borrow the reminder Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-schedule-deliver-'))
  const b = await bench(root)
  try {
    const original = b.agent.id
    await b.execute('schedule_create', { title: 'Reminder', prompt: 'REVIEW_ORIGINAL_SESSION', after_seconds: 1 })
    b.controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => expect(b.controller.session?.id).not.toBe(original))
    const current = b.controller.session?.id
    await vi.waitFor(() => expect(b.adapter.requests).toHaveLength(1), { timeout: 5000 })
    expect(b.controller.session?.id).toBe(current)
    expect(JSON.stringify(b.adapter.requests[0]?.messages)).toContain('REVIEW_ORIGINAL_SESSION')
    const restored = b.ctx.agents.get(original)
    expect(restored).toBeDefined()
    await restored!.whenIdle()
    expect(restored!.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'schedule')).toBe(true)
    await vi.waitFor(async () => expect(await b.ctx.schedule.list({ sessionId: original })).toEqual([]))
    b.controller.dispatch({ kind: 'select-session', id: original })
    await vi.waitFor(() => expect(b.controller.session).toBe(restored!.session))
    expect(b.controller.getModel().history.some(row => row.text.includes('Reminder received.'))).toBe(true)
  } finally { await b.close();await rm(root, { recursive: true, force: true }) }
})

it('deduplicates concurrent UI and reminder resumes of one cold Session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-schedule-race-'))
  const b = await bench(root)
  try {
    const id = b.agent.id
    b.controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => expect(b.controller.session?.id).not.toBe(id))
    const resume = vi.spyOn(b.ctx.agents, 'resume')
    const [ui, reminder] = await Promise.all([
      b.ctx.tuiScheduleSessions.acquire(id), b.ctx.tuiScheduleSessions.resolveAgent(id),
    ])
    if ('error' in reminder) throw reminder.error
    expect(ui.handle.agent).toBe(reminder.agent)
    expect(resume).toHaveBeenCalledTimes(1)
    await ui.handle.dispose()
    expect(b.ctx.agents.get(id)).toBe(reminder.agent)
  } finally { await b.close();await rm(root, { recursive: true, force: true }) }
})

it('refreshes the task browser and requires confirmation before cancelling a stored task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-schedule-browser-'))
  const b = await bench(root)
  try {
    b.controller.dispatch({ kind: 'command', query: 'schedules' })
    await vi.waitFor(() => expect(b.controller.getSchedulePane().loading).toBe(false))
    expect(b.controller.getSchedulePane().open).toBe(true)
    expect(b.controller.getSchedulePane().rows).toEqual([])
    await b.execute('schedule_create', { title: 'Cancel test', prompt: 'Full reminder instruction', after_seconds: 3600 })
    await vi.waitFor(() => expect(b.controller.getSchedulePane().rows).toHaveLength(1))
    b.controller.dispatch({ kind: 'schedule-enter' })
    expect(b.controller.getSchedulePane().details).toBe(true)
    expect(b.controller.getSchedulePane().rows[0]?.prompt).toBe('Full reminder instruction')
    b.controller.dispatch({ kind: 'schedule-enter' })
    expect(b.controller.getSchedulePane().open).toBe(false)
    b.controller.dispatch({ kind: 'command', query: 'schedules' })
    await vi.waitFor(() => expect(b.controller.getSchedulePane().rows).toHaveLength(1))
    const remove = vi.spyOn(b.ctx.schedule, 'delete')
    b.controller.dispatch({ kind: 'schedule-delete' })
    expect(b.controller.getSchedulePane().confirmDelete).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    b.controller.dispatch({ kind: 'schedule-confirm', confirmed: false })
    expect(b.controller.getSchedulePane().rows).toHaveLength(1)
    b.controller.dispatch({ kind: 'schedule-delete' })
    b.controller.dispatch({ kind: 'schedule-confirm', confirmed: true })
    await vi.waitFor(() => expect(b.controller.getSchedulePane().rows).toEqual([]))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(b.adapter.requests).toHaveLength(0)
  } finally { await b.close();await rm(root, { recursive: true, force: true }) }
})

it('persists tasks through exit, recovers overdue delivery once, and retains its receipt on restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-schedule-restart-'))
  let b = await bench(root)
  try {
    const id = b.agent.id
    await b.execute('schedule_create', { title: 'Restart reminder', prompt: 'AFTER_RESTART', after_seconds: 1 })
    await b.close()
    await new Promise(resolve => setTimeout(resolve, 1100))
    expect(b.adapter.requests).toHaveLength(0)
    b = await bench(root)
    const resolved = await b.ctx.tuiScheduleSessions.resolveAgent(id)
    if ('error' in resolved) throw resolved.error
    await vi.waitFor(() => expect(b.adapter.requests).toHaveLength(1), { timeout: 5000 })
    await b.ctx.agents.get(id)!.whenIdle()
    await vi.waitFor(async () => expect((await b.ctx.schedule.catalog())[0]?.status).toBe('inactive'))
    expect((await b.ctx.schedule.catalog())[0]?.lastDelivery).toBeDefined()
    await b.close()
    b = await bench(root)
    expect((await b.ctx.schedule.catalog())[0]?.status).toBe('inactive')
    expect(b.adapter.requests).toHaveLength(0)
  } finally { await b.close();await rm(root, { recursive: true, force: true }) }
}, 10000)
