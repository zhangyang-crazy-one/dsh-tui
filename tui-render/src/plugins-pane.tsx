/** Profile plugin inventory and controller-owned installation/confirmation views. */
import { Text } from 'ink'
import type { ReactNode } from 'react'
import { escapeContent } from './content.ts'
import { truncateDisplay } from './tool-cards.ts'
import { OverlayShell } from './overlay-shell.tsx'
import { paintRow, styled } from './theme.ts'
import { tuiCopy } from './ui-copy.ts'
import type { TuiLocale } from './ui-copy.ts'

/** One selectable bundle or declared plugin row; labels are localized by the controller. */
export interface PluginsPaneRow {
  id: string
  group: 'supplied' | 'owned'
  label: string
  details: readonly string[]
  toggle: boolean
  removable: boolean
}

/** Installation state remains controller-owned while this overlay is closed. */
export interface PluginsPaneState {
  open: boolean
  available: boolean
  loading: boolean
  rows: readonly PluginsPaneRow[]
  selectedIndex: number
  detailOffset: number
  mode: 'inventory' | 'input' | 'preview' | 'remove' | 'builds'
  spec: string
  busy: boolean
  inspecting: boolean
  inspection: readonly string[]
  progress: string
  output: string
  result: readonly string[]
  error?: string | undefined
  cancellation?: string | undefined
  pendingBuilds: readonly string[]
  confirmNames: readonly string[]
  restartRequired: boolean
  retry: boolean
}

/** Input interpreted only by the Plugins controller, never by the chat composer. */
export type PluginsPaneInput =
  | { kind: 'text'; value: string }
  | { kind: 'move'; delta: number }
  | { kind: 'close' | 'edit' | 'inspect' | 'install' | 'cancel' | 'toggle' | 'remove' | 'confirm' | 'dismiss' | 'approve' | 'retry' | 'reload' }

/** Closed, not-yet-read inventory. */
export const EMPTY_PLUGINS_PANE: PluginsPaneState = {
  open: false, available: false, loading: false, rows: [], selectedIndex: 0, detailOffset: 0,
  mode: 'inventory', spec: '', busy: false, inspecting: false, inspection: [],
  progress: '', output: '', result: [], pendingBuilds: [], confirmNames: [],
  restartRequired: false, retry: false,
}

/**
 * Render a bounded Plugins page inside the shared overlay shell.
 * @param props - controller snapshot, locale and available terminal dimensions.
 * @returns overlay rows, or null when closed.
 */
export function PluginsPane({ state, locale = 'zh-CN', maxCols, maxRows }: {
  state: PluginsPaneState
  locale?: TuiLocale | undefined
  maxCols: number
  maxRows: number
}): ReactNode {
  if (!state.open) return null
  const copy = (key: Parameters<typeof tuiCopy>[0]) => tuiCopy(key, locale)
  const width = Math.max(1, maxCols)
  const clean = (text: string) => truncateDisplay(escapeContent(text).replace(/\n/g, '\\n').replace(/\t/g, '\\t'), width)
  const lines: { text: string; selected?: boolean }[] = []
  const selected = state.rows[state.selectedIndex]
  let hint = !state.available ? copy('pluginsCloseHint') : [copy('pluginsBrowseHint'),
    ...(selected?.toggle ? [copy('pluginsToggleHint')] : []),
    copy('pluginsInstallHint'), ...(selected?.removable ? [copy('pluginsRemoveHint')] : []), copy('pluginsCloseHint')].join(' · ')
  if (!state.available) lines.push({ text: copy('pluginsUnavailable') })
  else if (state.mode === 'remove' || state.mode === 'builds') {
    lines.push(...(state.mode === 'remove' ? ['pluginsRemoveConfirm'] as const
      : ['pluginsBuildHeading', 'pluginsBuildPersist', 'pluginsBuildHost'] as const).map(key => ({ text: copy(key) })))
    lines.push(...state.confirmNames.map(text => ({ text })))
    hint = copy('pluginsConfirmHint')
  } else if (state.mode === 'input') {
    lines.push({ text: `> ${state.spec}▏` }, ...state.inspection.map(text => ({ text })))
    hint = copy('pluginsInputHint')
  } else if (state.mode === 'preview') {
    lines.push({ text: state.spec }, ...state.inspection.map(text => ({ text })))
    hint = copy('pluginsPreviewHint')
  } else {
    if (state.loading) lines.push({ text: copy('pluginsLoading') })
    if (!state.loading && state.rows.length === 0) lines.push({ text: copy('pluginsEmpty') })
    for (const group of ['supplied', 'owned'] as const) {
      const rows = state.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group)
      lines.push({ text: copy(group === 'supplied' ? 'pluginsSupplied' : 'pluginsOwned') })
      for (const { row, index } of rows) {
        const selected = index === state.selectedIndex
        lines.push({ text: `${selected ? '›' : ' '} ${row.label}`, selected })
        if (selected) lines.push(...row.details.map(text => ({ text: `  ${text}` })))
      }
    }
  }
  if (state.inspecting) lines.unshift({ text: copy('pluginsInspecting') })
  if (state.busy) hint = copy('pluginsBusyHint')
  else if (state.pendingBuilds.length && state.mode === 'inventory') hint = copy('pluginsApprovalHint')
  else if (state.retry && state.mode === 'inventory') hint = copy('pluginsRetryHint')
  const status = [state.progress, state.cancellation, ...state.result, state.error].filter((s): s is string => Boolean(s))
  if (state.pendingBuilds.length && state.mode !== 'builds') {
    status.push(`${copy('pluginsPendingBuilds')}: ${state.pendingBuilds.join(', ')}`)
  }
  if (state.output) status.push(...state.output.split(/\r?\n/).filter(Boolean))
  if (state.restartRequired) hint += ` · ${copy('pluginsReloadHint')}`
  const budget = Math.max(0, maxRows - 3)
  const statusRows = state.mode === 'remove' || state.mode === 'builds' ? [] : status.slice(0, Math.min(status.length, Math.floor(budget / 2)))
  const bodyBudget = budget - statusRows.length
  const selectedLine = lines.findIndex(line => line.selected)
  const start = state.mode === 'remove' || state.mode === 'builds' ? state.detailOffset
    : selectedLine < bodyBudget ? 0 : Math.max(0, selectedLine - 1)
  const visible = [...lines.slice(start, start + bodyBudget), ...statusRows.map(text => ({ text }))]
  return <OverlayShell title={clean(copy('pluginsTitle'))} body={clean(copy('pluginsScope'))} footnote={clean(hint)}>
    {visible.map((line, index) => <Text key={index} wrap="truncate">
      {paintRow([styled(clean(line.text), 'selected' in line && line.selected ? 'accent' : 'fg')])}
    </Text>)}
  </OverlayShell>
}
