import { checkTypes, currentWorkspace, mountSources, repositoryRoot, setupDeclarations } from './validation.js'

const workspace = currentWorkspace()
workspace.source = mountSources(repositoryRoot, workspace.dshRoot).source
setupDeclarations(workspace)
checkTypes(workspace)
