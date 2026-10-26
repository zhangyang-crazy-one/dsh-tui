/** Shared, fail-closed verification chain. DSH_SOURCE is a read-only clone source. */
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { COMPATIBLE_DSH_VERSION } from '../src/launcher.js'
import { build } from './build.js'

export const repositoryRoot = resolve(import.meta.dirname, '..')
const marker = '.dsh-tui-workspace.json'
const statePath = root => join(root, '.runtime/validation/workspace.json')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
export const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options })
  if (result.error || result.status !== 0) throw new Error(`${basename(command)} ${args.join(' ')} failed (${result.status ?? result.signal})`, { cause: result.error })
  return result
}

function assertNoSymlink(path) {
  let current = resolve(path)
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink in isolated workspace path: ${current}`)
    const parent = dirname(current)
    if (current === parent) break
    current = parent
  }
}

function assertOwned(dshRoot, root) {
  assertNoSymlink(dshRoot)
  if (!existsSync(join(dshRoot, marker)) || json(join(dshRoot, marker)).root !== resolve(root)) {
    throw new Error(`Not a tool-owned isolated DSH workspace: ${dshRoot}`)
  }
}

/** Replace only entries below a freshly created, owned clone; never a developer checkout. */
export function mountSources(root, dshRoot) {
  assertOwned(dshRoot, root)
  const source = sourceIdentity(root)
  assertNoSymlink(join(dshRoot, 'packages/tui'))
  for (const name of ['tui', 'tui-render']) {
    const destination = join(dshRoot, 'packages/tui', name)
    assertNoSymlink(destination)
    mkdirSync(destination, { recursive: true })
    for (const entry of ['src', 'tests', 'package.json', 'tsconfig.json']) {
      const source = join(root, name, entry === 'tsconfig.json' ? 'tsconfig.workspace.json' : entry)
      // Unlink a mirrored symlink itself; cp never follows a pre-existing destination.
      rmSync(join(destination, entry), { force: true, recursive: true })
      if (existsSync(source)) cpSync(source, join(destination, entry), { recursive: true, verbatimSymlinks: true })
    }
    // The four standalone checks use the repository configs, not stale declarations.
    cpSync(join(root, name, 'tsconfig.json'), join(destination, 'tsconfig.check.json'))
    if (name === 'tui-render') {
      const manifest = json(join(destination, 'package.json'))
      manifest.main = './src/index.ts'
      manifest.exports['.'].default = './src/index.ts'
      writeJson(join(destination, 'package.json'), manifest)
    }
  }
  for (const entry of ['presets', 'cordis.patch.yml']) {
    const destination = join(dshRoot, 'packages/tui', entry)
    rmSync(destination, { force: true, recursive: true })
    cpSync(join(root, entry), destination, { recursive: true })
  }
  if (JSON.stringify(source) !== JSON.stringify(sourceIdentity(root))) throw new Error('Repository source changed during mounting')
  const snapshot = { root: resolve(root), source, mounted: mountedIdentity(dshRoot) }
  writeJson(join(dshRoot, marker), snapshot)
  return snapshot
}

export function prepareWorkspace({ root = repositoryRoot, source = process.env.DSH_SOURCE ?? (existsSync(join(root, '../deepseek-harness')) ? join(root, '../deepseek-harness') : 'https://github.com/deepseek-ai/deepseek-harness.git'), tempRoot = tmpdir() } = {}) {
  const directory = mkdtempSync(join(realpathSync(tempRoot), 'dsh-tui-validation-'))
  const dshRoot = join(directory, 'dsh')
  // Local clone reads committed objects only, so dirty/untracked donor files cannot leak in.
  git(directory, ['clone', '--no-hardlinks', '--branch', `dsh-v${COMPATIBLE_DSH_VERSION}`, '--single-branch', source, dshRoot])
  const manifest = json(join(dshRoot, 'package.json'))
  if (manifest.version !== COMPATIBLE_DSH_VERSION) throw new Error(`Incompatible DSH ${manifest.version}`)
  const workspace = { directory, dshRoot, root: resolve(root), dshVersion: manifest.version,
    dshCommit: git(dshRoot, ['rev-parse', 'HEAD']), upstreamLock: hashFile(join(dshRoot, 'pnpm-lock.yaml')) }
  assertLockProvenance(workspace)
  writeJson(join(dshRoot, marker), { root: resolve(root) })
  workspace.source = mountSources(root, dshRoot).source
  return workspace
}

export function toolIdentity(dshRoot, name) {
  // An exact workspace link (created by frozen install), never a scan of store versions.
  const manifestPath = realpathSync(join(dshRoot, 'node_modules', name, 'package.json'))
  const manifest = json(manifestPath)
  const pins = join(dshRoot, 'packages/tui/validation-tools/package.json')
  if (existsSync(pins) && json(pins).devDependencies?.[name] !== manifest.version) throw new Error(`Pinned tool identity mismatch: ${name}@${manifest.version}`)
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name === 'typescript' ? 'tsc' : name]
  if (!bin) throw new Error(`Missing executable for ${name}`)
  const path = realpathSync(join(dirname(manifestPath), bin))
  return { name, version: manifest.version, path, manifestSha256: hashFile(manifestPath), sha256: hashFile(path) }
}

export function assertLockProvenance(workspace, installed = false) {
  const pins = json(join(workspace.root, 'scripts/validation-tools.json')).dshValidation
  if (!pins) throw new Error('Missing lock patch provenance; regenerate validation-tools.json metadata')
  if (pins.version !== COMPATIBLE_DSH_VERSION || pins.version !== workspace.dshVersion) throw new Error('Lock patch DSH version mismatch; regenerate the lock patch and metadata')
  if (pins.commit !== workspace.dshCommit || pins.commit !== git(workspace.dshRoot, ['rev-parse', 'HEAD'])) throw new Error('Lock patch DSH commit mismatch')
  if (pins.patchSha256 !== hashFile(join(workspace.root, 'scripts/validation-lock.patch'))) throw new Error('Lock patch hash mismatch')
  const expected = installed ? pins.installedLockSha256 : pins.upstreamLockSha256
  if (hashFile(join(workspace.dshRoot, 'pnpm-lock.yaml')) !== expected) throw new Error(`Lock patch ${installed ? 'installed' : 'upstream'} lock hash mismatch`)
}

export function assertWorkspaceCurrent(workspace) {
  const { root, dshRoot } = workspace
  assertOwned(dshRoot, root)
  const snapshot = json(join(dshRoot, marker))
  if (!snapshot.source || JSON.stringify(snapshot.source) !== JSON.stringify(workspace.source) || JSON.stringify(snapshot.source) !== JSON.stringify(sourceIdentity(root))) throw new Error('Repository source changed; validation workspace source mismatch')
  if (snapshot.mounted !== mountedIdentity(dshRoot)) throw new Error('Mounted source mirror changed during validation')
  assertLockProvenance(workspace, Boolean(workspace.lock))
  // Only the reviewed dependency lock and mounted plugin files may differ from the tag.
  git(dshRoot, ['diff', '--exit-code', 'HEAD', '--', '.', ':(exclude)pnpm-lock.yaml', ':(exclude)packages/tui/**'])
}

export function installDependencies(workspace, { offline = process.env.DSH_TUI_OFFLINE === '1', persist = true } = {}) {
  const { root, dshRoot } = workspace
  assertOwned(dshRoot, root)
  const lock = join(root, 'scripts/validation-lock.patch')
  // The patch includes the reviewed plugin closure and necessary peer snapshots.
  assertLockProvenance(workspace)
  git(dshRoot, ['apply', lock])
  assertLockProvenance(workspace, true)
  const manager = json(join(dshRoot, 'package.json')).packageManager
  const toolManifest = json(join(root, 'scripts/validation-tools.json'))
  writeJson(join(dshRoot, 'packages/tui/validation-tools/package.json'), toolManifest)
  const pnpm = process.env.DSH_TUI_PNPM ?? 'pnpm'
  const version = run(pnpm, ['--version'], { cwd: dshRoot, stdio: 'pipe' }).stdout.trim()
  if (`pnpm@${version}` !== manager) throw new Error(`Expected ${manager}, got pnpm@${version}; activate the upstream packageManager first`)
  workspace.pnpm = { version, executable: pnpm }
  run(pnpm, ['install', '--frozen-lockfile', ...(offline ? ['--offline'] : []),
    ...(process.env.DSH_TUI_STORE_DIR ? ['--store-dir', process.env.DSH_TUI_STORE_DIR] : []),
    '--filter', '@dsh-tui/validation-tools', '--filter', '@deepseek-ai/dsh-tui...',
    '--filter', '@deepseek-ai/dsh-app-boot...', '--filter', '@deepseek-ai/dsh-llm-pi-ai...',
    '--filter', '@deepseek-ai/dsh-sandbox-policy...', '--filter', '@deepseek-ai/dsh-agent-loop-testkit...',
    '--filter', '@deepseek-ai/dsh-typert-generator...',
  ], { cwd: dshRoot })
  // Expose only the pinned engineering tools at the clone root.
  const toolsRoot = join(dshRoot, 'packages/tui/validation-tools')
  for (const name of Object.keys(toolManifest.devDependencies)) {
    const destination = join(dshRoot, 'node_modules', name)
    if (!existsSync(destination)) {
      // A relative directory link stays inside this isolated install.
      symlinkSync(join(toolsRoot, 'node_modules', name), destination, 'junction')
    }
  }
  for (const [name, version] of Object.entries(toolManifest.devDependencies)) {
    const installed = json(join(dshRoot, 'node_modules', name, 'package.json'))
    if (installed.version !== version) throw new Error(`Expected ${name}@${version}, got ${installed.version}`)
  }
  assertWorkspaceCurrent({ ...workspace, lock: hashFile(join(dshRoot, 'pnpm-lock.yaml')) })
  workspace.preparation = preparationIdentity(root)
  workspace.lock = hashFile(join(dshRoot, 'pnpm-lock.yaml'))
  workspace.tools = Object.fromEntries(['esbuild', 'typescript', 'vitest', 'tsx'].map(name => [name, toolIdentity(dshRoot, name)]))
  if (persist) {
    assertNoSymlink(dirname(statePath(root)))
    writeJson(statePath(root), workspace)
  }
  return workspace
}

function preparationIdentity(root) {
  return createHash('sha256').update(JSON.stringify([COMPATIBLE_DSH_VERSION, ...['scripts/validation-tools.json', 'scripts/validation-lock.patch', 'tui/package.json', 'tui-render/package.json'].map(path => hashFile(join(root, path)))])).digest('hex')
}

export function currentWorkspace(root = repositoryRoot) {
  if (!existsSync(statePath(root))) return installDependencies(prepareWorkspace({ root }))
  const workspace = json(statePath(root))
  if (workspace.preparation !== preparationIdentity(root)) return installDependencies(prepareWorkspace({ root }))
  assertOwned(workspace.dshRoot, root)
  return workspace
}

export function setupDeclarations(workspace) {
  const { dshRoot } = workspace
  assertWorkspaceCurrent(workspace)
  run(process.execPath, [toolIdentity(dshRoot, 'typescript').path, '-b',
    'packages/tui/tui-render/tsconfig.json', 'packages/tui/tui/tsconfig.json',
    'packages/boot/app-boot/tsconfig.json', 'packages/llm/llm-pi-ai/tsconfig.json',
    'packages/sandbox/sandbox-policy/tsconfig.json', 'packages/test-support/agent-loop-testkit/tsconfig.json',
    'packages/goal/goal-round-driver/tsconfig.json',
  ], { cwd: dshRoot })
  run(process.execPath, ['--import', 'tsx/esm', 'scripts/generate-typert.ts'], { cwd: dshRoot })
  assertWorkspaceCurrent(workspace)
}

export function setupNative(workspace) {
  assertWorkspaceCurrent(workspace)
  const { dshRoot } = workspace
  const script = 'native/system/scripts/build.ts'
  run(process.execPath, ['--import', 'tsx/esm', script, '--host-addon-only'], { cwd: dshRoot })
  const nativeRoot = join(dshRoot, 'native/system/packages')
  const binaries = {}
  const collect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (entry.name.endsWith('.node')) binaries[relative(dshRoot, path)] = hashFile(path)
    }
  }
  collect(nativeRoot)
  workspace.native = { scriptSha256: hashFile(join(dshRoot, script)), binaries }
  assertWorkspaceCurrent(workspace)
}

export function checkTypes(workspace) {
  assertWorkspaceCurrent(workspace)
  const { dshRoot } = workspace
  const compiler = toolIdentity(dshRoot, 'typescript').path
  // Tests extend ../tsconfig.json; use a check-only copy of both packages.
  const checkRoot = join(workspace.directory, 'typecheck')
  mkdirSync(checkRoot, { recursive: true })
  for (const name of ['tui', 'tui-render']) {
    const from = join(dshRoot, 'packages/tui', name)
    const to = join(checkRoot, name)
    mkdirSync(to, { recursive: true })
    for (const entry of ['src', 'tests']) {
      rmSync(join(to, entry), { force: true, recursive: true })
      cpSync(join(from, entry), join(to, entry), { recursive: true })
    }
    cpSync(join(from, 'tsconfig.check.json'), join(to, 'tsconfig.json'))
    if (!existsSync(join(to, 'node_modules'))) {
      symlinkSync(join(from, 'node_modules'), join(to, 'node_modules'), 'junction')
    }
  }
  if (!existsSync(join(checkRoot, 'node_modules'))) {
    symlinkSync(join(dshRoot, 'node_modules'), join(checkRoot, 'node_modules'), 'junction')
  }
  for (const project of ['tui-render', 'tui', 'tui-render/tests', 'tui/tests']) {
    run(process.execPath, [compiler, '--noEmit', '-p', join(checkRoot, project, 'tsconfig.json')], { cwd: checkRoot })
  }
  assertWorkspaceCurrent(workspace)
  console.log('Plugin sources and tests passed strict type checking (4 projects).')
}

export function assertTestReport(report) {
  if (report.success === false || (report.numFailedTests ?? 0) > 0 || (report.numFailedTestSuites ?? 0) > 0) throw new Error('Test report contains failures')
  if (!(report.numTotalTests > 0) || !(report.numPassedTests > 0)) throw new Error('Test gate collected zero passed tests')
  return { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests ?? 0, skipped: report.numPendingTests ?? 0 }
}

export function runRootTests(root, evidence) {
  const tests = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.js')).sort().map(name => join(root, 'tests', name))
  if (tests.length === 0) throw new Error('No root test files (zero tests)')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  writeFileSync(join(evidence, 'root-tests.tap'), `${result.stdout ?? ''}${result.stderr ?? ''}`)
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error || result.status !== 0) throw new Error(`Root tests failed (${result.status})`)
  const passed = Number(result.stdout.match(/^# pass (\d+)$/mu)?.[1] ?? 0)
  const total = Number(result.stdout.match(/^# tests (\d+)$/mu)?.[1] ?? 0)
  return assertTestReport({ numTotalTests: total, numPassedTests: passed, numFailedTests: 0 })
}

export function runTuiTests(workspace, { vitest = toolIdentity(workspace.dshRoot, 'vitest').path, config } = {}) {
  if (workspace.root) assertWorkspaceCurrent(workspace)
  const { dshRoot, directory } = workspace
  const report = join(directory, 'tui-tests.json')
  rmSync(report, { force: true })
  run(process.execPath, [vitest, 'run', ...(config ? ['--config', config] : []),
    'packages/tui/tui/tests', 'packages/tui/tui-render/tests', '--maxWorkers', '2',
    '--passWithNoTests=false', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`,
  ], { cwd: dshRoot })
  const result = json(report)
  const counts = assertTestReport(result)
  const expected = []
  const collect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)) expected.push(resolve(path))
    }
  }
  for (const name of ['tui', 'tui-render']) collect(join(dshRoot, 'packages/tui', name, 'tests'))
  const collected = new Set((result.testResults ?? []).map(suite => resolve(suite.name)))
  if (expected.length === 0 || expected.some(path => !collected.has(path))) throw new Error('Incomplete TUI test collection; a current source test was omitted')
  if (workspace.root) assertWorkspaceCurrent(workspace)
  return { ...counts, files: collected.size }
}

