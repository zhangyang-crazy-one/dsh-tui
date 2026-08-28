import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentRegistry, { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createProjector } from '@deepseek-ai/dsh-tui-render'
import { decideNotify, DEFAULT_NOTIFY_QUIET_INPUT_SECONDS } from '../src/notify.ts'
import { RuntimeController, internals } from '../src/index.ts'

const OSC99_COMPLETED = '\x1b]99;i=1:d=0;DeepSeek ✅ 任务完成\x07'
const BEL = '\x07'

describe('decideNotify', () => {
  const attention = { mode: 'attention' as const, quietInputSeconds: 10 }

  it('is silent when the policy is off', () => {
    expect(decideNotify({
      kind: 'idle',
      settings: { mode: 'off', quietInputSeconds: 10 },
      secondsSinceLastInput: 999,
      turnEndReason: 'completed',
    })).toBeUndefined()
  })

  it('maps every turn-end reason to its own copy line', () => {
    const body = (reason: Parameters<typeof decideNotify>[0]['turnEndReason'], errorText?: string): string | undefined => {
      const decision = decideNotify({
        kind: 'idle',
        settings: attention,
        secondsSinceLastInput: 999,
        turnEndReason: reason,
        errorText,
      })
      return decision && decision.desktop ? decision.body : undefined
    }
    expect(body('completed')).toBe('✅ 任务完成')
    expect(body('error', 'rate limited')).toBe('❌ 回合失败:rate limited')
    expect(body('max-tokens')).toBe('⚠ 输出达到上限,回合被截断')
    expect(body('blocked')).toBe('⛔ 回合被策略阻塞')
    expect(body('interrupted')).toBe('⚠ 上次会话异常中断,回合已收尾')
  })

  it('truncates error text to the summary limit', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'error',
      errorText: 'x'.repeat(200),
    })
    expect(decision).toBeDefined()
    if (decision !== undefined && decision.desktop) {
      expect(decision.body.startsWith('❌ 回合失败:')).toBe(true)
      expect(decision.body.length).toBeLessThanOrEqual('❌ 回合失败:'.length + DEFAULT_NOTIFY_QUIET_INPUT_SECONDS + 80)
    }
  })

  it('truncates summary text on Unicode code points so emojis never split', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'error',
      errorText: '😀'.repeat(120),
    })
    expect(decision && decision.desktop).toBeDefined()
    if (decision !== undefined && decision.desktop) {
      const afterPrefix = decision.body.slice('❌ 回合失败:'.length)
      const codePoints = Array.from(afterPrefix)
      expect(codePoints).toHaveLength(80)
      expect(codePoints.every(char => char === '😀')).toBe(true)
    }
  })

  it('keeps the session title suffix inside the embedded summary limit', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'completed',
      sessionTitle: '修复通知',
    })
    expect(decision && decision.desktop && decision.body).toBe('✅ 任务完成 · 修复通知')
  })

  it('truncates the ask-user question text on code points before appending the suffix', () => {
    const decision = decideNotify({
      kind: 'ask-user',
      settings: attention,
      secondsSinceLastInput: 999,
      questionText: '?'.repeat(120),
      sessionTitle: '选择部署',
    })
    expect(decision && decision.desktop).toBeDefined()
    if (decision !== undefined && decision.desktop) {
      const prefix = '❓ 需要回答:'
      const suffix = ' · 选择部署'
      expect(decision.body.startsWith(prefix)).toBe(true)
      expect(decision.body.endsWith(suffix)).toBe(true)
      const codePoints = Array.from(decision.body)
      expect(codePoints.length).toBe(prefix.length + 80 + suffix.length)
    }
  })

  it('stays silent for a user-initiated abort in attention mode', () => {
    expect(decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'aborted',
      abortCause: { kind: 'user' },
    })).toBeUndefined()
  })

  it('uses the interrupted copy for non-user aborts in attention mode', () => {
    const body = (cause: Parameters<typeof decideNotify>[0]['abortCause']): string | undefined => {
      const decision = decideNotify({
        kind: 'idle',
        settings: attention,
        secondsSinceLastInput: 999,
        turnEndReason: 'aborted',
        abortCause: cause,
      })
      return decision && decision.desktop ? decision.body : undefined
    }
    expect(body({ kind: 'parent' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'hook', reason: 'toolchain veto' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'disposed' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'legacy' })).toBe('⚠ 上次会话异常中断,回合已收尾')
  })

  it('keeps the legacy cancel copy only for explicit user aborts under every-turn', () => {
    const body = (cause: Parameters<typeof decideNotify>[0]['abortCause']): string | undefined => {
      const decision = decideNotify({
        kind: 'idle',
        settings: { mode: 'every-turn', quietInputSeconds: 10 },
        secondsSinceLastInput: 0,
        turnEndReason: 'aborted',
        abortCause: cause,
      })
      return decision && decision.desktop ? decision.body : undefined
    }
    expect(body({ kind: 'user' })).toBe('⏹ 回合已取消')
    expect(body({ kind: 'parent' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'hook', reason: 'toolchain veto' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'disposed' })).toBe('⚠ 上次会话异常中断,回合已收尾')
    expect(body({ kind: 'legacy' })).toBe('⚠ 上次会话异常中断,回合已收尾')
  })

  it('emits the canonical `⏹ 回合已取消` line under every-turn even with a resolved session title', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: { mode: 'every-turn', quietInputSeconds: 10 },
      secondsSinceLastInput: 0,
      turnEndReason: 'aborted',
      abortCause: { kind: 'user' },
      sessionTitle: '修复通知',
    })
    expect(decision).toEqual({
      desktop: true,
      title: 'DeepSeek',
      body: '⏹ 回合已取消',
      urgency: 'normal',
    })
  })

  it('emits the explicit titleSuffix alongside the body when a session title is resolved', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'completed',
      sessionTitle: '修复通知',
    })
    expect(decision).toEqual({
      desktop: true,
      title: 'DeepSeek',
      body: '✅ 任务完成 · 修复通知',
      urgency: 'normal',
      titleSuffix: ' · 修复通知',
    })
  })

  it('omits the titleSuffix when no session title is resolved', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'completed',
    })
    expect(decision && 'titleSuffix' in decision).toBe(false)
  })

  it('uses the interrupted copy when an aborted reason lacks a cause under every-turn', () => {
    expect(decideNotify({
      kind: 'idle',
      settings: { mode: 'every-turn', quietInputSeconds: 10 },
      secondsSinceLastInput: 0,
      turnEndReason: 'aborted',
    })).toEqual({
      desktop: true,
      title: 'DeepSeek',
      body: '⚠ 上次会话异常中断,回合已收尾',
      urgency: 'normal',
    })
  })

  it('treats an aborted reason without a cause as a non-user abort in attention mode', () => {
    expect(decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'aborted',
    })).toEqual({
      desktop: true,
      title: 'DeepSeek',
      body: '⚠ 上次会话异常中断,回合已收尾',
      urgency: 'normal',
    })
  })

  it('falls through unknown merged reason kinds to the default line', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'plugin-new-kind' as Parameters<typeof decideNotify>[0]['turnEndReason'],
    })
    expect(decision && decision.desktop && decision.body).toBe('⚠ 回合异常结束')
  })

  it('downgrades to bell-only inside the quiet-input window', () => {
    expect(decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 3,
      turnEndReason: 'completed',
    })).toEqual({ desktop: false })
    expect(decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 3,
      turnEndReason: 'aborted',
      abortCause: { kind: 'user' },
    })).toBeUndefined()
    expect(decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 3,
      turnEndReason: 'aborted',
      abortCause: { kind: 'parent' },
    })).toEqual({ desktop: false })
  })

  it('appends the session title suffix when a title exists', () => {
    const decision = decideNotify({
      kind: 'idle',
      settings: attention,
      secondsSinceLastInput: 999,
      turnEndReason: 'completed',
      sessionTitle: '修复通知',
    })
    expect(decision && decision.desktop && decision.body).toBe('✅ 任务完成 · 修复通知')
  })

  it('marks approval and ask-user asks critical with their summaries', () => {
    const approval = decideNotify({
      kind: 'approval',
      settings: attention,
      secondsSinceLastInput: 999,
      toolName: 'Bash',
    })
    expect(approval && approval.desktop && approval.urgency).toBe('critical')
    expect(approval && approval.desktop && approval.body).toBe('⏸ 需要批准:Bash')
    const ask = decideNotify({
      kind: 'ask-user',
      settings: attention,
      secondsSinceLastInput: 999,
      questionText: '选择部署目标?',
    })
    expect(ask && ask.desktop && ask.urgency).toBe('critical')
    expect(ask && ask.desktop && ask.body).toBe('❓ 需要回答:选择部署目标?')
  })
})

