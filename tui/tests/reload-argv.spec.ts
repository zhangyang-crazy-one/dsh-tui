/**
 * `/reload` argv rewrite drops the original task positional, keeps launcher
 * flags and `--cwd` / `--frame-stats`, and adds `--resume`. The spawn helper
 * waits for close and maps signals to `128 + number`. Tests never start Node.
 */

import { EventEmitter } from 'node:events'
import { constants as osConstants } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  rebuildReloadArgv,
  relaunchProcess,
  type RelaunchHost,
} from '../src/reload-argv.ts'

function fakeChild(): EventEmitter {
  return new EventEmitter()
}

function hostWith(child: EventEmitter, spawnCalls: unknown[][]): RelaunchHost {
  return {
    spawn: (command, args, options) => {
      spawnCalls.push([command, [...args], options])
      return child
    },
    execPath: '/node',
    execArgv: ['--import', 'tsx/esm'],
    env: { PATH: '/bin' },
  }
}

describe('rebuildReloadArgv', () => {
  it('keeps launcher flags, drops the task positional, and adds --resume', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js', '--profile', 'deepseek-tui', 'hello'],
        ['hello'],
        { sessionId: 'sess-1' },
      ),
    ).toEqual([
      '/dsh.js',
      '--profile',
      'deepseek-tui',
      '--resume',
      'sess-1',
    ])
  })

  it('forwards --cwd and --frame-stats from the live config', () => {
    expect(
      rebuildReloadArgv(
        [
          'node',
          '/dsh.js',
          '--profile',
          'deepseek-tui',
          '--patch',
          'extra.yml',
          '--cwd',
          '/tmp/work',
          '--frame-stats',
          'frames.json',
          'seed task',
        ],
        ['--cwd', '/tmp/work', '--frame-stats', 'frames.json', 'seed task'],
        {
          sessionId: 'sess-2',
          cwd: '/tmp/work',
          frameStats: 'frames.json',
        },
      ),
    ).toEqual([
      '/dsh.js',
      '--profile',
      'deepseek-tui',
      '--patch',
      'extra.yml',
      '--cwd',
      '/tmp/work',
      '--frame-stats',
      'frames.json',
      '--resume',
      'sess-2',
    ])
  })

  it('keeps the full dsh argv as launcher when the inner list is empty', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js', '--profile', 'deepseek-tui'],
        [],
        { sessionId: 'sess-3' },
      ),
    ).toEqual([
      '/dsh.js',
      '--profile',
      'deepseek-tui',
      '--resume',
      'sess-3',
    ])
  })

  it('drops launcher tokens when inner args are not an exact suffix', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js', '--profile', 'deepseek-tui', 'hello'],
        ['--cwd', '/tmp'],
        { sessionId: 'sess-4', cwd: '/tmp' },
      ),
    ).toEqual(['/dsh.js', '--cwd', '/tmp', '--resume', 'sess-4'])
  })

  it('drops launcher tokens when inner args are longer than dsh argv', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js'],
        ['hello', 'world'],
        { sessionId: 'sess-5' },
      ),
    ).toEqual(['/dsh.js', '--resume', 'sess-5'])
  })

  it('omits --resume, --cwd, and --frame-stats when those values are empty', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js', '--profile', 'deepseek-tui'],
        [],
        { sessionId: '', cwd: '', frameStats: '' },
      ),
    ).toEqual(['/dsh.js', '--profile', 'deepseek-tui'])
  })

  it('omits --resume when the session id is missing', () => {
    expect(
      rebuildReloadArgv(
        ['node', '/dsh.js', '--profile', 'deepseek-tui'],
        [],
        { sessionId: undefined },
      ),
    ).toEqual(['/dsh.js', '--profile', 'deepseek-tui'])
  })

  it('returns only inner flags when process.argv has no script', () => {
    expect(
      rebuildReloadArgv(['node'], [], { sessionId: 'sess-6' }),
    ).toEqual(['--resume', 'sess-6'])
  })
})

describe('relaunchProcess', () => {
  it('spawns Node with execArgv plus the rewritten argv and returns the close code', async () => {
    const child = fakeChild()
    const spawnCalls: unknown[][] = []
    const done = relaunchProcess(
      ['/dsh.js', '--profile', 'deepseek-tui', '--resume', 'sess-1'],
      hostWith(child, spawnCalls),
    )
    child.emit('close', 0, null)
    await expect(done).resolves.toBe(0)
    expect(spawnCalls).toEqual([
      [
        '/node',
        [
          '--import',
          'tsx/esm',
          '/dsh.js',
          '--profile',
          'deepseek-tui',
          '--resume',
          'sess-1',
        ],
        { stdio: 'inherit', env: { PATH: '/bin' } },
      ],
    ])
  })

  it('maps a killing signal to 128 plus the signal number', async () => {
    const child = fakeChild()
    const done = relaunchProcess(['/dsh.js'], hostWith(child, []))
    child.emit('close', null, 'SIGTERM')
    await expect(done).resolves.toBe(128 + osConstants.signals.SIGTERM)
  })

  it('returns 1 when close reports neither a code nor a known signal', async () => {
    const child = fakeChild()
    const done = relaunchProcess(['/dsh.js'], hostWith(child, []))
    child.emit('close', null, null)
    await expect(done).resolves.toBe(1)
    const unknown = fakeChild()
    const unknownDone = relaunchProcess(['/dsh.js'], hostWith(unknown, []))
    unknown.emit('close', null, 'NOT_A_SIGNAL')
    await expect(unknownDone).resolves.toBe(1)
  })

  it('rejects on spawn error and ignores a later close', async () => {
    const child = fakeChild()
    const done = relaunchProcess(['/dsh.js'], hostWith(child, []))
    const failure = new Error('ENOENT')
    child.emit('error', failure)
    child.emit('error', new Error('second'))
    child.emit('close', 0, null)
    await expect(done).rejects.toBe(failure)
  })

  it('ignores a second close after the first settlement', async () => {
    const child = fakeChild()
    const done = relaunchProcess(['/dsh.js'], hostWith(child, []))
    child.emit('close', 7, null)
    child.emit('error', new Error('late'))
    child.emit('close', 1, null)
    await expect(done).resolves.toBe(7)
  })
})
