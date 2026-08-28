/**
 * Host opener for OSC 8 click.
 */

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { openUrl, openerSpec, type SpawnFn } from '../src/open-url.ts'

/** Narrow the child-process double to the spawn face openUrl consumes. */
function asSpawn(fn: () => unknown): SpawnFn {
  return fn as unknown as SpawnFn
}

describe('openerSpec', () => {
  it('uses open, start, or xdg-open', () => {
    expect(openerSpec('darwin', 'https://a')).toEqual({
      command: 'open',
      args: ['https://a'],
    })
    expect(openerSpec('win32', 'https://a')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'https://a'],
    })
    expect(openerSpec('linux', 'https://a')).toEqual({
      command: 'xdg-open',
      args: ['https://a'],
    })
  })
})

describe('openUrl', () => {
  it('ignores unsafe hrefs', () => {
    const spawnFn = vi.fn()
    openUrl('javascript:alert(1)', asSpawn(spawnFn))
    openUrl('./rel', asSpawn(spawnFn))
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('spawns detached and swallows child errors', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const spawnFn = vi.fn(() => child)
    openUrl('https://example.com', asSpawn(spawnFn), 'linux')
    expect(spawnFn).toHaveBeenCalledWith(
      'xdg-open',
      ['https://example.com'],
      { detached: true, stdio: 'ignore' },
    )
    expect(child.unref).toHaveBeenCalled()
    child.emit('error', new Error('ENOENT'))
  })

  it('swallows a synchronous spawn throw', () => {
    expect(() => {
      openUrl('https://example.com', asSpawn(() => {
        throw new Error('spawn')
      }))
    }).not.toThrow()
  })
})
