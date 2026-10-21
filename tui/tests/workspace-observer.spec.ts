import { expect, it, vi } from 'vitest'
import { WorkspaceObserver } from '../src/workspace-observer.ts'

it('throttles invalidations and releases watchers including late initialization', async () => {
  vi.useFakeTimers()
  try {
    const gate = Promise.withResolvers<() => Promise<void>>()
    let changed: ((error?: Error) => void) | undefined
    let signal: AbortSignal | undefined
    const close = vi.fn(async () => {})
    const refresh = vi.fn()
    const observer = new WorkspaceObserver(refresh, () => {})
    observer.observe(['root'], async (_target, callback, current) => { changed=callback;signal=current;return gate.promise })
    for(let i=0;i<100;i++) changed?.()
    await vi.advanceTimersByTimeAsync(200)
    expect(refresh).toHaveBeenCalledTimes(1)
    observer.close()
    expect(signal?.aborted).toBe(true)
    gate.resolve(close)
    await observer.settled()
    expect(close).toHaveBeenCalledTimes(1)
    changed?.()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})
it('reports an unavailable watch provider without claiming the tree is up to date', async () => {
  const failed=vi.fn()
  const observer=new WorkspaceObserver(()=>{},failed)
  observer.observe(['root'],async()=>{throw new Error('UNSUPPORTED')})
  await observer.settled()
  expect(failed).toHaveBeenCalledWith(expect.stringContaining('UNSUPPORTED'))
  observer.close()
})

it('receives a real local filesystem change and releases the watcher before return', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const ctx = new Context()
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-watch-'))
  const refresh = vi.fn()
  const failed = vi.fn()
  const observer = new WorkspaceObserver<Awaited<ReturnType<typeof ctx.fs.resolve>>>(refresh, failed)
  try {
    await ctx.plugin(LocalFileSystem)
    const target = await ctx.fs.resolve(root)
    observer.observe([target], (path, changed, signal) => ctx.fs.watch(path, changed, signal))
    await observer.settled()
    await writeFile(join(root, 'new.txt'), 'created locally')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 3000 })
    expect(failed).not.toHaveBeenCalled()
    observer.close();await observer.settled()
    const count = refresh.mock.calls.length
    await writeFile(join(root, 'after-close.txt'), 'not observed')
    await new Promise(resolve => setTimeout(resolve, 250))
    expect(refresh).toHaveBeenCalledTimes(count)
  } finally { observer.close();await observer.settled();await ctx.fiber.dispose();await rm(root, { recursive: true, force: true }) }
})
