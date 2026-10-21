/** Boot the published patch composition with local runtimes and an empty, disposable profile.
 * Run: node docs/full-preset-boot.mjs [--source] [path/to/deepseek-harness]
 * No prompt or model request is submitted. Network fetches are rejected and counted.
 *
 * Artifact preparation used for the local rc.2 checkout (run in its root):
 *   node node_modules/typescript/bin/tsc -b packages/api/remote-access/tsconfig.host.json packages/web/web-deepseek-api/tsconfig.json packages/boot/plugin-market/tsconfig.json
 *   node node_modules/typescript/bin/tsc -b --force packages/fs/tool-fs/tsconfig.json
 * Remote-access and plugin-market were bundled with their package-local official
 * tsdown configs. Protocol, market-index, web API and tool-fs used this official
 * tsdown API invocation; explicit .js output matches their published exports:
 *
 *   node --input-type=module <<'BUILD'
 *   import { createRequire } from 'node:module'
 *   const root = process.cwd()
 *   const require = createRequire(root + '/package.json')
 *   const { build } = await import(require.resolve('tsdown'))
 *   for (const path of ['packages/typert/protocol', 'packages/util/plugin-market-index', 'packages/web/web-deepseek-api', 'packages/fs/tool-fs']) {
 *     await build({ config: false, cwd: root + '/' + path, entry: ['lib/types/index.js'],
 *       outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', dts: false,
 *       clean: false, outExtensions: () => ({ js: '.js' }),
 *       deps: { neverBundle: [/^@deepseek-ai\//] } })
 *   }
 *   BUILD
 *
 * Force-emitting tool-fs matters when an old lib/types output lacks the rc.2
 * read/readImage/write/edit switches: it otherwise makes minimal appear to have
 * editing tools even though the checked source and declaration prohibit them.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyPresets } from './preset-boot-contract.mjs'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const upstream = resolve(args.find(arg => !arg.startsWith('--')) ?? join(project, '../deepseek-harness'))
const source = args.includes('--source')
const disabled = ['tui-runtime', 'tui-startup', 'webserver', 'zen-proxy', 'hmr', 'session-telemetry-otel']
const require = createRequire(join(upstream, 'package.json'))

if (args.includes('--isolated')) {
  await verifyBuilt()
} else {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tui-profile-presets-'))
  try {
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    const profile = join(home, 'profiles', 'tui')
    const target = join(profile, 'node_modules', manifest.name)
    await mkdir(dirname(target), { recursive: true })
    // This is the only profile package link. All bare plugins must resolve via
    // the real CLI installation closure and PluginPackages, not fixture links.
    await symlink(project, target, 'junction')
    await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true,
      dependencies: { [manifest.name]: `link:${project}` },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', manifest.name] } },
    }))
    await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
    await writeFile(join(profile, 'cordis.yml'), '[]\n')
    const env = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', TERM: 'dumb',
      DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
      DSH_TOOLS_MODE: 'native', TSX_TSCONFIG_PATH: join(upstream, 'tsconfig.base.json') }
    const childArgs = source ? await sourceArgs(home) : [fileURLToPath(import.meta.url), upstream, '--isolated']
    const result = spawnSync(process.execPath, childArgs, { cwd: home, env,
      stdio: ['ignore', 'inherit', 'inherit'], timeout: 60000 })
    if (result.error !== undefined) throw result.error
    assert.equal(result.signal, null, 'boot was terminated')
    assert.equal(result.status, 0, `${source ? 'source CLI' : 'built AppBoot'} preset composition failed`)
  } finally { await rm(home, { recursive: true, force: true }) }
}

function overrides(home) {
  return [
    ...disabled.map(id => ({ id, disabled: true })),
    { id: 'credentials', config: { path: join(home, '.credentials.yaml'), dshHome: home, watch: false } },
    { id: 'storage-json', config: { root: join(home, 'storages') } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions') } },
    { id: 'attachment-local', config: { dshHome: home } },
    { id: 'session-query-sqlite', config: { path: ':memory:', openAt: 'never' } },
    { id: 'tools', config: { mode: 'native' } },
    { id: 'fs-sandbox', config: { cwd: home } },
  ]
}

async function metadata() {
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  const version = JSON.parse(await readFile(join(upstream, 'package.json'), 'utf8')).version
  assert.equal(version, '0.2.1-rc.2')
  const patches = manifest.dsh.bundle.patch
  assert.ok(Array.isArray(patches), 'dsh.bundle.patch must contain the full ordered patch list')
  for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
    assert.ok(patches.includes(`./presets/${id}.patch.yml`), `bundle does not include ${id}`)
  }
  return { dsh: version, patchFiles: patches, disabledSurfaceRows: disabled, profileBundleLinks: 1 }
}

function resolutionEvidence(resolution) {
  const names = ['@deepseek-ai/dsh-agent-preset-registry', '@deepseek-ai/dsh-plugin-market', '@deepseek-ai/dsh-persona']
  const resolved = resolution.entries.filter(entry => names.includes(entry.name))
  for (const name of names) assert.ok(resolved.some(entry => entry.name === name), `missing runtime mapping: ${name}`)
  return { entries: resolution.entries.length, linkedRoots: resolution.linkedRoots, resolved }
}

async function verifyBuilt() {
  const home = process.cwd()
  assert.equal(home, process.env.DSH_HOME)
  const meta = await metadata()
  const { boot, auditStartupEntries, createRuntimeResolution, loadProfileDirectory, PluginPackages } =
    require(join(upstream, 'packages/boot/app-boot/lib/index.js'))
  const { provideCmdline } = require(join(upstream, 'packages/boot/cmdline/lib/index.js'))
  const installAnchor = join(upstream, 'apps/cli/package.json')
  const profile = loadProfileDirectory('preset-boot', join(home, 'profiles/tui'), installAnchor, { userLayer: false })
  assert.deepEqual(profile.skippedBundles, [])
  const resolution = await createRuntimeResolution({ installAnchor, profile, home })
  const requests = []
  globalThis.fetch = async () => { requests.push('fetch'); throw new Error('Offline verification blocked network') }
  let ctx
  try {
    ctx = await boot('preset-boot', join(profile.dir, 'cordis.yml'),
      [...profile.layers.flatMap(layer => layer.patches), ...overrides(home)], async context => {
        context.provide('profileContext', { name: 'tui', dir: profile.dir, patchPath: profile.patchPath,
          installAnchor, home, cwd: home, overlays: [], telemetryDisabledEnv: '1',
          startedBundles: profile.layers.map(layer => layer.packageName) })
        await context.plugin(PluginPackages, { resolution })
        provideCmdline(context, { args: [], exit() {} })
      })
    await auditStartupEntries(ctx, 'preset-boot', warning => { throw new Error(warning) })
    const evidence = resolutionEvidence(resolution)
    const checks = await verifyPresets(ctx, home, requests)
    console.log(JSON.stringify({ status: 'PASS', mode: 'built-appboot-profile-only', ...meta, ...evidence, ...checks }, null, 2))
  } finally { await ctx?.fiber.dispose() }
}

async function sourceArgs(home) {
  const meta = await metadata()
  const guard = join(home, 'offline-guard.mjs')
  await writeFile(guard, `export const requests = []\nglobalThis.fetch = async () => { requests.push('fetch'); throw new Error('Offline source verification blocked network') }\n`)
  const plugin = join(home, 'offline-verify.mjs')
  const contractUrl = new URL('./preset-boot-contract.mjs', import.meta.url).href
  const auditUrl = pathToFileURL(join(upstream, 'packages/boot/app-boot/src/index.ts')).href
  await writeFile(plugin, `
import assert from 'node:assert/strict'
import { verifyPresets } from ${JSON.stringify(contractUrl)}
import { auditStartupEntries } from ${JSON.stringify(auditUrl)}
import { requests } from ${JSON.stringify(pathToFileURL(guard).href)}
export const inject = ['appReady', 'appExit', 'agentPresets', 'agents', 'tools', 'systemPrompt', 'pluginPackages', 'commands', 'ptcRuntime', 'cordisInspect']
export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    void (async () => {
      try {
        await auditStartupEntries(ctx.root, 'preset-source', warning => { throw new Error(warning) })
        const resolutionEvidence = ${resolutionEvidence.toString()}
        const evidence = resolutionEvidence(ctx.pluginPackages.resolution)
        const checks = await verifyPresets(ctx, process.cwd(), requests)
        console.log(JSON.stringify({ status: 'PASS', mode: 'source-cli-profile-only', ...${JSON.stringify(meta)}, ...evidence, ...checks }, null, 2))
        ctx.appExit(0)
      } catch (error) { console.error(error); ctx.appExit(1) }
    })()
  }))
}
`)
  const patch = join(home, 'offline.patch.json')
  await writeFile(patch, JSON.stringify([...overrides(home), { insert: [{ id: 'offline-verification', name: plugin }] }]))
  return ['--import', require.resolve('tsx/esm'), '--import', guard,
    join(upstream, 'apps/cli/src/bin.ts'), '--profile', 'tui', '--patch', patch]
}
