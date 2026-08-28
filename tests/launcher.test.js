import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseLauncherInvocation,
  resolveLauncherSettings,
  runLauncher,
} from '../src/launcher.js'

const RUNTIME = '/home/test/.local/share/dsh-tui/runtime'

function createFixture(options = {}) {
  const calls = []
  const stdout = []
  const stderr = []
  const paths = new Map(Object.entries(options.paths ?? {}))
  const results = [...(options.results ?? [])]
  return {
    calls,
    stdout,
    stderr,
    adapters: {
      inspectPath(path) {
        return paths.get(path) ?? 'missing'
      },
      makeDirectory(path) {
        calls.push({ operation: 'mkdir', path })
      },
      readText(path) {
        const value = options.text?.[path]
        if (value === undefined) throw new Error(`unexpected read: ${path}`)
        return value
      },
      run(command, args, runOptions = {}) {
        calls.push({ operation: 'run', command, args, options: runOptions })
        return results.shift() ?? { status: 0, stdout: '', stderr: '' }
      },
      writeOut(text) {
        stdout.push(text)
      },
      writeError(text) {
        stderr.push(text)
      },
    },
  }
}

function settings(overrides = {}) {
  return {
    runtimeDirectory: RUNTIME,
    sourceUrl: 'https://github.com/zhangyang-crazy-one/deepseek-harness.git',
    sourceRef: 'feat/deepseek-tui',
    packageManager: 'pnpm',
    ...overrides,
  }
}

test('parses management commands and the pass-through separator', () => {
  assert.deepEqual(parseLauncherInvocation([]), { kind: 'launch', args: [] })
  assert.deepEqual(parseLauncherInvocation(['version']), { kind: 'version' })
  assert.deepEqual(parseLauncherInvocation(['update']), { kind: 'update' })
  assert.deepEqual(parseLauncherInvocation(['--', 'update']), { kind: 'launch', args: ['update'] })
  assert.deepEqual(parseLauncherInvocation(['--resume', 'session-1']), {
    kind: 'launch',
    args: ['--resume', 'session-1'],
  })
})

test('resolves stable deployment defaults and rejects empty overrides', () => {
  assert.deepEqual(resolveLauncherSettings({ env: {}, homeDirectory: '/home/test' }), settings())
  assert.deepEqual(resolveLauncherSettings({
    env: {
      DSH_TUI_RUNTIME_DIR: '/srv/dsh-tui',
      DSH_TUI_SOURCE_URL: 'ssh://git@example.test/dsh.git',
      DSH_TUI_SOURCE_REF: 'release',
      DSH_TUI_PNPM: '/opt/pnpm',
    },
    homeDirectory: '/home/test',
  }), settings({
    runtimeDirectory: '/srv/dsh-tui',
    sourceUrl: 'ssh://git@example.test/dsh.git',
    sourceRef: 'release',
    packageManager: '/opt/pnpm',
  }))
  assert.throws(
    () => resolveLauncherSettings({ env: { DSH_TUI_SOURCE_REF: '' }, homeDirectory: '/home/test' }),
    /DSH_TUI_SOURCE_REF must not be empty/,
  )
})

test('version reports an uninitialized runtime without creating it', () => {
  const fixture = createFixture()
  const status = runLauncher({
    invocation: { kind: 'version' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 0)
  assert.match(fixture.stdout.join(''), /dsh-tui 0\.1\.0-alpha\.1/)
  assert.match(fixture.stdout.join(''), /runtime: uninitialized/)
  assert.deepEqual(fixture.calls, [])
})

test('version reports the runtime SHA and DSH package version', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    text: { [`${RUNTIME}/package.json`]: '{"version":"0.1.2-alpha.1"}' },
    results: [{ status: 0, stdout: '0123456789abcdef\n', stderr: '' }],
  })
  const status = runLauncher({
    invocation: { kind: 'version' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 0)
  assert.match(fixture.stdout.join(''), /runtime SHA: 0123456789abcdef/)
  assert.match(fixture.stdout.join(''), /DSH version: 0\.1\.2-alpha\.1/)
})

test('launch forwards arguments and returns the child status', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    results: [{ status: 7, stdout: '', stderr: '' }],
  })
  const status = runLauncher({
    invocation: { kind: 'launch', args: ['--resume', 'session-1'] },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 7)
  assert.deepEqual(fixture.calls.at(-1), {
    operation: 'run',
    command: 'pnpm',
    args: ['dsh', '--profile', 'deepseek-tui', '--resume', 'session-1'],
    options: { cwd: RUNTIME, stdio: 'inherit' },
  })
})

