/**
 * DeepSeek account page: sign-in progress, the browser authorization link,
 * profile and balance, and sign-out confirmation. The controller owns the
 * account service subscription; this pane only paints its snapshot.
 * @module @deepseek-ai/dsh-tui-render/account-pane
 */
import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { OverlayShell } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'
import { truncateDisplay } from './tool-cards.ts'
import { tuiCopy } from './ui-copy.ts'
import type { TuiLocale } from './ui-copy.ts'

/** Login attempt phase as reported by the account service. */
export type AccountAttemptPhase =
  | 'initializing' | 'waiting-browser' | 'exchanging' | 'committing'
  | 'succeeded' | 'cancelled' | 'expired' | 'failed'

/** Safe login failure category as reported by the account service. */
export type AccountErrorCode = 'no-response' | 'network' | 'protocol' | 'expired' | 'storage'

/** Controller snapshot backing the account page. */
export interface AccountPaneState {
  open: boolean
  /** Whether the DeepSeek account service is mounted. */
  available: boolean
  /** Stored-account presence; `unknown` until the first service snapshot. */
  status: 'unknown' | 'signed-out' | 'credential-stored'
  phase?: AccountAttemptPhase | undefined
  authorizeUrl?: string | undefined
  errorCode?: AccountErrorCode | undefined
  /** Display name and masked contact, when the profile read succeeded. */
  profile?: string | undefined
  /** Wallet balances already formatted for display. */
  balance?: string | undefined
  /** Port-forward command shown when the callback listener is on a remote host. */
  forward?: string | undefined
  busy: boolean
  confirmSignOut: boolean
  error?: string | undefined
}

/** Input interpreted only by the account controller, never by the chat composer. */
export type AccountPaneInput = {
  kind: 'close' | 'sign-in' | 'open-url' | 'cancel' | 'sign-out' | 'confirm' | 'dismiss' | 'api-key'
}

/** Closed page before the first account snapshot. */
export const EMPTY_ACCOUNT_PANE: AccountPaneState = {
  open: false, available: false, status: 'unknown', busy: false, confirmSignOut: false,
}

/** Phases during which the attempt is still running. */
const ACTIVE_PHASES: ReadonlySet<AccountAttemptPhase> = new Set(['initializing', 'waiting-browser', 'exchanging', 'committing'])

/**
 * Whether a login attempt is still running.
 * @param phase - latest attempt phase.
 * @returns true until the attempt reaches a terminal phase.
 */
export function accountAttemptActive(phase: AccountAttemptPhase | undefined): boolean {
  return phase !== undefined && ACTIVE_PHASES.has(phase)
}

/**
 * Split one long token into rows of at most `width` columns so a terminal copy keeps it whole.
 * @param text - ASCII token such as a URL.
 * @param width - available columns.
 * @returns consecutive slices covering the token.
 */
function chunk(text: string, width: number): string[] {
  const size = Math.max(8, width)
  const rows: string[] = []
  for (let index = 0; index < text.length; index += size) rows.push(text.slice(index, index + size))
  return rows
}

/**
 * Render the account page inside the shared overlay shell.
 * @param props - controller snapshot, locale and available columns.
 * @returns overlay rows, or null when closed.
 */
