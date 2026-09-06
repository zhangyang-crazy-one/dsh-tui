/**
 * Hybrid runtime launcher for the DeepSeek Harness TUI.
 * Supports zero-clone lightweight launch via installed dsh, and source-runtime fallback.
 * @module @crazyhappyone/dsh-tui/launcher
 */

import { dirname, isAbsolute, join } from 'node:path'

const DEFAULT_SOURCE_URL = 'https://github.com/zhangyang-crazy-one/deepseek-harness.git'
const DEFAULT_SOURCE_REF = 'feat/deepseek-tui'

/** @typedef {'missing' | 'directory' | 'file' | 'symlink' | 'other'} PathKind */

/**
 * @typedef {object} LauncherSettings
 * @property {string} runtimeDirectory
 * @property {string} sourceUrl
 * @property {string} sourceRef
 * @property {string} packageManager
 * @property {string} [dshBin]
 * @property {'auto' | 'lightweight' | 'source'} [mode]
 * @property {string} [packageRoot]
 * @property {string} [homeDirectory]
 */

/**
 * @typedef {object} CommandResult
 * @property {number} status
 * @property {string} stdout
 * @property {string} stderr
 * @property {string | undefined} [signal]
 */

/**
 * @typedef {object} LauncherAdapters
 * @property {(path: string) => PathKind} inspectPath
 * @property {(path: string) => void} makeDirectory
 * @property {(path: string) => string} readText
 * @property {(path: string, content: string) => void} [writeText]
 * @property {(command: string, args: string[], options?: {cwd?: string, stdio?: 'inherit', capture?: boolean}) => CommandResult} run
 * @property {(text: string) => void} writeOut
 * @property {(text: string) => void} writeError
 */

/**
 * Parse the launcher's reserved management commands and flags.
 * @param {readonly string[]} argv - arguments after the executable.
 * @returns {{kind: 'version'} | {kind: 'update'} | {kind: 'probe'} | {kind: 'launch', args: string[], mode?: 'auto' | 'lightweight' | 'source'}}
 */
export function parseLauncherInvocation(argv) {
  if (argv[0] === '--') return { kind: 'launch', args: [...argv.slice(1)] }
  if (argv[0] === 'version') {
    if (argv.length !== 1) throw new Error('version takes no arguments; use `dsh-tui -- version ...` to send it as a task')
    return { kind: 'version' }
  }
  if (argv[0] === 'update') {
    if (argv.length !== 1) throw new Error('update takes no arguments; use `dsh-tui -- update ...` to send it as a task')
    return { kind: 'update' }
  }
  if (argv[0] === 'probe') {
    if (argv.length !== 1) throw new Error('probe takes no arguments; use `dsh-tui -- probe ...` to send it as a task')
    return { kind: 'probe' }
  }
  let mode = undefined
  const args = []
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (item === '--source') {
      mode = 'source'
    } else if (item === '--lightweight') {
      mode = 'lightweight'
    } else {
      args.push(item)
    }
  }
  return mode !== undefined ? { kind: 'launch', args, mode } : { kind: 'launch', args }
}

/**
 * Resolve deployment settings without touching the filesystem.
 * @param {{env: Readonly<Record<string, string | undefined>>, homeDirectory: string, packageRoot?: string}} input
 * @returns {LauncherSettings}
 */
export function resolveLauncherSettings({ env, homeDirectory, packageRoot }) {
  const runtimeDirectory = environmentValue(
    env,
    'DSH_TUI_RUNTIME_DIR',
    join(homeDirectory, '.local', 'share', 'dsh-tui', 'runtime'),
  )
  if (!isAbsolute(runtimeDirectory)) throw new Error('DSH_TUI_RUNTIME_DIR must be an absolute path')
  const envMode = env['DSH_TUI_MODE']
  if (envMode !== undefined && envMode !== 'auto' && envMode !== 'lightweight' && envMode !== 'source') {
    throw new Error(`DSH_TUI_MODE must be 'auto', 'lightweight', or 'source' (got '${envMode}')`)
  }
  const result = {
    runtimeDirectory,
    sourceUrl: environmentValue(env, 'DSH_TUI_SOURCE_URL', DEFAULT_SOURCE_URL),
    sourceRef: environmentValue(env, 'DSH_TUI_SOURCE_REF', DEFAULT_SOURCE_REF),
    packageManager: environmentValue(env, 'DSH_TUI_PNPM', 'pnpm'),
    homeDirectory,
  }
  if (env['DSH_BIN']?.trim()) result.dshBin = env['DSH_BIN'].trim()
  if (envMode) result.mode = envMode
  if (packageRoot) result.packageRoot = packageRoot
  return result
}

