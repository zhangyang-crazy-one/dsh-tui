import { describe, expect, it, vi } from 'vitest'
import { render, Text } from 'ink'
import { createElement, useCallback, useState } from 'react'
import { AppShell } from '../src/app-shell.tsx'
import { StreamView } from '../src/stream-view.tsx'
import type { ViewModel } from '../src/projection.ts'
import type { TranscriptViewportCommand } from '../src/transcript-viewport.ts'
import { visibleFrameSnapshot } from '../src/frame-snapshot.ts'
import { disposeRenderer, fakeTtyStdin, fakeTtyStdout, frameTtyStdout } from './helpers.ts'

function history(count = 80): ViewModel['history'] {
  return [{ id: 1, kind: 'user', timestamp: 0,
    text: Array.from({ length: count }, (_, index) => `ROW_${String(index).padStart(3, '0')}`).join('\n') }]
}

function model(count = 80): ViewModel {
  return { history: history(count), activeTurn: undefined, status: 'idle', reasoningExpanded: false, toolCardsExpanded: false }
}

function firstRow(): number {
  return Number(/ROW_(\d+)/u.exec(visibleFrameSnapshot()?.rows[0]?.line.text ?? '')?.[1])
}

// Vitest's expect.poll advances fake timers; keep the keyboard animation
// paused while waiting for React to commit the command's first step.
async function waitForRow(expected: number): Promise<void> {
  for (let attempt = 0; attempt < 200 && firstRow() !== expected; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(firstRow()).toBe(expected)
}

function output() {
  const stdout = fakeTtyStdout()
  Object.assign(stdout, { isTTY: true, rows: 24, columns: 80 })
  stdout.on('data', () => {})
  return frameTtyStdout(stdout)
}

function shell(children: ReturnType<typeof createElement>) {
  return createElement(AppShell, { title: 'COMMAND_INTERLEAVING', badge: '', children,
    status: createElement(Text, null, 'STATUS'), input: createElement(Text, null, '> INPUT') })
}

const renderOptions = () => ({ stdout: output(), stdin: fakeTtyStdin(), exitOnCtrlC: false, patchConsole: false, interactive: true })

describe('viewport command interleaving', () => {
  it.each([-3, 3])('uses the visible position for reverse wheel motion and the target for same direction (%i)', async delta => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const commandRef = { current: undefined as ((command: TranscriptViewportCommand) => void) | undefined }
    const instance = render(shell(createElement(StreamView, { model: model(), viewportCommandRef: commandRef })), renderOptions())
    try {
      await instance.waitUntilRenderFlush()
      expect(commandRef.current).toBeTypeOf('function')
      const initial = firstRow()
      const pageDistance = visibleFrameSnapshot()!.geometry.transcriptRows - 1
      commandRef.current!({ sequence: 1, kind: 'page', delta: 1 })
      await waitForRow(initial - 8)
      commandRef.current!({ sequence: 2, kind: 'scroll', delta, source: 'wheel' })
      const expected = initial - (delta < 0 ? 8 + delta : pageDistance + delta)
      await waitForRow(expected)
      await vi.advanceTimersByTimeAsync(200)
      expect(firstRow()).toBe(expected)
    } finally { await disposeRenderer(instance); vi.useRealTimers() }
  })

  it('does not replay an older fallback command after direct input and a content layout change', async () => {
    const commandRef = { current: undefined as ((command: TranscriptViewportCommand) => void) | undefined }
    const stale = { sequence: 1, kind: 'scroll', delta: 9, source: 'wheel' } as const
    const view = (count = 80) => shell(createElement(StreamView, { model: model(count), viewportCommand: stale, viewportCommandRef: commandRef }))
    const instance = render(view(), renderOptions())
    try {
      await instance.waitUntilRenderFlush()
      await expect.poll(() => commandRef.current).toBeTypeOf('function')
      const initial = firstRow()
      commandRef.current!({ sequence: 2, kind: 'scroll', delta: 3, source: 'wheel' })
      await expect.poll(firstRow).toBe(initial - 3)
      const detached = firstRow()
      instance.rerender(view(81))
      await instance.waitUntilRenderFlush()
      await expect.poll(firstRow).toBe(detached)
    } finally { await disposeRenderer(instance) }
  })

  it('acknowledges a fallback so replacing the pane cannot replay it on remount', async () => {
    const consumed: number[] = []
    function Host({ show }: { show: boolean }) {
      const [pending, setPending] = useState<TranscriptViewportCommand | undefined>({ sequence: 1, kind: 'edge', edge: 'oldest' })
      const onConsumed = useCallback((sequence: number) => {
        consumed.push(sequence)
        setPending(current => current?.sequence === sequence ? undefined : current)
      }, [])
      return shell(show ? createElement(StreamView, { model: model(), viewportCommand: pending, onViewportCommandConsumed: onConsumed })
        : createElement(Text, null, 'REPLACEMENT PANE'))
    }
    const instance = render(createElement(Host, { show: true }), renderOptions())
    try {
      await expect.poll(firstRow).toBe(0)
      instance.rerender(createElement(Host, { show: false }))
      await expect.poll(() => visibleFrameSnapshot()).toBeUndefined()
      instance.rerender(createElement(Host, { show: true }))
      await expect.poll(firstRow).toBe(61)
      expect(consumed).toContain(1)
    } finally { await disposeRenderer(instance) }
  })

  it('keeps the net displacement for direct bursts and reverses immediately from a clamped edge', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const commandRef = { current: undefined as ((command: TranscriptViewportCommand) => void) | undefined }
    const instance = render(shell(createElement(StreamView, { model: model(), viewportCommandRef: commandRef })), renderOptions())
    try {
      await instance.waitUntilRenderFlush()
      await expect.poll(() => commandRef.current).toBeTypeOf('function')
      const initial = firstRow()
      for (const [index, delta] of [9, 3, -6].entries()) commandRef.current!({ sequence: index + 1, kind: 'scroll', delta, source: 'wheel' })
      await expect.poll(firstRow).toBe(initial - 6)
      commandRef.current!({ sequence: 4, kind: 'scroll', delta: 10_000, source: 'wheel' })
      commandRef.current!({ sequence: 5, kind: 'scroll', delta: -3, source: 'wheel' })
      await expect.poll(firstRow).toBe(3)
      await vi.advanceTimersByTimeAsync(200)
      expect(firstRow()).toBe(3)
    } finally { await disposeRenderer(instance); vi.useRealTimers() }
  })
})
