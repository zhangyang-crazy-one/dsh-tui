/**
 * Export integration: `/export` writes the live session's Markdown transcript
 * to the working directory. The TUI owns this exporter because the Web-only
 * `/export` command (session-log-export) only reports a download request and
 * never writes files; every model-visible text block is escaped before it
 * lands in the file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SessionStore from '@deepseek-ai/dsh-session'
import {
  Session as SessionValue,
  SessionId,
} from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import {
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  exportSessionMarkdown,
  renderSessionMarkdown,
} from '../src/export.ts'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

/** Append one completed turn whose user prompt carries a distinct keyword. */
function appendRound(session: Session, turn: number, keyword: string): void {
  session.append('turn/start', { turn })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: `please buy ${keyword}` }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  session.append(
    'assistant/message',
    {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [
          {
            type: 'text',
            text: `ok, ${keyword} ordered`,
          },
        ],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    },
    { surfaceOp: 'append' },
  )
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

/** Scripted agent whose followup resolves immediately and appends nothing. */
function scriptedAgent(ownerCtx: Context, session: Session): Agent {
  const agent = {} as Agent
  const agentCtx = ownerCtx.extend({ agent })
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    status: 'idle',
    ctx: agentCtx,
    cancel: () => {},
    runMaintenance: () => Promise.reject(new Error('not used')),
    send: () => {},
    followup: (_message: UserMessage) => {},
    steer: () => {},
    inject: () => {},
    whenIdle: () => Promise.resolve(),
  } satisfies Partial<Agent>)
  return agent
}

interface Bench {
  ctx: Context
  controller: RuntimeController
}

/** Mount the services and a scripted agent factory. */
async function bench(root: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(JsonlSessionPersistence, { root })
  ctx.agents.setFactory({
    async createAgent(
      ownerCtx: Context,
      options: CreateAgentOptions,
    ): Promise<AgentHandle> {
      const session = ctx.sessions.create(options.sessionId, {
        ...(options.meta === undefined ? {} : { meta: options.meta }),
      })
      const agent = scriptedAgent(ownerCtx, session)
      await options.setup?.(agent.ctx)
      ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('not used')),
  })
  const io: TuiIo = {
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: () => {},
  }
  const controller = new RuntimeController(
    ctx,
    io,
    { task: '', cwd: root },
    () => {},
  )
  return { ctx, controller }
}