/**
 * Probe whether a runnable `dsh` command is available on the system.
 * @param {{env?: Readonly<Record<string, string | undefined>>, settings?: LauncherSettings, adapters: LauncherAdapters}} input
 * @returns {{ok: true, binPath: string, version: string} | {ok: false, reason: string}}
 */
export function probeInstalledDsh({ env = {}, settings, adapters }) {
  const explicit = settings?.dshBin ?? env['DSH_BIN']
  if (explicit && explicit.trim() !== '') {
    const trimmed = explicit.trim()
    const probe = adapters.run(trimmed, ['--version'], { capture: true })
    if (probe.status === 0) {
      return { ok: true, binPath: trimmed, version: probe.stdout.trim() || 'unknown' }
    }
    const err = probe.stderr.trim()
    return { ok: false, reason: `DSH_BIN is set to "${trimmed}" but failed to run${err ? `: ${err}` : ` (exit code ${probe.status})`}` }
  }

  const pathProbe = adapters.run('dsh', ['--version'], { capture: true })
  if (pathProbe.status === 0) {
    return { ok: true, binPath: 'dsh', version: pathProbe.stdout.trim() || 'unknown' }
  }

  return {
    ok: false,
    reason: 'dsh executable was not found in PATH or DSH_BIN',
  }
}

/**
 * Locate the bundled cordis.patch.yml within the package root.
 * @param {string | undefined} packageRoot
 * @param {LauncherAdapters} adapters
 * @returns {string | undefined}
 */
export function findBundledPatch(packageRoot, adapters) {
  if (!packageRoot || typeof packageRoot !== 'string') return undefined
  const candidates = [
    join(packageRoot, 'cordis.patch.yml'),
    join(packageRoot, 'tui', 'cordis.patch.yml'),
  ]
  for (const candidate of candidates) {
    if (adapters.inspectPath(candidate) === 'file') return candidate
  }
  return undefined
}

/**
 * Ensure the tui profile manifest exists in DSH_HOME.
 * @param {{homeDirectory?: string, env?: Readonly<Record<string, string | undefined>>, adapters: LauncherAdapters}} input
 */
export function ensureTuiProfile({ homeDirectory, env = {}, adapters }) {
  const dshHome = env['DSH_HOME'] || (homeDirectory ? join(homeDirectory, '.dsh') : undefined)
  if (!dshHome) return
  const profileDir = join(dshHome, 'profiles', 'tui')
  const manifestPath = join(profileDir, 'package.json')
  if (adapters.inspectPath(manifestPath) === 'file') return
  adapters.makeDirectory(profileDir)
  const manifest = {
    name: 'dsh-profile-tui',
    private: true,
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base'],
        patchReload: 'startup',
      },
    },
  }
  if (typeof adapters.writeText === 'function') {
    adapters.writeText(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
  }
}

/**
 * Run one parsed launcher invocation.
 * @param {{invocation: ReturnType<typeof parseLauncherInvocation>, settings: LauncherSettings, packageVersion: string, adapters: LauncherAdapters, env?: Readonly<Record<string, string | undefined>>}} input
 * @returns {number} process exit status.
 */
export function runLauncher({ invocation, settings, packageVersion, adapters, env = {} }) {
  switch (invocation.kind) {
    case 'version':
      return showVersion({ settings, packageVersion, adapters })
    case 'update':
      return updateRuntime({ settings, adapters })
    case 'probe':
      return showProbe({ settings, adapters, env })
    case 'launch':
      return launchTui({ args: invocation.args, mode: invocation.mode, settings, adapters, env })
    default:
      return assertNever(invocation)
  }
}

function environmentValue(env, name, fallback) {
  const value = env[name]
  if (value === undefined) return fallback
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
  return value
}

function runtimeState(settings, adapters) {
  const kind = adapters.inspectPath(settings.runtimeDirectory)
  if (kind === 'symlink') return { ok: false, message: `runtime path is a symbolic link: ${settings.runtimeDirectory}` }
  if (kind === 'missing') return { ok: true, initialized: false }
  if (kind !== 'directory') return { ok: false, message: `runtime path is not a directory: ${settings.runtimeDirectory}` }
  const gitKind = adapters.inspectPath(join(settings.runtimeDirectory, '.git'))
  if (gitKind !== 'directory' && gitKind !== 'file') {
    return { ok: false, message: `runtime directory is not a Git checkout: ${settings.runtimeDirectory}` }
  }
  return { ok: true, initialized: true }
}