export function AccountPane({ state, locale = 'zh-CN', maxCols }: {
  state: AccountPaneState
  locale?: TuiLocale | undefined
  maxCols: number
}): ReactNode {
  if (!state.open) return null
  const copy = (key: Parameters<typeof tuiCopy>[0]) => tuiCopy(key, locale)
  const width = Math.max(1, maxCols)
  const lines: { text: string; token: 'fg' | 'fgSoft' | 'fgDim' | 'accent' | 'accentText' | 'success' | 'warning' | 'error'; bold?: boolean; wrap?: boolean }[] = []
  const active = accountAttemptActive(state.phase)
  let hint: string
  if (!state.available) {
    lines.push({ text: copy('accountUnavailable'), token: 'fgDim' })
    hint = [copy('accountApiKeyHint'), copy('accountCloseHint')].join(' · ')
  } else if (state.confirmSignOut) {
    lines.push({ text: copy('accountSignOutConfirm'), token: 'warning', bold: true })
    hint = copy('accountConfirmHint')
  } else {
    let statusKey: 'accountSignedIn' | 'accountSignedOut' | 'accountLoading' = 'accountLoading'
    let statusDot = '◌'
    let statusToken: 'success' | 'fgDim' = 'fgDim'
    if (state.status === 'credential-stored') {
      statusKey = 'accountSignedIn'
      statusDot = '●'
      statusToken = 'success'
    } else if (state.status === 'signed-out') {
      statusKey = 'accountSignedOut'
      statusDot = '○'
    }
    lines.push({
      text: `${statusDot} ${copy(statusKey)}`,
      token: statusToken,
      bold: state.status === 'credential-stored',
    })
    if (state.profile !== undefined) {
      lines.push({ text: `  ${state.profile}`, token: 'fg', bold: true })
    }
    if (state.balance !== undefined) {
      lines.push({ text: `  ${copy('accountBalance')}: ${state.balance}`, token: 'accentText' })
    }
    if (state.phase !== undefined && !(state.phase === 'succeeded' && state.status === 'credential-stored')) {
      const phaseKey = ({
        'initializing': 'accountPhaseInitializing', 'waiting-browser': 'accountPhaseWaiting', 'exchanging': 'accountPhaseExchanging',
        'committing': 'accountPhaseCommitting', 'succeeded': 'accountPhaseSucceeded', 'cancelled': 'accountPhaseCancelled',
        'expired': 'accountPhaseExpired', 'failed': 'accountPhaseFailed',
      } as const)[state.phase]
      const reason = state.errorCode === undefined ? '' : `: ${copy(({
        'no-response': 'accountErrorNoResponse', 'network': 'accountErrorNetwork', 'protocol': 'accountErrorProtocol',
        'expired': 'accountErrorExpired', 'storage': 'accountErrorStorage',
      } as const)[state.errorCode])}`
      const isErr = state.phase === 'failed' || state.phase === 'expired'
      lines.push({ text: `  ${copy(phaseKey)}${reason}`, token: isErr ? 'error' : 'fgDim' })
    }
    if (state.phase === 'succeeded' && state.status === 'credential-stored') {
      lines.push({ text: `  ${copy('accountModelHint')}`, token: 'fgDim' })
    }
    if (state.phase === 'waiting-browser' && state.authorizeUrl !== undefined) {
      lines.push({ text: `  ${copy('accountOpenLink')}`, token: 'fgSoft' })
      for (const row of chunk(state.authorizeUrl, width)) lines.push({ text: row, token: 'accent', wrap: true })
      if (state.forward !== undefined) {
        lines.push({ text: `  ${copy('accountForward')}:`, token: 'fgDim' })
        for (const row of chunk(state.forward, width)) lines.push({ text: row, token: 'fg', wrap: true })
      }
    }
    if (active) {
      hint = [state.phase === 'waiting-browser' ? copy('accountOpenHint') : undefined, copy('accountCancelHint'), copy('accountCloseHint')]
        .filter((value): value is string => value !== undefined)
        .join(' · ')
    } else if (state.status === 'credential-stored') {
      hint = [copy('accountSignOutHint'), copy('accountCloseHint')].join(' · ')
    } else {
      hint = [copy('accountSignInHint'), copy('accountApiKeyHint'), copy('accountCloseHint')].join(' · ')
    }
    if (state.busy) hint = copy('accountBusyHint')
  }
  return <OverlayShell title={copy('accountTitle')} footnote={truncateDisplay(escapeContent(hint), width)} error={state.error}>
    {lines.map((line, index) => <Text key={index} wrap="truncate">
      {paintRow([styled(line.wrap === true ? escapeContent(line.text) : truncateDisplay(escapeContent(line.text), width), line.token, undefined, line.bold === true)])}
    </Text>)}
  </OverlayShell>
}
