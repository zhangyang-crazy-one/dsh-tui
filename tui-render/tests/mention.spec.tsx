/**
 * Mention popup: controlled selection, empty/loading states, and canonical
 * insertion normalization for shipping TOOL-04 behavior.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'ink'
import { createElement } from 'react'
import { Mention, normalizeMentionInsertion } from '../src/mention.tsx'
import type { MentionCandidate, MentionPhase } from '../src/mention.tsx'
import { applyTheme } from '../src/theme.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

afterEach(() => {
  applyTheme('truecolor')
})

const CANDIDATES: MentionCandidate[] = [
  { kind: 'file', name: 'main.ts' },
  { kind: 'subagent', name: 'explorer', target: '@explorer ' },
  { kind: 'skill', name: 'summary' },
]

async function paint(
  phase: MentionPhase,
  candidates: readonly MentionCandidate[],
  selectedIndex: number,
): Promise<string> {
  applyTheme('truecolor')
  const chunks: string[] = []
  const stdout = fakeTtyStdout()
  const instance = render(
    createElement(Mention, {
      phase,
      candidates,
      selectedIndex,
    }),
    {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  )
  stdout.on('data', (chunk: string) => chunks.push(chunk))
  try {
    await instance.waitUntilRenderFlush()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    await instance.waitUntilRenderFlush()
    return chunks.join('')
  } finally {
    instance.unmount()
  }
}

describe('Mention presenter', () => {
  it('paints the 子代理 header for a running-child candidate', async () => {
    const out = await paint('ready', [
      {
        kind: 'subagent',
        name: 'explorer',
        target: '@explorer ',
      },
    ], 0)
    expect(out).toContain('子代理')
    expect(out).toContain('@ explorer')
    expect(out).not.toContain('Submit')
    expect(out).not.toContain('OK')
    expect(out).not.toContain('Cancel')
    expect(out).not.toContain('Save')
  })

  it('keeps 文件/目录/技能 headers unchanged beside 子代理', async () => {
    const out = await paint('ready', [
      { kind: 'file', name: 'main.ts' },
      { kind: 'directory', name: 'src/' },
      { kind: 'skill', name: 'summary' },
      { kind: 'subagent', name: 'explorer', target: '@explorer ' },
    ], 2)
    expect(out).toContain('文件')
    expect(out).toContain('目录')
    expect(out).toContain('技能')
    expect(out).toContain('子代理')
  })

  it('shows the established loading and empty states', async () => {
    expect(await paint('loading', [], 0)).toContain('加载中…')
    const empty = await paint('ready', [], 0)
    expect(empty).toContain('无匹配')
    expect(empty).not.toContain('子代理')
  })

  it('escapes CSI in a subagent candidate name', async () => {
    const out = await paint('ready', [
      {
        kind: 'subagent',
        name: 'evil\x1b[2J',
        target: '@evil\x1b[2J ',
      },
    ], 0)
    expect(out).toContain('子代理')
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b')
  })

  it('renders the row at selectedIndex with the selected treatment', async () => {
    const out = await paint('ready', CANDIDATES, 1)
    expect(out).toContain('› ')
    expect(out).toContain('@ explorer')
    expect(out).not.toContain('› @ main.ts')
  })

  it('moves the selected treatment when selectedIndex changes without changing candidates', async () => {
    const first = stripAnsi(await paint('ready', CANDIDATES, 0))
    const middle = stripAnsi(await paint('ready', CANDIDATES, 1))
    const last = stripAnsi(await paint('ready', CANDIDATES, 2))
    expect(first).toContain('› @ main.ts')
    expect(middle).toContain('› @ explorer')
    expect(last).toContain('› @ summary')
  })

  it('clamps an out-of-range selectedIndex for rendering without inventing a candidate', async () => {
    const out = stripAnsi(await paint('ready', CANDIDATES, 99))
    expect(out).toContain('› @ summary')
    expect(out).not.toContain('› @ main.ts')
  })
})

describe('normalizeMentionInsertion', () => {
  it('keeps a pre-spaced target at exactly one trailing ASCII space', () => {
    expect(normalizeMentionInsertion({
      kind: 'subagent',
      name: 'explorer',
      target: '@explorer ',
    })).toBe('@explorer ')
  })

  it('trims multiple trailing whitespace characters before adding one space', () => {
    expect(normalizeMentionInsertion({
      kind: 'subagent',
      name: 'explorer',
      target: '@explorer   \n\t',
    })).toBe('@explorer ')
  })

  it('falls back to @name plus one trailing ASCII space when target is absent', () => {
    expect(normalizeMentionInsertion({
      kind: 'subagent',
      name: 'explorer',
    })).toBe('@explorer ')
  })
})
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
}
