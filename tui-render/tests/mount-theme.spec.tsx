/**
 * Mount-path theme install: mountTuiRender installs the detected color tier
 * from the environment once, before the first render (P14 three-tier
 * fallback). The env option is how tests keep the installed tier
 * deterministic; the real mount path defaults to process.env.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { Text } from 'ink'
import { applyTheme, currentTier, mountTuiRender } from '../src/index.ts'
import { hyperlinksEnabled, setHyperlinks } from '../src/hyperlink.ts'
import { ENABLE_SGR_MOUSE, DISABLE_SGR_MOUSE } from '../src/sgr-mouse.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

afterEach(() => {
  applyTheme('truecolor')
  setHyperlinks(false)
})

describe('mount-time theme install', () => {
  it('installs none when the environment forces NO_COLOR', () => {
    const disposer = mountTuiRender(createElement(Text, null, 'x'), {
      env: { NO_COLOR: '1', COLORTERM: 'truecolor' },
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
    })
    try {
      expect(currentTier()).toBe('none')
    } finally {
      disposer()
    }
  })

  it('installs truecolor when the environment advertises it', () => {
    const disposer = mountTuiRender(createElement(Text, null, 'x'), {
      env: { COLORTERM: 'truecolor' },
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
    })
    try {
      expect(currentTier()).toBe('truecolor')
    } finally {
      disposer()
    }
  })

  it('installs the 256 tier from the TERM whitelist', () => {
    const disposer = mountTuiRender(createElement(Text, null, 'x'), {
      env: { TERM: 'xterm-256color' },
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
    })
    try {
      expect(currentTier()).toBe('256')
    } finally {
      disposer()
    }
  })
})

describe('mount-time hyperlinks and mouse tracking', () => {
  it('installs OSC 8 from TERM_PROGRAM', () => {
    const disposer = mountTuiRender(createElement(Text, null, 'x'), {
      env: { TERM_PROGRAM: 'ghostty', COLORTERM: 'truecolor' },
      stdout: fakeTtyStdout(),
      stdin: fakeTtyStdin(),
    })
    try {
      expect(hyperlinksEnabled()).toBe(true)
    } finally {
      disposer()
    }
  })

  it('enables and disables SGR mouse on a TTY pair', () => {
    const stdout = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
      isTTY: boolean
      columns: number
      rows: number
    }
    stdout.isTTY = true
    stdout.columns = 80
    stdout.rows = 24
    const chunks: string[] = []
    stdout.on('data', chunk => chunks.push(chunk))
    const disposer = mountTuiRender(createElement(Text, null, 'x'), {
      env: { COLORTERM: 'truecolor' },
      stdout,
      stdin: fakeTtyStdin(),
    })
    disposer()
    const out = chunks.join('')
    expect(out).toContain(ENABLE_SGR_MOUSE)
    expect(out).toContain(DISABLE_SGR_MOUSE)
  })
})
