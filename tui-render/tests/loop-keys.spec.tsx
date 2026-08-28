/** mapKeyEvent against Ink's real input contract (boolean flags, '\r' Enter). */

import { describe, expect, it } from 'vitest'
import { feedbackLabel, feedbackLine, mapKeyEvent, statusHint, statusLine, statusSlot, formatIdleComposerStatus, composeIdleComposerStatus, shortenHomePath, clampViewShift, MAX_VIEW_SHIFT, activeMentionQuery } from '../src/loop.tsx'
import type { MentionCandidate } from '../src/mention.tsx'
import type { LoopInputState } from '../src/loop.tsx'

const COMMANDS = [
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'help', description: 'Show command help and key bindings' },
]
const EMPTY: LoopInputState = {
  text: '',
  commandQuery: undefined,
  prefixG: false,
  renaming: false,
  mentionSelectedIndex: 0,
  mentionDismissed: false,
}
const CHAT_PANE = { open: false, selectedId: undefined }
const CHAT_SEARCH = { open: false, selectedId: undefined }
const MENTION_CANDIDATES: MentionCandidate[] = [
  { kind: 'subagent', name: 'alpha', target: '@alpha ' },
  { kind: 'subagent', name: 'beta' },
]

function mapMentionKey(
  state: LoopInputState,
  key: string,
  info: Parameters<typeof keyInfo>[0],
  selectedIndex: number,
) {
  return mapKeyEvent(
    state,
    key,
    keyInfo(info),
    COMMANDS,
    CHAT_PANE,
    CHAT_SEARCH,
    { open: false },
    { open: false, selectedId: undefined },
    { open: false },
    { open: false },
    { open: false },
    { open: false },
    { open: false },
    true,
    {},
    {
      open: true,
      candidateCount: MENTION_CANDIDATES.length,
      selectedIndex,
      selectedCandidate: MENTION_CANDIDATES[selectedIndex],
    },
  )
}

function keyInfo(
  overrides: Record<string, boolean> = {},
): Parameters<typeof mapKeyEvent>[2] {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  }
}

describe('text input delivery', () => {
  it('appends multi-character IME commits to the composer', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: '你好' },
      '，我们',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.text).toBe('你好，我们')
      expect(effect.action).toEqual({ kind: 'none' })
    }
  })

  it('ignores escape-sequence residue and control-modified input', () => {
    for (const [key, info] of [
      ['[A', keyInfo()],
      ['', keyInfo()],
      ['c', keyInfo({ ctrl: true })],
    ] as const) {
      const effect = mapKeyEvent(
        { ...EMPTY, text: 'hi' },
        key,
        info,
        COMMANDS,
        CHAT_PANE,
        CHAT_SEARCH,
      )
      if (key === 'c') continue // Ctrl+C dispatches sigint, covered elsewhere
      expect(effect.kind).toBe('dispatch')
      if (effect.kind === 'dispatch') {
        expect(effect.text).toBe('hi')
      }
    }
  })

  it('filters the search query with multi-character commits', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: '关' },
      '键词',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      { open: true, selectedId: undefined },
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'search', query: '关键词' })
    }
  })

  it('filters the model panel with multi-character commits', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'de' },
      'epseek',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      { open: false },
      { open: true, selectedId: undefined },
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'model-filter', query: 'deepseek' })
    }
  })

  it('inserts j/k into a non-empty composer instead of scrolling', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'just ' },
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.text).toBe('just j')
    }
  })

  it('keeps j/k scrolling while the composer is empty', () => {
    const effect = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'scroll', delta: -1 })
    }
  })

  it('scrolls on arrow keys while the composer is empty', () => {
    const down = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ downArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'scroll',
      delta: -1,
    })
    const up = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ upArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'scroll',
      delta: 1,
    })
  })

  it('routes page and edge navigation through explicit scroll actions', () => {
    const cases = [
      [keyInfo({ pageUp: true }), { kind: 'scroll', delta: 60 }],
      [keyInfo({ pageDown: true }), { kind: 'scroll', delta: -60 }],
      [keyInfo({ home: true }), { kind: 'scroll-edge', edge: 'oldest' }],
      [keyInfo({ end: true }), { kind: 'scroll-edge', edge: 'latest' }],
    ] as const
    for (const [info, expected] of cases) {
      const effect = mapKeyEvent(
        { ...EMPTY, text: 'draft' },
        '',
        info,
        COMMANDS,
        CHAT_PANE,
        CHAT_SEARCH,
      )
      expect(effect.kind === 'dispatch' ? effect.action : effect).toEqual(expected)
    }

    const latest = mapKeyEvent(
      EMPTY,
      'G',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(latest.kind === 'dispatch' ? latest.action : latest).toEqual({
      kind: 'scroll-edge',
      edge: 'latest',
    })
    const typed = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      'G',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(typed.kind === 'dispatch' ? typed.text : typed).toBe('draftG')
  })

  it('rejects embedded control code points as text', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'safe' },
      '\u0000',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind === 'dispatch' ? effect.text : effect.kind).toBe('safe')
  })
})

