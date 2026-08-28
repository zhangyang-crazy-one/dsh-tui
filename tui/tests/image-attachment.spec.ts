import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { RuntimeController, internals } from '../src/index.ts'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const pngBytes = (): Buffer => Buffer.concat([PNG_MAGIC, Buffer.alloc(12)])

interface SavedInput {
  data: Uint8Array
  mediaType: string
  name?: string
}

/** Duck-typed stand-in registered under the runtime service key `attachments`. */
class FakeAttachments extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  readonly imageLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 4096,
    maxImagePixels: 1_000_000,
    maxImageDimension: 1000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }

  saved: SavedInput[] = []

  async validateImage(input: { data: Uint8Array }): Promise<void> {
    if (!Buffer.from(input.data.subarray(0, 4)).equals(PNG_MAGIC)) {
      throw new Error('decoded bytes are not a raster image')
    }
  }

  async saveImages(inputs: readonly SavedInput[]): Promise<Ref[]> {
    return inputs.map((input) => {
      this.saved.push(input)
      return {
        attachmentId: `att-${String(this.saved.length)}`,
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 2,
        height: 2,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
    })
  }
}

interface Ref {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

type OutgoingMessage = { id: string; content: readonly unknown[] }

async function bench(): Promise<{
  controller: RuntimeController
  followup: ReturnType<typeof vi.fn<(message: OutgoingMessage) => void>>
  steer: ReturnType<typeof vi.fn<(message: OutgoingMessage) => void>>
  attachments: FakeAttachments
  dir: string
}> {
  const dir = mkdtempSync(join(tmpdir(), 'tui-image-'))
  const ctx = new Context()
  await ctx.plugin(FakeAttachments)
  const attachments = ctx.get('attachments') as unknown as FakeAttachments
  const controller = new RuntimeController(
    ctx,
    { stdout: { write: () => true }, stderr: { write: () => true }, exit: () => {} },
    { task: '' },
    () => {},
  )
  const followup = vi.fn<(message: OutgoingMessage) => void>()
  const steer = vi.fn<(message: OutgoingMessage) => void>()
  const state = controller as unknown as {
    agentHandle: {
      followup(message: OutgoingMessage): void
      steer(message: OutgoingMessage): void
      cancel(): void
    }
  }
  state.agentHandle = { followup, steer, cancel: () => {} }
  return { controller, followup, steer, attachments, dir }
}

let activeRoot = ''
afterEach(() => {
  if (activeRoot !== '') rmSync(activeRoot, { recursive: true, force: true })
  activeRoot = ''
})

type StubChild = {
  stdout: { on(event: 'data', listener: (chunk: Buffer) => void): void }
  on: {
    (event: 'error', listener: (error: NodeJS.ErrnoException) => void): void
    (event: 'close', listener: (code: number | null) => void): void
  }
}

function stubClipboard(child: StubChild): void {
  internals.clipboardSpawn = (() => child) as unknown as typeof internals.clipboardSpawn
}

function clipboardChild(outcome: { bytes?: Buffer; error?: NodeJS.ErrnoException; code?: number }): StubChild {
  const on = ((event: 'error' | 'close', listener: (value: NodeJS.ErrnoException | number | null) => void): void => {
    if (event === 'error' && outcome.error !== undefined) listener(outcome.error)
    if (event === 'close') listener(outcome.code ?? 0)
  }) as StubChild['on']
  return {
    stdout: {
      on: (_event, listener) => {
        if (outcome.bytes !== undefined) listener(outcome.bytes)
      },
    },
    on,
  }
}

describe('TUI image intake', () => {
  it('admits a local image path as a pending token', async () => {
    const { controller, dir } = await bench()
    activeRoot = dir
    const file = join(dir, 'shot.png')
    writeFileSync(file, pngBytes())
    await expect(controller.intakeImagePath(file)).resolves.toEqual({ ok: true, token: '[图片 #1]' })
  })

  it('strips one layer of outer quotes from a pasted path', async () => {
    const { controller, dir } = await bench()
    activeRoot = dir
    const file = join(dir, 'shot.png')
    writeFileSync(file, pngBytes())
    await expect(controller.intakeImagePath(`"${file}"`)).resolves.toEqual({ ok: true, token: '[图片 #1]' })
  })

  it('refuses missing files, directories, non-images, symlinks, and control characters', async () => {
    const { controller, dir } = await bench()
    activeRoot = dir
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'notes.txt'), 'text')
    writeFileSync(join(dir, 'real.png'), pngBytes())
    symlinkSync(join(dir, 'real.png'), join(dir, 'link.png'))
    await expect(controller.intakeImagePath(join(dir, 'gone.png'))).resolves.toEqual({ ok: false, reason: '文件不存在' })
    await expect(controller.intakeImagePath(join(dir, 'nested'))).resolves.toEqual({ ok: false, reason: '不是普通文件' })
    await expect(controller.intakeImagePath(join(dir, 'notes.txt'))).resolves.toEqual({ ok: false, reason: '不支持的图片类型' })
    await expect(controller.intakeImagePath(join(dir, 'link.png'))).resolves.toEqual({ ok: false, reason: '符号链接已拒绝' })
    await expect(controller.intakeImagePath('bad\u0000path.png')).resolves.toEqual({ ok: false, reason: '不是可用的图片路径' })
  })

