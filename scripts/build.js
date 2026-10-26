/** Bundle current plugin sources only inside a tool-owned compatible DSH clone. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { assertWorkspaceCurrent, currentWorkspace, mountSources, repositoryRoot, run, setupDeclarations, toolIdentity } from './validation.js'

export function build(workspace) {
  const { root: packageRoot, dshRoot, directory } = workspace
  assertWorkspaceCurrent(workspace)
  const esbuild = toolIdentity(dshRoot, 'esbuild').path
  const devtoolsStub = join(directory, 'react-devtools-core-stub.js')
  writeFileSync(devtoolsStub, 'export default { initialize() {}, connectToDevTools() {} };\n')
  const banner = "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
  const targets = [
    { entry: join(dshRoot, 'packages/tui/tui/src/index.ts'), out: 'index.js', extra: [`--alias:react-devtools-core=${devtoolsStub}`] },
    { entry: join(dshRoot, 'packages/tui/tui/src/startup.ts'), out: 'startup.js' },
    { entry: join(dshRoot, 'packages/tui/tui/src/user-settings.ts'), out: 'settings.js' },
    { entry: join(dshRoot, 'packages/tui/tui/src/schedule.ts'), out: 'schedule.js' },
    { entry: join(packageRoot, 'plugins/zen-proxy/index.js'), out: 'zen-proxy.js' },
  ]
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  for (const target of targets) {
    const outfile = join(packageRoot, 'dist', target.out)
    console.log(`Building dist/${target.out}...`)
    run(esbuild, [target.entry, '--bundle', '--platform=node', '--format=esm', '--target=es2022',
      `--tsconfig=${join(dshRoot, 'tsconfig.base.json')}`,
      `--banner:js=${banner}`, `--outfile=${outfile}`, ...(target.extra ?? [])], { cwd: dshRoot })
    run(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(outfile)};`], { cwd: directory })
  }
  assertWorkspaceCurrent(workspace)
  console.log(`dsh-tui bundle built against dsh ${workspace.dshVersion}.`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const workspace = currentWorkspace(repositoryRoot)
  workspace.source = mountSources(repositoryRoot, workspace.dshRoot).source
  setupDeclarations(workspace)
  build(workspace)
}