const sourcePaths = ['tui', 'tui-render', 'src', 'bin', 'plugins', 'scripts', 'tests', '.github/workflows',
  'presets', 'assets', 'package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'CHANGELOG.md']
function treeIdentity(root, paths, ignored = new Set()) {
  const hash = createHash('sha256')
  const visit = (path) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Source symlinks are not supported in verification: ${path}`)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (!ignored.has(relative(root, join(path, name)))) visit(join(path, name))
    } else if (stat.isFile() && !path.endsWith('.tsbuildinfo')) {
      hash.update(relative(root, path)); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0')
    }
  }
  for (const path of paths) if (existsSync(join(root, path))) visit(join(root, path))
  return hash.digest('hex')
}

function mountedIdentity(dshRoot) {
  return treeIdentity(dshRoot, ['packages/tui/tui/src', 'packages/tui/tui/tests', 'packages/tui/tui/package.json', 'packages/tui/tui/tsconfig.json', 'packages/tui/tui/tsconfig.check.json',
    'packages/tui/tui-render/src', 'packages/tui/tui-render/tests', 'packages/tui/tui-render/package.json', 'packages/tui/tui-render/tsconfig.json', 'packages/tui/tui-render/tsconfig.check.json', 'packages/tui/presets', 'packages/tui/cordis.patch.yml'])
}

export function sourceIdentity(root) {
  const ignored = new Set(['tui', 'tui-render'].flatMap(name => ['node_modules', 'lib', '.cache', '.vite', 'coverage'].map(entry => join(name, entry))))
  const sha256 = treeIdentity(root, sourcePaths, ignored)
  let commit = null
  try { commit = git(root, ['rev-parse', 'HEAD']) } catch { /* fixtures may have no git metadata */ }
  return { commit, sha256 }
}

export function checkDependencies(root, dshRoot) {
  // Every imported runtime package in the bundle patch must be declared by the distributable.
  const require = createRequire(join(dshRoot, 'package.json'))
  const yaml = require('js-yaml')
  const schema = yaml.DEFAULT_SCHEMA.extend([new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => value })])
  const manifest = json(join(root, 'package.json'))
  for (const filename of ['cordis.patch.yml', ...readdirSync(join(root, 'presets')).filter(name => name.endsWith('.yml')).map(name => `presets/${name}`)]) {
    const text = readFileSync(join(root, filename), 'utf8')
    const names = []
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') {
        if (typeof value.name === 'string') {
          const name = value.name.match(/^(@deepseek-ai\/[a-z\d-]+)/u)?.[1]
          if (name) names.push(name)
        }
        Object.values(value).forEach(visit)
      }
    }
    visit(yaml.load(text, { schema }))
    for (const name of names) {
      if (['@deepseek-ai/dsh-tui', '@deepseek-ai/dsh-tui-render'].includes(name)) continue
      if (!manifest.dependencies?.[name] && !manifest.peerDependencies?.[name]) throw new Error(`Undeclared bundle dependency ${name} in ${filename}`)
    }
  }
}

export function packAndImport(root, directory, { bundles = {} } = {}) {
  const result = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory], { cwd: root, stdio: 'pipe' })
  const [packed] = JSON.parse(result.stdout)
  const tarball = join(directory, packed.filename)
  const unpacked = join(directory, 'packed')
  mkdirSync(unpacked)
  run('tar', ['-xzf', tarball, '-C', unpacked])
  const packageRoot = join(unpacked, 'package')
  const manifest = json(join(packageRoot, 'package.json'))
  for (const [name, expected] of Object.entries(bundles)) {
    if (basename(name) !== name || hashFile(join(packageRoot, 'dist', name)) !== expected) throw new Error(`Packed bundle hash mismatch: ${name}`)
  }
  for (const name of ['runtime', 'startup', 'settings', 'schedule', 'zen-proxy']) {
    const entry = manifest.exports[`./${name}`]
    if (typeof entry !== 'string' || !existsSync(join(packageRoot, entry))) throw new Error(`Missing packed entrypoint ${name}`)
    run(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(packageRoot, entry)).href)})`], { cwd: packageRoot })
  }
  return { filename: packed.filename, sha256: hashFile(tarball) }
}

