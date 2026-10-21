/** Terminal composition uses the official registry, Loader scopes and durable selection. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import PresetRegistry from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { afterEach, expect, it } from 'vitest'
import { TerminalPresets, BASE_AGENT_PLUGIN_IDS } from '../src/presets.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { presetTestService: { label: string } }
}

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  ctx.loader.builtins.preset = AgentPreset
  ctx.loader.builtins.contribute = {
    inject: ['tools'],
    apply(child: Context, config: { tool: string }) {
      child.tools.register({
        name: config.tool, description: config.tool,
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
        execute: () => Promise.resolve(config.tool),
      })
    },
  }
  ctx.loader.builtins.provider = { apply(child: Context) { child.provide('presetTestService', { label: 'minimal' }) } }
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(PresetRegistry, { default: 'standard' })
  await ctx.loader.root.update([
    { id: 'standard', name: 'cordis:preset', config: { id: 'standard', plugins: [{ name: 'cordis:contribute', config: { tool: 'read' } }] } },
    { id: 'minimal', name: 'cordis:preset', config: { id: 'minimal', plugins: [
      { name: 'cordis:contribute', config: { tool: 'bash' } },
      { name: 'cordis:group', group: true, isolate: { presetTestService: true }, config: [{ name: 'cordis:provider' }] },
    ] } },
    { id: 'broken', name: 'cordis:preset', config: { id: 'broken', plugins: [{ name: 'cordis:missing' }] } },
  ])
  return { ctx, presets: new TerminalPresets(ctx) }
}

it('lists failed definitions and reads the actual declaration for terminal inspection', async () => {
  const { presets } = await harness()
  expect((await presets.list()).find(row => row.id === 'standard')).toMatchObject({ isDefault: true })
  expect((await presets.list()).find(row => row.id === 'broken')?.broken).toBeTruthy()
  expect((await presets.read('minimal')).content).toContain('cordis:contribute')
})

it('mounts before publication and switches standard to minimal without Host tool leakage', async () => {
  const { ctx, presets } = await harness()
  const composition = await presets.setup('standard')
  const handle = await ctx.agents.create({
    sessionId: SessionId('preset-switch'), meta: { agentPreset: composition.agentPreset! }, setup: composition.setup,
  })
  const agent = handle.agent
  const { agent: other } = await ctx.agents.create({ sessionId: SessionId('preset-other'), setup: composition.setup })
  expect(ctx.tools.schemas().map(tool => tool.name)).toEqual([])
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['read'])
  expect(presets.current(agent.session)).toBe('standard')
  expect(await presets.select(agent, 'minimal')).toBe('minimal')
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['bash'])
  expect(presets.current(agent.session)).toBe('minimal')
  expect(ctx.tools.schemas(other).map(tool => tool.name)).toEqual(['read'])
  expect(presets.serviceFor(other, 'presetTestService')).toBeUndefined()
  expect(agent.session.header.agentPreset).toBe('standard')
  expect(presets.serviceFor(agent, 'presetTestService')).toEqual({ label: 'minimal' })
  expect(ctx.get('presetTestService')).toBeUndefined()
})

it('delegates first-turn locking to the real registry and keeps the committed selection', async () => {
  const { ctx, presets } = await harness()
  const composition = await presets.setup()
  const { agent } = await ctx.agents.create({ sessionId: SessionId('preset-lock'), setup: composition.setup })
  await presets.select(agent, 'minimal')
  agent.session.append('turn/start', { turn: 1 })
  await expect(presets.select(agent, 'standard')).rejects.toMatchObject({ code: 'agent-preset/locked' })
  expect(presets.current(agent.session)).toBe('minimal')
  expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(['bash'])
})

it('restores the projection selection instead of the creation header', async () => {
  const { ctx, presets } = await harness()
  const composition = await presets.setup('standard')
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('preset-source'), meta: { agentPreset: composition.agentPreset! }, setup: composition.setup,
  })
  await presets.select(agent, 'minimal')
  const restore = await presets.setup(undefined, agent.session)
  expect(restore.agentPreset).toBe('minimal')
  const { agent: restored } = await ctx.agents.create({
    sessionId: SessionId('preset-restored'), meta: { agentPreset: 'standard' },
    seed: agent.session.snapshotEvents(), setup: (agentCtx, restoredAgent) => presets.restore(agentCtx, restoredAgent),
  })
  expect(presets.current(restored.session)).toBe('minimal')
  expect(ctx.agentPresets.composedPreset(restored.ctx)).toBe('minimal')
  expect(ctx.tools.schemas(restored).map(tool => tool.name)).toEqual(['bash'])
})

it('never falls back to the default for unknown or broken definitions', async () => {
  const { ctx, presets } = await harness()
  await expect(presets.setup('absent')).rejects.toMatchObject({ code: 'agent-preset/not-found' })
  const broken = await presets.setup('broken')
  await expect(ctx.agents.create({ sessionId: SessionId('broken-agent'), setup: broken.setup })).rejects.toThrow()
  expect(ctx.agents.get(SessionId('broken-agent'))).toBeUndefined()
})

it('preserves legacy preset-free deployments and only rejects an explicit unavailable selection', async () => {
  const ctx = new Context()
  contexts.push(ctx)
  const presets = new TerminalPresets(ctx)
  expect(await presets.list()).toEqual([])
  expect(await presets.setup()).toMatchObject({ setup: expect.any(Function) })
  await expect(presets.setup('minimal')).rejects.toThrow('agentPresets')
  await expect(presets.read('minimal')).rejects.toThrow('agentPresets')
})

it('disables all base and terminal agent contributions before mounting per-session declarations', () => {
  const patch = readFileSync(new URL('../../presets/base-disable.patch.yml', import.meta.url), 'utf8')
  for (const id of BASE_AGENT_PLUGIN_IDS) {
    expect(patch).toContain(`- id: ${id}\n  disabled: true`)
  }
  for (const id of ['tools', 'skill', 'subagents', 'jobs', 'goals', 'token-meter', 'shell-env', 'schedule']) {
    expect(BASE_AGENT_PLUGIN_IDS).not.toContain(id)
  }
})

// SHA-256 of the tracked rc.2 declarations, not a snapshot of terminal output.
it('ships the four official rc.2 declarations without widening their tools', () => {
  const expected = {
    standard: '0d398d2a6872a73a106cb3bd19303ecccf1637e1fcad4d0bf9d8a72d2c2c68f5',
    ptc: '9e355c947bf61c3d2fe9bf3214b386f83c0d99d37579ce22576d4b82cb6e1a2c',
    minimal: 'a2a9ba1c9c392a45466708f18bc0aefbf300577f9b544dc06049f73a8a5b3267',
    cordis: '01b0fc94fd49136b332254a7ae5658e43ffe646f7248047dba65d499cfc74596',
  }
  for (const [id, sha256] of Object.entries(expected)) {
    const bytes = readFileSync(new URL(`../../presets/${id}.patch.yml`, import.meta.url))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
  }
})
