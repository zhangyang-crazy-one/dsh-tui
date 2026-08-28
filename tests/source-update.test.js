import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const launcher = join(repositoryRoot, 'bin', 'dsh-tui.js')

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    shell: false,
  })
  if (options.allowFailure !== true && result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed (${String(result.status)}): ${result.stderr}`)
  }
  return result
}

function git(cwd, args) {
  return command('git', args, { cwd }).stdout.trim()
}

function commit(cwd, filename, content, message) {
  writeFileSync(join(cwd, filename), content)
  git(cwd, ['add', filename])
  git(cwd, ['commit', '-m', message])
  return git(cwd, ['rev-parse', 'HEAD'])
}

test('real source update clones, fast-forwards, and rejects dirty or divergent runtime state', {
  skip: process.platform === 'win32' ? 'POSIX executable fixture' : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tui-source-update-'))
  try {
    const remote = join(root, 'remote.git')
    const source = join(root, 'source')
    const runtime = join(root, 'runtime')
    const pnpmLog = join(root, 'pnpm.log')
    const fakePnpm = join(root, 'fake-pnpm')

    git(root, ['init', '--bare', remote])
    git(root, ['init', '--initial-branch=feat/deepseek-tui', source])
    git(source, ['config', 'user.name', 'dsh-tui test'])
    git(source, ['config', 'user.email', 'dsh-tui@example.test'])
    const first = commit(source, 'package.json', '{"version":"1.0.0"}\n', 'first')
    git(source, ['remote', 'add', 'origin', remote])
    git(source, ['push', '--set-upstream', 'origin', 'feat/deepseek-tui'])

    writeFileSync(fakePnpm, `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'\nappendFileSync(process.env.DSH_TUI_TEST_PNPM_LOG, process.argv.slice(2).join(' ') + '\\n')\n`)
    chmodSync(fakePnpm, 0o755)
    const environment = {
      ...process.env,
      DSH_TUI_RUNTIME_DIR: runtime,
      DSH_TUI_SOURCE_URL: remote,
      DSH_TUI_SOURCE_REF: 'feat/deepseek-tui',
      DSH_TUI_PNPM: fakePnpm,
      DSH_TUI_TEST_PNPM_LOG: pnpmLog,
    }

    const initialized = command(process.execPath, [launcher, 'update'], { env: environment })
    assert.match(initialized.stdout, new RegExp(first))
    assert.equal(git(runtime, ['rev-parse', 'HEAD']), first)
    assert.equal(readFileSync(pnpmLog, 'utf8'), 'install --frozen-lockfile\n')

    const second = commit(source, 'state.txt', 'second\n', 'second')
    git(source, ['push', 'origin', 'feat/deepseek-tui'])
    const updated = command(process.execPath, [launcher, 'update'], { env: environment })
    assert.match(updated.stdout, new RegExp(`${first} -> ${second}`))
    assert.equal(git(runtime, ['rev-parse', 'HEAD']), second)

    writeFileSync(join(runtime, 'dirty.txt'), 'dirty\n')
    const dirty = command(process.execPath, [launcher, 'update'], {
      env: environment,
      allowFailure: true,
    })
    assert.equal(dirty.status, 1)
    assert.match(dirty.stderr, /runtime worktree is not clean/)
    assert.equal(git(runtime, ['rev-parse', 'HEAD']), second)
    rmSync(join(runtime, 'dirty.txt'))

    git(runtime, ['config', 'user.name', 'dsh-tui test'])
    git(runtime, ['config', 'user.email', 'dsh-tui@example.test'])
    commit(runtime, 'local.txt', 'local\n', 'local')
    commit(source, 'remote.txt', 'remote\n', 'remote')
    git(source, ['push', 'origin', 'feat/deepseek-tui'])
    const divergentHead = git(runtime, ['rev-parse', 'HEAD'])
    const divergent = command(process.execPath, [launcher, 'update'], {
      env: environment,
      allowFailure: true,
    })
    assert.equal(divergent.status, 1)
    assert.match(divergent.stderr, /not a fast-forward/)
    assert.equal(git(runtime, ['rev-parse', 'HEAD']), divergentHead)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('launch preserves the shell-visible child signal outcome', {
  skip: process.platform === 'win32' ? 'POSIX signal outcome' : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tui-signal-'))
  try {
    const runtime = join(root, 'runtime')
    const fakePnpm = join(root, 'fake-pnpm')
    git(root, ['init', runtime])
    writeFileSync(fakePnpm, '#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM")\n')
    chmodSync(fakePnpm, 0o755)
    const launched = command(process.execPath, [launcher], {
      env: {
        ...process.env,
        DSH_TUI_RUNTIME_DIR: runtime,
        DSH_TUI_PNPM: fakePnpm,
      },
      allowFailure: true,
    })
    assert.equal(launched.status, 143)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
