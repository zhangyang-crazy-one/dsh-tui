/** Read-only official Host capability catalogs; plugin installs enter the existing preview. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MarketListingEntry } from '@deepseek-ai/dsh-plugin-market/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-plugin-market'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type { BrowserOptions } from './browser.ts'

export function inspectBrowser(ctx: Context, agent: Agent, input: string): BrowserOptions {
  const inspect = ctx.get('cordisInspect')
  const match = input.trim() === '' ? undefined : /^(host|client)\s+(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/u.exec(input.trim())
  if (input.trim() !== '' && match === null) throw new Error('用法：/inspect [host|client PROVIDER METHOD JSON]')
  const directory = () => {
    if (inspect === undefined) throw new Error('Cordis inspect 服务未组合')
    return inspect.list().flatMap(provider => provider.methods.map(method => ({ id: `${provider.platform}/${provider.id}/${method.name}`, title: `${provider.platform} · ${provider.id}.${method.name}`, hint: method.description })))
  }
  const query = async (id: string, signal: AbortSignal) => {
    const row = directory().find(row => row.id === id)
    if (row === undefined || inspect === undefined) throw new Error('未知自检方法')
    const [platform, provider, method] = id.split('/') as ['host' | 'client', string, string]
    const args = match?.[4] === undefined ? {} : JSON.parse(match[4]) as JsonValue
    return JSON.stringify(await inspect.query(platform, provider, method, args, agent, signal), null, 2)
  }
  return { id: 'inspect', title: 'Cordis 自检 · 只读 · Client 需连接页面',
    load: async () => match === undefined ? directory() : directory().filter(row => row.id === `${match?.[1]}/${match?.[2]}/${match?.[3]}`),
    detail: (row, signal) => query(row.id, signal),
  }
}

export function marketBrowser(ctx: Context, text: string, preview: (spec: string, registry?: string) => void, navigate?: (options: BrowserOptions) => void, offset = 0): BrowserOptions {
  const market = ctx.get('pluginMarket')
  const entries = new Map<string, MarketListingEntry>()
  const failures = new Map<string, string>()
  let more = false
  return { id: 'market', title: `插件市场 · ${text || '已配置索引'} · ${offset + 1}–${offset + 25}/源`,
    load: async signal => {
      if (market === undefined) throw new Error('插件市场服务未组合')
      entries.clear();failures.clear();more = false
      const indexes = market.listIndexes()
      if (indexes.length === 0) throw new Error('尚未配置索引：在 /settings 的 plugin-market.indexes 添加 HTTP(S) 索引 URL')
      const rows = await Promise.all(indexes.map(async index => {
        try {
          const page = await market.search(index.url, { text, sort: { kind: 'relevance' }, offset, limit: 25 })
          signal.throwIfAborted()
          more ||= page.nextOffset !== null
          return page.entries.map(entry => {
            const id = `${index.url}#${entry.name}`;entries.set(id, entry)
            return { id, title: entry.name, hint: `${entry.defaultVersion ?? '无兼容版本'} · ${entry.installation.status}${page.nextOffset === null ? '' : ` · ${page.total} 项；可用 /market 关键词缩小范围`}` }
          })
        } catch (error: unknown) {
          signal.throwIfAborted()
          const reason = error instanceof Error ? error.message : String(error)
          failures.set(index.url, reason)
          return [{ id: index.url, title: index.url, hint: `读取失败：${reason}` }]
        }
      }))
      return rows.flat()
    },
    detail: async row => JSON.stringify(entries.get(row.id) ?? { error: failures.get(row.id) }, null, 2),
    actions: [{ key: 'i', label: '预览安装（仍需确认）', run: async (row, signal) => {
      const entry = entries.get(row.id)
      const version = entry?.versions.find(version => version.version === entry.defaultVersion)
      if (version === undefined || !version.compatibility.compatible) throw new Error('该条目没有兼容的默认版本，未启动安装')
      signal.throwIfAborted();preview(version.install.spec, version.install.registry)
    } }, { key: 'n', label: '下一页', run: async (_row, signal) => {
      signal.throwIfAborted();if (more && navigate !== undefined) navigate(marketBrowser(ctx, text, preview, navigate, offset + 25))
    } }, { key: 'p', label: '上一页', run: async (_row, signal) => {
      signal.throwIfAborted();if (offset > 0 && navigate !== undefined) navigate(marketBrowser(ctx, text, preview, navigate, Math.max(0, offset - 25)))
    } }],
  }
}
