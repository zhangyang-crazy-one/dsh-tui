/** Typed Session projections for source inspection; no inference from rendered placeholders. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BrowserRow } from '@deepseek-ai/dsh-tui-render'

export function eventJson(event: SessionEvent): string { return JSON.stringify(event, null, 2) }
export function trajectoryRows(events: readonly SessionEvent[]): BrowserRow[] {
  const turnStarts = new Map<number, number>()
  const calls = new Map<string, number>()
  return events.map(event => {
    const data = event.data as Record<string, unknown>
    if (event.type === 'turn/start' && typeof data['turn'] === 'number') turnStarts.set(data['turn'], event.time)
    if (event.type === 'tool/call' && typeof data['callId'] === 'string') calls.set(data['callId'], event.time)
    const facts: string[] = []
    if (typeof data['turn'] === 'number') facts.push(`回合 ${data['turn']}`)
    if (typeof data['step'] === 'number') facts.push(`步骤 ${data['step']}`)
    const start = event.type === 'turn/end' && typeof data['turn'] === 'number' ? turnStarts.get(data['turn'])
      : event.type === 'tool/result' && typeof data['callId'] === 'string' ? calls.get(data['callId']) : undefined
    if (start !== undefined) facts.push(`${Math.max(0, event.time - start)} ms`)
    const usage = data['usage']
    if (usage !== null && typeof usage === 'object') {
      for (const [key, value] of Object.entries(usage)) if (typeof value === 'number') facts.push(`${key}=${value}`)
    }
    const name = typeof data['name'] === 'string' ? ` · ${data['name']}` : ''
    return { id: String(event.seq), title: `#${event.seq} ${event.type}${name}`, hint: facts.join(' · ') || new Date(event.time).toISOString() }
  })
}
export type AttachmentRow = BrowserRow & (
  | { readonly kind: 'image'; readonly ref: Extract<ContentBlock, { type: 'image' }>['attachment'] }
  | { readonly kind: 'file'; readonly ref: Extract<ContentBlock, { type: 'file' }>['attachment'] }
)
export function attachmentRows(events: readonly SessionEvent[]): AttachmentRow[] {
  const rows: AttachmentRow[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    for (const [index, block] of event.data.content.entries()) {
      if (block.type !== 'image' && block.type !== 'file') continue
      const common = { id: `${event.seq}:${index}`, title: `${block.type === 'image' ? '图片' : '文件'} · ${block.attachment.name ?? block.attachment.attachmentId}`,
        hint: `${block.attachment.bytes} B${block.type === 'image' ? ` · ${block.attachment.width}×${block.attachment.height}` : ''}` }
      if (block.type === 'image') rows.push({ ...common, kind: 'image', ref: block.attachment })
      else rows.push({ ...common, kind: 'file', ref: block.attachment })
    }
  }
  return rows
}
