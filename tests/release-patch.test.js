import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { releasePatch } from '../src/release-patch.js'

test('release projection preserves model and workspace rows and rewrites only bundled entries', () => {
  const source = '- id: llm-deepseek\n  config:\n    protocol: messages\n- insert:\n    - id: tui-startup\n      name: "@deepseek-ai/dsh-tui/startup"\n    - id: zen-proxy\n      name: "./zen-proxy/index.js"\n    - id: tui-runtime\n      name: "@deepseek-ai/dsh-tui"\n    - id: workspace-changes\n      name: "@deepseek-ai/dsh-workspace-changes"\n'
  assert.equal(releasePatch(source, './dist'), source
    .replace('"@deepseek-ai/dsh-tui/startup"', '"./dist/startup.js"')
    .replace('"./zen-proxy/index.js"', '"./dist/zen-proxy.js"')
    .replace('"@deepseek-ai/dsh-tui"', '"./dist/index.js"'))
  assert.throws(() => releasePatch('- insert: []\n', './dist'), /missing plugin entries/)
})

test('both shipped patches refer to existing artifacts and share the current release configuration', () => {
  const root = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const fallback = readFileSync(new URL('../tui/cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(fallback.replaceAll('../dist/', './dist/'), root)
  assert.match(root, /id: workspace-changes/)
  assert.match(root, /model: !!js "process.env.DSH_MODEL \?\? 'deepseek-flash'"/)
  assert.doesNotMatch(root, /id: deepseek-v4-flash|models:/)
  for (const file of ['index', 'startup', 'zen-proxy']) {
    assert.ok(readFileSync(new URL(`../dist/${file}.js`, import.meta.url)).length > 0)
    assert.ok(root.includes(`"./dist/${file}.js"`))
  }
})
