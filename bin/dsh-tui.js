#!/usr/bin/env node
/** Command-line entry for the dsh-tui source-runtime launcher. */

import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { constants, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseLauncherInvocation, resolveLauncherSettings, runLauncher } from '../src/launcher.js'

function inspectPath(path) {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'missing'
    throw error
  }
}

function run(command, args, options = {}) {
  const capture = options.capture === true
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: capture ? 'utf8' : undefined,
    env: process.env,
    maxBuffer: capture ? 16 * 1024 * 1024 : undefined,
    shell: false,
    stdio: options.stdio === 'inherit' ? 'inherit' : capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error !== undefined) {
    return { status: 1, stdout: '', stderr: result.error.message }
  }
  const status = result.status ?? signalOutcome(result.signal)
  return {
    status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    ...(result.signal === null ? {} : { signal: result.signal }),
  }
}

function signalOutcome(signal) {
  if (signal === null) return 1
  const number = constants.signals[signal]
  return number === undefined ? 1 : 128 + number
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))

try {
  const invocation = parseLauncherInvocation(process.argv.slice(2))
  const settings = resolveLauncherSettings({ env: process.env, homeDirectory: homedir() })
  process.exitCode = runLauncher({
    invocation,
    settings,
    packageVersion: manifest.version,
    adapters: {
      inspectPath,
      makeDirectory: path => mkdirSync(path, { recursive: true, mode: 0o700 }),
      readText: path => readFileSync(path, 'utf8'),
      run,
      writeOut: text => process.stdout.write(text),
      writeError: text => process.stderr.write(text),
    },
  })
} catch (error) {
  process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
