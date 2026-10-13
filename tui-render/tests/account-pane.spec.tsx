/** Account overlay rendering and keyboard admission preserve the chat draft. */
import { describe, expect, it } from 'vitest'
import { renderToString } from 'ink'
import { createElement } from 'react'
import { AccountPane, EMPTY_ACCOUNT_PANE } from '../src/account-pane.tsx'
import type { AccountPaneState } from '../src/account-pane.tsx'
import { mapKeyEvent } from '../src/loop.tsx'
import type { LoopInputState } from '../src/loop.tsx'
import { stripTerminalControls } from './helpers.ts'

const signedOut: AccountPaneState = { ...EMPTY_ACCOUNT_PANE, open: true, available: true, status: 'signed-out' }
const url = `https://platform.example/authorize?state=${'x'.repeat(90)}`
function output(state: AccountPaneState, columns = 60, locale: 'zh-CN' | 'en-US' = 'en-US') {
  return stripTerminalControls(renderToString(createElement(AccountPane, { state, locale, maxCols: columns }), { columns }))
}
const draft: LoopInputState = { text: 'draft', commandQuery: undefined, prefixG: false, renaming: false,
  mentionSelectedIndex: 0, mentionDismissed: false, caretIndex: 5 }
function key(state: AccountPaneState, input: string, flags: Record<string, boolean> = {}) {
  const info: Parameters<typeof mapKeyEvent>[2] = { upArrow: false, downArrow: false, leftArrow: false,
    rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false,
    escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false,
    meta: false, super: false, hyper: false, capsLock: false, numLock: false, ...flags }
  return mapKeyEvent(draft, input, info, [], { open: false, selectedId: undefined }, { open: false, selectedId: undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, true, { account: state })
}
const sent = (effect: ReturnType<typeof key>) => effect.kind === 'dispatch' && effect.action.kind === 'account-input' ? effect.action.input.kind : undefined

describe('AccountPane', () => {
  it('renders nothing when closed and an API-key route when the service is absent', () => {
    expect(output(EMPTY_ACCOUNT_PANE)).toBe('')
    const text = output({ ...signedOut, available: false }, 80, 'zh-CN')
    expect(text).toContain('DeepSeek 账号')
    expect(text).toContain('k 使用 API 密钥')
  })

  it('keeps the whole authorization link across rows and shows the forward command', () => {
    const text = output({ ...signedOut, phase: 'waiting-browser', authorizeUrl: url, forward: 'ssh -L 4000:127.0.0.1:4000 <host>' })
    expect(text.replace(/\s+/g, '')).toContain(url)
    expect(text).toContain('Waiting for browser authorization')
    expect(text).toContain('ssh -L 4000:127.0.0.1:4000 <host>')
    expect(text).toContain('o Open browser')
  })

  it('shows profile, balance, failure reason and the sign-out confirmation', () => {
    const signedIn = output({ ...signedOut, status: 'credential-stored', phase: 'succeeded', profile: 'Ada', balance: 'CNY 1.00' })
    expect(signedIn).toContain('Signed in')
    expect(signedIn).toContain('Balance: CNY 1.00')
    expect(signedIn).toContain('/model')
    expect(output({ ...signedOut, phase: 'failed', errorCode: 'no-response' })).toContain('Sign-in failed: the service did not respond')
    expect(output({ ...signedOut, status: 'credential-stored', confirmSignOut: true })).toContain('API keys are kept')
  })

  it('maps keys by account state without touching the draft', () => {
    expect(sent(key(signedOut, '', { return: true }))).toBe('sign-in')
    expect(sent(key(signedOut, 'k'))).toBe('api-key')
    expect(sent(key(signedOut, 'x'))).toBeUndefined()
    const waiting: AccountPaneState = { ...signedOut, phase: 'waiting-browser', authorizeUrl: url }
    expect(sent(key(waiting, 'o'))).toBe('open-url')
    expect(sent(key(waiting, 'c'))).toBe('cancel')
    expect(sent(key(waiting, '', { return: true }))).toBeUndefined()
    const stored: AccountPaneState = { ...signedOut, status: 'credential-stored' }
    expect(sent(key(stored, 'x'))).toBe('sign-out')
    expect(sent(key({ ...stored, confirmSignOut: true }, 'y'))).toBe('confirm')
    expect(sent(key({ ...stored, confirmSignOut: true }, 'n'))).toBe('dismiss')
    expect(sent(key(stored, '', { escape: true }))).toBe('close')
    expect(sent(key({ ...stored, busy: true }, 'x'))).toBeUndefined()
    const held = key(signedOut, 'k')
    expect(held.kind === 'dispatch' ? held.text : undefined).toBe('draft')
  })
})
