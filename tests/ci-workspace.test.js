import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { prepareWorkspace } from '../scripts/prepare-workspace.js'
import { COMPATIBLE_DSH_VERSION } from '../src/launcher.js'

const root = resolve(import.meta.dirname, '..')
const workflow = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
function runBlock(name) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split('      - name: ')[0]
  assert.ok(step, `missing workflow step: ${name}`)
  return step.split('        run: |\n')[1].split('\n').filter(Boolean)
    .map(line => line.slice(10)).join('\n')
}
function put(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, content)
}
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ci-workspace-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const candidate = join(dir, 'candidate')
  const dsh = join(dir, 'dsh')
  put(join(candidate, 'package.json'), '{"type":"module"}')
  for (const path of ['scripts/prepare-workspace.js', 'src/launcher.js']) {
    put(join(candidate, path), readFileSync(join(root, path)))
  }
  put(join(dsh, 'package.json'), JSON.stringify({ version: COMPATIBLE_DSH_VERSION }))
  for (const name of ['tui', 'tui-render']) {
    put(join(candidate, name, 'src/index.ts'), `export const candidate = '${name}'\n`)
    put(join(candidate, name, 'tests/candidate-only.spec.ts'), `// ${name} candidate sentinel\n`)
    put(join(candidate, name, 'package.json'), JSON.stringify({ main: './lib/index.js', exports: { '.': { default: './lib/index.js' } } }))
    put(join(candidate, name, 'tsconfig.workspace.json'), `{"candidate":"${name}"}`)
    put(join(dsh, 'packages/tui', name, 'src/upstream-only.ts'), 'old upstream')
    put(join(dsh, 'packages/tui', name, 'tests/upstream-only.spec.ts'), 'old upstream')
    put(join(dsh, 'packages/tui', name, 'node_modules/keep'), 'dependency sentinel')
  }
  put(join(candidate, 'presets/example.patch.yml'), 'candidate preset')
  put(join(candidate, 'cordis.patch.yml'), 'candidate patch')
  return { dir, candidate, dsh }
}
function assertCandidate(candidate, dsh) {
  for (const name of ['tui', 'tui-render']) {
    const target = join(dsh, 'packages/tui', name)
    for (const path of ['src/index.ts', 'tests/candidate-only.spec.ts']) {
      assert.equal(readFileSync(join(target, path), 'utf8'), readFileSync(join(candidate, name, path), 'utf8'))
    }
    assert.equal(readFileSync(join(target, 'tsconfig.json'), 'utf8'), readFileSync(join(candidate, name, 'tsconfig.workspace.json'), 'utf8'))
    assert.equal(existsSync(join(target, 'src/upstream-only.ts')), false)
    assert.equal(existsSync(join(target, 'tests/upstream-only.spec.ts')), false)
    assert.equal(readFileSync(join(target, 'node_modules/keep'), 'utf8'), 'dependency sentinel')
  }
  const renderer = JSON.parse(readFileSync(join(dsh, 'packages/tui/tui-render/package.json'), 'utf8'))
  assert.equal(renderer.main, './src/index.ts')
  assert.equal(renderer.exports['.'].default, './src/index.ts')
  assert.equal(readFileSync(join(dsh, 'packages/tui/presets/example.patch.yml'), 'utf8'), 'candidate preset')
  assert.equal(readFileSync(join(dsh, 'packages/tui/cordis.patch.yml'), 'utf8'), 'candidate patch')
}

test('workspace preparation mounts candidate sources/tests/config and preserves dependencies', t => {
  const { candidate, dsh } = fixture(t)
  assert.equal(prepareWorkspace(candidate, dsh), COMPATIBLE_DSH_VERSION)
  assertCandidate(candidate, dsh)
  put(join(candidate, 'tui/src/index.ts'), 'updated candidate')
  prepareWorkspace(candidate, dsh)
  assertCandidate(candidate, dsh)
})

test('wrong upstream version is rejected before any workspace mutation', t => {
  const { candidate, dsh } = fixture(t)
  put(join(dsh, 'package.json'), '{"version":"0.0.0"}')
  assert.throws(() => prepareWorkspace(candidate, dsh), /check out dsh-v/u)
  assert.equal(readFileSync(join(dsh, 'packages/tui/tui/src/upstream-only.ts'), 'utf8'), 'old upstream')
})

