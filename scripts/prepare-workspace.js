/** Mount candidate plugin sources without rebuilding release bundles. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { COMPATIBLE_DSH_VERSION } from '../src/launcher.js'

export function prepareWorkspace(packageRoot, dshRoot) {
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
  return dshVersion
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packageRoot = resolve(import.meta.dirname, '..')
  const dshRoot = resolve(process.env.DSH_SOURCE ?? resolve(packageRoot, '../deepseek-harness'))
  prepareWorkspace(packageRoot, dshRoot)
}
