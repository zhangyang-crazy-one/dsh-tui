import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { inspectBrowser, marketBrowser } from '../src/capability-browsers.ts'

describe('capability source browsers', () => {
  it('queries the declared Host method with the exact live agent and JSON input', async () => {
    const ctx = new Context();const agent = { id: 'exact' } as Agent
    const query = vi.fn(async () => ({ tools: [] }))
    ctx.provide('cordisInspect', { list: () => [{ id: 'Tool', platform: 'host', description: 'scope', methods: [{ name: 'listTools' }] }], query } as never)
    const options = inspectBrowser(ctx, agent, '')
    const signal = new AbortController().signal
    const rows = await options.load(signal)
    expect(rows.map(row => row.id)).toEqual(['host/Tool/listTools'])
    expect(await options.detail!(rows[0]!, signal)).toContain('tools')
    expect(query).toHaveBeenCalledWith('host', 'Tool', 'listTools', {}, agent, signal)
    await ctx.fiber.dispose()
  })
  it('shows market fetch failures and refuses incompatible installation without bypassing preview', async () => {
    const ctx = new Context();const preview = vi.fn()
    ctx.provide('pluginMarket', { listIndexes: () => [{ url: 'https://fixture.invalid/index.json' }], search: async () => ({ entries: [{ name: 'pkg', versions: [], installation: { status: 'not-installed' } }], total: 1, nextOffset: null }) } as never)
    const options = marketBrowser(ctx, '', preview)
    const signal = new AbortController().signal
    const rows = await options.load(signal)
    await expect(options.actions![0]!.run(rows[0]!, signal)).rejects.toThrow('兼容')
    expect(preview).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })
})

it('pages market results and passes the compatible exact target to preview', async () => {
  const ctx = new Context();const preview = vi.fn();const navigate = vi.fn()
  const search = vi.fn(async () => ({ entries: [{ name: 'pkg', defaultVersion: '1.2.3', versions: [{ version: '1.2.3', compatibility: { compatible: true }, install: { spec: 'pkg@1.2.3', registry: 'https://registry.example/' } }], installation: { status: 'not-installed' } }], total: 26, nextOffset: 25 }))
  ctx.provide('pluginMarket', { listIndexes: () => [{ url: 'https://fixture.invalid/index.json' }], search } as never)
  try {
    const browser = marketBrowser(ctx, 'query', preview, navigate)
    const signal = new AbortController().signal
    const rows = await browser.load(signal)
    await browser.actions![0]!.run(rows[0]!, signal)
    expect(preview).toHaveBeenCalledWith('pkg@1.2.3', 'https://registry.example/')
    await browser.actions![1]!.run(rows[0]!, signal)
    const next = navigate.mock.calls[0]?.[0] as typeof browser
    await next.load(signal)
    expect(search).toHaveBeenLastCalledWith('https://fixture.invalid/index.json', expect.objectContaining({ offset: 25, limit: 25, text: 'query' }))
  } finally { await ctx.fiber.dispose() }
})
