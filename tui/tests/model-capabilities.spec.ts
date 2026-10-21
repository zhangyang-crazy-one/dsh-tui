/** TUI bundle capabilities run through the official loop and durable Session log. */
import { readFileSync } from 'node:fs'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as TimeContext from '@deepseek-ai/dsh-time-context'
import * as Present from '@deepseek-ai/dsh-tool-present'
import { createProjector } from '@deepseek-ai/dsh-tui-render'
import * as yaml from 'js-yaml'
import { describe, expect, it, vi } from 'vitest'

interface Row { id?: string; name?: string; config?: Record<string, unknown>; insert?: Row[] }
const schema = yaml.JSON_SCHEMA.extend(new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar', resolve: data => typeof data === 'string', construct: (data: unknown) => data,
}))
function capability(id: string): Row {
  const patch = yaml.load(readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema }) as Row[]
  const row = patch.flatMap(item => item.insert ?? []).find(item => item.id === id)
  expect(row, `TUI must compose ${id}`).toBeDefined()
  if (row === undefined) throw new Error(`missing ${id}`)
  return row
}
class ReplyAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'clock received' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class PresentAdapter extends ReplyAdapter {
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.requests.length !== 0) { yield * super.stream(options);return }
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'block-end', index: 0, block: {
      type: 'tool-call', id: ToolCallId('present-report'), name: 'present',
      arguments: JSON.stringify({ files: [{ path: '报告.docx', description: 'Final report' }] }),
    } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

describe('TUI model capabilities', () => {
  it('logs current zoned time in model context without adding a human transcript row', async () => {
    const row = capability('time-context')
    expect(row.name).toBe('@deepseek-ai/dsh-time-context')
    const ctx = new Context()
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(TimeContext, row.config)
      const adapter = new ReplyAdapter()
      ctx.llm.registerAdapter(['clock-test'], adapter)
      const agent = await ctx.agentLoop.create(SessionId('tui-clock'), { provider: 'clock-test', model: 'test' })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'What time is it?' }] }))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(1)
      const events = agent.session.snapshotEvents()
      const readings = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'time-context')
      expect(readings).toHaveLength(1)
      const request = JSON.stringify(adapter.requests[0]?.messages)
      expect(request).toContain('Time sampled while preparing turn 1, step 1:')
      expect(request).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone)
      const projector = createProjector()
      projector.seed(events)
      expect(projector.snapshot().history.filter(message => message.kind === 'user').map(message => message.text)).toEqual(['What time is it?'])
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Again' }] }))
      await agent.whenIdle()
      expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'time-context')).toHaveLength(1)
    } finally { await ctx.fiber.dispose() }
  })

  it('composes the official present tool with a bounded per-call file count', () => {
    const row = capability('tool-present')
    expect(row.name).toBe('@deepseek-ai/dsh-tool-present')
    expect(row.config?.['maxFiles']).toBe(8)
    expect(Present.inject).toEqual(['tools', 'fs', 'sessionProjections', 'workingDirectory'])
  })

  it('runs present through the official loop on a real binary file and replays its delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tui-present-'))
    const ctx = new Context()
    try {
      await writeFile(join(root, '报告.docx'), Uint8Array.of(80, 75, 0, 255))
      await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
      await ctx.plugin(AgentLoop, { agents: [] })
      const maxFiles = capability('tool-present').config?.['maxFiles']
      if (typeof maxFiles !== 'number') throw new Error('present requires maxFiles')
      await ctx.plugin(Present, { maxFiles })
      const read = vi.spyOn(ctx.fs, 'readBytes')
      const adapter = new PresentAdapter()
      ctx.llm.registerAdapter(['delivery-test'], adapter)
      const { agent } = await ctx.agents.create({
        sessionId: SessionId('tui-delivery'), meta: { cwd: root },
        agentOptions: { provider: 'delivery-test', model: 'test' },
      })
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Deliver the report' }] }))
      await agent.whenIdle()
      expect(adapter.requests).toHaveLength(2)
      expect(JSON.stringify(adapter.requests[0]?.tools)).toContain('present')
      const events = agent.session.snapshotEvents()
      const delivery = events.find(event => event.type === 'deliverables/presented')
      const expected = [{ path: await realpath(join(root, '报告.docx')), description: 'Final report' }]
      expect(delivery?.data.files).toEqual(expected)
      const result = events.find(event => event.type === 'tool/result')
      expect(result?.data.message.isError).toBe(false)
      const call = events.find(event => event.type === 'tool/call')
      expect(call?.seq).toBeLessThan(delivery?.seq ?? 0)
      expect(delivery?.seq).toBeLessThan(events.find(event => event.type === 'turn/end')?.seq ?? 0)
      expect(read).not.toHaveBeenCalled()
      const projector = createProjector();projector.seed(events)
      expect(projector.snapshot().deliveries).toEqual(expected)
      expect(projector.snapshot().history.at(-1)?.presentedFiles).toEqual(expected)
    } finally { await ctx.fiber.dispose();await rm(root, { recursive: true, force: true }) }
  })
})
