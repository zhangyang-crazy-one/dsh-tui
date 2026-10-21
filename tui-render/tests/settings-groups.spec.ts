import { expect, it } from 'vitest'
import { settingsGroup, nextSettingsGroup } from '../src/settings-groups.ts'

it('provides explicit sections without changing field identities or order', () => {
  const rows = [
    { namespace: 'llm-pi-ai', field: 'providers' }, { namespace: 'credentials', field: 'KEY' },
    { namespace: 'tui', field: 'theme' }, { namespace: 'agent-loop', field: 'maxSteps' },
    { namespace: 'subagent', field: 'maxDepth' }, { namespace: 'web-search', field: 'provider' },
    { namespace: 'shell', field: 'timeout' }, { namespace: 'plugin-market', field: 'indexes' },
  ]
  expect(rows.map(settingsGroup)).toEqual(['providers','providers','appearance','agent','subagents','web','shell','plugins'])
  expect(nextSettingsGroup(rows,0,1)).toBe(2)
  expect(nextSettingsGroup(rows,2,-1)).toBe(0)
  expect(nextSettingsGroup(rows,7,1)).toBe(0)
})
