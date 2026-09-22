/** Rebuild the release from the sibling Harness checkout and its supported bundler. */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { releasePatch } from '../src/release-patch.js'

const packageRoot = resolve(import.meta.dirname, '..')
const harnessRoot = resolve(packageRoot, '../deepseek-harness')
// The Harness bundler writes to ../dsh-tui; fail before touching another checkout.
if (realpathSync(resolve(harnessRoot, '../dsh-tui')) !== realpathSync(packageRoot)) {
  throw new Error('The Harness bundler must target this dsh-tui checkout')
}
execFileSync('pnpm', ['exec', 'tsx', 'scripts/build-dsh-tui-bundle.ts'], {
  cwd: harnessRoot,
  stdio: 'inherit',
})
const source = readFileSync(resolve(harnessRoot, 'packages/tui/tui/cordis.patch.yml'), 'utf8')
const rootPatch = releasePatch(source, './dist')
const fallbackPatch = releasePatch(source, '../dist')
writeFileSync(resolve(packageRoot, 'cordis.patch.yml'), rootPatch)
writeFileSync(resolve(packageRoot, 'tui/cordis.patch.yml'), fallbackPatch)
console.log('Release patches generated from the Harness TUI composition.')