describe('remaining pure key routes', () => {
  it('covers tab fallthrough, query derivation, and rename non-text input', () => {
    const outside = mapKeyEvent(EMPTY, '\t', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(outside.kind === 'dispatch' ? outside.text : outside.kind).toBe('')

    const derived = mapKeyEvent(
      { ...EMPTY, text: '/he' },
      '\t',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(derived.kind === 'dispatch' ? derived.text : derived.kind).toBe('/help')
    const missing = mapKeyEvent(
      { ...EMPTY, text: '/zzz' },
      '\t',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(missing.kind === 'dispatch' ? missing.text : missing.kind).toBe('/zzz')

    expect(mapKeyEvent(
      { ...EMPTY, text: 'title', renaming: true },
      '[A',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    ).kind).toBe('none')
  })

  it('covers search and model up-arrow, text, and inert input paths', () => {
    const search = { open: true, selectedId: undefined }
    const searchUp = mapKeyEvent(EMPTY, '', keyInfo({ upArrow: true }), COMMANDS, CHAT_PANE, search)
    expect(searchUp.kind === 'dispatch' ? searchUp.action : searchUp).toEqual({
      kind: 'session-pane-move', delta: -1,
    })
    const searchText = mapKeyEvent(EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, search)
    expect(searchText.kind === 'dispatch' ? searchText.action : searchText).toEqual({ kind: 'search', query: 'x' })
    expect(mapKeyEvent(EMPTY, '\u0000', keyInfo(), COMMANDS, CHAT_PANE, search).kind).toBe('none')

    const model = { open: true, selectedId: undefined }
    const modelUp = mapKeyEvent(
      EMPTY, '', keyInfo({ upArrow: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model,
    )
    expect(modelUp.kind === 'dispatch' ? modelUp.action : modelUp).toEqual({ kind: 'model-move', delta: -1 })
    const modelText = mapKeyEvent(
      EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model,
    )
    expect(modelText.kind === 'dispatch' ? modelText.action : modelText).toEqual({ kind: 'model-filter', query: 'x' })
    expect(mapKeyEvent(
      EMPTY, '\u0000', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model,
    ).kind).toBe('none')
  })

  it('keeps return inert for an open mention without a selected candidate', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: '@' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      {},
      { open: true, candidateCount: 1, selectedIndex: 0, selectedCandidate: undefined },
    )
    expect(effect.kind).toBe('none')
  })

  it('preserves the prior command query when slash is inserted after text', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'a', commandQuery: 'old', caretIndex: 1 },
      '/',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect).toMatchObject({ kind: 'dispatch', text: 'a/', commandQuery: 'old' })
  })

  it('treats absent ask-user option counts as empty and supports arrow movement', () => {
    const args = [
      EMPTY, '', keyInfo({ return: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      undefined, undefined, undefined, undefined, { open: true },
    ] as const
    expect(mapKeyEvent(...args).kind).toBe('none')
    expect(mapKeyEvent(
      EMPTY, '1', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      undefined, undefined, undefined, undefined, { open: true },
    ).kind).toBe('none')
    const down = mapKeyEvent(
      EMPTY, '', keyInfo({ downArrow: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      undefined, undefined, undefined, undefined, { open: true, optionCount: 2 },
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({ kind: 'ask-user-move', delta: 1 })
    const up = mapKeyEvent(
      EMPTY, '', keyInfo({ upArrow: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      undefined, undefined, undefined, undefined, { open: true, optionCount: 2 },
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({ kind: 'ask-user-move', delta: -1 })
  })

  it('renders goal status and an idle footer without a badge', () => {
    expect(statusSlot('generating', false, { head: '目标 1/2', objective: 'finish' }))
      .toContain('目标 1/2')
    expect(composeIdleComposerStatus(80, '/home/me/work', '', '/home/me'))
      .toContain('~/work')
  })
})

describe('mapKeyEvent (Ink contract)', () => {
  it('sends on Enter (\\r + return flag), not on the literal string', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'hi' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'send', text: 'hi' })
      expect(effect.text).toBe('')
    }
  })

  it('newlines on Shift+Enter', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'a' },
      '\r',
      keyInfo({ return: true, shift: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') expect(effect.text).toBe('a\n')
  })

  it('deletes on the backspace flag even though the string is empty', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'abc' },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') expect(effect.text).toBe('ab')
  })

  it('recomputes the command query when backspacing a slash line', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: '/ab', commandQuery: 'ab', caretIndex: 3 },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('dispatch')
    if (effect.kind === 'dispatch') {
      expect(effect.text).toBe('/a')
      expect(effect.commandQuery).toBe('a')
    }
  })

  it('cancels command mode on the escape flag', () => {
    const effect = mapKeyEvent(
      { text: '/comp', commandQuery: 'comp', prefixG: false, renaming: false },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') expect(effect.commandQuery).toBeUndefined()
  })

  it('executes the highlighted prefix match on Enter inside command mode', () => {
    const effect = mapKeyEvent(
      { text: '/comp', commandQuery: 'comp', prefixG: false, renaming: false },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'command', query: 'compact' })
      expect(effect.text).toBe('')
    }
  })

  it('executes /settings from the /s prefix on Enter', () => {
    const directory = [
      { name: 'permission', description: 'Switch the permission preset' },
      { name: 'settings', description: 'Edit provider settings (baseURL)' },
    ]
    const effect = mapKeyEvent(
      { text: '/s', commandQuery: 's', prefixG: false, renaming: false },
      '\r',
      keyInfo({ return: true }),
      directory,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'command', query: 'settings' })
    }
  })

  it('executes the controlled row for empty / and preserves an unknown prefix', () => {
    const empty = mapKeyEvent(
      { text: '/', commandQuery: undefined, prefixG: false, renaming: false },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (empty.kind === 'dispatch') {
      expect(empty.action).toEqual({ kind: 'command', query: 'compact' })
    }
    const unknown = mapKeyEvent(
      { text: '/zzz', commandQuery: undefined, prefixG: false, renaming: false },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (unknown.kind === 'dispatch') {
      expect(unknown.action).toEqual({ kind: 'command', query: 'zzz' })
    }
  })

  it('keeps trailing arguments when Enter expands a command prefix', () => {
    const directory = [
      { name: 'permission', description: 'Switch the permission preset' },
    ]
    const effect = mapKeyEvent(
      {
        text: '/permission workspace-write',
        commandQuery: 'permission workspace-write',
        prefixG: false,
        renaming: false,
      },
      '\r',
      keyInfo({ return: true }),
      directory,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({
        kind: 'command',
        query: 'permission workspace-write',
      })
    }
  })

  it('completes the first match on Tab inside command mode', () => {
    const effect = mapKeyEvent(
      { text: '/comp', commandQuery: 'comp', prefixG: false, renaming: false },
      '\t',
      keyInfo({ tab: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') expect(effect.text).toBe('/compact')
  })

  it('stops generation on Ctrl+C and toggles reasoning on Ctrl+O', () => {
    const stop = mapKeyEvent(
      EMPTY,
      'c',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (stop.kind === 'dispatch')
      expect(stop.action).toEqual({ kind: 'sigint' })
    const toggle = mapKeyEvent(
      EMPTY,
      'o',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (toggle.kind === 'dispatch')
      expect(toggle.action).toEqual({ kind: 'toggle-reasoning' })
    const cards = mapKeyEvent(
      EMPTY,
      'e',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (cards.kind === 'dispatch')
      expect(cards.action).toEqual({ kind: 'toggle-tool-cards' })
    const copy = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      'y',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(copy).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'copy-message' },
      text: 'draft',
    })
    const enter = mapKeyEvent(EMPTY, 'return', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (enter.kind === 'dispatch')
      expect(enter.action.kind).not.toBe('toggle-tool-cards')
    const space = mapKeyEvent(EMPTY, ' ', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(space.kind === 'dispatch' ? space.action.kind : space.kind).not.toBe(
      'toggle-tool-cards',
    )
  })

  it('scrolls on j/k and opens palettes on / and @', () => {
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'scroll', delta: -1 })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (up.kind === 'dispatch')
      expect(up.action).toEqual({ kind: 'scroll', delta: 1 })
    const command = mapKeyEvent(EMPTY, '/', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (command.kind === 'dispatch') expect(command.commandQuery).toBe('')
    const mention = mapKeyEvent(EMPTY, '@', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (mention.kind === 'dispatch') expect(mention.text).toBe('@')
  })

  it('treats only an unfinished leading @token as mention mode', () => {
    expect(activeMentionQuery('@alpha')).toBe('alpha')
    expect(activeMentionQuery('@')).toBe('')
    expect(activeMentionQuery('@alpha ')).toBeUndefined()
    expect(activeMentionQuery('hi @alpha')).toBeUndefined()
  })

  it('moves mention selection with Up and Down without scrolling the transcript', () => {
    const down = mapMentionKey({ ...EMPTY, text: '@a' }, 'j', {}, 0)
    expect(down.kind).toBe('dispatch')
    if (down.kind === 'dispatch') {
      expect(down.action).toEqual({ kind: 'none' })
      expect(down.mentionSelectedIndex).toBe(1)
    }
    const up = mapMentionKey(
      { ...EMPTY, text: '@a', mentionSelectedIndex: 1 },
      'k',
      {},
      1,
    )
    if (up.kind === 'dispatch') {
      expect(up.action).toEqual({ kind: 'none' })
      expect(up.mentionSelectedIndex).toBe(0)
    }
  })

  it('clamps mention selection at both boundaries', () => {
    const top = mapMentionKey({ ...EMPTY, text: '@a' }, 'k', {}, 0)
    const bottom = mapMentionKey(
      { ...EMPTY, text: '@a', mentionSelectedIndex: 1 },
      'j',
      {},
      1,
    )
    if (top.kind === 'dispatch') expect(top.mentionSelectedIndex).toBe(0)
    if (bottom.kind === 'dispatch') expect(bottom.mentionSelectedIndex).toBe(1)
  })

  it('applies canonical mention insertion on Enter and never dispatches send', () => {
    const fixedTarget = mapMentionKey(
      { ...EMPTY, text: '@al', mentionSelectedIndex: 0 },
      '\r',
      { return: true },
      0,
    )
    if (fixedTarget.kind === 'dispatch') {
      expect(fixedTarget.action).toEqual({ kind: 'none' })
      expect(fixedTarget.text).toBe('@alpha ')
    }
    const fallback = mapMentionKey(
      { ...EMPTY, text: '@be', mentionSelectedIndex: 1 },
      '\r',
      { return: true },
      1,
    )
    if (fallback.kind === 'dispatch') {
      expect(fallback.action).toEqual({ kind: 'none' })
      expect(fallback.text).toBe('@beta ')
    }
  })

  it('dismisses the current mention query on Escape and reopens on the next edit', () => {
    const dismissed = mapMentionKey(
      { ...EMPTY, text: '@al' },
      '',
      { escape: true },
      0,
    )
    if (dismissed.kind === 'dispatch') {
      expect(dismissed.mentionDismissed).toBe(true)
      expect(dismissed.text).toBe('@al')
    }
    const reopened = mapKeyEvent(
      { ...EMPTY, text: '@al', mentionDismissed: true },
      'p',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (reopened.kind === 'dispatch') {
      expect(reopened.text).toBe('@alp')
      expect(reopened.mentionDismissed).toBe(false)
      expect(reopened.mentionSelectedIndex).toBe(0)
    }
  })

  it('appends printable characters and feeds the command query', () => {
    const typed = mapKeyEvent(EMPTY, 'h', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (typed.kind === 'dispatch') expect(typed.text).toBe('h')
    const inCommand = mapKeyEvent(
      { text: '/c', commandQuery: 'c', prefixG: false, renaming: false },
      'o',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (inCommand.kind === 'dispatch') expect(inCommand.commandQuery).toBe('co')
  })

  it('dispatches new-session on Ctrl+N and toggles search on Ctrl+K', () => {
    const fresh = mapKeyEvent(
      EMPTY,
      'n',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (fresh.kind === 'dispatch')
      expect(fresh.action).toEqual({ kind: 'new-session' })
    const search = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (search.kind === 'dispatch') {
      expect(search.action).toEqual({ kind: 'search-pane' })
      expect(search.text).toBe('')
    }
  })

  it('toggles the timeline view on Ctrl+T', () => {
    const effect = mapKeyEvent(
      EMPTY,
      't',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch')
      expect(effect.action).toEqual({ kind: 'toggle-timeline' })
  })

  it('opens the session pane on the g-s sequence and not on a bare s', () => {
    // The armed `g` enters the buffer first (K1 buffer-preserving chord).
    const g = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (g.kind === 'dispatch') {
      expect(g.prefixG).toBe(true)
      expect(g.text).toBe('g')
    }
    const s = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (s.kind === 'dispatch') {
      expect(s.action).toEqual({ kind: 'session-pane' })
      expect(s.prefixG).toBe(false)
      // Chord wins: the armed `g` is removed from the buffer.
      expect(s.text).toBe('')
    }
    const bare = mapKeyEvent(EMPTY, 's', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (bare.kind === 'dispatch') expect(bare.text).toBe('s')
  })

  it('keeps the g in the buffer when the chord times out (K1)', () => {
    // Post-timeout state: the owner cleared the arm; `g` stays as typed text.
    const s = mapKeyEvent(
      { ...EMPTY, text: 'g' },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (s.kind === 'dispatch') expect(s.text).toBe('gs')
  })

  it('keeps both letters when an intervening key breaks the chord (K1)', () => {
    const afterG = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    let state = EMPTY
    if (afterG.kind === 'dispatch') state = { ...EMPTY, text: afterG.text, prefixG: afterG.prefixG }
    const afterX = mapKeyEvent(state, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    if (afterX.kind === 'dispatch') {
      expect(afterX.prefixG).toBe(false)
      expect(afterX.text).toBe('gx')
    }
    const afterS = mapKeyEvent(
      { ...EMPTY, text: afterX.kind === 'dispatch' ? afterX.text : 'gx' },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (afterS.kind === 'dispatch') expect(afterS.text).toBe('gxs')
  })

  it('keeps a pasted gs in the buffer (paste never arms, K1)', () => {
    // Paste arrives through the usePaste path, which appends without arming;
    // the reducer sees a plain 'g' then 's' only if armed state was cleared.
    const s = mapKeyEvent(
      { ...EMPTY, text: 'gs' },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (s.kind === 'dispatch') {
      expect(s.text).toBe('gss')
      expect(s.action).not.toEqual({ kind: 'session-pane' })
    }
  })

  it('preserves the ordinary word good verbatim (K1)', () => {
    let state = EMPTY
    for (const char of 'good') {
      const effect = mapKeyEvent(state, char, keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
      if (effect.kind !== 'dispatch') throw new Error('expected dispatch')
      state = { ...state, text: effect.text, prefixG: effect.prefixG }
    }
    expect(state.text).toBe('good')
    expect(state.prefixG).toBe(false)
  })

  it('keeps /settings as composer text instead of opening the session list', () => {
    let state = EMPTY
    for (const char of '/settings') {
      const effect = mapKeyEvent(state, char, keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
      if (effect.kind !== 'dispatch') throw new Error('expected dispatch')
      expect(effect.action).not.toEqual({ kind: 'session-pane' })
      state = {
        ...state,
        text: effect.text,
        commandQuery: effect.commandQuery,
        prefixG: effect.prefixG,
        caretIndex: effect.caretIndex,
      }
    }
    expect(state.text).toBe('/settings')
    expect(state.prefixG).toBe(false)
  })

  it('keeps the ordinary word settings verbatim (K1)', () => {
    let state = EMPTY
    for (const char of 'settings') {
      const effect = mapKeyEvent(state, char, keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
      if (effect.kind !== 'dispatch') throw new Error('expected dispatch')
      expect(effect.action).not.toEqual({ kind: 'session-pane' })
      state = {
        ...state,
        text: effect.text,
        prefixG: effect.prefixG,
        caretIndex: effect.caretIndex,
      }
    }
    expect(state.text).toBe('settings')
    expect(state.prefixG).toBe(false)
  })

  it('moves the caret with left/right and inserts in the middle', () => {
    const left = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 2 },
      '',
      keyInfo({ leftArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(left.kind).toBe('dispatch')
    if (left.kind === 'dispatch') {
      expect(left.text).toBe('ab')
      expect(left.caretIndex).toBe(1)
    }
    const inserted = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 1 },
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(inserted.kind).toBe('dispatch')
    if (inserted.kind === 'dispatch') {
      expect(inserted.text).toBe('axb')
      expect(inserted.caretIndex).toBe(2)
    }
    const right = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 0 },
      '',
      keyInfo({ rightArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(right.kind).toBe('dispatch')
    if (right.kind === 'dispatch') expect(right.caretIndex).toBe(1)
  })

  it('deletes the grapheme before the caret', () => {
    const mid = mapKeyEvent(
      { ...EMPTY, text: 'axb', caretIndex: 2 },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(mid.kind).toBe('dispatch')
    if (mid.kind === 'dispatch') {
      expect(mid.text).toBe('ab')
      expect(mid.caretIndex).toBe(1)
    }
    const start = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 0 },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(start.kind).toBe('dispatch')
    if (start.kind === 'dispatch') {
      expect(start.text).toBe('ab')
      expect(start.caretIndex).toBe(0)
    }
  })

  it('scrolls on arrow keys while the composer has text; j still inserts', () => {
    const up = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ upArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'scroll',
      delta: 1,
    })
    const down = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ downArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'scroll',
      delta: -1,
    })
    const letter = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(letter.kind === 'dispatch' ? letter.text : letter).toBe('draftj')
  })

  it('closes the list on g-s while the pane is open (K1)', () => {
    const pane = { open: true, selectedId: 'session-1' }
    const g = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    let state = EMPTY
    if (g.kind === 'dispatch') state = { ...EMPTY, text: g.text, prefixG: g.prefixG }
    const s = mapKeyEvent(state, 's', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (s.kind === 'dispatch') {
      expect(s.action).toEqual({ kind: 'session-pane' })
      expect(s.text).toBe('')
    }
  })

  it('clears the g prefix on an unrelated key but keeps the text (K1)', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (effect.kind === 'dispatch') {
      expect(effect.prefixG).toBe(false)
      expect(effect.text).toBe('gx')
    }
  })

  it('routes list-mode keys: move, select, rename, delete, close', () => {
    const pane = { open: true, selectedId: 'session-1' }
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'session-pane-move', delta: 1 })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (up.kind === 'dispatch')
      expect(up.action).toEqual({ kind: 'session-pane-move', delta: -1 })
    const select = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (select.kind === 'dispatch')
      expect(select.action).toEqual({ kind: 'select-session', id: 'session-1' })
    const remove = mapKeyEvent(EMPTY, 'd', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (remove.kind === 'dispatch')
      expect(remove.action).toEqual({ kind: 'delete-session' })
    const close = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      's',
      keyInfo(),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (close.kind === 'dispatch')
      expect(close.action).toEqual({ kind: 'session-pane' })
    const escape = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (escape.kind === 'dispatch')
      expect(escape.action).toEqual({ kind: 'session-pane' })
    const ignored = mapKeyEvent(EMPTY, 'x', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    // A non-command printable key only disarms the armed delete (K6).
    if (ignored.kind === 'dispatch')
      expect(ignored.action).toEqual({ kind: 'session-pane-idle' })
  })

  it('ignores Enter in list mode when no row is selected', () => {
    const effect = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      { open: true, selectedId: undefined },
      CHAT_SEARCH,
    )
    expect(effect.kind).toBe('none')
  })

  it('captures the rename buffer and confirms it on Enter', () => {
    const pane = { open: true, selectedId: 'session-1' }
    const start = mapKeyEvent(EMPTY, 'r', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (start.kind === 'dispatch') expect(start.renaming).toBe(true)
    const typed = mapKeyEvent(
      { ...EMPTY, renaming: true },
      'n',
      keyInfo(),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (typed.kind === 'dispatch') expect(typed.text).toBe('n')
    const confirm = mapKeyEvent(
      { ...EMPTY, text: 'new title', renaming: true },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (confirm.kind === 'dispatch') {
      expect(confirm.action).toEqual({
        kind: 'rename-session',
        title: 'new title',
      })
      expect(confirm.renaming).toBe(false)
    }
    const cancel = mapKeyEvent(
      { ...EMPTY, text: 'partial', renaming: true },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      pane,
      CHAT_SEARCH,
    )
    if (cancel.kind === 'dispatch') {
      expect(cancel.renaming).toBe(false)
      expect(cancel.text).toBe('')
    }
  })

  it('filters the search query while the search panel is open', () => {
    const search = { open: true, selectedId: 'session-1' }
    const typed = mapKeyEvent(
      { ...EMPTY, text: 'k' },
      'w',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      search,
    )
    if (typed.kind === 'dispatch') {
      expect(typed.action).toEqual({ kind: 'search', query: 'kw' })
      expect(typed.text).toBe('kw')
    }
    const erased = mapKeyEvent(
      { ...EMPTY, text: 'kw' },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      search,
    )
    if (erased.kind === 'dispatch') {
      expect(erased.action).toEqual({ kind: 'search', query: 'k' })
      expect(erased.text).toBe('k')
    }
  })

  it('moves, selects, and closes from the search panel', () => {
    const search = { open: true, selectedId: 'session-2' }
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, search)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'session-pane-move', delta: 1 })
    const select = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      search,
    )
    if (select.kind === 'dispatch') {
      expect(select.action).toEqual({ kind: 'select-session', id: 'session-2' })
      expect(select.text).toBe('')
    }
    const close = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      search,
    )
    if (close.kind === 'dispatch') {
      expect(close.action).toEqual({ kind: 'search-pane' })
      expect(close.text).toBe('')
    }
  })

  it('ignores Enter in search mode when no candidate is highlighted', () => {
    const effect = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      { open: true, selectedId: undefined },
    )
    expect(effect.kind).toBe('none')
  })

  it('keeps the chat text and routes the toggle on panel Escape/Enter (K4 observable)', () => {
    // List mode: Escape closes via the session-pane toggle with the text intact.
    const listEscape = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      { open: true, selectedId: 'session-1' },
      CHAT_SEARCH,
    )
    if (listEscape.kind === 'dispatch') {
      expect(listEscape.action).toEqual({ kind: 'session-pane' })
      expect(listEscape.text).toBe('draft')
    }
    // List mode: Enter selects without touching the buffer.
    const listEnter = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      { open: true, selectedId: 'session-1' },
      CHAT_SEARCH,
    )
    if (listEnter.kind === 'dispatch') {
      expect(listEnter.action).toEqual({ kind: 'select-session', id: 'session-1' })
      expect(listEnter.text).toBe('draft')
    }
  })

  it('routes timeline mode keys: j/k scroll, Escape closes, Ctrl+T toggles (K3)', () => {
    const timeline = { open: true }
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, timeline)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'timeline-scroll', delta: 1 })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, timeline)
    if (up.kind === 'dispatch')
      expect(up.action).toEqual({ kind: 'timeline-scroll', delta: -1 })
    const close = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      timeline,
    )
    if (close.kind === 'dispatch')
      expect(close.action).toEqual({ kind: 'toggle-timeline' })
    const toggle = mapKeyEvent(
      EMPTY,
      't',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      timeline,
    )
    if (toggle.kind === 'dispatch')
      expect(toggle.action).toEqual({ kind: 'toggle-timeline' })
    // A printable key is inert in timeline mode (no scroll, no typing).
    const inert = mapKeyEvent(EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, timeline)
    expect(inert.kind).toBe('none')
  })

  it('routes model-pane keys: j/k move, printable filter, backspace filter', () => {
    const model = { open: true, selectedId: 'deepseek-official:deepseek-chat' }
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'model-move', delta: 1 })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model)
    if (up.kind === 'dispatch')
      expect(up.action).toEqual({ kind: 'model-move', delta: -1 })
    const typed = mapKeyEvent(
      { ...EMPTY, text: 'deep' },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      model,
    )
    if (typed.kind === 'dispatch') {
      expect(typed.action).toEqual({ kind: 'model-filter', query: 'deeps' })
      expect(typed.text).toBe('deeps')
    }
    const erased = mapKeyEvent(
      { ...EMPTY, text: 'deeps' },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      model,
    )
    if (erased.kind === 'dispatch') {
      expect(erased.action).toEqual({ kind: 'model-filter', query: 'deep' })
      expect(erased.text).toBe('deep')
    }
  })

  it('selects the highlighted model on Enter and closes on Escape (K4 buffer intact)', () => {
    const model = { open: true, selectedId: 'deepseek-official:deepseek-chat' }
    const select = mapKeyEvent(
      { ...EMPTY, text: 'deep' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      model,
    )
    if (select.kind === 'dispatch') {
      expect(select.action).toEqual({
        kind: 'select-model',
        id: 'deepseek-official:deepseek-chat',
      })
      expect(select.text).toBe('')
    }
    const close = mapKeyEvent(
      { ...EMPTY, text: 'deep' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      model,
    )
    if (close.kind === 'dispatch') {
      expect(close.action).toEqual({ kind: 'model-pane' })
      expect(close.text).toBe('')
    }
  })

  it('ignores Enter in model mode when no row is highlighted', () => {
    const effect = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      { open: true, selectedId: undefined },
    )
    expect(effect.kind).toBe('none')
  })

  it('keeps g s inert inside the model panel (filter, never the chord, K2)', () => {
    const model = { open: true, selectedId: 'p:m' }
    const g = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, model)
    if (g.kind === 'dispatch') {
      expect(g.action).toEqual({ kind: 'model-filter', query: 'g' })
      expect(g.prefixG).toBe(false)
    }
    const s = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      model,
    )
    if (s.kind === 'dispatch') {
      expect(s.action).toEqual({ kind: 'model-filter', query: 'gs' })
      expect(s.action).not.toEqual({ kind: 'session-pane' })
    }
  })

  it('routes help-pane keys: j/k scroll, Esc/Enter close, others inert', () => {
    const help = { open: true }
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, undefined, help)
    if (down.kind === 'dispatch')
      expect(down.action).toEqual({ kind: 'help-scroll', delta: 1 })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, undefined, help)
    if (up.kind === 'dispatch')
      expect(up.action).toEqual({ kind: 'help-scroll', delta: -1 })
    const escape = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      help,
    )
    if (escape.kind === 'dispatch') {
      expect(escape.action).toEqual({ kind: 'help-pane' })
      expect(escape.text).toBe('draft')
    }
    const enter = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      help,
    )
    if (enter.kind === 'dispatch')
      expect(enter.action).toEqual({ kind: 'help-pane' })
    const inert = mapKeyEvent(EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, undefined, undefined, help)
    expect(inert.kind).toBe('none')
    const backspace = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      help,
    )
    expect(backspace.kind).toBe('none')
  })

  it('routes the pane-toggle actions from normal mode (K2 routing only)', () => {
    // The list opens through the buffer-preserving chord.
    const g = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    const s = mapKeyEvent(
      { ...EMPTY, text: g.kind === 'dispatch' ? g.text : 'g', prefixG: g.kind === 'dispatch' ? g.prefixG : true },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (s.kind === 'dispatch') expect(s.action).toEqual({ kind: 'session-pane' })
    const search = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (search.kind === 'dispatch') expect(search.action).toEqual({ kind: 'search-pane' })
    const timeline = mapKeyEvent(
      EMPTY,
      't',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    if (timeline.kind === 'dispatch') expect(timeline.action).toEqual({ kind: 'toggle-timeline' })
  })

  it('disarms an armed delete on any other printable key in list mode (K6)', () => {
    const pane = { open: true, selectedId: 'session-1' }
    const effect = mapKeyEvent(EMPTY, 'x', keyInfo(), COMMANDS, pane, CHAT_SEARCH)
    if (effect.kind === 'dispatch') {
      expect(effect.action).toEqual({ kind: 'session-pane-idle' })
      expect(effect.text).toBe('')
    }
  })

  it('maps y/a/n/d/Esc/i to approval actions without changing text (K14)', () => {
    const open = { open: true }
    const buffered = { ...EMPTY, text: 'draft' }
    const allow = mapKeyEvent(
      buffered,
      'y',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(allow).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'approval-allow' },
      text: 'draft',
    })
    const alt = mapKeyEvent(
      buffered,
      'a',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(alt.kind === 'dispatch' ? alt.action : alt).toEqual({
      kind: 'approval-allow',
    })
    const deny = mapKeyEvent(
      buffered,
      'n',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(deny.kind === 'dispatch' ? deny.action : deny).toEqual({
      kind: 'approval-deny',
    })
    const altDeny = mapKeyEvent(
      buffered,
      'd',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(altDeny.kind === 'dispatch' ? altDeny.action : altDeny).toEqual({
      kind: 'approval-deny',
    })
    const escape = mapKeyEvent(
      buffered,
      'escape',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(escape.kind === 'dispatch' ? escape.action : escape).toEqual({
      kind: 'approval-deny',
    })
    const detail = mapKeyEvent(
      buffered,
      'i',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(detail.kind === 'dispatch' ? detail.action : detail).toEqual({
      kind: 'approval-detail',
    })
  })

  it('routes Ctrl+Y before approval and ask-user dialog capture', () => {
    const buffered = { ...EMPTY, text: 'draft' }
    const approvalCopy = mapKeyEvent(
      buffered,
      'y',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: true },
    )
    expect(approvalCopy).toMatchObject({
      kind: 'dispatch', action: { kind: 'copy-message' }, text: 'draft',
    })
    const askCopy = mapKeyEvent(
      buffered,
      'y',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      undefined,
      { open: true, optionCount: 1 },
    )
    expect(askCopy).toMatchObject({
      kind: 'dispatch', action: { kind: 'copy-message' }, text: 'draft',
    })
  })

  it('routes Ctrl+G with the current draft before dialog capture', () => {
    const buffered = { ...EMPTY, text: 'editor draft' }
    for (const dialogArgs of [
      [undefined, { open: true }],
      [{ open: true }, undefined],
    ] as const) {
      const effect = mapKeyEvent(
        buffered,
        'g',
        keyInfo({ ctrl: true }),
        COMMANDS,
        CHAT_PANE,
        CHAT_SEARCH,
        undefined,
        undefined,
        undefined,
        dialogArgs[0],
        dialogArgs[1],
      )
      expect(effect).toMatchObject({
        kind: 'dispatch',
        action: { kind: 'edit-external', text: 'editor draft' },
        text: 'editor draft',
      })
    }
  })

  it('takes the FIFO head only on empty-composer Up and toggles compaction on Ctrl+K', () => {
    const args = [
      EMPTY,
      '',
      keyInfo({ upArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
      {},
      undefined,
      { headText: 'oldest draft' },
      { available: false },
    ] as const
    expect(mapKeyEvent(...args)).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'take-queued-draft' },
      text: 'oldest draft',
      caretIndex: 12,
    })
    expect(mapKeyEvent(
      { ...EMPTY, text: 'busy' },
      '',
      keyInfo({ upArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...args.slice(6),
    )).toMatchObject({ action: { kind: 'scroll', delta: 1 }, text: 'busy' })
    expect(mapKeyEvent(
      EMPTY,
      'k',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...args.slice(6, 17),
      { available: true },
    )).toMatchObject({ action: { kind: 'toggle-compaction-divider' } })
  })

  it('keeps y as composer text when the approval slot is closed', () => {
    const typed = mapKeyEvent(EMPTY, 'y', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(typed.kind === 'dispatch' ? typed.text : typed.kind).toBe('y')
    expect(typed.kind === 'dispatch' ? typed.action.kind : typed.kind).toBe('none')
  })

  it('ignores browse chords and command submit while approval is open (K2′)', () => {
    const open = { open: true }
    const g = mapKeyEvent(
      EMPTY,
      'g',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(g.kind).toBe('none')
    const s = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(s.kind).toBe('none')
    const search = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(search.kind).toBe('none')
    const timeline = mapKeyEvent(
      EMPTY,
      't',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(timeline.kind).toBe('none')
    const help = mapKeyEvent(
      { ...EMPTY, text: '/help', commandQuery: 'help' },
      'return',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(help.kind).toBe('none')
    const permission = mapKeyEvent(
      { ...EMPTY, text: '/permission', commandQuery: 'permission' },
      'return',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      open,
    )
    expect(permission.kind).toBe('none')
  })

  it('ignores browse chords while ask-user is open (K2′)', () => {
    const search = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: true },
    )
    expect(search.kind).toBe('none')
    const chord = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: true },
    )
    expect(chord.kind).toBe('none')
  })

  it('keeps Ctrl+C as sigint while the approval slot is open', () => {
    const stop = mapKeyEvent(
      EMPTY,
      'c',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: true },
    )
    expect(stop.kind === 'dispatch' ? stop.action : stop).toEqual({
      kind: 'sigint',
    })
  })

  it('maps j/k/1-3/Enter/Esc on the permission overlay and swallows other keys', () => {
    const open = { open: true }
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: false },
      open,
    ] as const
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'permission-move',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'permission-move',
      delta: -1,
    })
    const jump = mapKeyEvent(
      EMPTY,
      '2',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(jump.kind === 'dispatch' ? jump.action : jump).toEqual({
      kind: 'permission-jump',
      index: 1,
    })
    const apply = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(apply.kind === 'dispatch' ? apply.action : apply).toEqual({
      kind: 'permission-apply',
    })
    const escape = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(escape).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'permission-escape' },
      text: 'draft',
    })
    const inert = mapKeyEvent(
      EMPTY,
      'y',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(inert.kind).toBe('none')
    const typed = mapKeyEvent(
      EMPTY,
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(typed.kind).toBe('none')
  })

  it('maps 1-9/Enter/Esc on ask-user and ignores an out-of-range digit', () => {
    const open = { open: true, optionCount: 2 }
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      open,
    ] as const
    const digit = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '1',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(digit).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'ask-user-digit', index: 0 },
      text: 'draft',
    })
    const oob = mapKeyEvent(
      EMPTY,
      '9',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(oob.kind).toBe('none')
    const submit = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(submit.kind === 'dispatch' ? submit.action : submit).toEqual({
      kind: 'ask-user-submit',
    })
    const escape = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(escape.kind === 'dispatch' ? escape.action : escape).toEqual({
      kind: 'ask-user-cancel',
    })
    const emptyEnter = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: true, optionCount: 0 },
    )
    expect(emptyEnter.kind).toBe('none')
    const move = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(move.kind === 'dispatch' ? move.action : move).toEqual({
      kind: 'ask-user-move',
      delta: 1,
    })
  })

  it('enables j/k move on ask-user whenever there are options', () => {
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: true, optionCount: 10 },
    ] as const
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'ask-user-move',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'ask-user-move',
      delta: -1,
    })
    expect(mapKeyEvent(
      EMPTY,
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    ).kind).toBe('none')
  })

  it('maps j/k/Enter/Esc on the settings overlay and seeds the draft on edit', () => {
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: false },
      { open: false },
      { open: true, editValue: 'https://api.deepseek.com' },
    ] as const
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'settings-move',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'settings-move',
      delta: -1,
    })
    const arrowDown = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ downArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(arrowDown.kind === 'dispatch' ? arrowDown.action : arrowDown).toEqual({
      kind: 'settings-move',
      delta: 1,
    })
    const edit = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(edit).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-edit' },
      text: 'https://api.deepseek.com',
    })
    const escape = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(escape.kind === 'dispatch' ? escape.action : escape).toEqual({
      kind: 'settings-escape',
    })
    const inert = mapKeyEvent(
      EMPTY,
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(inert.kind).toBe('none')
    const exported = mapKeyEvent(
      EMPTY,
      'e',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(exported.kind === 'dispatch' ? exported.action : exported).toEqual({
      kind: 'settings-export',
    })
    const reloaded = mapKeyEvent(
      EMPTY,
      'r',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(reloaded.kind === 'dispatch' ? reloaded.action : reloaded).toEqual({
      kind: 'settings-reload',
    })
  })

  it('edits the settings draft in the composer without entering command mode', () => {
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: false },
      { open: false },
      { open: true, editing: true, editValue: 'https://api.deepseek.com' },
    ] as const
    const typed = mapKeyEvent(
      { ...EMPTY, text: 'https://' },
      '/',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(typed).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      text: 'https:///',
      commandQuery: undefined,
    })
    const apply = mapKeyEvent(
      { ...EMPTY, text: 'https://next.example' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(apply).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-apply', value: 'https://next.example' },
      text: '',
    })
    const cancel = mapKeyEvent(
      { ...EMPTY, text: 'https://draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(cancel).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-cancel-edit' },
      text: '',
    })
    const backspace = mapKeyEvent(
      { ...EMPTY, text: 'ab' },
      '',
      keyInfo({ backspace: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(backspace).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      text: 'a',
    })
    const left = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 2 },
      '',
      keyInfo({ leftArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(left).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      caretIndex: 1,
    })
    const right = mapKeyEvent(
      { ...EMPTY, text: 'ab', caretIndex: 0 },
      '',
      keyInfo({ rightArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(right).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      caretIndex: 1,
    })
    const inert = mapKeyEvent(
      { ...EMPTY, text: 'https://' },
      'j',
      keyInfo({ ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(inert.kind).toBe('none')
  })

  it('maps onboarding Enter/Esc and does not treat e as export', () => {
    const extras = [
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: false },
      { open: false },
      { open: true, onboarding: true, editing: true, editValue: '' },
    ] as const
    const apply = mapKeyEvent(
      { ...EMPTY, text: 'sk-test' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(apply).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-apply', value: 'sk-test' },
      text: '',
    })
    const skip = mapKeyEvent(
      { ...EMPTY, text: 'sk-test' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(skip).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-escape' },
      text: '',
    })
    const typed = mapKeyEvent(
      EMPTY,
      'e',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras,
    )
    expect(typed).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      text: 'e',
    })
  })

  it('inserts a newline on Enter when submitOnEnter is false', () => {
    const effect = mapKeyEvent(
      { ...EMPTY, text: 'hello' },
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      { open: false },
      { open: false, selectedId: undefined },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      false,
    )
    expect(effect).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'none' },
      text: 'hello\n',
    })
    const send = mapKeyEvent(
      { ...EMPTY, text: 'hello' },
      '\r',
      keyInfo({ return: true, ctrl: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      { open: false },
      { open: false, selectedId: undefined },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      { open: false },
      false,
    )
    expect(send).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'send', text: 'hello' },
      text: '',
    })
  })

  it('seeds an empty draft when the settings overlay has no editValue', () => {
    const edit = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      undefined,
      undefined,
      undefined,
      { open: false },
      { open: false },
      { open: false },
      { open: true },
    )
    expect(edit).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'settings-edit' },
      text: '',
    })
  })

  it('escapes ANSI in the feedback label before it reaches the terminal (A1)', () => {
    const raw = '✗ 切换失败：\u001b[31mboom\u001b[0m（当前会话保持可用）'
    const label = feedbackLabel(raw)
    expect(label).not.toContain('\u001b')
    expect(label).toContain('\\x1b')
    expect(label).toContain('boom')
    expect(feedbackLabel(undefined)).toBeUndefined()
  })
})

