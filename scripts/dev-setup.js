// Run after `node scripts/prepare-workspace.js` (or `npm run build`) has mounted
// the plugin sources in the dsh checkout.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dshRoot = resolve(process.env.DSH_SOURCE ?? join(root, '../deepseek-harness'))
const compiler = join(dshRoot, 'node_modules/typescript/bin/tsc')
if (!existsSync(compiler)) throw new Error(`Run pnpm install in ${dshRoot} first`)

// Build real declarations through the upstream project graph, including Cordis
// service augmentations. Local editor configs resolve these package exports.
execFileSync(process.execPath, [compiler, '-b',
  'packages/tui/tui-render/tsconfig.json', 'packages/tui/tui/tsconfig.json',
  'packages/boot/app-boot/tsconfig.json', 'packages/llm/llm-pi-ai/tsconfig.json',
  'packages/sandbox/sandbox-policy/tsconfig.json', 'packages/test-support/agent-loop-testkit/tsconfig.json',
], { cwd: dshRoot, stdio: 'inherit' })
// Source imports also consume generated /typert package exports at runtime.
execFileSync(process.execPath, ['--import', 'tsx/esm', 'scripts/generate-typert.ts'], {
  cwd: dshRoot, stdio: 'inherit',
})

for (const [local, upstream] of [
  ['', ''], ['tui', 'packages/tui/tui'], ['tui-render', 'packages/tui/tui-render'],
]) {
  const source = join(dshRoot, upstream, 'node_modules')
  const destination = join(root, local, 'node_modules')
  if (!existsSync(source)) throw new Error(`Missing ${source}; run pnpm install in the checkout`)
  // A directory link preserves pnpm's relative links; never copy its entries
  // or remove a developer's existing installation.
  if (!existsSync(destination)) {
    mkdirSync(join(root, local), { recursive: true })
    symlinkSync(source, destination, 'junction')
  }
}
console.log('Editor dependencies and upstream declarations are ready.')

