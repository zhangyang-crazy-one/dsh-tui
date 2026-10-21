import assert from 'node:assert/strict'

// Shared by built AppBoot and the actual source CLI. It never submits a prompt.
export async function verifyPresets(ctx, home, requests) {
  const handles = []
  try {
    const roster = (await ctx.agentPresets.remoteExportList()).presets
    assert.deepEqual(roster.map(row => row.id), ['standard', 'ptc', 'minimal', 'cordis'])
    for (const row of roster) assert.equal(row.broken, undefined, `${row.id}: ${row.broken}`)
    assert.ok(ctx.get('ptcRuntime'), 'the PTC Host runtime must activate')
    const results = []
    for (const row of roster) {
      const handle = await ctx.agents.create({
        sessionId: `offline-preset-${row.id}`,
        meta: { cwd: home, agentPreset: row.id },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, row.id) },
      })
      handles.push(handle)
      const agent = handle.agent
      const tools = ctx.tools.schemas(agent).map(tool => tool.name).sort()
      const assembly = await ctx.systemPrompt.assemble({ scope: agent })
      const modelTools = assembly.tools.map(tool => tool.name).sort()
      const commands = {
        goal: ctx.commands.find(agent, 'goal') !== undefined,
        compact: ctx.commands.find(agent, 'compact') !== undefined,
      }
      assert.equal(commands.compact, true, `${row.id} lost its scoped compact command`)
      assert.equal(commands.goal, row.id !== 'minimal', `${row.id} has the wrong goal command visibility`)
      if (row.id !== 'cordis') {
        for (const name of ['cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'plugin_market']) {
          assert.ok(!tools.includes(name), `${row.id} inherited Cordis-only tool ${name}`)
        }
      }
      if (row.id === 'minimal') {
        assert.deepEqual(tools, [process.platform === 'win32' ? 'pwsh' : 'bash', 'read_image', 'working_directory'].sort())
        for (const name of ['edit', 'write', 'read', 'glob', 'grep', 'web_search', 'subagent', 'cordis_inspect_query']) {
          assert.ok(!tools.includes(name), `minimal leaked ${name}; global=${ctx.tools.schemas().map(tool => tool.name).sort().join(',')}; scoped=${tools.join(',')}`)
        }
        assert.ok(tools.includes('read_image'))
        assert.ok(tools.includes(process.platform === 'win32' ? 'pwsh' : 'bash'))
        assert.ok(!modelTools.includes('run_code'), 'minimal inherited PTC presentation')
      }
      if (row.id === 'ptc') assert.deepEqual(modelTools, ['run_code'])
      if (row.id === 'standard') {
        assert.ok(modelTools.includes('edit'), 'standard lost its filesystem editor')
        assert.ok(!modelTools.includes('run_code'), 'standard inherited PTC presentation')
      }
      if (row.id === 'cordis') {
        assert.ok(tools.includes('cordis_inspect_list'))
        assert.ok(tools.includes('cordis_inspect_query'))
        assert.ok(tools.includes('plugin_manager'))
        const providers = ctx.cordisInspect.list().filter(provider => provider.platform === 'host')
        assert.deepEqual(providers.map(provider => provider.id).sort(), ['Config', 'Event', 'Service', 'Tool'])
        const toolsView = await ctx.cordisInspect.query('host', 'Tool', 'listTools', {}, agent, new AbortController().signal)
        assert.ok(toolsView.tools.some(tool => tool.name === 'cordis_inspect_query'))
      }
      const events = agent.session.snapshotEvents()
      assert.ok(!events.some(event => event.type === 'request/header'), 'a model request was assembled for execution')
      results.push({ preset: row.id, tools, modelTools, commands, logEvents: events.length, modelRequests: 0 })
    }
    assert.deepEqual(requests, [], 'an offline boot attempted a network fetch')
    return { globalTools: ctx.tools.schemas().map(tool => tool.name).sort(), networkRequests: requests.length, roster: results }
  } finally {
    for (const handle of handles.reverse()) await handle.dispose()
  }
}
