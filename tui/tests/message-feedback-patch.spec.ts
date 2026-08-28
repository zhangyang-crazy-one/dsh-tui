/**
 * The deepseek-tui patch contributes message-feedback over the storage stack
 * owned by dsh-base, without re-inserting base-owned ids.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'

/** The cordis `!!js` scalar tag, tolerated (not evaluated) for shape assertions. */
const JS_EXPR = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data: unknown) => ({ __jsExpr: data }),
})
const SCHEMA = yaml.JSON_SCHEMA.extend(JS_EXPR)

interface PatchRow {
  id?: string
  name?: string
  config?: Record<string, unknown>
}

/** Load one patch list while retaining its Loader JavaScript expressions. */
function patchRows(path: string): PatchRow[] {
  const parsed: unknown = yaml.load(readFileSync(path, 'utf8'), {
    schema: SCHEMA,
  })
  expect(Array.isArray(parsed)).toBe(true)
  return parsed as PatchRow[]
}

/** The TUI patch's insert rows. */
function insertRows(): PatchRow[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const parsed = patchRows(resolve(root, 'cordis.patch.yml'))
  return (parsed as { insert?: PatchRow[] }[]).flatMap(block => block.insert ?? [])
}

describe('deepseek-tui message-feedback patch rows', () => {
  it('inserts only the feedback consumer over the base-owned storage stack', () => {
    const rows = insertRows()
    const byId = new Map(rows.map(row => [row.id, row]))
    expect(byId.has('storage')).toBe(false)
    expect(byId.has('storage-json')).toBe(false)
    expect(byId.has('storage-domain')).toBe(false)
    expect(byId.has('session-projection-cache')).toBe(false)
    expect(byId.get('message-feedback')?.name).toBe('@deepseek-ai/dsh-message-feedback')
    expect(byId.get('message-feedback')?.config?.['maxNoteBytes']).toBe(8192)
  })

  it('keeps a single session-stats row', () => {
    const rows = insertRows()
    expect(rows.filter(row => row.id === 'session-stats').length).toBe(1)
  })

  it('assembles each base-owned storage id exactly once with base config', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const assembled = composeEntries([
      patchRows(resolve(root, '../../bundle/base/cordis.patch.yml')),
      patchRows(resolve(root, 'cordis.patch.yml')),
    ])
    const ids = [
      'storage',
      'storage-json',
      'storage-domain',
      'session-projection-cache',
    ]
    for (const id of ids) {
      expect(assembled.filter(row => row.id === id)).toHaveLength(1)
    }
    const byId = new Map(assembled.map(row => [row.id, row]))
    expect(byId.get('storage-domain')?.config).toEqual({ backend: 'json' })
    expect(byId.get('session-projection-cache')?.config).toEqual({
      writeEveryEvents: 200,
      writeIntervalMs: 5000,
    })
  })
})
