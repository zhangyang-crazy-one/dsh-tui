import { Box, render, Text } from 'ink'
import { createElement } from 'react'
import { expect, it } from 'vitest'
import { disposeRenderer, fakeTtyStdin, fakeTtyStdout } from './helpers.ts'
import { MarkdownBlock } from '../src/markdown.tsx'
import { ReasoningBlock } from '../src/reasoning.tsx'

it('releases the beforeExit listener when disposing a test renderer', async () => {
  const before = process.listenerCount('beforeExit')
  const instance = render(createElement(Text, null, 'dispose fixture'), {
    stdin: fakeTtyStdin(), stdout: fakeTtyStdout(),
    exitOnCtrlC: false, patchConsole: false, interactive: false,
  })
  await instance.waitUntilRenderFlush()
  await disposeRenderer(instance)
  expect(process.listenerCount('beforeExit')).toBe(before)
})

it('uses the supplied transcript width without adding per-message resize listeners', async () => {
  const stdout = fakeTtyStdout()
  Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 })
  const instance = render(createElement(Text, null, 'baseline'), {
    stdin: fakeTtyStdin(), stdout,
    exitOnCtrlC: false, patchConsole: false, interactive: true,
  })
  try {
    await instance.waitUntilRenderFlush()
    const baseline = stdout.listenerCount('resize')
    instance.rerender(createElement(Box, { flexDirection: 'column' },
      createElement(MarkdownBlock, { source: '**answer**', maxCols: 70 }),
      createElement(ReasoningBlock, { text: 'reasoning', collapsed: false, durationMs: 1, maxCols: 70 }),
    ))
    await instance.waitUntilRenderFlush()
    expect(stdout.listenerCount('resize')).toBe(baseline)
  } finally {
    await disposeRenderer(instance)
  }
})
