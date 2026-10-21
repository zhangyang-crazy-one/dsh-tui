/** Credential-free production renderer exercised by scripts/check-mouse-pty.py. */
import { writeFileSync } from 'node:fs'
import { createElement, Profiler, useEffect, useState } from 'react'
import { Text, useInput, useWindowSize } from 'ink'
import { AppShell, mountTuiRender, StreamView, type ViewModel } from '../../src/index.ts'
import { setFrameCaret } from '../../src/frame-fill.ts'
import { setMouseRailListener, setMouseScrollListener } from '../../src/mouse-io.ts'
import type { TranscriptViewportCommand } from '../../src/transcript-viewport.ts'

const stats = { commits: 0, snapshots: 0 }
const statsPath = process.argv[2]
if (statsPath === undefined) throw new Error('A metrics output path is required')
const save = () => {
  stats.snapshots += 1
  writeFileSync(statsPath, JSON.stringify(stats))
}
const model: ViewModel = {
  history: Array.from({ length: 500 }, (_, id) => ({
    timestamp: Date.UTC(2026, 9, 20, 8, 0, id),
    id, kind: 'assistant', text: `Row ${String(id).padStart(4, '0')}  中文复制验证 · Provider settings and subagent output.\nSecond line ${id}: stable terminal rendering.`,
  })),
  activeTurn: undefined, status: 'idle', reasoningExpanded: false, toolCardsExpanded: false,
}

function Fixture() {
  useInput(() => {})
  const { rows } = useWindowSize()
  const [command, setCommand] = useState<TranscriptViewportCommand>()
  setFrameCaret({ row: rows - 2, col: 4 })
  useEffect(() => {
    setMouseScrollListener(delta => setCommand(previous => ({ sequence: (previous?.sequence ?? 0) + 1, kind: 'scroll', delta })))
    setMouseRailListener(fraction => setCommand(previous => ({ sequence: (previous?.sequence ?? 0) + 1, kind: 'position', fraction })))
    return () => { setMouseScrollListener(undefined); setMouseRailListener(undefined) }
  }, [])
  return createElement(AppShell, {
    title: 'Mouse performance fixture', badge: '500 messages · no network',
    input: createElement(Text, null, '› Draft preserved while selecting'),
    status: createElement(Text, null, 'P0 · Wheel / upward selection / copy'),
    children: createElement(StreamView, { model, viewportCommand: command }),
  })
}
const dispose = mountTuiRender(createElement(Profiler, {
  id: 'mouse-pty', onRender: () => { stats.commits += 1 }, children: createElement(Fixture),
}), { env: { TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
process.on('SIGUSR2', save)
process.once('SIGTERM', () => { save(); dispose(); process.exit(0) })
