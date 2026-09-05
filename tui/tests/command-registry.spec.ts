/**
 * Command-registry wiring: the slash-command directory merges the registry's
 * descriptors for the live agent (minus the Web-only `/export` placeholder)
 * with the TUI's local commands; dispatch forwards non-local lines to
 * `ctx.commands.execute` and renders the settled result through the feedback
 * row; unknown commands surface `✗ 未知命令`; `/resume` opens the session list
 * without toggling it closed; `/reload` requests process
 * replacement; `/help` renders the merged directory plus the key cheat sheet; `@` mentions list the workspace
 * directory and the skill registry. Overlapping runs land only the newest
 * (the seq guard also silences the abort a session rebind triggers), and
 * Ctrl+N closes every overlay panel across the new session.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {
  Agent,
  AgentHandle,
  CreateAgentOptions,
} from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { RuntimeController } from '../src/index.ts'
import type { TuiIo } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

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
  requestReload: ReturnType<typeof vi.fn>
}

/** Mount the services, the command registry, and a scripted agent factory. */
async function bench(root?: string): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'test-provider',
    model: 'test-model',
  })
  await ctx.plugin(CommandRuntime)
  if (root !== undefined) {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(SkillRegistry)
  }
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
  const requestReload = vi.fn()
  const controller = new RuntimeController(
    ctx,
    io,
    { task: '', ...(root === undefined ? {} : { cwd: root }) },
    () => {},
    requestReload,
  )
  return { ctx, controller, requestReload }
}

describe('command directory', () => {
  it('merges the registry descriptors with the local commands and filters the Web /export placeholder', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    // Simulate the base patch's real registrations plus the Web-only export.
    ctx.commands.register({
      name: 'compact',
      description: 'Compact older conversation history',
      handler: () => ({ kind: 'success', text: 'ok' }),
    })
    ctx.commands.register({
      name: 'permission',
      description: 'Switch the permission preset (sandbox mode + approval policy)',
      handler: () => ({ kind: 'success', text: 'ok' }),
    })
    ctx.commands.register({
      name: 'feedback',
      description: 'Record feedback',
      input: { hint: '<text>' },
      handler: () => ({ kind: 'success', text: 'recorded' }),
    })
    ctx.commands.register({
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
      handler: () => ({ kind: 'success', text: 'Download request' }),
    })

    // The palette shows the registry commands plus local export/help/model/reload/settings,
    // with exactly one export entry (the Web placeholder is filtered).
    expect(controller.commands.map(command => command.name)).toEqual([
      'compact',
      'export',
      'feedback',
      'help',
      'model',
      'permission',
      'reasoning',
      'reload',
      'resume',
      'scrollbar',
      'settings',
      'status',
      'tools',
    ])
    expect(controller.commands.find(command => command.name === 'compact')).toEqual({
      name: 'compact',
      description: 'Compact older conversation history',
    })
    expect(controller.commands.find(command => command.name === 'permission')).toEqual({
      name: 'permission',
      description: 'Switch the permission preset (sandbox mode + approval policy)',
    })
    expect(controller.commands.find(command => command.name === 'settings')).toEqual({
      name: 'settings',
      description: 'Edit settings, catalogs, and General',
    })
    expect(controller.commands.find(command => command.name === 'reload')).toEqual({
      name: 'reload',
      description: 'Relaunch this process and resume the session',
    })
    expect(controller.commands.find(command => command.name === 'resume')).toEqual({
      name: 'resume',
      description: 'Switch or resume a session',
    })
    await ctx.fiber.dispose()
  })

  it('keeps the local file export entry, not the Web placeholder description', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'export',
      description: 'Download this Session log as a ZIP archive',
      handler: () => ({ kind: 'success', text: 'Download request' }),
    })

    controller.dispatch({ kind: 'command', query: 'help' })
    await vi.waitFor(() => {
      const help = controller.getHelpPane()
      expect(help.open).toBe(true)
      expect(help.lines.join('\n')).toContain('Export this session to a Markdown file')
    })
    expect(controller.getHelpPane().lines.join('\n')).not.toContain('ZIP archive')
    await ctx.fiber.dispose()
  })
})

