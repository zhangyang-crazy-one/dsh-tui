import { describe, expect, it } from 'vitest'
import { render, renderToString } from 'ink'
import { createElement } from 'react'
import { KEYMAP } from '../src/keymap.ts'
import { EMPTY_INPUT, handleInput } from '../src/input-bar.tsx'
import {
  COMMAND_MENU_WINDOW,
  CommandMenu,
  completeFirst,
  filterCommands,
  resolveEnterQuery,
} from '../src/command-menu.tsx'
import { Mention } from '../src/mention.tsx'
import { reduceInteraction } from '../src/interaction-state.ts'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

function ttyStdout(columns: number) {
  const stream = fakeTtyStdout() as ReturnType<typeof fakeTtyStdout> & {
    columns: number
    rows: number
  }
  stream.columns = columns
  stream.rows = 24
  return stream
}

async function paintCommandMenu(
  items: ReadonlyArray<{ name: string; description: string }>,
  columns: number,
): Promise<string> {
  const stdout = ttyStdout(columns)
  const chunks: string[] = []
  stdout.on('data', chunk => chunks.push(chunk))
  const instance = render(
    createElement(CommandMenu, {
      items,
      query: '',
    }),
    {
      stdout,
      stdin: fakeTtyStdin(),
      exitOnCtrlC: false,
      patchConsole: false,
      interactive: true,
    },
  )
  try {
    await instance.waitUntilRenderFlush()
    return chunks.join('')
  } finally {
    instance.unmount()
  }
}

describe('KEYMAP', () => {
  it('binds the interaction table from the UI spec', () => {
    const actions = KEYMAP.map(binding => binding.action)
    expect(actions).toContain('send')
    expect(actions).toContain('stop-generation')
    expect(actions).toContain('toggle-reasoning')
    expect(actions).toContain('toggle-tool-cards')
    expect(actions).toContain('copy-message')
    expect(actions).toContain('edit-external')
    expect(actions).toContain('command-menu')
    expect(KEYMAP).toContainEqual({ key: 'y', ctrl: true, action: 'copy-message' })
    expect(KEYMAP).toContainEqual({ key: 'g', ctrl: true, action: 'edit-external' })
  })
})

describe('handleInput', () => {
  it('sends on Enter and clears the buffer', () => {
    const next = handleInput(
      { ...EMPTY_INPUT, text: 'hi' },
      { input: 'return', ctrl: false, shift: false },
    )
    expect(next.command).toEqual({ kind: 'send', text: 'hi' })
    expect(next.state.text).toBe('')
  })

  it('opens command and mention modes on / and @', () => {
    expect(
      handleInput(EMPTY_INPUT, { input: '/', ctrl: false, shift: false }).state
        .commandMode,
    ).toBe(true)
    expect(
      handleInput(EMPTY_INPUT, { input: '@', ctrl: false, shift: false }).state
        .mentionMode,
    ).toBe(true)
  })
})

describe('CommandMenu / Mention', () => {
  it('filters commands by name prefix and completes the first', () => {
    const items = [
      { name: 'compact', description: 'Compact older conversation history' },
      { name: 'model', description: 'Switch the active model' },
      { name: 'help', description: 'Show command help and key bindings' },
      { name: 'permission', description: 'Switch the permission preset' },
      { name: 'settings', description: 'Edit provider settings (baseURL)' },
    ]
    expect(filterCommands(items, 'com').map(item => item.name)).toEqual([
      'compact',
    ])
    expect(filterCommands(items, 's').map(item => item.name)).toEqual([
      'settings',
    ])
    expect(completeFirst(items, 'model')?.name).toBe('model')
    expect(resolveEnterQuery(items, 's')).toBe('settings')
    expect(resolveEnterQuery(items, 'permission workspace-write')).toBe(
      'permission workspace-write',
    )
    expect(resolveEnterQuery(items, '')).toBe('compact')
    expect(resolveEnterQuery(items, '', 2)).toBe('help')
    expect(resolveEnterQuery(items, ' settings')).toBe(' settings')
    expect(resolveEnterQuery(items, 'zzz')).toBe('zzz')
  })

  it('sections controlled candidates by kind after the loading phase', () => {
    expect(renderToString(createElement(Mention, {
      phase: 'loading',
      candidates: [],
      selectedIndex: 0,
    }))).toContain('加载中…')
    const out = renderToString(createElement(Mention, {
      phase: 'ready',
      candidates: [
        { kind: 'file', name: 'src/main.ts', description: '入口' },
        { kind: 'directory', name: 'src/main/' },
        { kind: 'skill', name: 'summary', description: '总结技能' },
      ],
      selectedIndex: 0,
    }))
    expect(out).toContain('文件')
    expect(out).toContain('目录')
    expect(out).toContain('技能')
    expect(out).toContain('src/main.ts')
    expect(out).toContain('src/main/')
    expect(out).toContain('summary')
    expect(out).toContain('入口')
    expect(out).toContain('总结技能')
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254m› ')
  })

  it('shows the empty state for a ready controlled presenter', () => {
    expect(renderToString(createElement(Mention, {
      phase: 'ready',
      candidates: [],
      selectedIndex: 0,
    }))).toContain('无匹配')
  })
})