function launchTui({ args, mode, settings, adapters, env = {} }) {
  const effectiveMode = mode ?? settings.mode ?? 'auto'

  if (effectiveMode === 'source') {
    return launchSourceTui({ args, settings, adapters })
  }

  const patchPath = findBundledPatch(settings.packageRoot, adapters)

  if (patchPath !== undefined) {
    const probe = probeInstalledDsh({ env, settings, adapters })
    if (probe.ok) {
      return launchLightweightTui({ args, binPath: probe.binPath, patchPath, adapters, env, settings })
    }
    if (effectiveMode === 'lightweight') {
      return reportError(adapters, `lightweight mode requires installed dsh (${probe.reason}); run \`npm i -g @deepseek-ai/dsh\` or use \`dsh-tui --source\``)
    }
  } else if (effectiveMode === 'lightweight') {
    return reportError(adapters, `bundled TUI patch not found under ${settings.packageRoot}; run \`dsh-tui update\` to initialize source runtime`)
  }

  // Fallback to source runtime if initialized
  const state = runtimeState(settings, adapters)
  if (state.ok && state.initialized) {
    return launchSourceTui({ args, settings, adapters })
  }

  if (state.ok && !state.initialized) {
    adapters.writeError('dsh-tui: 未检测到系统已安装的 dsh 核心引擎。\n')
    adapters.writeError('dsh-tui: 推荐通过 npm 极速安装官方运行时（无需克隆完整源码仓库，仅需数十 MB）：\n')
    adapters.writeError('dsh-tui:   npm install --global @deepseek-ai/dsh\n\n')
    adapters.writeError('dsh-tui: 若您需要进行底层源码开发与测试，可运行:\n')
    adapters.writeError('dsh-tui:   dsh-tui update\n')
    adapters.writeError('dsh-tui:   dsh-tui --source\n')
    return reportError(adapters, `runtime is not initialized at ${settings.runtimeDirectory}; run \`dsh-tui update\` first`)
  }

  return launchSourceTui({ args, settings, adapters })
}

function launchLightweightTui({ args, binPath, patchPath, adapters, env = {}, settings }) {
  ensureTuiProfile({ homeDirectory: settings?.homeDirectory, env, adapters })
  const result = adapters.run(
    binPath,
    ['--profile', 'tui', '--patch', patchPath, ...args],
    { stdio: 'inherit' },
  )
  return result.status
}

function launchSourceTui({ args, settings, adapters }) {
  const state = runtimeState(settings, adapters)
  if (!state.ok) return reportError(adapters, state.message)
  if (!state.initialized) {
    return reportError(adapters, `runtime is not initialized at ${settings.runtimeDirectory}; run \`dsh-tui update\` first`)
  }
  const result = adapters.run(
    settings.packageManager,
    ['dsh', '--profile', 'deepseek-tui', ...args],
    { cwd: settings.runtimeDirectory, stdio: 'inherit' },
  )
  return result.status
}

function showProbe({ settings, adapters, env = {} }) {
  const probe = probeInstalledDsh({ env, settings, adapters })
  if (probe.ok) {
    adapters.writeOut(`dsh: installed\n`)
    adapters.writeOut(`executable: ${probe.binPath}\n`)
    adapters.writeOut(`version: ${probe.version}\n`)
    const patchPath = findBundledPatch(settings.packageRoot, adapters)
    adapters.writeOut(`bundled patch: ${patchPath ?? 'missing'}\n`)
    return 0
  }
  adapters.writeOut(`dsh: not installed (${probe.reason})\n`)
  return 1
}

function showVersion({ settings, packageVersion, adapters }) {
  adapters.writeOut(`dsh-tui ${packageVersion}\n`)
  adapters.writeOut(`runtime directory: ${settings.runtimeDirectory}\n`)
  const state = runtimeState(settings, adapters)
  if (!state.ok) return reportError(adapters, state.message)
  if (!state.initialized) {
    adapters.writeOut('runtime: uninitialized\n')
    return 0
  }
  const revision = captureGit(adapters, settings.runtimeDirectory, ['rev-parse', 'HEAD'], 'read runtime HEAD')
  if (!revision.ok) return revision.status
  adapters.writeOut(`runtime SHA: ${revision.stdout}\n`)
  adapters.writeOut(`DSH version: ${readDshVersion(settings.runtimeDirectory, adapters)}\n`)
  return 0
}

function readDshVersion(runtimeDirectory, adapters) {
  try {
    const manifest = JSON.parse(adapters.readText(join(runtimeDirectory, 'package.json')))
    return typeof manifest.version === 'string' && manifest.version !== '' ? manifest.version : 'unknown'
  } catch (error) {
    return `unreadable (${errorMessage(error)})`
  }
}