describe('command dispatch', () => {
  it('forwards non-local commands to the registry and renders the success text', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'ping',
      description: 'Answer pong',
      handler: () => ({ kind: 'success', text: 'pong' }),
    })

    controller.dispatch({ kind: 'command', query: 'ping' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ pong')
    })
    await ctx.fiber.dispose()
  })

  it('renders an error result through the ✗ feedback convention', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'frobnicate',
      description: 'Frobnicate',
      handler: () => ({ kind: 'error', text: 'no widgets left' }),
    })

    controller.dispatch({ kind: 'command', query: 'frobnicate' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ no widgets left')
    })
    await ctx.fiber.dispose()
  })

  it('reports an unknown command instead of staying silent', async () => {
    const { ctx, controller } = await bench()
    await controller.start()

    controller.dispatch({ kind: 'command', query: 'nope' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 未知命令')
    })
    await ctx.fiber.dispose()
  })

  it('requests process replacement for /reload and does not treat it as unknown', async () => {
    const { ctx, controller, requestReload } = await bench()
    await controller.start()

    controller.dispatch({ kind: 'command', query: 'reload' })
    expect(requestReload).toHaveBeenCalledOnce()
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('does not treat a parameterized /reload line as the local reload command', async () => {
    const { ctx, controller, requestReload } = await bench()
    await controller.start()

    controller.dispatch({ kind: 'command', query: 'reload now' })
    expect(requestReload).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 未知命令')
    })
    await ctx.fiber.dispose()
  })

  it('opens the session list from /resume and does not close it when already open', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    expect(controller.getSessionPane().open).toBe(false)
    controller.dispatch({ kind: 'command', query: 'resume' })
    expect(controller.getSessionPane().open).toBe(true)
    controller.dispatch({ kind: 'command', query: 'resume' })
    expect(controller.getSessionPane().open).toBe(true)
    controller.dispatch({ kind: 'command', query: 'resume ' })
    expect(controller.getSessionPane().open).toBe(true)
    await ctx.fiber.dispose()
  })

  it('does not treat a parameterized /resume line as the local resume command', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'resume now' })
    expect(controller.getSessionPane().open).toBe(false)
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✗ 未知命令')
    })
    await ctx.fiber.dispose()
  })

  it('renders a thrown handler failure visibly', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'explode',
      description: 'Explode',
      handler: () => {
        throw new Error('kaboom')
      },
    })

    controller.dispatch({ kind: 'command', query: 'explode' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toContain('✗ kaboom')
    })
    await ctx.fiber.dispose()
  })

  it('formats a non-Error handler throw', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'string-throw',
      description: 'String throw',
      handler: () => { throw 'string exploded' },
    })
    controller.dispatch({ kind: 'command', query: 'string-throw' })
    await vi.waitFor(() => { expect(controller.getFeedback()).toBe('✗ string exploded') })
    await ctx.fiber.dispose()
  })

  it('closes the permission overlay after a successful command without text', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'silent',
      description: 'Silent success',
      handler: () => ({ kind: 'success' } as never),
    })
    controller.dispatch({ kind: 'command', query: 'permission' })
    expect(controller.getPermissionPane().open).toBe(true)
    controller.dispatch({ kind: 'command', query: 'silent' })
    await vi.waitFor(() => { expect(controller.getPermissionPane().open).toBe(false) })
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('closes the plan directory after a successful command without text', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'silent-plan',
      description: 'Silent plan switch',
      handler: () => ({ kind: 'success' }),
    })
    const state = controller as unknown as { planDirectoryOpen: boolean }
    state.planDirectoryOpen = true
    controller.dispatch({ kind: 'command', query: 'silent-plan' })
    await vi.waitFor(() => { expect(controller.getPlanDirectoryPane().open).toBe(false) })
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('keeps silent success silent when no command overlay is open', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'silent-idle',
      description: 'Silent idle command',
      handler: () => ({ kind: 'success' }),
    })
    controller.dispatch({ kind: 'command', query: 'silent-idle' })
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })
})