describe('styled status and feedback lines', () => {
  it('styles the status row in accent', () => {
    expect(statusLine('generating')).toContain('\x1b[38;2;77;107;254m⏹ Ctrl+C 停止')
    expect(statusLine('stopped')).toContain('\x1b[38;2;77;107;254m继续生成')
  })

  it('shows the fgDim key hint only beside generating/stopped status rows (W2-T6)', () => {
    expect(statusHint('generating')).toContain('\x1b[38;2;138;143;152m')
    expect(statusHint('generating')).toContain('↑↓/jk 滚动')
    expect(statusHint('generating')).not.toContain('/ 命令')
    expect(statusHint('stopped')).toContain('↑↓/jk 滚动')
    expect(statusHint('generating', true)).toBe('')
    expect(statusHint('stopped', true)).toBe('')
    expect(statusHint('exit-armed')).toBe('')
    expect(statusHint('idle')).toBe('')
  })

  it('composes the status slot as the accent label plus the fgDim hint', () => {
    expect(statusSlot('generating')).toContain('\x1b[38;2;77;107;254m⏹ Ctrl+C 停止')
    expect(statusSlot('generating')).toContain('\x1b[38;2;138;143;152m↑↓/jk 滚动')
    expect(statusSlot('generating', true)).not.toContain('↑↓/jk 滚动')
    expect(statusSlot('stopped')).toContain('\x1b[38;2;77;107;254m继续生成')
    expect(statusSlot('exit-armed')).toContain('\x1b[38;2;77;107;254m再按一次 Ctrl+C 退出')
    expect(statusSlot('exit-armed')).not.toContain('↑↓/jk 滚动')
  })

  it('builds the idle composer status from cwd, badge, and command hints', () => {
    expect(shortenHomePath('/home/me/proj', '/home/me')).toBe('~/proj')
    expect(shortenHomePath('/home/me', '/home/me')).toBe('~')
    expect(shortenHomePath('/tmp/work', '/home/me')).toBe('/tmp/work')
    expect(formatIdleComposerStatus('/home/me/proj', 'deepseek · flash', '/home/me')).toBe(
      '~/proj · deepseek · flash · / 命令 · @ 提及',
    )
    expect(formatIdleComposerStatus('/tmp/work', '', '/home/me')).toBe(
      '/tmp/work · / 命令 · @ 提及',
    )
  })

  it('keeps the idle footer to one row by dropping stats and hints before cwd/model', () => {
    expect(
      composeIdleComposerStatus(
        80,
        '/home/me/projects/deepseek-harness',
        'deepseek · flash',
        '/home/me',
        '22 turns · 4567 tok · 98765 ms',
      ),
    ).toBe('~/projects/deepseek-harness · deepseek · flash · 22 turns · 4567 tok · 98765 ms')
    expect(
      composeIdleComposerStatus(
        120,
        '/home/me/projects/deepseek-harness',
        'deepseek · flash',
        '/home/me',
        '22 turns · 4567 tok · 98765 ms',
      ),
    ).toContain('22 turns · 4567 tok · 98765 ms')
    expect(
      composeIdleComposerStatus(
        200,
        '/home/me/projects/deepseek-harness',
        'deepseek · flash',
        '/home/me',
        '22 turns · 4567 tok · 98765 ms',
      ),
    ).toContain('/ 命令 · @ 提及')
  })

  it('maps the ✓ glyph to success and other feedback to error', () => {
    expect(feedbackLine('✗ 删除失败')).toContain('\x1b[38;2;239;68;68m✗ 删除失败')
    expect(feedbackLine('✓ 已切换会话')).toContain('\x1b[38;2;34;197;94m✓ 已切换会话')
    expect(feedbackLine(undefined)).toBeUndefined()
  })

  it('renders the neutral feedback variant in plain foreground (no ✓/✗ coercion)', () => {
    const line = feedbackLine('模型已切换', 'neutral')
    expect(line).toContain('\x1b[38;2;247;247;248m模型已切换')
    expect(line).not.toContain('\x1b[38;2;239;68;68m')
    expect(line).not.toContain('\x1b[38;2;34;197;94m')
  })

  it('escapes before styling feedback (A3)', () => {
    const line = feedbackLine('✗ 切换失败：\u001b[31mboom\u001b[0m')
    expect(line).toContain('\\x1b')
    expect(line).not.toContain('\u001b[31m')
    expect(line).toContain('boom')
  })
})

