/** Offline integration: real goal authority, continuation driver, loop and session log. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import GoalService from '@deepseek-ai/dsh-goal'
import * as GoalDriver from '@deepseek-ai/dsh-goal-round-driver'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'

class Reply extends LlmAdapter {
  requests = 0
  beforeReply?: (request: GenerateOptions) => void
  override async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests++
    this.beforeReply?.(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Work remains; goal is active.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function bench() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(GoalService)
  await ctx.plugin(GoalDriver)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new Reply()
  ctx.llm.registerAdapter(['goal-offline'], adapter)
  const agent = await ctx.agentLoop.create(SessionId(`tui-goal-${Math.random()}`), { provider: 'goal-offline', model: 'test' })
  return { ctx, adapter, agent }
}

describe('goal continuation wiring', () => {
  it('continues after normal replies and a mid-round objective edit until its round cap', async () => {
    const { ctx, adapter, agent } = await bench()
    try {
      adapter.beforeReply = () => {
        if (adapter.requests !== 3) return
        const goal = ctx.goals.get(agent)!
        ctx.goals.edit(agent, goal, { objective: 'Edited objective' })
      }
      ctx.goals.create(agent, { objective: 'Finish the work', maxGoalRounds: 4 })
      await vi.waitFor(() => expect(ctx.goals.get(agent)?.phase).toBe('blocked'))
      expect(adapter.requests).toBe(4)
      const rounds = agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'goal' ? [event.data.source] : [])
      expect(rounds).toMatchObject([
        { round: 1, revision: 1 }, { round: 2, revision: 1 }, { round: 3, revision: 1 }, { round: 4, revision: 2 },
      ])
      expect(ctx.goals.get(agent)).toMatchObject({ blockedReason: { code: 'round-limit' }, roundsStarted: 4, activation: 'disarmed' })
    } finally { await ctx.fiber.dispose() }
  })

  it('does not secretly rearm a disarmed goal; explicit resume continues it', async () => {
    const { ctx, adapter, agent } = await bench()
    try {
      adapter.beforeReply = () => { if (adapter.requests === 1) ctx.goals.disarm(agent) }
      ctx.goals.create(agent, { objective: 'Finish the work', maxGoalRounds: 2 })
      await vi.waitFor(() => expect(agent.status).toBe('idle'))
      await vi.waitFor(() => expect(adapter.requests).toBe(1))
      expect(ctx.goals.get(agent)).toMatchObject({ phase: 'active', activation: 'disarmed', roundsStarted: 1 })
      ctx.goals.resume(agent, ctx.goals.get(agent)!)
      await vi.waitFor(() => expect(ctx.goals.get(agent)?.phase).toBe('blocked'))
      expect(adapter.requests).toBe(2)
    } finally { await ctx.fiber.dispose() }
  })
})
