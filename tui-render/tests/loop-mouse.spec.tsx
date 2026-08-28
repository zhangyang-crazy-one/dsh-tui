/**
 * TuiLoop mouse-scroll listener: wheel deltas share each pane's j/k action.
 */

import { render } from 'ink'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiLoop } from '../src/loop.tsx'
import type { TuiController } from '../src/loop.tsx'
import { notifyMouseScroll, setMouseScrollListener } from '../src/mouse-io.ts'
import type { ViewModel } from '../src/projection.ts'
import type { SessionPaneState } from '../src/session-pane.tsx'
import type { SearchPaneState } from '../src/search-pane.tsx'
import type { ModelPaneState } from '../src/model-pane.tsx'
import type { HelpPaneState } from '../src/help-pane.tsx'
import { EMPTY_APPROVAL_PANE } from '../src/approval-pane.tsx'
import { EMPTY_ASK_USER_PANE } from '../src/ask-user-pane.tsx'
import { EMPTY_PERMISSION_PANE } from '../src/permission-pane.tsx'
import { EMPTY_SETTINGS_PANE } from '../src/settings-pane.tsx'
import { EMPTY_OVERLAY_PANE } from '../src/overlay-shell.tsx'
import type { SettingsPaneState } from '../src/settings-pane.tsx'
import { fakeTtyStdin, fakeTtyStdout } from './helpers.ts'

const IDLE_MODEL: ViewModel = {
  history: [],
  activeTurn: undefined,
  status: 'idle',
  scrollOffset: 0,
  reasoningExpanded: false,
  toolCardsExpanded: false,
}

function controller(partial: Partial<TuiController> & { dispatch: TuiController['dispatch'] }): TuiController {
  const emptySession: SessionPaneState = {
    rows: [],
    selectedIndex: 0,
    open: false,
    confirmDelete: false,
    deleteUnavailable: false,
    currentId: undefined,
  }
  const emptySearch: SearchPaneState = {
    query: '',
    results: [],
    selectedIndex: 0,
    open: false,
    status: 'idle',
  }
  const emptyModel: ModelPaneState = {
    open: false,
    filter: '',
    rows: [],
    selectedIndex: 0,
    status: 'idle',
  }
  const emptyHelp: HelpPaneState = { open: false, lines: ['a', 'b', 'c'] }
  return {
    getModel: () => IDLE_MODEL,
    getInteraction: () => 'idle',
    getBadge: () => 't',
    getTitle: () => 't',
    getSessionPane: () => emptySession,
    getSearchPane: () => emptySearch,
    getTimelineOpen: () => false,
    getModelPane: () => emptyModel,
    getHelpPane: () => emptyHelp,
    getApprovalPane: () => EMPTY_APPROVAL_PANE,
    getAskUserPane: () => EMPTY_ASK_USER_PANE,
    getPermissionPane: () => EMPTY_PERMISSION_PANE,
    getSettingsPane: () => EMPTY_SETTINGS_PANE,
    getAgentHubPane: () => EMPTY_OVERLAY_PANE,
    getPlanDirectoryPane: () => EMPTY_OVERLAY_PANE,
    getWorkspacePane: () => EMPTY_OVERLAY_PANE,
    getFeedbackPane: () => EMPTY_OVERLAY_PANE,
    getWorkflowOverlay: () => EMPTY_OVERLAY_PANE,
    getPlanReviewPane: () => EMPTY_OVERLAY_PANE,
    getComposerHud: () => undefined,
    getToolPresenters: () => undefined,
    getSubmitOnEnter: () => true,
    getFeedback: () => undefined,
    subscribe: () => () => {},
    commands: [],
    getCwd: () => '/',
    listMentions: async () => [],
    ...partial,
  }
}

afterEach(() => {
  setMouseScrollListener(undefined)
})

async function mount(ctrl: TuiController) {
  const instance = render(createElement(TuiLoop, { title: 't', controller: ctrl }), {
    stdout: fakeTtyStdout(),
    stdin: fakeTtyStdin(),
    exitOnCtrlC: false,
    patchConsole: false,
  })
  await instance.waitUntilRenderFlush()
  return instance
}

describe('TuiLoop mouse scroll', { timeout: 30_000 }, () => {
  it('dispatches conversation scroll', async () => {
    const dispatch = vi.fn()
    const instance = await mount(controller({ dispatch }))
    try {
      notifyMouseScroll(1)
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'scroll', delta: 1 })
    } finally {
      instance.unmount()
    }
  })

  it('dispatches settings-move and ignores edit', async () => {
    const dispatch = vi.fn()
    const settings: SettingsPaneState = {
      ...EMPTY_SETTINGS_PANE,
      open: true,
      rows: [{ namespace: 'tui', field: 'x', value: '1' }],
    }
    const instance = await mount(controller({
      dispatch,
      getSettingsPane: () => settings,
    }))
    try {
      notifyMouseScroll(1)
      await instance.waitUntilRenderFlush()
      expect(dispatch).toHaveBeenCalledWith({ kind: 'settings-move', delta: -1 })
    } finally {
      instance.unmount()
    }
    dispatch.mockClear()
    const editing = await mount(controller({
      dispatch,
      getSettingsPane: () => ({ ...settings, editing: true }),
    }))
    try {
      notifyMouseScroll(1)
      await editing.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      editing.unmount()
    }
    const onboardingState: SettingsPaneState = { ...settings, onboarding: true }
    const onboarding = await mount(controller({
      dispatch,
      getSettingsPane: () => onboardingState,
    }))
    try {
      notifyMouseScroll(1)
      await onboarding.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      onboarding.unmount()
    }
  })

  it('scrolls help and timeline locally without a controller action', async () => {
    const dispatch = vi.fn()
    const helpState = { open: true, lines: Array.from({ length: 40 }, (_, i) => `L${i}`) }
    const help = await mount(controller({
      dispatch,
      getHelpPane: () => helpState,
    }))
    try {
      notifyMouseScroll(-1)
      await help.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      help.unmount()
    }
    const timelineModel: ViewModel = {
      ...IDLE_MODEL,
      history: Array.from({ length: 80 }, (_, i) => ({
        id: i,
        kind: 'user' as const,
        text: `t${i}`,
        timestamp: 0,
      })),
    }
    const timeline = await mount(controller({
      dispatch,
      getTimelineOpen: () => true,
      getModel: () => timelineModel,
    }))
    try {
      notifyMouseScroll(-1)
      await timeline.waitUntilRenderFlush()
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      timeline.unmount()
    }
  })
})