test('checkout step resolves the exact tag and mounts candidate before dependency installation', t => {
  const { dir, candidate } = fixture(t)
  const bin = join(dir, 'bin')
  const log = join(dir, 'commands.jsonl')
  for (const name of ['git', 'corepack', 'pnpm']) {
    put(join(bin, name), `#!${process.execPath}\nimport fs from 'node:fs'; import path from 'node:path';\nconst args=process.argv.slice(2);\nfs.appendFileSync(process.env.COMMAND_LOG, JSON.stringify({ command: '${name}', args })+'\\n');\nif ('${name}' === 'git') { const dst=args.at(-1); fs.mkdirSync(dst,{recursive:true}); fs.writeFileSync(path.join(dst,'package.json'), JSON.stringify({packageManager:'pnpm@10.0.0',version:'${COMPATIBLE_DSH_VERSION}'})); for (const name of ['tui','tui-render']) { fs.mkdirSync(path.join(dst,'packages/tui',name,'node_modules'),{recursive:true}); fs.writeFileSync(path.join(dst,'packages/tui',name,'node_modules/keep'),'dependency sentinel'); } }\nif ('${name}' === 'pnpm') { const dst=args.at(-1); if (!fs.existsSync(path.join(dst,'packages/tui/tui/tests/candidate-only.spec.ts'))) process.exit(9); }\n`)
    // Executable mocks only record arguments; no clone, package install or network.
    cpSync(join(bin, name), join(bin, `${name}.mjs`))
    writeFileSync(join(bin, name), `#!/bin/sh\nexec '${process.execPath}' '${join(bin, `${name}.mjs`)}' "$@"\n`, { mode: 0o755 })
    chmodSync(join(bin, name), 0o755)
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: join(dir, 'runner'), COMMAND_LOG: log, GITHUB_ENV: join(dir, 'github-env') }
  delete env.COMPATIBLE_DSH_VERSION
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', runBlock('Check out compatible DSH')], { cwd: candidate, env, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const commands = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
  assertCandidate(candidate, join(dir, 'runner/deepseek-harness'))
  assert.deepEqual(commands.at(-1), { command: 'pnpm', args: ['install', '--no-frozen-lockfile', '--dir', join(dir, 'runner/deepseek-harness')] })
  assert.deepEqual(commands[0], { command: 'git', args: ['clone', '--depth', '1', '--branch', `dsh-v${COMPATIBLE_DSH_VERSION}`, 'https://github.com/deepseek-ai/deepseek-harness.git', join(dir, 'runner/deepseek-harness')] })
})

test('TUI step sets up the mounted candidate and invokes Vitest from the DSH root', t => {
  const { dir, candidate, dsh } = fixture(t)
  prepareWorkspace(candidate, dsh)
  const bin = join(dir, 'bin')
  put(join(bin, 'npm'), `#!/bin/sh\ntest "$1 $2" = 'run dev:setup'\ntest -f "$DSH_SOURCE/packages/tui/tui/tests/candidate-only.spec.ts"\n`)
  chmodSync(join(bin, 'npm'), 0o755)
  put(join(bin, 'pnpm'), `#!/bin/sh\nset -e\ntest \"$1 $2\" = 'run build:native-system'\ntest \"$PWD\" = \"$DSH_SOURCE\"\ntouch .native-built\n`)
  chmodSync(join(bin, 'pnpm'), 0o755)
  const probe = join(dir, 'vitest-probe.json')
  put(join(dsh, 'node_modules/vitest/vitest.mjs'), `import fs from 'node:fs';\nif (!fs.existsSync('.native-built')) process.exit(9);\nfs.writeFileSync(process.env.VITEST_PROBE, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), sentinel: fs.readFileSync('packages/tui/tui/tests/candidate-only.spec.ts', 'utf8') }));\n`)
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', runBlock('Run TUI tests')], {
    cwd: candidate, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DSH_SOURCE: dsh, VITEST_PROBE: probe }, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assertCandidate(candidate, dsh)
  const actual = JSON.parse(readFileSync(probe, 'utf8'))
  assert.equal(actual.cwd, dsh)
  assert.equal(actual.sentinel, '// tui candidate sentinel\n')
  assert.deepEqual(actual.args, ['run', 'packages/tui/tui/tests', 'packages/tui/tui-render/tests', '--maxWorkers', '2'])
})
