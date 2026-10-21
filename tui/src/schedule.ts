/** Official durable scheduling with the terminal's transport-free Session resolver. */
import { Context, Service } from '@deepseek-ai/cordis'
import type { AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { ApiSessionAgentController } from '@deepseek-ai/dsh-api-session-controller/src/agent.ts'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { installModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/src/model-selection-projection.ts'
import ScheduleService from '@deepseek-ai/dsh-schedule'
import type { Config as ScheduleConfig } from '@deepseek-ai/dsh-schedule'
import type { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'tui-schedule'
export const inject = ['agents', 'sessions', 'storageDomain', 'sessionPersistence',
  'agentDefaultModel', 'sessionQuery', 'sessionProjections', 'typert']
export const Config = ScheduleService.Config

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared activation owner for reminder delivery and terminal Session switches. */
    tuiScheduleSessions: TuiScheduleSessions
  }
}

/** A UI borrows restored Agents; the owning plugin retains their cleanup handles. */
export class TuiScheduleSessions extends Service {
  private readonly controller: ApiSessionAgentController

  constructor(ctx: Context) {
    super(ctx, 'tuiScheduleSessions')
    installModelSelectionProjection(ctx)
    this.controller = new ApiSessionAgentController(ctx)
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'request/header') return
      const agent = ctx.agents.get(session.id)
      if (agent?.session !== session) return
      const config = event.data.header.config
      this.controller.consumeSelection(agent, config.provider, config.model, config.reasoningEffort)
    })
  }

  /** Use the official resolver's subagent checks, persistence reads and resume deduplication. */
  resolveAgent(sessionId: SessionId): ReturnType<ApiSessionAgentController['resolveAgent']> {
    return this.controller.resolveAgent(sessionId)
  }

  /** Restore or borrow one Agent without acquiring a second writer for the UI. */
  async acquire(sessionId: SessionId): Promise<{ handle: AgentHandle; modelSelectionRef: ModelSelectionRef }> {
    const result = await this.resolveAgent(sessionId)
    if ('error' in result) throw result.error
    const { agent } = result
    return {
      handle: { agent, dispose: async () => {} },
      modelSelectionRef: this.controller.selectionFor(agent),
    }
  }
}

/**
 * Schedule only consumes resolveAgent. Supply that capability on its private
 * Context; do not advertise a partial Session Remote service on the root or
 * mount browser uploads/HTTP transport just to deliver a terminal reminder.
 */
export async function apply(ctx: Context, config: ScheduleConfig): Promise<void> {
  const sessions = new TuiScheduleSessions(ctx)
  const delivery = ctx.extend({ sessionController: {
    resolveAgent: (id: SessionId) => sessions.resolveAgent(id),
  } satisfies Pick<SessionController, 'resolveAgent'> })
  const schedule = new ScheduleService(delivery, config)
  await schedule[Service.init]()
}