describe('renderSessionMarkdown', () => {
  it('omits empty/non-text assistant blocks and defaults a missing tool error flag', () => {
    const callId = ToolCallId('call-default-error')
    const events: SessionEvent[] = [
      {
        type: 'user/message', seq: 0, time: 0,
        data: createUserMessage({
          content: [
            { type: 'text', text: '' },
            { type: 'image', data: 'ignored', mimeType: 'image/png' } as never,
          ],
          source: { kind: 'user' },
        }),
      },
      {
        type: 'assistant/message', seq: 1, time: 1,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: '' }, { type: 'reasoning', text: 'hidden' }],
            source: { provider: 'test', model: 'test' },
          }),
        },
      },
      {
        type: 'tool/result', seq: 2, time: 2,
        data: {
          turn: 1,
          step: 1,
          message: {
            id: 'tool-default' as never,
            role: 'user',
            source: { kind: 'tool', callId },
            content: [{
              type: 'tool-result',
              toolCallId: callId,
              content: [{ type: 'text', text: 'ok' }],
            }],
          },
        },
      },
    ]
    const markdown = renderSessionMarkdown(events)
    expect(markdown).not.toContain('hidden')
    expect(markdown).toContain('"isError": false')
  })
  it('preserves durable human and tool chronology without hidden model content', () => {
    const callId = ToolCallId('call-ordered')
    const events: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 500,
        data: createUserMessage({
          content: [{ type: 'text', text: 'INTERNAL-CONTEXT-SENTINEL' }],
          source: {
            kind: 'plugin',
            plugin: 'test',
            form: 'snapshot',
            sections: [],
          },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 1,
        time: 1_000,
        data: createUserMessage({
          content: [{ type: 'text', text: 'visible human prompt' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'assistant/message',
        seq: 2,
        time: 2_000,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [
              { type: 'reasoning', text: 'REASONING-SENTINEL' },
              { type: 'text', text: 'visible assistant answer' },
            ],
            source: {
              provider: 'PROVIDER-METADATA-SENTINEL',
              model: 'test-model',
            },
          }),
        },
        surfaceOp: 'append',
      },
      {
        type: 'tool/call',
        seq: 3,
        time: 3_000,
        data: {
          turn: 1,
          step: 1,
          callId,
          name: 'read_file',
          arguments: '{"path":"ordered.ts"}',
        },
      },
      {
        type: 'tool/result',
        seq: 4,
        time: 4_000,
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId,
            content: [{ type: 'text', text: 'ordered file contents' }],
            isError: true,
          }),
          error: { name: 'ReadFailure', code: 'PARTIAL' },
        },
        surfaceOp: 'append',
      },
    ]

    const markdown = renderSessionMarkdown(events)
    const orderedHeadings = [
      '## User — 1970-01-01T00:00:01.000Z',
      '## Assistant — 1970-01-01T00:00:02.000Z',
      '## Tool Call — 1970-01-01T00:00:03.000Z',
      '## Tool Result — 1970-01-01T00:00:04.000Z',
    ].map(heading => markdown.indexOf(heading))

    expect(orderedHeadings[0]).toBeGreaterThanOrEqual(0)
    for (let index = 1; index < orderedHeadings.length; index += 1) {
      expect(orderedHeadings[index]).toBeGreaterThan(orderedHeadings[index - 1]!)
    }
    expect(markdown).toContain('visible human prompt')
    expect(markdown).toContain('visible assistant answer')
    expect(markdown).toContain('"callId": "call-ordered"')
    expect(markdown).toContain('"name": "read_file"')
    expect(markdown).toContain('"arguments": "{\\"path\\":\\"ordered.ts\\"}"')
    expect(markdown).toContain('"result": "ordered file contents"')
    expect(markdown).toContain('"isError": true')
    expect(markdown).toContain('"name": "ReadFailure"')
    expect(markdown).toContain('"code": "PARTIAL"')
    expect(markdown).not.toContain('INTERNAL-CONTEXT-SENTINEL')
    expect(markdown).not.toContain('REASONING-SENTINEL')
    expect(markdown).not.toContain('PROVIDER-METADATA-SENTINEL')
  })

  it('renders user and assistant blocks with ISO time headers', () => {
    const events: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 1_000,
        data: createUserMessage({
          content: [{ type: 'text', text: 'hello' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'assistant/message',
        seq: 1,
        time: 2_000,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: 'hi there' }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        },
        surfaceOp: 'append',
      },
    ]
    const markdown = renderSessionMarkdown(events)
    expect(markdown).toContain('## User — 1970-01-01T00:00:01.000Z')
    expect(markdown).toContain('## Assistant — 1970-01-01T00:00:02.000Z')
    expect(markdown).toContain('hello')
    expect(markdown).toContain('hi there')
  })

  it('contains Markdown syntax inside quoted prose blocks', () => {
    const payload = [
      '# forged heading',
      '> forged quote',
      '- forged list',
      '---',
      '```',
      '``````',
      '',
      'tail',
    ].join('\n')
    const events: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 1_000,
        data: createUserMessage({
          content: [{ type: 'text', text: payload }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'assistant/message',
        seq: 1,
        time: 2_000,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [{ type: 'text', text: payload }],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        },
        surfaceOp: 'append',
      },
    ]

    const markdown = renderSessionMarkdown(events)
    const quotedPayload = payload
      .split('\n')
      .map(line => line === '' ? '>' : `> ${line}`)
      .join('\n')
    expect(markdown.split(quotedPayload)).toHaveLength(3)
    expect(markdown.match(/^#{1,6}\s.+$/gmu)).toEqual([
      '## User — 1970-01-01T00:00:01.000Z',
      '## Assistant — 1970-01-01T00:00:02.000Z',
    ])
  })

  it('uses payload-aware fences for structured tool records', () => {
    const callId = ToolCallId('fence-call')
    const events: SessionEvent[] = [
      {
        type: 'tool/call',
        seq: 0,
        time: 1_000,
        data: {
          turn: 1,
          step: 1,
          callId,
          name: 'dangerous```tool',
          arguments: '{"script":"``````"}',
        },
      },
      {
        type: 'tool/result',
        seq: 1,
        time: 2_000,
        data: {
          turn: 1,
          step: 1,
          message: createToolResultMessage({
            callId,
            content: [{ type: 'text', text: 'result ``````` payload' }],
            isError: false,
          }),
        },
        surfaceOp: 'append',
      },
    ]

    const markdown = renderSessionMarkdown(events)
    const fenceLines = markdown
      .split('\n')
      .filter(line => /^`+(?:json)?$/u.test(line))
    expect(fenceLines).toHaveLength(4)
    const callFence = fenceLines[0]!.slice(0, -'json'.length)
    const resultFence = fenceLines[2]!.slice(0, -'json'.length)
    expect(callFence.length).toBeGreaterThan(6)
    expect(fenceLines[1]).toBe(callFence)
    expect(resultFence.length).toBeGreaterThan(7)
    expect(fenceLines[3]).toBe(resultFence)
    expect(markdown).toContain('dangerous```tool')
    expect(markdown).toContain('result ``````` payload')
  })

  it('escapes control sequences in model output before writing', () => {
    const events: SessionEvent[] = [
      {
        type: 'assistant/message',
        seq: 0,
        time: 1_000,
        data: {
          turn: 1,
          step: 1,
          message: createAssistantMessage({
            content: [
              {
                type: 'text',
                text: 'ok \u0000nul \u0007bell \u001b[31mred\u001b[0m done',
              },
            ],
            source: { provider: 'test-provider', model: 'test-model' },
          }),
        },
        surfaceOp: 'append',
      },
    ]
    const markdown = renderSessionMarkdown(events)
    expect(markdown).toContain(
      'ok \\x00nul \\x07bell \\x1b[31mred\\x1b[0m done',
    )
    expect(markdown).not.toContain('\u0000')
    expect(markdown).not.toContain('\u0007')
    expect(markdown).not.toContain('\u001b')
  })

  it('omits model-visible context messages from the human transcript', () => {
    const events: SessionEvent[] = [
      {
        type: 'user/message',
        seq: 0,
        time: 1_000,
        data: createUserMessage({
          content: [{ type: 'text', text: 'internal runtime context' }],
          source: { kind: 'plugin', plugin: 'test', form: 'snapshot', sections: [] },
        }),
        surfaceOp: 'append',
      },
      {
        type: 'user/message',
        seq: 1,
        time: 2_000,
        data: createUserMessage({
          content: [{ type: 'text', text: 'visible human prompt' }],
          source: { kind: 'user' },
        }),
        surfaceOp: 'append',
      },
    ]

    const markdown = renderSessionMarkdown(events)
    expect(markdown).toContain('visible human prompt')
    expect(markdown).not.toContain('internal runtime context')
    expect(markdown.match(/^## User/mgu)).toHaveLength(1)
  })
})

describe('session export command', () => {
  it('rejects if the encoded filename no longer remains a direct child', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'dsh-tui-export-containment-'))
    roots.push(outer)
    const exportDir = join(outer, 'selected')
    vi.stubGlobal('encodeURIComponent', () => '../escape')

    await expect(exportSessionMarkdown(
      SessionValue.create(SessionId('escape-attempt')),
      exportDir,
    )).rejects.toThrow('direct child')
    await expect(readdir(exportDir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a separator-bearing session id inside the selected directory', async () => {
    const outer = await mkdtemp(join(tmpdir(), 'dsh-tui-export-path-'))
    roots.push(outer)
    const exportDir = join(outer, 'selected')
    const session = SessionValue.create(
      SessionId('../../../outside\\windows'),
    )

    const target = await exportSessionMarkdown(session, exportDir)

    expect(dirname(resolve(target))).toBe(resolve(exportDir))
    expect(await readdir(exportDir)).toEqual([basename(target)])
    expect(basename(target)).toMatch(/^session-.+\.md$/u)
  })

  it('writes the live session transcript to the working directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-export-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    await controller.start()

    const session = controller.session
    expect(session).toBeDefined()
    appendRound(session!, 1, 'apple')
    appendRound(session!, 2, 'banana')

    controller.dispatch({ kind: 'command', query: 'export' })
    const target = join(root, `session-${session!.id}.md`)
    let content = ''
    await vi.waitFor(
      async () => {
        content = await readFile(target, 'utf8')
        expect(content).toContain('please buy apple')
      },
      { timeout: 5_000 },
    )

    // Both rounds' user and assistant texts are present with headings.
    expect(content).toContain('## User —')
    expect(content).toContain('## Assistant —')
    expect(content).toContain('please buy apple')
    expect(content).toContain('ok, apple ordered')
    expect(content).toContain('please buy banana')
    expect(content).toContain('ok, banana ordered')
    await ctx.fiber.dispose()
  })

  it('surfaces a ✗ feedback row when the exporter rejects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-export-failure-'))
    roots.push(root)
    const { ctx, controller } = await bench(root)
    await controller.start()
    const session = controller.session
    expect(session).toBeDefined()
    appendRound(session!, 1, 'apple')
    const spy = vi
      .spyOn(await import('../src/export.ts'), 'exportSessionMarkdown')
      .mockRejectedValueOnce(new Error('disk full'))
    try {
      controller.dispatch({ kind: 'command', query: 'export' })
      await vi.waitFor(() => {
        expect(controller.getFeedback()).toBe('✗ 会话导出失败：disk full')
      }, { timeout: 5_000 })
    } finally {
      spy.mockRestore()
    }
    await ctx.fiber.dispose()
  })
})
