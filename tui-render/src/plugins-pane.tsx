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
  group: 'official' | 'supplied' | 'owned'
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
  type LineEntry = {
    text: string
    selected?: boolean
    token?: 'fg' | 'fgSoft' | 'fgDim' | 'accent' | 'accentText' | 'warning' | 'error'
    bold?: boolean
  }
  const lines: LineEntry[] = []
  const selected = state.rows[state.selectedIndex]
  let hint: string
  if (!state.available) {
    hint = copy('pluginsCloseHint')
  } else {
    hint = [
      copy('pluginsBrowseHint'),
      ...(selected?.toggle ? [copy('pluginsToggleHint')] : []),
      copy('pluginsInstallHint'),
      ...(selected?.removable ? [copy('pluginsRemoveHint')] : []),
      copy('pluginsCloseHint'),
    ].join(' · ')
  }
  if (!state.available) lines.push({ text: copy('pluginsUnavailable'), token: 'fgDim' })
  else if (state.mode === 'remove' || state.mode === 'builds') {
    lines.push(...(state.mode === 'remove' ? ['pluginsRemoveConfirm'] as const
      : ['pluginsBuildHeading', 'pluginsBuildPersist', 'pluginsBuildHost'] as const).map(key => ({ text: copy(key), token: 'warning' as const, bold: true })))
    lines.push(...state.confirmNames.map(text => ({ text: `  ${text}`, token: 'fg' as const })))
    hint = copy('pluginsConfirmHint')
  } else if (state.mode === 'input') {
    lines.push({ text: `> ${state.spec}▏`, token: 'accent', bold: true }, ...state.inspection.map(text => ({ text, token: 'fgDim' as const })))
    hint = copy('pluginsInputHint')
  } else if (state.mode === 'preview') {
    lines.push({ text: state.spec, token: 'accentText', bold: true }, ...state.inspection.map(text => ({ text, token: 'fgSoft' as const })))
    hint = copy('pluginsPreviewHint')
  } else {
    if (state.loading) lines.push({ text: copy('pluginsLoading'), token: 'fgDim' })
    if (!state.loading && state.rows.length === 0) lines.push({ text: copy('pluginsEmpty'), token: 'fgDim' })
    for (const group of ['official', 'supplied', 'owned'] as const) {
      const rows = state.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.group === group)
      if (group === 'official' && rows.length === 0) continue
      let groupKey: 'pluginsOfficialGroup' | 'pluginsSupplied' | 'pluginsOwned' = 'pluginsOwned'
      if (group === 'official') groupKey = 'pluginsOfficialGroup'
      else if (group === 'supplied') groupKey = 'pluginsSupplied'
      lines.push({ text: copy(groupKey), token: 'accentText', bold: true })
      for (const { row, index } of rows) {
        const isSelected = index === state.selectedIndex
        lines.push({
          text: `${isSelected ? '›' : ' '} ${row.label}`,
          selected: isSelected,
          token: isSelected ? 'accent' : 'fgSoft',
          bold: isSelected,
        })
        if (isSelected) {
          lines.push(...row.details.map(text => ({ text: `    ${text}`, token: 'fgDim' as const })))
        }
      }
    }
  }
  if (state.inspecting) lines.unshift({ text: copy('pluginsInspecting'), token: 'accentText' })
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
  let start = 0
  if (state.mode === 'remove' || state.mode === 'builds') {
    start = state.detailOffset
  } else if (selectedLine >= bodyBudget) {
    start = Math.max(0, selectedLine - 1)
  }
  const statusEntries: LineEntry[] = statusRows.map((text) => {
    let token: LineEntry['token'] = 'accentText'
    if (state.error !== undefined && text === state.error) {
      token = 'error'
    } else if (state.restartRequired) {
      token = 'warning'
    }
    return { text, token }
  })
  const visible = [...lines.slice(start, start + bodyBudget), ...statusEntries]
  return <OverlayShell title={clean(copy('pluginsTitle'))} body={clean(copy('pluginsScope'))} footnote={clean(hint)}>
    {visible.map((line, index) => <Text key={index} wrap="truncate">
      {paintRow([styled(clean(line.text), line.token ?? (line.selected ? 'accent' : 'fg'), undefined, line.bold === true)])}
    </Text>)}
  </OverlayShell>
}
