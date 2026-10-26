import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { COMPATIBLE_DSH_VERSION } from '../src/launcher.js'

const root = resolve(import.meta.dirname, '..')
const validation = await import('../scripts/validation.js')
const state = join(root, '.runtime/validation/workspace.json')
const installedVitest = existsSync(join(root, 'node_modules/vitest/vitest.mjs'))
  ? realpathSync(join(root, 'node_modules/vitest/vitest.mjs'))
  : existsSync(state) ? JSON.parse(readFileSync(state, 'utf8')).tools?.vitest?.path : null
const { prepareWorkspace, mountSources, runRootTests, runTuiTests, assertTestReport, toolIdentity,
  sourceIdentity, hashFile, verifyArtifact, packAndImport } = validation
const temporary = (t) => {
  const path = mkdtempSync(join(tmpdir(), 'dsh-tui-validation-test-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}
const put = (path, text) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text) }
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function fixture(t) {
  const base = temporary(t)
  const upstream = join(base, 'upstream')
  const repo = join(base, 'repo')
  mkdirSync(upstream)
  put(join(upstream, 'package.json'), JSON.stringify({ version: COMPATIBLE_DSH_VERSION, packageManager: 'pnpm@11.28.5' }))
  put(join(upstream, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  put(join(upstream, 'packages/tui/tui/src/index.ts'), 'export const old = true\n')
  put(join(upstream, 'packages/tui/tui/tests/sentinel.spec.ts'), "import { test } from 'vitest'; test('old mirror', () => {})\n")
  git(upstream, ['init'])
  git(upstream, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'add', '.'])
  git(upstream, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'])
  git(upstream, ['tag', `dsh-v${COMPATIBLE_DSH_VERSION}`])
  for (const name of ['tui', 'tui-render']) {
    put(join(repo, name, 'package.json'), JSON.stringify({ name, exports: { '.': { default: './lib/index.js' } } }))
    put(join(repo, name, 'tsconfig.workspace.json'), '{}')
    put(join(repo, name, 'tsconfig.json'), '{}')
    put(join(repo, name, 'tests/tsconfig.json'), '{}')
    put(join(repo, name, 'src/index.ts'), 'export const current = true\n')
  }
  put(join(repo, 'presets/test.patch.yml'), 'test')
  put(join(repo, 'cordis.patch.yml'), 'test')
  put(join(repo, 'scripts/validation-lock.patch'), 'fixture patch')
  put(join(repo, 'scripts/validation-tools.json'), JSON.stringify({ dshValidation: { version: COMPATIBLE_DSH_VERSION, commit: git(upstream, ['rev-parse', 'HEAD']), upstreamLockSha256: hashFile(join(upstream, 'pnpm-lock.yaml')), patchSha256: hashFile(join(repo, 'scripts/validation-lock.patch')) } }))
  return { base, upstream, repo }
}

test('preparation clones the compatible tag and leaves dirty upstream and symlink targets untouched', (t) => {
  const { base, upstream, repo } = fixture(t)
  put(join(upstream, 'packages/tui/tui/src/index.ts'), 'local developer edit\n')
  put(join(upstream, 'untracked.txt'), 'keep\n')
  const before = git(upstream, ['status', '--porcelain=v1', '--untracked-files=all'])
  const workspace = prepareWorkspace({ root: repo, source: upstream, tempRoot: base })
  assert.notEqual(realpathSync(workspace.dshRoot), realpathSync(upstream))
  assert.equal(readFileSync(join(workspace.dshRoot, 'packages/tui/tui/src/index.ts'), 'utf8'), 'export const current = true\n')
  assert.equal(readFileSync(join(upstream, 'packages/tui/tui/src/index.ts'), 'utf8'), 'local developer edit\n')
  assert.equal(git(upstream, ['status', '--porcelain=v1', '--untracked-files=all']), before)
  const outside = join(base, 'outside')
  mkdirSync(outside)
  put(join(outside, 'keep'), 'keep')
  rmSync(join(workspace.dshRoot, 'packages/tui/tui/src'), { recursive: true })
  symlinkSync(outside, join(workspace.dshRoot, 'packages/tui/tui/src'))
  mountSources(repo, workspace.dshRoot)
  assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'keep')
  assert.throws(() => mountSources(repo, upstream), /owned|isolated/u)
})

test('test report gate rejects zero tests, failures and skipped-only tests', () => {
  assert.throws(() => assertTestReport({ numTotalTests: 0, numPassedTests: 0, success: true }), /zero|passed/u)
  assert.throws(() => assertTestReport({ numTotalTests: 2, numPassedTests: 0, success: true }), /zero|passed/u)
  assert.throws(() => assertTestReport({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 1, success: false }), /fail/u)
  assert.equal(assertTestReport({ numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, success: true }).passed, 2)
})

test('root tests run in repository cwd, propagate failure and reject empty suites', (t) => {
  const base = temporary(t)
  mkdirSync(join(base, 'tests'))
  assert.throws(() => runRootTests(base, base), /zero|No .*test/u)
  put(join(base, 'tests/current.test.js'), "const {test}=require('node:test'); const assert=require('node:assert/strict'); test('cwd',()=>assert.equal(process.cwd(), __dirname.replace(/[/\\\\]tests$/, '')))\n")
  assert.equal(runRootTests(base, base).passed, 1)
  put(join(base, 'tests/current.test.js'), "require('node:test').test('current failure',()=>{throw Error('sentinel')})\n")
  assert.throws(() => runRootTests(base, base), /fail/u)
})

test('current failing TUI source cannot be hidden by a passing old workspace mirror', { skip: !installedVitest && 'Vitest is available after validate:prepare' }, (t) => {
  const { base, repo, upstream } = fixture(t)
  // Real Vitest, independent config, no network and no product source modifications.
  const vitest = installedVitest
  const dshRoot = join(base, 'old')
  cpSync(upstream, dshRoot, { recursive: true })
  put(join(dshRoot, '.dsh-tui-workspace.json'), JSON.stringify({ root: repo }))
  const dependencies = existsSync(join(root, 'node_modules')) ? realpathSync(join(root, 'node_modules')) : join(JSON.parse(readFileSync(state, 'utf8')).dshRoot, 'node_modules')
  symlinkSync(dependencies, join(dshRoot, 'node_modules'), 'junction')
  mkdirSync(join(dshRoot, 'packages/tui/tui-render/tests'), { recursive: true })
  const config = join(base, 'vitest.config.mjs')
  put(config, 'export default {test:{include:["packages/tui/*/tests/**/*.spec.ts"],pool:"threads",maxWorkers:1}}\n')
  assert.equal(runTuiTests({ dshRoot, directory: base }, { vitest, config }).passed, 1)
  put(join(repo, 'tui/tests/sentinel.spec.ts'), "import {test} from 'vitest'; test('CURRENT_SOURCE_SENTINEL',()=>{throw Error('CURRENT_SOURCE_SENTINEL')})\n")
  mountSources(repo, dshRoot)
  assert.throws(() => runTuiTests({ dshRoot, directory: base }, { vitest, config }), /fail/u)
  rmSync(join(dshRoot, 'packages/tui/tui/tests/sentinel.spec.ts'))
  assert.throws(() => runTuiTests({ dshRoot, directory: base }, { vitest, config }), /fail/u)
})

test('build tool uses the declared tool link even when the store contains a newer esbuild', (t) => {
  const base = temporary(t)
  const pinned = join(base, 'node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild')
  put(join(pinned, 'package.json'), '{"name":"esbuild","version":"0.28.2","bin":{"esbuild":"bin/esbuild"}}')
  put(join(pinned, 'bin/esbuild'), 'pinned')
  put(join(base, 'node_modules/.pnpm/esbuild@99.0.0/node_modules/esbuild/bin/esbuild'), 'wrong')
  symlinkSync(pinned, join(base, 'node_modules/esbuild'), 'junction')
  const tool = toolIdentity(base, 'esbuild')
  assert.equal(tool.version, '0.28.2')
  assert.equal(tool.path, join(pinned, 'bin/esbuild'))
})

test('publication gate rejects changed source, bundles and tarball despite a matching commit', (t) => {
  const base = temporary(t)
  put(join(base, 'tui/src/index.ts'), 'current')
  const bundles = {}
  for (const name of ['index.js', 'startup.js', 'settings.js', 'schedule.js', 'zen-proxy.js']) {
    put(join(base, 'dist', name), 'bundle')
    bundles[name] = hashFile(join(base, 'dist', name))
  }
  put(join(base, 'artifact.tgz'), 'packed')
  const record = {
    schema: 1, status: 'verified', source: sourceIdentity(base),
    bundles,
    tarball: { filename: 'artifact.tgz', sha256: hashFile(join(base, 'artifact.tgz')) },
    tests: { root: { passed: 1 }, tui: { passed: 1 } },
  }
  const proof = join(base, 'provenance.json')
  put(proof, JSON.stringify(record))
  assert.equal(verifyArtifact(base, proof), join(base, 'artifact.tgz'))
  put(join(base, 'dist/index.js'), 'tampered')
  assert.throws(() => verifyArtifact(base, proof), /bundle|hash/u)
  put(join(base, 'dist/index.js'), 'bundle')
  put(join(base, 'tui/src/index.ts'), 'tampered source')
  assert.throws(() => verifyArtifact(base, proof), /source/u)
  put(join(base, 'tui/src/index.ts'), 'current')
  put(join(base, 'artifact.tgz'), 'tampered archive')
  assert.throws(() => verifyArtifact(base, proof), /tarball|hash/u)
})


test('packed entrypoints are imported from the archive, including import failures', (t) => {
  const base = temporary(t)
  const repo = join(base, 'repo')
  const entries = ['runtime', 'startup', 'settings', 'schedule', 'zen-proxy']
  const exports = Object.fromEntries(entries.map(name => [`./${name}`, `./dist/${name}.js`]))
  put(join(repo, 'package.json'), JSON.stringify({ name: '@fixture/packed-tui', version: '1.0.0', type: 'module', files: ['dist'], exports }))
  for (const name of entries) put(join(repo, 'dist', `${name}.js`), 'export default {}\n')
  const good = join(base, 'good')
  mkdirSync(good)
  const tarball = packAndImport(repo, good)
  assert.equal(hashFile(join(good, tarball.filename)), tarball.sha256)
  const mismatch = join(base, 'mismatch')
  mkdirSync(mismatch)
  assert.throws(() => packAndImport(repo, mismatch, { bundles: { 'runtime.js': 'incorrect-build-hash' } }), /Packed bundle hash mismatch/u)
  put(join(repo, 'dist/runtime.js'), "throw Error('PACKED_IMPORT_SENTINEL')\n")
  const bad = join(base, 'bad')
  mkdirSync(bad)
  assert.throws(() => packAndImport(repo, bad), /failed/u)
})

test('source provenance includes new untracked code even in a source lib directory', (t) => {
  const base = temporary(t)
  put(join(base, 'src/index.js'), 'export {}\n')
  git(base, ['init'])
  git(base, ['add', '.'])
  git(base, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'source'])
  const before = sourceIdentity(base)
  put(join(base, 'src/lib/untracked.js'), 'export const current = true\n')
  const after = sourceIdentity(base)
  assert.equal(before.commit, after.commit)
  assert.notEqual(before.sha256, after.sha256)
  put(join(base, 'tui-render/src/untracked.ts'), 'export {}\n')
  assert.notEqual(sourceIdentity(base).sha256, after.sha256)
})

test('workspace freshness rejects both concurrent repository edits and isolated mirror edits', (t) => {
  const { base, upstream, repo } = fixture(t)
  const workspace = prepareWorkspace({ root: repo, source: upstream, tempRoot: base })
  assert.doesNotThrow(() => validation.assertWorkspaceCurrent(workspace))
  put(join(repo, 'tui/src/index.ts'), 'concurrent edit\n')
  assert.throws(() => validation.assertWorkspaceCurrent(workspace), /source.*chang|source.*mismatch/iu)
  put(join(repo, 'tui/src/index.ts'), 'export const current = true\n')
  put(join(workspace.dshRoot, 'packages/tui/tui/src/index.ts'), 'modified isolated mirror\n')
  assert.throws(() => validation.assertWorkspaceCurrent(workspace), /mount|mirror/iu)
})

test('lock provenance rejects a different upstream version, commit or lock before patching', (t) => {
  const { base, upstream, repo } = fixture(t)
  const workspace = prepareWorkspace({ root: repo, source: upstream, tempRoot: base })
  assert.doesNotThrow(() => validation.assertLockProvenance(workspace))
  assert.throws(() => validation.assertLockProvenance({ ...workspace, dshVersion: '0.0.0' }), /version/iu)
  assert.throws(() => validation.assertLockProvenance({ ...workspace, dshCommit: 'wrong' }), /commit/iu)
  put(join(repo, 'scripts/validation-lock.patch'), 'edited patch')
  assert.throws(() => validation.assertLockProvenance(workspace), /patch hash/iu)
  put(join(repo, 'scripts/validation-lock.patch'), 'fixture patch')
  put(join(workspace.dshRoot, 'pnpm-lock.yaml'), 'different upstream lock\n')
  assert.throws(() => validation.assertLockProvenance(workspace), /lock/iu)
})

test('published compatibility ranges admit supported DSH prereleases with standard npm semver', {
  skip: !existsSync(state) && 'DSH dependencies are available after validate:prepare',
}, () => {
  const workspace = JSON.parse(readFileSync(state, 'utf8'))
  const { satisfies } = createRequire(join(workspace.dshRoot, 'package.json'))('semver')
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const range of [manifest.engines.dsh, manifest.peerDependencies['@deepseek-ai/dsh']]) {
    for (const version of ['0.2.0-rc.2', '0.2.1-alpha.2', '0.2.1-rc.2', COMPATIBLE_DSH_VERSION, '0.2.1']) {
      assert.equal(satisfies(version, range), true, `${range} must admit ${version}`)
    }
    for (const version of ['0.1.6-alpha.2', '0.2.0-rc.1', '0.3.0-rc.1', '0.3.0']) {
      assert.equal(satisfies(version, range), false, `${range} must reject ${version}`)
    }
  }
})
