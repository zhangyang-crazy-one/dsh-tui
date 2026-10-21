import { describe, expect, it } from 'vitest'
import { shortcutBindings, remapShortcut, shortcutCatalog } from '../src/shortcut-bindings.ts'

describe('composer shortcut bindings', () => {
  it('remaps the action and releases its previous chord', () => {
    expect(remapShortcut('r', { 'toggle-reasoning': 'Ctrl+R' })).toBe('o')
    expect(remapShortcut('o', { 'toggle-reasoning': 'Ctrl+R' })).toBeUndefined()
    expect(remapShortcut('c', {})).toBe('c')
  })
  it('rejects unknown actions, duplicate chords, editor and terminal control keys', () => {
    expect(() => shortcutBindings({ invented: 'Ctrl+R' })).toThrow('未知动作')
    expect(() => shortcutBindings({ 'toggle-reasoning': 'Ctrl+B' })).toThrow('冲突')
    for (const chord of ['Ctrl+C', 'Ctrl+U', 'Ctrl+W', 'Ctrl+M', 'Ctrl+I', 'Alt+X', 'x']) {
      expect(() => shortcutBindings({ 'toggle-reasoning': chord })).toThrow()
    }
  })
  it('supports disabling and presents actual binding plus modal and editor catalogs', () => {
    expect(remapShortcut('o', { 'toggle-reasoning': 'none' })).toBeUndefined()
    const rows = shortcutCatalog({ 'toggle-reasoning': 'Ctrl+R' })
    expect(rows.find(row => row.id === 'toggle-reasoning')?.hint).toContain('Ctrl+R')
    expect(rows.find(row => row.id === 'editor')?.hint).toContain('Shift')
    expect(rows.find(row => row.id === 'blocking')?.hint).toContain('Alt+H')
    expect(rows.find(row => row.id === 'settings')?.hint).toContain('Tab')
  })
})
