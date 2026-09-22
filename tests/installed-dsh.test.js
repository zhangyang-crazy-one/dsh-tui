import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('the CLI finds a local package without PATH shims and launches its non-executable bin once', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tui-installed-'))
  try {
    const packageDirectory = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh', bin: { dsh: './entry.cjs' },
    }))
    writeFileSync(join(packageDirectory, 'entry.cjs'), `
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.DSH_TEST_CALLS, JSON.stringify(args) + '\\n')
if (args[0] === '--version') console.log('0.1.6-alpha.2')
else process.exitCode = 7
`)
    const callsFile = join(root, 'calls.jsonl')
    const launcher = fileURLToPath(new URL('../bin/dsh-tui.js', import.meta.url))
    const result = spawnSync(process.execPath, [launcher, '--lightweight', '--resume', 'session-1'], {
      cwd: root,
      env: { PATH: '', DSH_HOME: join(root, 'home'), DSH_TEST_CALLS: callsFile },
      encoding: 'utf8', timeout: 15000,
    })
    assert.equal(result.status, 7, result.stderr)
    assert.deepEqual(readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
      ['--version'],
      ['--profile', 'tui', '--patch', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), '--resume', 'session-1'],
    ])
    const profile = JSON.parse(readFileSync(join(root, 'home', 'profiles', 'tui', 'package.json'), 'utf8'))
    assert.deepEqual(profile.dsh.profile, { bundles: ['@deepseek-ai/dsh-base'], patchReload: 'startup' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
