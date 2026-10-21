/** Terminal access to official per-session composition; selection policy stays in the registry. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentSetup } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { AgentPresetDocument, AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'

/** Global model-facing rows that must disappear before presets become authoritative. */
export const BASE_AGENT_PLUGIN_IDS: readonly string[] = [
  'tool-plugin-manager', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search',
  'skill-filesystem', 'tool-skill', 'command-goal', 'tool-goal', 'plan-mode',
  'compaction-basic', 'command-compact', 'tool-result-pruner', 'tool-subagent-control',
  'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'workflow-ptc',
  'tool-workflow', 'agent-instructions', 'tool-todo', 'tool-web',
  // These additional agent contributions are owned by the terminal bundle.
  'time-context', 'tool-present', 'tool-ask-user', 'tool-schedule',
]

/** Put the identity in create metadata and await setup before publishing an Agent. */
export interface TerminalPresetSetup {
  readonly agentPreset?: string
  readonly setup: AgentSetup
}

export class TerminalPresets {
  constructor(private readonly ctx: Context) {}

  /** Return the live roster, preserving unusable definitions and their diagnostics. */
  async list(): Promise<readonly AgentPresetRow[]> {
    const registry = this.ctx.get('agentPresets')
    return registry === undefined ? [] : (await registry.remoteExportList()).presets
  }

  /** Read declaration YAML without providing a second configuration writer. */
  async read(id: string): Promise<AgentPresetDocument> {
    return this.requireRegistry().readDocument(id)
  }

  /** Selection events supersede the immutable creation header. */
  current(session: Session): string | undefined {
    return this.ctx.get('sessionProjections')?.stateOf(session, 'agentPreset') ?? undefined
  }

  /**
   * Compose a new Session, or retain the selection reconstructed from an existing Session.
   * A restored Session's projection takes precedence over a caller's requested identity.
   * Failed mounts roll back through the official Agent factory's setup transaction.
   */
  async setup(id?: string, session?: Session): Promise<TerminalPresetSetup> {
    const selected = session === undefined ? id : this.current(session)
    const registry = this.ctx.get('agentPresets')
    if (registry === undefined) {
      if (selected !== undefined || session?.header.agentPreset !== undefined) this.requireRegistry()
      return { setup: () => {} }
    }
    const agentPreset = (await registry.resolve(selected)).id
    return {
      agentPreset,
      setup: async (agentCtx) => { await registry.mount(agentCtx, agentPreset) },
    }
  }

  /** Use as a resume setup callback after persistence has reconstructed the Session log. */
  async restore(agentCtx: Context, agent: Agent): Promise<void> {
    await (await this.setup(undefined, agent.session)).setup(agentCtx, agent)
  }

  /** Official selection serializes switches, logs the choice and rejects started Sessions. */
  async select(agent: Agent, id: string): Promise<string> {
    return this.requireRegistry().select(agent, id)
  }

  /** Resolve an isolated preset service before a deployment-wide provider. */
  serviceFor<K extends string & keyof Context>(agent: Agent, name: K): Context[K] | undefined {
    return this.ctx.get('agentPresets')?.serviceFor(agent, name) ?? agent.ctx.get(name)
  }

  private requireRegistry() {
    const registry = this.ctx.get('agentPresets')
    if (registry === undefined) throw new Error('This profile does not compose agentPresets')
    return registry
  }
}