async function bench(): Promise<{
  ctx: Context
  controller: RuntimeController
  session: ReturnType<SessionStore['create']>
  writes: string[]
  notifySpawns: Array<{ command: string; args: readonly string[] }>
  restore: () => void
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const followup = vi.fn<(message: ReturnType<typeof createUserMessage>) => void>()
  const steer = vi.fn<(message: ReturnType<typeof createUserMessage>) => void>()
  const session = ctx.sessions.create(SessionId(`notify-${randomUUID()}`))
  let disposed = false
  const agent = {} as Agent
  Object.assign(agent, {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, {
      inserted: () => {},
      claimed: () => {},
      discarded: () => {},
    }),
    status: 'running',
    ctx,
    cancel: (): void => {},
    whenIdle: (): Promise<void> => Promise.resolve(),
    runMaintenance: (): Promise<never> => Promise.reject(new Error('not used')),
    send: (): void => {},
    followup: (message: ReturnType<typeof createUserMessage>): void => {
      followup(message)
    },
    steer: (message: ReturnType<typeof createUserMessage>): void => {
      steer(message)
    },
    inject: (): void => {},
  } satisfies Partial<Agent>)
  const writes: string[] = []
  const controller = new RuntimeController(
    ctx,
    { stdout: { write: (chunk) => { writes.push(chunk); return true } }, stderr: { write: () => true }, exit: () => {} },
    { task: '' },
    () => {},
  )
  const state = controller as unknown as {
    commitCandidate(candidate: {
      handle: { agent: Agent; dispose(): Promise<void> }
      projector: ReturnType<typeof createProjector>
      modelSelectionRef: {
        current: { provider: string; model: string }
        assembled: undefined
      }
      badge: string
    }): void
    machine: 'generating'
  }
  state.commitCandidate({
    handle: {
      agent,
      dispose: (): Promise<void> => {
        disposed = true
        return Promise.resolve()
      },
    },
    projector: createProjector(),
    modelSelectionRef: {
      current: { provider: 'test-provider', model: 'test-model' },
      assembled: undefined,
    },
    badge: 'test-provider · test-model',
  })
  void disposed
  const originalEnvironment = internals.notifyEnvironment
  const originalNotifySpawn = internals.notifySpawn
  const notifySpawns: Array<{ command: string; args: readonly string[] }> = []
  internals.notifySpawn = (command, args) => {
    notifySpawns.push({ command, args })
  }
  return {
    ctx,
    controller,
    session,
    writes,
    notifySpawns,
    restore: () => {
      internals.notifyEnvironment = originalEnvironment
      internals.notifySpawn = originalNotifySpawn
    },
  }
}

