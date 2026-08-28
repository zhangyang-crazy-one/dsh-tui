/**
 * Mouse wheel delta → visible-pane LoopAction.
 */

import { describe, expect, it } from 'vitest'
import { mouseScrollAction } from '../src/mouse-map.ts'
import type { MouseScrollContext } from '../src/mouse-map.ts'

const CLOSED: MouseScrollContext = {
  permissionOpen: false,
  settingsOpen: false,
  settingsEditing: false,
  modelOpen: false,
  helpOpen: false,
  sessionOpen: false,
  searchOpen: false,
  timelineOpen: false,
}

describe('mouseScrollAction', () => {
  it('returns undefined for a zero delta or settings edit', () => {
    expect(mouseScrollAction(0, CLOSED)).toBeUndefined()
    expect(
      mouseScrollAction(1, { ...CLOSED, settingsOpen: true, settingsEditing: true }),
    ).toBeUndefined()
  })

  it('maps wheel-up to conversation older and list-up', () => {
    expect(mouseScrollAction(1, CLOSED)).toEqual({ kind: 'scroll', delta: 1 })
    expect(mouseScrollAction(-1, CLOSED)).toEqual({ kind: 'scroll', delta: -1 })
    expect(mouseScrollAction(1, { ...CLOSED, permissionOpen: true })).toEqual({
      kind: 'permission-move',
      delta: -1,
    })
    expect(mouseScrollAction(-1, { ...CLOSED, settingsOpen: true })).toEqual({
      kind: 'settings-move',
      delta: 1,
    })
    expect(mouseScrollAction(1, { ...CLOSED, modelOpen: true })).toEqual({
      kind: 'model-move',
      delta: -1,
    })
    expect(mouseScrollAction(-1, { ...CLOSED, helpOpen: true })).toEqual({
      kind: 'help-scroll',
      delta: 1,
    })
    expect(mouseScrollAction(1, { ...CLOSED, sessionOpen: true })).toEqual({
      kind: 'session-pane-move',
      delta: -1,
    })
    expect(mouseScrollAction(-1, { ...CLOSED, searchOpen: true })).toEqual({
      kind: 'session-pane-move',
      delta: 1,
    })
    expect(mouseScrollAction(1, { ...CLOSED, timelineOpen: true })).toEqual({
      kind: 'timeline-scroll',
      delta: -1,
    })
  })
})
