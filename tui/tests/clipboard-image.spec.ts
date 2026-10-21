/** Platform-specific clipboard helpers keep binary output off the terminal. */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ChildProcess, spawn as spawnProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { RuntimeController, internals } from '../src/index.ts'

const platform = internals.clipboardPlatform
const spawn = internals.clipboardSpawn
afterEach(() => { internals.clipboardPlatform = platform;internals.clipboardSpawn = spawn })

it('uses pngpaste stdout on macOS and gives an actionable missing-helper message', async () => {
  internals.clipboardPlatform = 'darwin'
  const ctx = new Context()
  const controller = new RuntimeController(ctx, { stdout: { write: () => true }, stderr: { write: () => true }, exit() {} }, { task: '' }, () => {})
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new ChildProcess(), {
    stdin: null, stdout, stderr,
    stdio: [null, stdout, stderr, undefined, undefined] as [null, PassThrough, PassThrough, undefined, undefined],
  })
  const capture = vi.fn(() => {
    queueMicrotask(() => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })))
    return child
  })
  internals.clipboardSpawn = capture
  try {
    const result = await controller.intakeClipboardImage()
    expect(capture).toHaveBeenCalledWith('pngpaste', ['-'], expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 5000 }))
    expect(result).toEqual({ ok: false, reason: '剪贴板助手缺失：请安装 pngpaste（brew install pngpaste）' })
  } finally { await controller.dispose();await ctx.fiber.dispose() }
})

it('bounds a stalled clipboard helper and cancels it when the controller closes', async () => {
  internals.clipboardPlatform = 'darwin'
  const ctx = new Context()
  const make = (clipboardTimeoutMs: number) => new RuntimeController(ctx,
    { stdout: { write: () => true }, stderr: { write: () => true }, exit() {} },
    { task: '', clipboardTimeoutMs }, () => {})
  internals.clipboardSpawn = (_command, _args, options) => spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options)
  const timed = make(50)
  const cancelled = make(10000)
  try {
    await expect(timed.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '剪贴板读取失败' })
    const reading = cancelled.intakeClipboardImage()
    await cancelled.dispose()
    await expect(reading).resolves.toEqual({ ok: false, reason: '剪贴板读取已取消' })
  } finally { await timed.dispose();await cancelled.dispose();await ctx.fiber.dispose() }
})

it('accepts binary PNG stdout from the macOS helper without printing it', async () => {
  internals.clipboardPlatform = 'darwin'
  const ctx = new Context()
  const output = vi.fn(() => true)
  const controller = new RuntimeController(ctx, { stdout: { write: output }, stderr: { write: output }, exit() {} }, { task: '' }, () => {})
  internals.clipboardSpawn = (_command, _args, options) => spawnProcess(process.execPath, ['-e',
    "process.stdout.write(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMQsAAAAASUVORK5CYII=', 'base64'))",
  ], options)
  try {
    await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: true, token: '[图片 #1]' })
    expect(output).not.toHaveBeenCalled()
  } finally { await controller.dispose();await ctx.fiber.dispose() }
})