describe('turn-end notifications', () => {
  it('records the turn ending without popping until the run settles', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(writes).toEqual([])
    } finally {
      restore()
    }
  })

  it('emits the settled summary once when the run drains', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([OSC99_COMPLETED])
    } finally {
      restore()
    }
  })

  it('stays silent when the tui section disables notifications', async () => {
    const { controller, session, writes, restore } = await bench()
    const withSection = controller as unknown as {
      readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' } | undefined
    }
    withSection.readTuiSettings = () => ({ notify: 'off' })
    try {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([])
    } finally {
      restore()
    }
  })

  it('rings BEL and spawns the literal notify-send helper with urgency on fallback terminals', async () => {
    const { controller, session, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toContain(BEL)
      expect(notifySpawns).toEqual([{
        command: 'notify-send',
        args: ['-u', 'normal', 'DeepSeek', '✅ 任务完成'],
      }])
    } finally {
      restore()
    }
  })

  it('rings bell only when the last keypress is inside the quiet window', async () => {
    const { controller, session, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([BEL])
      expect(notifySpawns).toEqual([])
    } finally {
      restore()
    }
  })

  it('pops one notification per turn end under the every-turn escape hatch', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    const withSection = controller as unknown as {
      readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' } | undefined
    }
    withSection.readTuiSettings = () => ({ notify: 'every-turn' })
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      expect(writes.filter(chunk => chunk === OSC99_COMPLETED)).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it('notifies the approval ask the moment it enqueues', async () => {
    const { controller, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    try {
      const agent = (controller as unknown as { agent: Agent }).agent
      void (controller as unknown as {
        enqueueApproval(request: { agent: Agent; toolName: string }): Promise<unknown>
      }).enqueueApproval({ agent, toolName: 'Bash' })
      expect(writes).toEqual([BEL])
      expect(notifySpawns).toEqual([{
        command: 'notify-send',
        args: ['-u', 'critical', 'DeepSeek', '⏸ 需要批准:Bash'],
      }])
    } finally {
      restore()
    }
  })

  it('contains synchronous notify-send launch failures', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    internals.notifySpawn = () => { throw new Error('missing helper') }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      expect(() => {
        ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      }).not.toThrow()
      expect(writes).toEqual([BEL])
    } finally {
      restore()
    }
  })

  it('falls back to the first user text when no persisted title exists', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: '修复通知摘要' })
      session.append('user/message', {
        id: 'u1' as never,
        content: [{ type: 'text', text: '修复通知摘要' }],
        source: { kind: 'user' },
      } as never, { surfaceOp: 'append' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      const write = writes.find(chunk => chunk.includes('✅ 任务完成'))
      expect(write).toBeDefined()
      expect(write).toContain('· 修复通知摘要')
    } finally {
      restore()
    }
  })

  it('prefers the persisted title over the first user text fallback', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: '修复通知摘要' })
      session.append('user/message', {
        id: 'u1' as never,
        content: [{ type: 'text', text: '修复通知摘要' }],
        source: { kind: 'user' },
      } as never, { surfaceOp: 'append' })
      session.append('session/title', {
        title: '跑测试',
        messageSeqs: [],
        source: { kind: 'user' },
      })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      const write = writes.find(chunk => chunk.includes('✅ 任务完成'))
      expect(write).toBeDefined()
      expect(write).toContain('· 跑测试')
      expect(write).not.toContain('修复通知摘要')
    } finally {
      restore()
    }
  })

  it('omits the title suffix when neither persisted title nor user text exists', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([OSC99_COMPLETED])
    } finally {
      restore()
    }
  })

  it('passes the full abort cause through to the settled summary decision', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', {
        turn: 1,
        reason: { kind: 'aborted', reason: { kind: 'parent' } },
      })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      const write = writes.find(chunk => chunk.includes('异常中断'))
      expect(write).toBeDefined()
    } finally {
      restore()
    }
  })

  it('stays silent at the controller for user-initiated aborts in attention mode', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', {
        turn: 1,
        reason: { kind: 'aborted', reason: { kind: 'user' } },
      })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([])
    } finally {
      restore()
    }
  })

  it('attention quiet window routes the approval ask to bell only and skips the desktop helper', async () => {
    const { controller, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    try {
      const agent = (controller as unknown as { agent: Agent }).agent
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      void (controller as unknown as {
        enqueueApproval(request: { agent: Agent; toolName: string }): Promise<unknown>
      }).enqueueApproval({ agent, toolName: 'Bash' })
      expect(writes).toEqual([BEL])
      expect(notifySpawns).toEqual([])
    } finally {
      restore()
    }
  })

  it('attention quiet window routes the ask-user question to bell only and skips the desktop helper', async () => {
    const { controller, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    try {
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      ;(controller as unknown as {
        notifyAttention(input: { kind: 'ask-user'; questionText?: string }): void
      }).notifyAttention({ kind: 'ask-user', questionText: 'pick a target' })
      expect(writes).toEqual([BEL])
      expect(notifySpawns).toEqual([])
    } finally {
      restore()
    }
  })

  it('attention quiet window downgrades the OSC99 transport to BEL when keyboard input is recent', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      expect(writes).toEqual([BEL])
    } finally {
      restore()
    }
  })

  it('every-turn bypasses the quiet window so desktop notifications still pop after recent input', async () => {
    const { controller, session, writes, restore } = await bench()
    internals.notifyEnvironment = { TERM_PROGRAM: 'iTerm.app' }
    const withSection = controller as unknown as {
      readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' } | undefined
    }
    withSection.readTuiSettings = () => ({ notify: 'every-turn' })
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
      expect(writes.filter(chunk => chunk === OSC99_COMPLETED)).toHaveLength(2)
    } finally {
      restore()
    }
  })

  it('every-turn bypasses the quiet window for approval and ask-user events too', async () => {
    const { controller, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    const withSection = controller as unknown as {
      readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' } | undefined
    }
    withSection.readTuiSettings = () => ({ notify: 'every-turn' })
    try {
      const agent = (controller as unknown as { agent: Agent }).agent
      ;(controller as unknown as { noteUserActivity(): void }).noteUserActivity()
      void (controller as unknown as {
        enqueueApproval(request: { agent: Agent; toolName: string }): Promise<unknown>
      }).enqueueApproval({ agent, toolName: 'Bash' })
      ;(controller as unknown as {
        notifyAttention(input: { kind: 'ask-user'; questionText?: string }): void
      }).notifyAttention({ kind: 'ask-user', questionText: 'pick a target' })
      expect(writes.filter(chunk => chunk === BEL)).toHaveLength(2)
      expect(notifySpawns).toEqual([
        { command: 'notify-send', args: ['-u', 'critical', 'DeepSeek', '⏸ 需要批准:Bash'] },
        { command: 'notify-send', args: ['-u', 'critical', 'DeepSeek', '❓ 需要回答:pick a target'] },
      ])
    } finally {
      restore()
    }
  })

  it('off policy emits neither desktop notification nor BEL for idle, approval, or ask-user events', async () => {
    const { controller, session, writes, notifySpawns, restore } = await bench()
    internals.notifyEnvironment = { TERM: 'vt100' }
    const withSection = controller as unknown as {
      readTuiSettings?: () => { notify?: 'off' | 'attention' | 'every-turn' } | undefined
    }
    withSection.readTuiSettings = () => ({ notify: 'off' })
    try {
      controller.dispatch({ kind: 'send', text: 'start' })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      ;(controller as unknown as { notifyRunSettled(): void }).notifyRunSettled()
      const agent = (controller as unknown as { agent: Agent }).agent
      void (controller as unknown as {
        enqueueApproval(request: { agent: Agent; toolName: string }): Promise<unknown>
      }).enqueueApproval({ agent, toolName: 'Bash' })
      ;(controller as unknown as {
        notifyAttention(input: { kind: 'ask-user'; questionText?: string }): void
      }).notifyAttention({ kind: 'ask-user', questionText: 'pick a target' })
      expect(writes).toEqual([])
      expect(notifySpawns).toEqual([])
    } finally {
      restore()
    }
  })
})