describe('command overlap and session rebind', () => {
  it('drops a successful settlement whose request sequence was invalidated', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    const slow = Promise.withResolvers<{ kind: 'success'; text: string }>()
    ctx.commands.register({ name: 'sequence-success', description: 'Slow', handler: () => slow.promise })
    controller.dispatch({ kind: 'command', query: 'sequence-success' })
    ;(controller as unknown as { commandSeq: number }).commandSeq++
    slow.resolve({ kind: 'success', text: 'stale sequence' })
    await slow.promise
    await Promise.resolve()
    expect(controller.getFeedback()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('drops a stale successful command result', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    const slow = Promise.withResolvers<{ kind: 'success'; text: string }>()
    ctx.commands.register({ name: 'slow-success', description: 'Slow', handler: () => slow.promise })
    ctx.commands.register({ name: 'fast-success', description: 'Fast', handler: () => ({ kind: 'success', text: 'fresh' }) })
    controller.dispatch({ kind: 'command', query: 'slow-success' })
    controller.dispatch({ kind: 'command', query: 'fast-success' })
    await vi.waitFor(() => { expect(controller.getFeedback()).toBe('✓ fresh') })
    slow.resolve({ kind: 'success', text: 'stale' })
    await Promise.resolve()
    expect(controller.getFeedback()).toBe('✓ fresh')
    await ctx.fiber.dispose()
  })
  it('lands only the newest command when runs overlap; the old rejection stays silent', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    let rejectSlow!: (reason: Error) => void
    ctx.commands.register({
      name: 'slow',
      description: 'Slow',
      handler: () =>
        new Promise<{ kind: 'success'; text: string }>((_resolve, reject) => {
          rejectSlow = reject
        }),
    })
    ctx.commands.register({
      name: 'fast',
      description: 'Fast',
      handler: () => ({ kind: 'success', text: 'fresh' }),
    })

    controller.dispatch({ kind: 'command', query: 'slow' })
    controller.dispatch({ kind: 'command', query: 'fast' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ fresh')
    })
    // The superseded run settles late with a failure: the guard discards it,
    // so the new command's feedback is never clobbered by a stale ✗.
    rejectSlow(new Error('stale failure'))
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(controller.getFeedback()).toBe('✓ fresh')
    await ctx.fiber.dispose()
  })

  it('silently drops the aborted rejection when the session rebinds (bindAgent bumps the seq)', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'slowping',
      description: 'Slow ping',
      handler: () =>
        new Promise<{ kind: 'success'; text: string }>(() => {
          // Never settles on its own; only the owning UI request can stop it.
        }),
    })

    // The command is still in flight when the user presses Ctrl+N; bindAgent
    // aborts it and bumps commandSeq, so the abort rejection is discarded
    // instead of flashing a misleading ✗ row over the new session.
    controller.dispatch({ kind: 'command', query: 'slowping' })
    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已新建会话')
    })
    await new Promise<void>(resolve => setTimeout(resolve, 30))
    expect(controller.getFeedback()).toBe('✓ 已新建会话')
    expect(controller.getFeedback()).not.toContain('✗')
    await ctx.fiber.dispose()
  })

  it('closes every overlay panel across the new session (Ctrl+N)', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'help' })
    await vi.waitFor(() => {
      expect(controller.getHelpPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'command', query: 'model' })
    expect(controller.getModelPane().open).toBe(true)
    expect(controller.getHelpPane().open).toBe(false)

    controller.dispatch({ kind: 'new-session' })
    await vi.waitFor(() => {
      expect(controller.getFeedback()).toBe('✓ 已新建会话')
    })
    expect(controller.getModelPane().open).toBe(false)
    expect(controller.getHelpPane().open).toBe(false)
    expect(controller.getSessionPane().open).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('/help', () => {
  it('opens the help sheet with every command description, hint, and the key bindings', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    ctx.commands.register({
      name: 'feedback',
      description: 'Record feedback',
      input: { hint: '<text>' },
      handler: () => ({ kind: 'success', text: 'recorded' }),
    })

    controller.dispatch({ kind: 'command', query: 'help' })
    await vi.waitFor(() => {
      const help = controller.getHelpPane()
      expect(help.open).toBe(true)
      const sheet = help.lines.join('\n')
      expect(sheet).toContain('/feedback — Record feedback 输入: <text>')
      expect(sheet).toContain('/export — Export this session to a Markdown file')
    })
    const sheet = controller.getHelpPane().lines.join('\n')
    // The old `✓ ` success-color workaround is gone: the sheet is a pane now.
    expect(sheet).not.toContain('✓ /help')
    expect(sheet).toContain('Ctrl+C 停止/退出')
    expect(sheet).toContain('Ctrl+O')
    expect(sheet).toContain('Ctrl+N')
    expect(sheet).toContain('Ctrl+K 搜索')
    expect(sheet).toContain('Ctrl+T 时间线')
    expect(sheet).toContain('Ctrl+E 工具卡')
    expect(sheet).toContain('y/n 审批')
    expect(sheet).toContain('/permission')
    expect(sheet).toContain('/settings')
    expect(sheet).toContain('g a 子代理 · g t 工作区 · g f 反馈 · g w 工作流')
    expect(sheet).toContain('↑↓/jk 滚动')
    expect(sheet).toContain('滚轮滚动 · 点击打开链接 · 拖选复制')
    expect(sheet).toContain('Esc 关闭')
    expect(sheet).toContain('/plan 计划 · /goal 目标 · /compact 压缩')
    expect(sheet).toContain('/model 模型选择')
    expect(sheet).toContain('/settings 设置')
    expect(sheet).toContain('/resume 会话')
    expect(sheet).toContain('/reload 重载')
    expect(sheet).toContain('/resume — Switch or resume a session')
    expect(sheet).toContain('/reload — Relaunch this process and resume the session')
    await ctx.fiber.dispose()
  })

  it('closes the help sheet on the help-pane toggle', async () => {
    const { ctx, controller } = await bench()
    await controller.start()
    controller.dispatch({ kind: 'command', query: 'help' })
    await vi.waitFor(() => {
      expect(controller.getHelpPane().open).toBe(true)
    })
    controller.dispatch({ kind: 'help-pane' })
    expect(controller.getHelpPane().open).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('listMentions', () => {
  it('lists workspace files and directories by prefix and skills by name or description', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tui-mentions-'))
    roots.push(root)
    await mkdir(join(root, 'notes'))
    await writeFile(join(root, 'alpha.ts'), 'export const a = 1\n')
    await writeFile(join(root, 'beta.md'), '# beta\n')
    const { ctx, controller } = await bench(root)
    ctx.skills.register({
      name: 'fetch-weather',
      description: 'Weather lookup for a city',
      source: 'runtime',
      content: 'Use the weather API.',
    })

    const all = await controller.listMentions(root, '')
    expect(all.map(candidate => candidate.name).sort()).toEqual([
      'alpha.ts',
      'beta.md',
      'fetch-weather',
      'notes',
    ])
    expect(all.find(candidate => candidate.name === 'alpha.ts')).toMatchObject({
      kind: 'file',
      target: join(root, 'alpha.ts'),
    })
    expect(all.find(candidate => candidate.name === 'notes')).toMatchObject({
      kind: 'directory',
    })
    expect(all.find(candidate => candidate.name === 'fetch-weather')).toMatchObject({
      kind: 'skill',
      description: 'Weather lookup for a city',
    })

    // Files match by case-insensitive prefix only.
    expect(await controller.listMentions(root, 'al')).toEqual([
      expect.objectContaining({ kind: 'file', name: 'alpha.ts' }),
    ])
    expect(await controller.listMentions(root, 'note')).toEqual([
      expect.objectContaining({ kind: 'directory', name: 'notes' }),
    ])
    // Skills match on name or description.
    expect(await controller.listMentions(root, 'weather')).toEqual([
      expect.objectContaining({ kind: 'skill', name: 'fetch-weather' }),
    ])
    expect(await controller.listMentions(root, 'fetch')).toEqual([
      expect.objectContaining({ kind: 'skill', name: 'fetch-weather' }),
    ])
    expect(await controller.listMentions(root, 'zzz')).toEqual([])
    await ctx.fiber.dispose()
  })
})