test('launch rejects an absent runtime and a symbolic-link runtime', () => {
  const absent = createFixture()
  assert.equal(runLauncher({
    invocation: { kind: 'launch', args: [] },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: absent.adapters,
  }), 1)
  assert.match(absent.stderr.join(''), /dsh-tui update/)

  const link = createFixture({ paths: { [RUNTIME]: 'symlink' } })
  assert.equal(runLauncher({
    invocation: { kind: 'launch', args: [] },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: link.adapters,
  }), 1)
  assert.match(link.stderr.join(''), /symbolic link/)
  assert.deepEqual(link.calls, [])
})

test('update clones an absent runtime and installs frozen dependencies', () => {
  const fixture = createFixture({
    results: [
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'abcdef123456\n', stderr: '' },
    ],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 0)
  assert.deepEqual(fixture.calls, [
    { operation: 'mkdir', path: '/home/test/.local/share/dsh-tui' },
    {
      operation: 'run',
      command: 'git',
      args: ['clone', '--branch', 'feat/deepseek-tui', '--single-branch', '--', settings().sourceUrl, RUNTIME],
      options: { capture: true },
    },
    {
      operation: 'run',
      command: 'pnpm',
      args: ['install', '--frozen-lockfile'],
      options: { cwd: RUNTIME, stdio: 'inherit' },
    },
    {
      operation: 'run',
      command: 'git',
      args: ['rev-parse', 'HEAD'],
      options: { cwd: RUNTIME, capture: true },
    },
  ])
  assert.match(fixture.stdout.join(''), /abcdef123456/)
})

test('update redacts source credentials from clone failures', () => {
  const sourceUrl = 'https://secret-token@example.test/private.git'
  const fixture = createFixture({
    results: [{
      status: 128,
      stdout: '',
      stderr: `fatal: could not read from ${sourceUrl}\n`,
    }],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings({ sourceUrl }),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 128)
  assert.doesNotMatch(fixture.stderr.join(''), /secret-token/)
  assert.match(fixture.stderr.join(''), /<source>/)
})

test('update rejects a dirty runtime before fetching', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    results: [{ status: 0, stdout: ' M package.json\n', stderr: '' }],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 1)
  assert.match(fixture.stderr.join(''), /not clean/)
  assert.equal(fixture.calls.length, 1)
})

test('update fast-forwards a clean runtime and refreshes dependencies', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    results: [
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'oldsha\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'newsha\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
    ],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 0)
  assert.deepEqual(fixture.calls.filter(call => call.operation === 'run').map(call => [call.command, call.args]), [
    ['git', ['status', '--porcelain']],
    ['git', ['rev-parse', 'HEAD']],
    ['git', ['fetch', '--no-tags', '--', settings().sourceUrl, 'feat/deepseek-tui']],
    ['git', ['rev-parse', 'FETCH_HEAD']],
    ['git', ['merge-base', '--is-ancestor', 'oldsha', 'newsha']],
    ['git', ['merge', '--ff-only', 'newsha']],
    ['pnpm', ['install', '--frozen-lockfile']],
  ])
  assert.match(fixture.stdout.join(''), /oldsha -> newsha/)
})

test('update rejects divergent history before merge', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    results: [
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'oldsha\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'newsha\n', stderr: '' },
      { status: 1, stdout: '', stderr: '' },
    ],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 1)
  assert.match(fixture.stderr.join(''), /not a fast-forward/)
  assert.equal(fixture.calls.some(call => call.operation === 'run' && call.args[0] === 'merge'), false)
})

test('update reports dependency recovery after a successful fast-forward', () => {
  const fixture = createFixture({
    paths: { [RUNTIME]: 'directory', [`${RUNTIME}/.git`]: 'directory' },
    results: [
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'oldsha\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: 'newsha\n', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 0, stdout: '', stderr: '' },
      { status: 9, stdout: '', stderr: '' },
    ],
  })
  const status = runLauncher({
    invocation: { kind: 'update' },
    settings: settings(),
    packageVersion: '0.1.0-alpha.1',
    adapters: fixture.adapters,
  })
  assert.equal(status, 9)
  assert.match(fixture.stderr.join(''), /pnpm install --frozen-lockfile/)
  assert.match(fixture.stderr.join(''), /newsha/)
})