export function verifyArtifact(root, provenance) {
  const record = json(provenance)
  if (record.schema !== 1 || record.status !== 'verified' || !(record.tests?.root?.passed > 0) || !(record.tests?.tui?.passed > 0)) throw new Error('Artifact has no successful verification record')
  if (JSON.stringify(record.source) !== JSON.stringify(sourceIdentity(root))) throw new Error('Verified source identity mismatch')
  for (const name of ['index.js', 'startup.js', 'settings.js', 'schedule.js', 'zen-proxy.js']) {
    if (!record.bundles?.[name]) throw new Error(`Missing verified bundle hash: ${name}`)
  }
  for (const [filename, expected] of Object.entries(record.bundles)) {
    if (basename(filename) !== filename || hashFile(join(root, 'dist', filename)) !== expected) throw new Error(`Verified bundle hash mismatch: ${filename}`)
  }
  if (basename(record.tarball.filename) !== record.tarball.filename) throw new Error('Invalid tarball name')
  const tarball = join(dirname(provenance), record.tarball.filename)
  if (hashFile(tarball) !== record.tarball.sha256) throw new Error('Verified tarball hash mismatch')
  return tarball
}

function bundleHashes(root) {
  return Object.fromEntries(readdirSync(join(root, 'dist')).filter(name => name.endsWith('.js')).sort().map(name => [name, hashFile(join(root, 'dist', name))]))
}

