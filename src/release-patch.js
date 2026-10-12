/** Release patch projection from the matching Harness TUI composition. */

/**
 * Packages the Harness TUI composition mounts that exist only in the source
 * checkout. The published `dsh` runtime cannot import them, so a release row
 * would fail to activate and print a warning on every lightweight launch.
 */
const SOURCE_ONLY_PACKAGES = ['@deepseek-ai/dsh-llm-openai', '@deepseek-ai/dsh-llm-anthropic']

/**
 * Replace insert rows for source-only packages with a comment naming them.
 * @param {string} patch - patch text.
 * @returns {string} Patch text without rows the published runtime cannot load.
 */
export function dropSourceOnlyRows(patch) {
  return patch.replace(/^( +)- id: ([\w-]+)\n\1  name: (["'])([^"'\n]+)\3\n/gmu, (row, indent, id, _quote, name) =>
    SOURCE_ONLY_PACKAGES.includes(name)
      ? `${indent}# ${id} (${name}) is source-mode only; it is not published to npm.\n`
      : row)
}

/**
 * Point the three bundled plugins at release artifacts and drop source-only
 * rows, retaining all other rows.
 * @param {string} source - Harness packages/tui/tui/cordis.patch.yml content.
 * @param {string} distDirectory - Relative dist directory from the output patch.
 * @returns {string} Patch text suitable for dsh --patch.
 */
export function releasePatch(source, distDirectory) {
  const entries = new Map([
    ['@deepseek-ai/dsh-tui/startup', 'startup.js'],
    ['./zen-proxy/index.js', 'zen-proxy.js'],
    ['@deepseek-ai/dsh-tui', 'index.js'],
  ])
  const patch = source.replace(/^(\s+name: )(["'])([^"']+)\2$/gmu, (line, prefix, quote, name) => {
    const file = entries.get(name)
    if (!file) return line
    entries.delete(name)
    return `${prefix}${quote}${distDirectory}/${file}${quote}`
  })
  if (entries.size) throw new Error(`TUI patch is missing plugin entries: ${[...entries.keys()].join(', ')}`)
  return dropSourceOnlyRows(patch)
}
