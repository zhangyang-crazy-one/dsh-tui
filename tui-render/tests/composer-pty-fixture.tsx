/** Standalone real-PTY benchmark; deliberately independent of global integration fixtures. */
import React from 'react'
import { createElement, useEffect, useRef, useState } from 'react'
import { Box, render, useApp, useInput, useWindowSize } from 'ink'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Permit isolated baseline sources transpiled using classic JSX.
Object.assign(globalThis, { React })
const source = process.env.COMPOSER_SOURCE_ROOT ?? resolve(import.meta.dirname, '../src')
const { InputBar } = await import(pathToFileURL(resolve(source, 'input-bar.tsx')).href)
const { moveCaretByGrapheme } = await import(pathToFileURL(resolve(source, 'composer-cursor.ts')).href)
const units = Number(process.argv[2] ?? 700)
const original = '中文🙂abc'.repeat(units / 7)

function Fixture() {
  const [draft, setDraft] = useState({ text: original, caret: original.length })
  const sequence = useRef(0)
  const { waitUntilRenderFlush } = useApp()
  const { rows } = useWindowSize()
  useInput((input, key) => {
    if (key.ctrl && input === 'c') { process.exit(0); return }
    sequence.current += 1
    setDraft(current => key.leftArrow
      ? { ...current, caret: moveCaretByGrapheme(current.text, current.caret, -1) }
      : { text: current.text.slice(0, current.caret) + input + current.text.slice(current.caret),
        caret: current.caret + input.length })
  })
  // Acknowledge at the PTY master only after Ink has flushed this update.
  // This explicitly settles Ink's pending throttle; it is a fixture metric.
  useEffect(() => {
    let live = true
    const current = sequence.current
    void waitUntilRenderFlush().then(() => {
      if (live) process.stdout.write(`\x1b]777;composer;${current};${draft.text.length};${draft.caret}\x07`)
    })
    return () => { live = false }
  }, [draft, waitUntilRenderFlush])
  return createElement(Box, { height: rows, flexDirection: 'column', justifyContent: 'flex-end' },
    createElement(InputBar, { text: draft.text, caretIndex: draft.caret, commandMode: false, mentionMode: false }))
}

render(createElement(Fixture), { exitOnCtrlC: false, patchConsole: false, maxFps: 120 })