export async function validate(root = repositoryRoot) {
  assertNoSymlink(join(root, '.runtime/validation'))
  rmSync(join(root, '.runtime/validation/verified.json'), { force: true })
  const source = sourceIdentity(root)
  const workspace = installDependencies(prepareWorkspace({ root }))
  console.log(`Validation workspace: ${workspace.directory}`)
  checkDependencies(root, workspace.dshRoot)
  setupDeclarations(workspace)
  setupNative(workspace)
  checkTypes(workspace)
  build(workspace)
  const bundles = bundleHashes(root)
  const tests = { root: runRootTests(root, workspace.directory), tui: runTuiTests(workspace) }
  assertWorkspaceCurrent(workspace)
  if (JSON.stringify(bundles) !== JSON.stringify(bundleHashes(root))) throw new Error('Built bundle hashes changed during testing')
  const tarball = packAndImport(root, workspace.directory, { bundles })
  assertWorkspaceCurrent(workspace)
  if (JSON.stringify(source) !== JSON.stringify(sourceIdentity(root))) throw new Error('Source changed during validation; rerun against a stable source tree')
  if (JSON.stringify(bundles) !== JSON.stringify(bundleHashes(root))) throw new Error('Built bundle hashes changed during packing')
  const record = { schema: 1, status: 'verified', source, dsh: { version: workspace.dshVersion, commit: workspace.dshCommit, upstreamLock: workspace.upstreamLock, lock: workspace.lock },
    node: { version: process.version, executableSha256: hashFile(process.execPath) }, pnpm: workspace.pnpm, tools: workspace.tools, native: workspace.native, tests, bundles, tarball }
  const provenance = join(workspace.directory, 'provenance.json')
  writeJson(provenance, record)
  verifyArtifact(root, provenance)
  writeJson(join(root, '.runtime/validation/verified.json'), { provenance })
  console.log(`Verified artifact: ${join(workspace.directory, tarball.filename)}\nProvenance: ${provenance}`)
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `tarball=${join(workspace.directory, tarball.filename)}\nprovenance=${provenance}\n`, { flag: 'a' })
  return record
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const action = process.argv[2] ?? 'validate'
  if (action === 'prepare') {
    const workspace = installDependencies(prepareWorkspace())
    console.log(`Prepared current sources: ${workspace.dshRoot}`)
  } else if (action === 'verify-artifact') {
    const provenance = process.argv[3] ?? json(join(repositoryRoot, '.runtime/validation/verified.json')).provenance
    console.log(verifyArtifact(repositoryRoot, resolve(provenance)))
  } else if (action === 'test-tui') {
    const workspace = currentWorkspace()
    workspace.source = mountSources(repositoryRoot, workspace.dshRoot).source
    setupDeclarations(workspace)
    setupNative(workspace)
    console.log(runTuiTests(workspace))
  } else if (action === 'validate') await validate()
  else throw new Error(`Unknown validation action: ${action}`)
}
