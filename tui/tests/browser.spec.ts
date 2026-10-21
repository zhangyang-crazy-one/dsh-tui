import { expect, it } from 'vitest'
import { TerminalBrowser } from '../src/browser.ts'

it('cancels in-flight reads, ignores stale completions and preserves selected identity on refresh', async () => {
  const changed = () => {}
  const browser = new TerminalBrowser(changed)
  const gate = Promise.withResolvers<readonly { id: string; title: string }[]>()
  let signal: AbortSignal | undefined
  browser.open({ id: 'test', title: '目录', load: async current => { signal = current;return gate.promise } })
  expect(browser.get().busy).toBe(true)
  browser.close()
  expect(signal?.aborted).toBe(true)
  gate.resolve([{ id: 'stale', title: '过期' }])
  await browser.settled()
  expect(browser.get().open).toBe(false)
  let rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  browser.open({ id: 'test', title: '目录', load: async () => rows, detail: async row => row.id })
  await browser.settled()
  browser.move(1)
  rows = [rows[1]!, rows[0]!]
  browser.refresh()
  await browser.settled()
  expect(browser.get().selectedIndex).toBe(0)
  browser.enter()
  await browser.settled()
  expect(browser.get().detail).toBe('b')
  browser.back()
  expect(browser.get().detail).toBeUndefined()
  browser.back()
  expect(browser.get().open).toBe(false)
})
it('shows failures, retries without losing the owner, and dispatches only configured actions', async () => {
  const browser = new TerminalBrowser(() => {})
  let fail = true
  let called = 0
  browser.open({ id: 'test', title: '目录', load: async () => {
    if (fail) throw new Error('READ_FAILED')
    return [{ id: 'ok', title: 'OK' }]
  }, actions: [{ key: 'o', label: '打开', run: async () => { called++ } }] })
  await browser.settled()
  expect(browser.get().error).toContain('READ_FAILED')
  fail = false
  browser.refresh()
  await browser.settled()
  browser.action('x')
  browser.action('o')
  await browser.settled()
  expect(called).toBe(1)
  expect(browser.get().error).toBeUndefined()
  browser.close()
})
