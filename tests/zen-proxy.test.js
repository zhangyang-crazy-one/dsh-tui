import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const PLUGIN_SRC = new URL('../plugins/zen-proxy/index.js', import.meta.url)

/**
 * Load the vendored zen-proxy plugin with a minimal schemastery stub.
 * The plugin only evaluates `z.object/string/number` shapes at import time;
 * behavior under test receives a plain config object, so the stub never
 * validates. The stub sits beside the rewritten entry as a relative import,
 * which keeps the test dependency-free (CI runs node --test with no
 * install step; ESM ignores NODE_PATH).
 */
async function loadPlugin() {
  const dir = mkdtempSync(join(tmpdir(), 'zen-proxy-test-'))
  writeFileSync(
    join(dir, 'schemastery-stub.mjs'),
    'const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });\n'
    + 'export default new Proxy({}, { get: () => (...args) => chain });\n',
  )
  const source = readFileSync(PLUGIN_SRC, 'utf8')
    .replaceAll('"@deepseek-ai/schemastery"', '"./schemastery-stub.mjs"')
  assert.ok(!source.includes('@deepseek-ai/schemastery'), 'import rewrite must remove the bare specifier')
  const entry = join(dir, 'zen-proxy-under-test.mjs')
  writeFileSync(entry, source)
  return import(entry)
}

function stubCtx() {
  const disposers = []
  const logs = []
  return {
    ctx: {
      effect: (fn) => {
        const dispose = fn()
        disposers.push(dispose)
        return dispose
      },
      logger: {
        info: (m) => { logs.push(['info', String(m)]) },
        warn: (m) => { logs.push(['warn', String(m)]) },
      },
    },
    disposeAll: () => { for (const dispose of disposers.splice(0)) dispose() },
    logs,
  }
}

/** Grab a free localhost port without holding it. */
async function freePort() {
  const probe = http.createServer()
  await new Promise((resolve) => { probe.listen(0, '127.0.0.1', resolve) })
  const port = probe.address().port
  await new Promise((resolve) => { probe.close(resolve) })
  return port
}

test('zen-proxy exposes the cordis plugin face', async () => {
  const plugin = await loadPlugin()
  assert.equal(plugin.name, 'zen-proxy')
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(plugin.Config !== undefined)
})

test('zen-proxy serves unknown routes with 404 and disposes cleanly', async () => {
  const plugin = await loadPlugin()
  const { ctx, disposeAll } = stubCtx()
  const port = await freePort()
  plugin.apply(ctx, {
    host: '127.0.0.1',
    port,
    upstreamHost: 'opencode.ai',
    upstreamBasePath: '/zen/v1',
    userAgent: 'opencode-test/1.0',
    clientHeader: 'cli',
    projectHeader: 'global',
  })
  await new Promise((r) => { setTimeout(r, 100) })
  const res = await fetch(`http://127.0.0.1:${port}/nope`)
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.match(body.error.message, /unsupported/)
  disposeAll()
  await assert.rejects(fetch(`http://127.0.0.1:${port}/nope`), /fetch failed|ECONNREFUSED/)
})

test('vendored source carries the official identity headers and dynamic ids', () => {
  // Regression guard on the vendored copy: the Zen gateway validates the
  // User-Agent content plus x-opencode-* headers, and MissingSessionID is
  // answered with per-request ses_/msg_ ids. If upstream changes these,
  // re-vendor instead of editing the copy.
  const source = readFileSync(PLUGIN_SRC, 'utf8')
  for (const header of [
    '"user-agent": config.userAgent',
    '"x-opencode-client": config.clientHeader',
    '"x-opencode-project": config.projectHeader',
    '"x-opencode-session"',
    '"x-opencode-request"',
  ]) {
    assert.ok(source.includes(header), `vendored plugin must send ${header}`)
  }
  assert.ok(source.includes('rnd("ses_")'), 'session ids must be generated per request')
  assert.ok(source.includes('rnd("msg_")'), 'request ids must be generated per request')
  assert.ok(
    source.includes('opencode/1.18.30'),
    'default User-Agent must impersonate the official CLI',
  )
})
