import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')
if (!existsSync(compiler)) throw new Error('Run npm run build && npm run dev:setup first')
for (const project of ['tui-render', 'tui', 'tui-render/tests', 'tui/tests']) {
  execFileSync(process.execPath, [compiler, '--noEmit', '-p', join(root, project, 'tsconfig.json')], {
    cwd: root, stdio: 'inherit',
  })
}
console.log('Plugin sources and tests passed strict type checking (4 projects).')
