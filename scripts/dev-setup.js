/** Prepare declarations in the isolated clone. Existing editor links are never replaced. */
import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { currentWorkspace, mountSources, repositoryRoot, setupDeclarations } from './validation.js'

const workspace = currentWorkspace()
workspace.source = mountSources(repositoryRoot, workspace.dshRoot).source
setupDeclarations(workspace)
for (const [local, upstream] of [['', ''], ['tui', 'packages/tui/tui'], ['tui-render', 'packages/tui/tui-render']]) {
  const destination = join(repositoryRoot, local, 'node_modules')
  let present = existsSync(destination)
  if (!present) { try { lstatSync(destination); present = true } catch {} }
  if (!present) {
    mkdirSync(dirname(destination), { recursive: true })
    symlinkSync(join(workspace.dshRoot, upstream, 'node_modules'), destination, 'junction')
  }
}
console.log(`Declarations ready in ${workspace.dshRoot}; existing editor links preserved.`)