describe('palette selected rows', () => {
  it('marks the selected command row with the accent › prefix', () => {
    const out = renderToString(
      createElement(CommandMenu, {
        items: [
          { name: 'compact', description: 'Compact older conversation history' },
          { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)' },
          { name: 'model', description: 'Switch the active model' },
        ],
        query: '',
      }),
    )
    expect(out).toContain('\x1b[38;2;77;107;254m› ')
    expect(out).toContain('\x1b[38;2;247;247;248m/compact')
    expect(out).not.toContain('\x1b[38;2;77;107;254m› /compact')
    expect(out).toContain('/permission')
    expect(out).toContain('/model')
    expect(out).toContain('\x1b[38;2;138;143;152mCompact older conversation history')
    expect(out).not.toContain(' — ')
  })

  it('caps the palette at eight rows', () => {
    const items = Array.from({ length: COMMAND_MENU_WINDOW + 1 }, (_, index) => ({
      name: `cmd${String(index)}`,
      description: `Description ${String(index)}`,
    }))
    const out = renderToString(
      createElement(CommandMenu, {
        items,
        query: '',
      }),
    )
    expect(out).toContain('/cmd0')
    expect(out).toContain(`/cmd${String(COMMAND_MENU_WINDOW - 1)}`)
    expect(out).not.toContain(`/cmd${String(COMMAND_MENU_WINDOW)}`)
  })

  it('omits an empty description column', () => {
    const out = renderToString(
      createElement(CommandMenu, {
        items: [{ name: 'solo', description: '' }],
        query: '',
      }),
    )
    expect(out).toContain('/solo')
  })

  it('ellipsizes a description that overflows the remaining columns', async () => {
    const out = await paintCommandMenu(
      [{
        name: 'compact',
        description: 'Compact older conversation history into a much longer explanation',
      }],
      40,
    )
    expect(out).toContain('/compact')
    expect(out).toContain('…')
  })

  it('drops the description when no columns remain after the name', async () => {
    const out = await paintCommandMenu(
      [{ name: 'x', description: 'hidden sentinel' }],
      6,
    )
    expect(out).toContain('/x')
    expect(out).not.toContain('hidden sentinel')
  })

  it('keeps only the ellipsis when one description column remains', async () => {
    const out = await paintCommandMenu(
      [{ name: 'x', description: 'hidden sentinel' }],
      7,
    )
    expect(out).toContain('…')
    expect(out).not.toContain('hidden sentinel')
  })

  it('renders nothing when the query matches no command', () => {
    const out = renderToString(
      createElement(CommandMenu, {
        items: [{ name: 'compact', description: 'Compact older conversation history' }],
        query: 'zzz',
      }),
    )
    expect(out).toBe('')
  })

  it('escapes CSI in a command description', () => {
    const out = renderToString(
      createElement(CommandMenu, {
        items: [{ name: 'evil', description: '\x1b[2J wipe' }],
        query: '',
      }),
    )
    expect(out).toContain('/evil')
    expect(out).not.toContain('\x1b[2J')
    expect(out).toContain('\\x1b')
  })

  it('marks the selected mention row with the bold accent › prefix (style only)', () => {
    const out = renderToString(createElement(Mention, {
      phase: 'ready',
      candidates: [
        { kind: 'file', name: 'src/main.ts' },
        { kind: 'file', name: 'src/main.md' },
      ],
      selectedIndex: 0,
    }))
    expect(out).toContain('\x1b[1m\x1b[38;2;77;107;254m› ')
    expect(out).toContain('@ src/main.ts')
    expect(out).toContain('@ src/main.md')
    expect(out).not.toContain('\x1b[1m\x1b[38;2;77;107;254m@ src/main.ts')
  })
})

describe('reduceInteraction', () => {
  it('walks generate → stop → stopped → continue → exit-armed → exit', () => {
    const first = reduceInteraction('idle', { kind: 'send', text: 'hi' })
    expect(first).toEqual({
      state: 'generating',
      effect: { kind: 'followup', text: 'hi' },
    })
    const stopped = reduceInteraction('generating', {
      kind: 'turn-ended',
      completed: false,
    })
    expect(stopped.state).toBe('stopped')
    const continued = reduceInteraction('stopped', {
      kind: 'send',
      text: 'more',
    })
    expect(continued.state).toBe('generating')
    const idle = reduceInteraction('generating', {
      kind: 'turn-ended',
      completed: true,
    })
    expect(idle.state).toBe('idle')
    const armed = reduceInteraction('idle', { kind: 'sigint' })
    expect(armed).toEqual({
      state: 'exit-armed',
      effect: { kind: 'arm-exit' },
    })
    const exit = reduceInteraction('exit-armed', { kind: 'sigint' })
    expect(exit.effect).toEqual({ kind: 'exit', code: 0 })
  })

  it('cancels generation on SIGINT while generating', () => {
    const next = reduceInteraction('generating', { kind: 'sigint' })
    expect(next.state).toBe('generating')
    expect(next.effect).toEqual({ kind: 'cancel-generation' })
  })
})
