import { mkdirSync, readdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const ts = createRequire(resolve(process.cwd(), 'package.json'))('typescript')
const root = process.cwd()
const target = resolve(process.env.DSH_HISTORY_BASELINE ?? '/tmp/dsh-history-baseline')
mkdirSync(target + '/src', { recursive: true })
writeFileSync(target + '/package.json', '{"type":"module"}\n')
for (const file of readdirSync(root + '/tui-render/src')) {
  const path = target + '/src/' + file
  if (file === 'stream-view.tsx' || file === 'transcript-line-store.ts') {
    const source = execFileSync('git', ['show', 'HEAD:tui-render/src/' + file], { encoding: 'utf8' })
    writeFileSync(path, file.endsWith('.tsx') ? ts.transpileModule(source, { fileName: file,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 } }).outputText : source)
  } else if (!existsSync(path)) symlinkSync(root + '/tui-render/src/' + file, path)
}
for (const [path, source] of [[target + '/node_modules', root + '/node_modules'],
  [target + '/src/node_modules', root + '/tui-render/node_modules']]) if (!existsSync(path)) symlinkSync(source, path)
console.log(target + '/src')