describe('overlay occupancy (K2/K2′/K20)', () => {
  const OPEN = { open: true }
  const CLOSED = { open: false }
  const CLOSED_OVERLAYS = {
    agentHub: CLOSED,
    planDirectory: CLOSED,
    workspace: CLOSED,
    feedback: CLOSED,
    workflowOverlay: CLOSED,
    planReview: CLOSED,
  }

  function extras(
    approval: { open: boolean } = CLOSED,
    overlays: {
      agentHub?: { open: boolean }
      planDirectory?: { open: boolean }
      workspace?: {
        open: boolean
        editing?: boolean | undefined
        rootPath?: string | undefined
        selectedKind?: 'directory' | 'file' | 'other' | undefined
        selectedPath?: string | undefined
      }
      feedback?: {
        open: boolean
        editing?: boolean | undefined
        note?: string | undefined
      }
      workflowOverlay?: { open: boolean }
      planReview?: { open: boolean }
    } = {},
  ) {
    return [
      CLOSED,
      { open: false, selectedId: undefined },
      CLOSED,
      approval,
      CLOSED,
      CLOSED,
      { open: false },
      true,
      { ...CLOSED_OVERLAYS, ...overlays },
    ] as const
  }

  it('opens Agent Hub on g a and clears the armed g', () => {
    const g = mapKeyEvent(EMPTY, 'g', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(g.kind === 'dispatch' ? g.prefixG : g.kind).toBe(true)
    const a = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'a',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
    )
    expect(a.kind === 'dispatch' ? a.action : a).toEqual({ kind: 'agent-hub' })
    if (a.kind === 'dispatch') {
      expect(a.text).toBe('')
      expect(a.prefixG).toBe(false)
    }
  })

  it('maps g t / g f / g w to workspace, feedback, and workflow overlays', () => {
    const armed = { ...EMPTY, text: 'g', prefixG: true }
    const t = mapKeyEvent(armed, 't', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(t.kind === 'dispatch' ? t.action : t).toEqual({ kind: 'workspace-pane' })
    const f = mapKeyEvent(armed, 'f', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(f.kind === 'dispatch' ? f.action : f).toEqual({ kind: 'feedback-pane' })
    const w = mapKeyEvent(armed, 'w', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH)
    expect(w.kind === 'dispatch' ? w.action : w).toEqual({ kind: 'workflow-overlay' })
  })

  it('refuses g w while approval is open (K2′)', () => {
    const w = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'w',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(OPEN),
    )
    expect(w.kind).toBe('none')
  })

  it('scrolls the workflow overlay on j/k while open', () => {
    const open = extras(CLOSED, { workflowOverlay: OPEN })
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'workflow-overlay-scroll',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ upArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...open,
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'workflow-overlay-scroll',
      delta: -1,
    })
  })

  it('moves the workspace selection on j/k and enters the path draft on e', () => {
    const open = extras(CLOSED, {
      workspace: { open: true, rootPath: '/ws', selectedKind: 'directory', selectedPath: '/ws/src' },
    })
    const down = mapKeyEvent(EMPTY, 'j', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'workspace-move',
      delta: 1,
    })
    const up = mapKeyEvent(EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'workspace-move',
      delta: -1,
    })
    const edit = mapKeyEvent(EMPTY, 'e', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(edit.kind === 'dispatch' ? edit.action : edit).toEqual({ kind: 'workspace-edit' })
    if (edit.kind === 'dispatch') {
      expect(edit.text).toBe('/ws')
    }
  })

  it('dispatches workspace-enter for a directory and inserts the path for a file', () => {
    const directory = extras(CLOSED, {
      workspace: { open: true, rootPath: '/ws', selectedKind: 'directory', selectedPath: '/ws/src' },
    })
    const expand = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...directory,
    )
    expect(expand.kind === 'dispatch' ? expand.action : expand).toEqual({
      kind: 'workspace-enter',
    })
    if (expand.kind === 'dispatch') {
      expect(expand.text).toBe('')
    }
    const file = extras(CLOSED, {
      workspace: { open: true, rootPath: '/ws', selectedKind: 'file', selectedPath: '/ws/a.ts' },
    })
    const insert = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...file,
    )
    expect(insert.kind === 'dispatch' ? insert.action : insert).toEqual({
      kind: 'workspace-enter',
    })
    if (insert.kind === 'dispatch') {
      expect(insert.text).toBe('/ws/a.ts')
      expect(insert.caretIndex).toBe('/ws/a.ts'.length)
    }
  })

  it('routes the workspace path draft through the shared editing keys', () => {
    const editing = extras(CLOSED, { workspace: { open: true, editing: true, rootPath: '/ws' } })
    const typed = mapKeyEvent(
      { ...EMPTY, text: '/w' },
      's',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...editing,
    )
    expect(typed.kind === 'dispatch' ? typed.text : typed.kind).toBe('/ws')
    const apply = mapKeyEvent(
      { ...EMPTY, text: '/elsewhere' },
      '',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...editing,
    )
    expect(apply.kind === 'dispatch' ? apply.action : apply).toEqual({
      kind: 'workspace-apply',
      value: '/elsewhere',
    })
    if (apply.kind === 'dispatch') {
      expect(apply.text).toBe('')
    }
    const cancel = mapKeyEvent(
      { ...EMPTY, text: '/elsewhere' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...editing,
    )
    expect(cancel.kind === 'dispatch' ? cancel.action : cancel).toEqual({
      kind: 'workspace-cancel-edit',
    })
  })

  it('rates through l/d and enters the note draft on e while feedback is open', () => {
    const open = extras(CLOSED, { feedback: { open: true, note: '旧备注' } })
    const like = mapKeyEvent(EMPTY, 'l', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(like.kind === 'dispatch' ? like.action : like).toEqual({
      kind: 'feedback-rate',
      rating: 'positive',
    })
    const dislike = mapKeyEvent(EMPTY, 'd', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(dislike.kind === 'dispatch' ? dislike.action : dislike).toEqual({
      kind: 'feedback-rate',
      rating: 'negative',
    })
    const edit = mapKeyEvent(EMPTY, 'e', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...open)
    expect(edit.kind === 'dispatch' ? edit.action : edit).toEqual({
      kind: 'feedback-note-edit',
    })
    if (edit.kind === 'dispatch') {
      expect(edit.text).toBe('旧备注')
    }
  })

  it('routes the feedback note draft through the shared editing keys', () => {
    const editing = extras(CLOSED, { feedback: { open: true, editing: true } })
    const apply = mapKeyEvent(
      { ...EMPTY, text: '新备注' },
      '',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...editing,
    )
    expect(apply.kind === 'dispatch' ? apply.action : apply).toEqual({
      kind: 'feedback-note-apply',
      value: '新备注',
    })
    if (apply.kind === 'dispatch') {
      expect(apply.text).toBe('')
    }
    const cancel = mapKeyEvent(
      { ...EMPTY, text: '新备注' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...editing,
    )
    expect(cancel.kind === 'dispatch' ? cancel.action : cancel).toEqual({
      kind: 'feedback-note-cancel',
    })
  })

  it('keeps g a inert while approval is open and still allows y (K2′)', () => {
    const g = mapKeyEvent(
      EMPTY,
      'g',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(OPEN),
    )
    expect(g.kind).toBe('none')
    const a = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'a',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(OPEN),
    )
    expect(a.kind).toBe('none')
    const y = mapKeyEvent(
      EMPTY,
      'y',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(OPEN),
    )
    expect(y.kind === 'dispatch' ? y.action : y).toEqual({ kind: 'approval-allow' })
  })

  it('refuses overlay chords while plan-review is open (K2′)', () => {
    const a = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'a',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(a.kind).toBe('none')
  })

  it('maps plan-review y/n/Esc and j/k before overlay chords (K24)', () => {
    const y = mapKeyEvent(
      EMPTY,
      'y',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(y.kind === 'dispatch' ? y.action : y).toEqual({
      kind: 'plan-review-approve',
    })
    const n = mapKeyEvent(
      EMPTY,
      'n',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(n.kind === 'dispatch' ? n.action : n).toEqual({
      kind: 'plan-review-keep',
    })
    const escape = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(escape.kind === 'dispatch' ? escape.action : escape).toEqual({
      kind: 'ask-user-cancel',
    })
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'plan-review-scroll',
      delta: 1,
    })
    const downArrow = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ downArrow: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    )
    expect(downArrow.kind === 'dispatch' ? downArrow.action : downArrow).toEqual({
      kind: 'plan-review-scroll',
      delta: 1,
    })
    for (const [key, info] of [
      ['k', keyInfo()],
      ['', keyInfo({ upArrow: true })],
    ] as const) {
      const up = mapKeyEvent(
        EMPTY,
        key,
        info,
        COMMANDS,
        CHAT_PANE,
        CHAT_SEARCH,
        ...extras(CLOSED, { planReview: OPEN }),
      )
      expect(up.kind === 'dispatch' ? up.action : up).toEqual({
        kind: 'plan-review-scroll',
        delta: -1,
      })
    }
    expect(mapKeyEvent(
      EMPTY,
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planReview: OPEN }),
    ).kind).toBe('none')
  })

  it('covers alternate overlay navigation and absent workspace/feedback drafts', () => {
    const planUp = mapKeyEvent(
      EMPTY, '', keyInfo({ upArrow: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    )
    expect(planUp.kind === 'dispatch' ? planUp.action : planUp).toEqual({
      kind: 'plan-directory-move', delta: -1,
    })
    expect(mapKeyEvent(
      EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    ).kind).toBe('none')
    const workflowUp = mapKeyEvent(
      EMPTY, 'k', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      ...extras(CLOSED, { workflowOverlay: OPEN }),
    )
    expect(workflowUp.kind === 'dispatch' ? workflowUp.action : workflowUp).toEqual({
      kind: 'workflow-overlay-scroll', delta: -1,
    })
    expect(mapKeyEvent(
      EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH,
      ...extras(CLOSED, { workflowOverlay: OPEN }),
    ).kind).toBe('none')

    const workspace = extras(CLOSED, { workspace: { open: true, selectedKind: 'file' } })
    const enter = mapKeyEvent(
      EMPTY, '', keyInfo({ return: true }), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...workspace,
    )
    expect(enter).toMatchObject({ kind: 'dispatch', action: { kind: 'workspace-enter' }, text: '' })
    const edit = mapKeyEvent(EMPTY, 'e', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...workspace)
    expect(edit).toMatchObject({ kind: 'dispatch', action: { kind: 'workspace-edit' }, text: '' })
    expect(mapKeyEvent(
      EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...workspace,
    ).kind).toBe('none')

    const feedback = extras(CLOSED, { feedback: { open: true } })
    const note = mapKeyEvent(EMPTY, 'e', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...feedback)
    expect(note).toMatchObject({ kind: 'dispatch', action: { kind: 'feedback-note-edit' }, text: '' })
    expect(mapKeyEvent(
      EMPTY, 'x', keyInfo(), COMMANDS, CHAT_PANE, CHAT_SEARCH, ...feedback,
    ).kind).toBe('none')
  })

  it('toggles the same overlay closed on a matching chord (K20)', () => {
    const a = mapKeyEvent(
      { ...EMPTY, text: 'g', prefixG: true },
      'a',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(a.kind === 'dispatch' ? a.action : a).toEqual({ kind: 'agent-hub' })
    expect(a.kind === 'dispatch' ? a.text : a).toBe('')
  })

  it('dispatches overlay escape without changing the composer buffer', () => {
    const escape = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(escape).toMatchObject({
      kind: 'dispatch',
      action: { kind: 'agent-hub-escape' },
      text: 'draft',
    })
    const workspace = mapKeyEvent(
      { ...EMPTY, text: 'draft' },
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { workspace: OPEN }),
    )
    expect(workspace.kind === 'dispatch' ? workspace.action : workspace).toEqual({
      kind: 'workspace-escape',
    })
    const feedback = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { feedback: OPEN }),
    )
    expect(feedback.kind === 'dispatch' ? feedback.action : feedback).toEqual({
      kind: 'feedback-escape',
    })
    const workflow = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { workflowOverlay: OPEN }),
    )
    expect(workflow.kind === 'dispatch' ? workflow.action : workflow).toEqual({
      kind: 'workflow-overlay-escape',
    })
    const plan = mapKeyEvent(
      EMPTY,
      '',
      keyInfo({ escape: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    )
    expect(plan.kind === 'dispatch' ? plan.action : plan).toEqual({
      kind: 'plan-directory-escape',
    })
  })

  it('swallows composer keys while an overlay is browsing', () => {
    const typed = mapKeyEvent(
      EMPTY,
      'x',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(typed.kind).toBe('none')
  })

  it('maps Hub j/k and Enter while the overlay is open (K22)', () => {
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'agent-hub-move',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'agent-hub-move',
      delta: -1,
    })
    const enter = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { agentHub: OPEN }),
    )
    expect(enter.kind === 'dispatch' ? enter.action : enter).toEqual({
      kind: 'agent-hub-enter',
    })
  })

  it('maps plan-directory j/k and Enter while the overlay is open (K23)', () => {
    const down = mapKeyEvent(
      EMPTY,
      'j',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    )
    expect(down.kind === 'dispatch' ? down.action : down).toEqual({
      kind: 'plan-directory-move',
      delta: 1,
    })
    const up = mapKeyEvent(
      EMPTY,
      'k',
      keyInfo(),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    )
    expect(up.kind === 'dispatch' ? up.action : up).toEqual({
      kind: 'plan-directory-move',
      delta: -1,
    })
    const enter = mapKeyEvent(
      EMPTY,
      '\r',
      keyInfo({ return: true }),
      COMMANDS,
      CHAT_PANE,
      CHAT_SEARCH,
      ...extras(CLOSED, { planDirectory: OPEN }),
    )
    expect(enter.kind === 'dispatch' ? enter.action : enter).toEqual({
      kind: 'plan-directory-apply',
    })
  })
})

describe('clampViewShift', () => {
  it('clamps a conversation view-shift into [0, MAX_VIEW_SHIFT]', () => {
    expect(clampViewShift(0, 1)).toBe(1)
    expect(clampViewShift(0, -1)).toBe(0)
    expect(clampViewShift(MAX_VIEW_SHIFT, 1)).toBe(MAX_VIEW_SHIFT)
    expect(clampViewShift(MAX_VIEW_SHIFT, -1)).toBe(MAX_VIEW_SHIFT - 1)
  })
})