function updateRuntime({ settings, adapters }) {
  const state = runtimeState(settings, adapters)
  if (!state.ok) return reportError(adapters, state.message)
  if (!state.initialized) return cloneRuntime({ settings, adapters })

  const clean = captureGit(adapters, settings.runtimeDirectory, ['status', '--porcelain'], 'inspect runtime worktree')
  if (!clean.ok) return clean.status
  if (clean.stdout !== '') {
    return reportError(adapters, `runtime worktree is not clean: ${settings.runtimeDirectory}`)
  }

  const before = captureGit(adapters, settings.runtimeDirectory, ['rev-parse', 'HEAD'], 'read current runtime HEAD')
  if (!before.ok) return before.status
  const fetched = adapters.run(
    'git',
    ['fetch', '--no-tags', '--', settings.sourceUrl, settings.sourceRef],
    { cwd: settings.runtimeDirectory, capture: true },
  )
  if (fetched.status !== 0) {
    return reportCommandFailure(adapters, 'fetch configured runtime source', fetched, [settings.sourceUrl])
  }
  const after = captureGit(adapters, settings.runtimeDirectory, ['rev-parse', 'FETCH_HEAD'], 'read fetched runtime HEAD')
  if (!after.ok) return after.status

  const ancestry = adapters.run(
    'git',
    ['merge-base', '--is-ancestor', before.stdout, after.stdout],
    { cwd: settings.runtimeDirectory, capture: true },
  )
  if (ancestry.status === 1) {
    return reportError(
      adapters,
      `runtime update is not a fast-forward (${before.stdout} -> ${after.stdout}); replace the dedicated runtime only after reviewing its history`,
    )
  }
  if (ancestry.status !== 0) return reportCommandFailure(adapters, 'verify runtime ancestry', ancestry)

  const merge = adapters.run('git', ['merge', '--ff-only', after.stdout], {
    cwd: settings.runtimeDirectory,
    capture: true,
  })
  if (merge.status !== 0) return reportCommandFailure(adapters, 'fast-forward runtime', merge)
  const installStatus = installDependencies({ settings, adapters, currentSha: after.stdout })
  if (installStatus !== 0) return installStatus
  adapters.writeOut(`runtime updated: ${before.stdout} -> ${after.stdout}\n`)
  return 0
}

function cloneRuntime({ settings, adapters }) {
  adapters.makeDirectory(dirname(settings.runtimeDirectory))
  const clone = adapters.run(
    'git',
    ['clone', '--branch', settings.sourceRef, '--single-branch', '--', settings.sourceUrl, settings.runtimeDirectory],
    { capture: true },
  )
  if (clone.status !== 0) return reportCommandFailure(adapters, 'clone configured runtime source', clone, [settings.sourceUrl])
  const installStatus = installDependencies({ settings, adapters, currentSha: 'new checkout' })
  if (installStatus !== 0) return installStatus
  const revision = captureGit(adapters, settings.runtimeDirectory, ['rev-parse', 'HEAD'], 'read cloned runtime HEAD')
  if (!revision.ok) return revision.status
  adapters.writeOut(`runtime initialized: ${revision.stdout}\n`)
  return 0
}

function installDependencies({ settings, adapters, currentSha }) {
  const install = adapters.run(settings.packageManager, ['install', '--frozen-lockfile'], {
    cwd: settings.runtimeDirectory,
    stdio: 'inherit',
  })
  if (install.status === 0) return 0
  adapters.writeError(`dsh-tui: dependency refresh failed at ${currentSha}; runtime is not ready\n`)
  adapters.writeError(`dsh-tui: recover with: cd ${settings.runtimeDirectory} && ${settings.packageManager} install --frozen-lockfile\n`)
  return install.status
}

function captureGit(adapters, cwd, args, label) {
  const result = adapters.run('git', args, { cwd, capture: true })
  if (result.status !== 0) return { ok: false, status: reportCommandFailure(adapters, label, result) }
  return { ok: true, stdout: result.stdout.trim() }
}

function reportCommandFailure(adapters, label, result, redactions = []) {
  let detail = result.stderr.trim()
  for (const value of redactions) detail = detail.replaceAll(value, '<source>')
  detail = detail.replaceAll(/https?:\/\/[^/@\s]+@/g, 'https://<credentials>@')
  adapters.writeError(`dsh-tui: ${label} failed${detail === '' ? '' : `: ${detail}`}\n`)
  return result.status === 0 ? 1 : result.status
}

function reportError(adapters, message) {
  adapters.writeError(`dsh-tui: ${message}\n`)
  return 1
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function assertNever(value) {
  throw new Error(`unhandled launcher invocation: ${JSON.stringify(value)}`)
}
