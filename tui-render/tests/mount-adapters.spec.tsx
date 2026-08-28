import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'

const mocks = vi.hoisted(() => ({
  disposeMouse: vi.fn(),
  unmount: vi.fn(),
  attachMouseIo: vi.fn((io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }) => ({
    ...io,
    dispose: mocks.disposeMouse,
  })),
  render: vi.fn(() => ({ unmount: mocks.unmount })),
}))

vi.mock('ink', async importOriginal => ({
  ...await importOriginal<typeof import('ink')>(),
  render: mocks.render,
}))
vi.mock('../src/mouse-io.ts', () => ({ attachMouseIo: mocks.attachMouseIo }))

import { Text } from 'ink'
import {
  createFrameProbe,
  mountTuiFrame,
  mountTuiLoop,
  mountTuiRender,
  type TuiController,
} from '../src/index.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

afterEach(() => {
  vi.clearAllMocks()
})

describe('TUI mount adapters', () => {
  it('uses process defaults and disposes Ink before mouse ownership', () => {
    const dispose = mountTuiRender(createElement(Text, null, 'default'))
    expect(mocks.attachMouseIo).toHaveBeenCalledOnce()
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      alternateScreen: true,
      patchConsole: false,
      exitOnCtrlC: false,
    }))

    dispose()
    expect(mocks.unmount).toHaveBeenCalledOnce()
    expect(mocks.disposeMouse).toHaveBeenCalledOnce()
  })

  it('wraps a frame probe and forwards injected IO and Ctrl+C ownership', () => {
    const stdin = fakeTtyStdin()
    const stdout = fakeTtyStdout()
    const dispose = mountTuiRender(createElement(Text, null, 'probe'), {
      env: { NO_COLOR: '1' },
      stdin,
      stdout,
      exitOnCtrlC: true,
      frameProbe: createFrameProbe(),
    })
    expect(mocks.attachMouseIo).toHaveBeenCalledWith({ stdin, stdout })
    expect(mocks.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      exitOnCtrlC: true,
      stdin,
    }))
    dispose()
  })

  it('mounts the pre-loop frame and loop through the shared renderer', () => {
    const io = { env: { COLORTERM: 'truecolor' }, stdin: fakeTtyStdin(), stdout: fakeTtyStdout() }
    const frameDispose = mountTuiFrame({ title: 'title', badge: 'badge', content: 'content' }, io)
    const loopDispose = mountTuiLoop({} as TuiController, { title: 'loop', ...io })

    expect(mocks.render).toHaveBeenCalledTimes(2)
    frameDispose()
    loopDispose()
    expect(mocks.unmount).toHaveBeenCalledTimes(2)
  })
})
