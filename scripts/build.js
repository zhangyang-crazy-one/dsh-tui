/**
 * Build the release bundle from this repository's plugin sources.
 *
 * dsh-tui is a dsh plugin bundle: `tui/` and `tui-render/` are compiled against
 * an upstream dsh checkout (its workspace packages supply types and the
 * modules esbuild inlines). The checkout defaults to ../deepseek-harness at
 * the release tag named by COMPATIBLE_DSH_VERSION; DSH_SOURCE overrides it.
 * Run `pnpm install` in that checkout first.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { COMPATIBLE_DSH_VERSION } from '../src/launcher.js'

const packageRoot = resolve(import.meta.dirname, '..')
const dshRoot = resolve(process.env.DSH_SOURCE ?? resolve(packageRoot, '../deepseek-harness'))
let dshVersion
try {
  dshVersion = JSON.parse(readFileSync(join(dshRoot, 'package.json'), 'utf8')).version
} catch (cause) {
  throw new Error(`Cannot read dsh checkout manifest at ${dshRoot}`, { cause })
}
if (dshVersion !== COMPATIBLE_DSH_VERSION) {
  throw new Error(`dsh checkout ${dshRoot} is ${dshVersion}; check out dsh-v${COMPATIBLE_DSH_VERSION} first`)
}

// Mount the plugin packages into the checkout's workspace so their
// `@deepseek-ai/*` imports resolve to the matching upstream sources.
for (const name of ['tui', 'tui-render']) {
  const target = join(dshRoot, 'packages/tui', name)
  mkdirSync(target, { recursive: true })
  // Replace only mirrored entries; the package's pnpm links stay in place.
  for (const entry of ['src', 'tests', 'package.json', 'tsconfig.json']) {
    const from = join(packageRoot, name, entry === 'tsconfig.json' ? 'tsconfig.workspace.json' : entry)
    rmSync(join(target, entry), { recursive: true, force: true })
    if (existsSync(from)) cpSync(from, join(target, entry), { recursive: true })
  }
  // This is a source workspace mount, not an installed renderer release.
  // Resolve its package entry to the mirrored source for both esbuild and
  // Vitest; an existing lib/index.js in the checkout may belong to an older UI.
  if (name === 'tui-render') {
    const manifestPath = join(target, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.main = './src/index.ts'
    manifest.exports['.'].default = './src/index.ts'
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  }
}

// Package tests read the bundle patch beside the plugin packages.
cpSync(join(packageRoot, 'presets'), join(dshRoot, 'packages/tui/presets'), { recursive: true })
cpSync(join(packageRoot, 'cordis.patch.yml'), join(dshRoot, 'packages/tui/cordis.patch.yml'))

/** Newest esbuild in the checkout's pnpm store. */
function findEsbuild() {
  const store = join(dshRoot, 'node_modules/.pnpm')
  const versions = readdirSync(store).filter(name => /^esbuild@\d/u.test(name)).sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true }))
  const latest = versions.at(-1)
  if (latest === undefined) throw new Error(`esbuild is not installed in ${store}`)
  return join(store, latest, 'node_modules/esbuild/bin/esbuild')
}

const esbuild = findEsbuild()
const stubDir = join(dshRoot, 'node_modules/.cache')
mkdirSync(stubDir, { recursive: true })
const devtoolsStub = join(stubDir, 'react-devtools-core-stub.js')
writeFileSync(devtoolsStub, 'export default { initialize() {}, connectToDevTools() {} };\n')
const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"

const targets = [
  { entry: join(dshRoot, 'packages/tui/tui/src/index.ts'), out: 'index.js', extra: [`--alias:react-devtools-core=${devtoolsStub}`] },
  { entry: join(dshRoot, 'packages/tui/tui/src/startup.ts'), out: 'startup.js' },
  { entry: join(dshRoot, 'packages/tui/tui/src/user-settings.ts'), out: 'settings.js' },
  { entry: join(dshRoot, 'packages/tui/tui/src/schedule.ts'), out: 'schedule.js' },
  // Outside the workspace: borrow the checkout's source path aliases.
  { entry: join(packageRoot, 'plugins/zen-proxy/index.js'), out: 'zen-proxy.js', extra: [`--tsconfig=${join(dshRoot, 'tsconfig.base.json')}`] },
]
for (const target of targets) {
  const outfile = join(packageRoot, 'dist', target.out)
  console.log(`Building dist/${target.out}...`)
  execFileSync(esbuild, [
    target.entry, '--bundle', '--platform=node', '--format=esm', '--target=es2022',
    `--banner:js=${banner}`, `--outfile=${outfile}`, ...(target.extra ?? []),
  ], { cwd: dshRoot, stdio: 'inherit' })
  execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(outfile)};`], { stdio: 'inherit' })
}

console.log(`dsh-tui bundle built against dsh ${dshVersion}.`)
