/** Release patch projection from the matching Harness TUI composition. */

/**
 * Point the three bundled plugins at release artifacts, retaining all other rows.
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
  return patch
}