  it('maps every clipboard helper outcome to its locked refusal or success', async () => {
    const { controller } = await bench()
    const originalWayland = process.env.WAYLAND_DISPLAY
    const originalDisplay = process.env.DISPLAY
    const originalSpawn = internals.clipboardSpawn
    try {
      delete process.env.WAYLAND_DISPLAY
      delete process.env.DISPLAY
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '剪贴板助手缺失' })

      process.env.WAYLAND_DISPLAY = 'wayland-0'

      stubClipboard(clipboardChild({ bytes: pngBytes() }))
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: true, token: '[图片 #1]' })

      stubClipboard(clipboardChild({ error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }))
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '剪贴板助手缺失' })

      stubClipboard(clipboardChild({ code: 1 }))
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '剪贴板读取失败' })

      stubClipboard(clipboardChild({ bytes: Buffer.alloc(0) }))
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '剪贴板中没有图片' })

      stubClipboard(clipboardChild({ bytes: Buffer.alloc(2048, 0x89) }))
      await expect(controller.intakeClipboardImage()).resolves.toEqual({ ok: false, reason: '图片超过大小上限' })
    } finally {
      internals.clipboardSpawn = originalSpawn
      if (originalWayland === undefined) delete process.env.WAYLAND_DISPLAY
      else process.env.WAYLAND_DISPLAY = originalWayland
      if (originalDisplay === undefined) delete process.env.DISPLAY
      else process.env.DISPLAY = originalDisplay
    }
  })

  it('sends an interleaved text/image user message and persists only durable refs', async () => {
    const { controller, followup, attachments, dir } = await bench()
    activeRoot = dir
    const file = join(dir, 'shot.png')
    writeFileSync(file, pngBytes())
    await controller.intakeImagePath(file)
    controller.dispatch({ kind: 'send', text: 'look [图片 #1] now' })
    await vi.waitFor(() => {
      expect(followup).toHaveBeenCalledOnce()
    })
    const message = followup.mock.calls[0]?.[0]
    expect(message?.content[0]).toEqual({ type: 'text', text: 'look ' })
    expect((message?.content[1] as { type: string }).type).toBe('image')
    expect((message?.content[1] as { attachment: Ref }).attachment.attachmentId).toBe('att-1')
    expect(message?.content[2]).toEqual({ type: 'text', text: ' now' })
    expect(attachments.saved).toHaveLength(1)
    expect(JSON.stringify(message)).not.toContain('base64')
    expect(JSON.stringify(message)).not.toContain(file)
  })

  it('steers image-bearing drafts on the running turn through the same vocabulary', async () => {
    const { controller, followup, steer, dir } = await bench()
    activeRoot = dir
    const file = join(dir, 'shot.png')
    writeFileSync(file, pngBytes())
    controller.dispatch({ kind: 'send', text: 'start the turn' })
    await vi.waitFor(() => {
      expect(followup).toHaveBeenCalledOnce()
    })
    await controller.intakeImagePath(file)
    controller.dispatch({ kind: 'send', text: '[图片 #1]' })
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledOnce()
    })
    expect((steer.mock.calls[0]?.[0].content[0] as { type: string }).type).toBe('image')
  })

  it('keeps an unknown token as literal text instead of inventing a ref', async () => {
    const { controller, followup } = await bench()
    controller.dispatch({ kind: 'send', text: 'see [图片 #42]' })
    await vi.waitFor(() => {
      expect(followup).toHaveBeenCalledOnce()
    })
    expect(followup.mock.calls[0]?.[0].content).toEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: '[图片 #42]' },
    ])
  })

  it('tokenizes queued drafts and resubmits a taken-back image without re-saving', async () => {
    const { controller, followup, attachments, steer, dir } = await bench()
    activeRoot = dir
    const file = join(dir, 'shot.png')
    writeFileSync(file, pngBytes())
    // Occupied current-turn steer pushes this submit into the later-turn FIFO.
    controller.dispatch({ kind: 'send', text: 'start the turn' })
    await vi.waitFor(() => {
      expect(followup).toHaveBeenCalledOnce()
    })
    await controller.intakeImagePath(file)
    controller.dispatch({ kind: 'send', text: '[图片 #1] queued' })
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledOnce()
    })
    controller.dispatch({ kind: 'send', text: '[图片 #1] queued' })
    await vi.waitFor(() => {
      expect(attachments.saved).toHaveLength(1)
    })
    expect(controller.getQueuedDraftText()).toBe('[图片 #1] queued')

    // Resubmitting the tokenized text must reuse the durable ref.
    const restored = controller.getQueuedDraftText()
    expect(restored).toContain('[图片 #1]')
    if (restored === undefined) throw new Error('taken-back image draft is missing')
    // Resubmitting the tokenized text lands in the FIFO and must reuse the
    // durable ref instead of saving the bytes a second time.
    controller.dispatch({ kind: 'send', text: restored })
    await vi.waitFor(() => {
      expect(controller.getQueuedDraftText()).toBe('[图片 #1] queued')
    })
    expect(attachments.saved).toHaveLength(1)
    const steeredImage = steer.mock.calls[0]?.[0].content.find(
      block => (block as { type: string }).type === 'image',
    ) as { attachment: Ref }
    expect(steeredImage.attachment.attachmentId).toBe('att-1')
  })
})
