/**
 * Shared Markdown parse + cache layer.
 *
 * The renderer and the incremental projector both need to translate a
 * canonical source string into an mdast tree and trim the streamed partial
 * closing fence from the last code block. The trim is sensitive (it
 * prevents the partial-fence flicker called out in the upstream test
 * suite) so both call sites must use the same implementation; the
 * projector copy in `markdown-projector.ts` was previously a hand-maintained
 * duplicate and this module is the single source of truth going forward.
 *
 * Caching is LRU-bounded so settled (immutable) sources pay one parse
 * then reuse the cached tree. The cache key is the raw source bytes
 * because mdast tree identity, block range, and inline text all change
 * with any edit; a content-hash key would silently miss on whitespace
 * edits that keep the same logical tree.
 *
 * @module @deepseek-ai/dsh-tui-render/markdown-parse
 */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Root, RootContent } from 'mdast'

/** Default cache capacity; matches the upstream markdown cache limit. */
export const MARKDOWN_PARSE_DEFAULT_CACHE_LIMIT = 2000

/** Bounded settled-source cache keyed by the source bytes. */
const cache = new Map<string, Root>()

/** Capacity ceiling for the settled-source cache. */
const cacheLimit = MARKDOWN_PARSE_DEFAULT_CACHE_LIMIT

/** Diagnostic counters for cache-aware tests and instrumentation. */
let cacheHits = 0
let cacheParses = 0
let cacheEvictions = 0

/** Hit the cache while preserving insertion order (LRU touch). */
function lruGet(key: string): Root | undefined {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

/** Insert into the cache, evicting the oldest entry once at capacity. */
function lruSet(key: string, value: Root): void {
  cache.delete(key)
  while (cache.size >= cacheLimit) {
    const oldest = cache.keys().next().value
    /* v8 ignore next -- cacheLimit >= 1 guarantees a non-empty cache at eviction */
    if (oldest === undefined) break
    cache.delete(oldest)
    cacheEvictions += 1
  }
  cache.set(key, value)
}

/**
 * Parse a canonical markdown source into an mdast tree. Settled sources
 * hit the bounded cache; streaming or never-before-seen sources re-parse
 * and trim the partial closing fence in place.
 * @param source - canonical markdown source (untrusted; escaped downstream).
 * @param settled - `true` for immutable history sources eligible for caching.
 * @returns the parsed mdast tree (possibly cached).
 */
export function parseMarkdownSource(source: string, settled: boolean): Root {
  if (settled && source.length > 0) {
    const cached = lruGet(source)
    if (cached !== undefined) {
      cacheHits += 1
      return cached
    }
  }
  cacheParses += 1
  const root = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  trimPartialClosingFence(root, source)
  if (settled && source.length > 0) {
    lruSet(source, root)
  }
  return root
}

/**
 * Trim a streamed partial closing fence from the last code block. An
 * unclosed fence swallows the tail line as code content until the closing
 * marker is complete, so a fence arriving character by character would
 * briefly paint its own ` `` ` as code (the Pi #5825 flicker). The trimmed
 * line reappears as content when it turns out not to be a fence prefix.
 *
 * @param root - parsed mdast tree (mutated in place).
 * @param source - the markdown source the tree was parsed from.
 */
export function trimPartialClosingFence(root: Root, source: string): void {
  let node: RootContent | undefined = root.children.at(-1)
  while (
    node !== undefined
    && (node.type === 'list' || node.type === 'listItem' || node.type === 'blockquote')
  ) {
    node = (node.children as RootContent[]).at(-1)
  }
  if (node?.type !== 'code' || node.position === undefined) {
    return
  }
  const start = node.position.start.offset
  const end = node.position.end.offset
  if (start === undefined || end === undefined) {
    return
  }
  const raw = source.slice(start, end)
  const marker = /^(`{3,}|~{3,})/.exec(raw)?.[1]
  if (marker === undefined) return
  const lastLine = raw.split('\n').at(-1) as string
  if (lastLine === '' || lastLine.length >= marker.length) return
  if (lastLine !== marker.charAt(0).repeat(lastLine.length)) return
  node.value = node.value
    .slice(0, node.value.length - lastLine.length)
    .replace(/\n$/, '')
}

/**
 * Read-only instrumentation seam for the shared parse layer. Mirrors the
 * upstream `markdownCacheInternals` shape so cache-aware tests and the
 * stream-view lane can keep one polling contract.
 */
export const markdownParseInternals = {
  /** Clear the cache and reset every counter to zero. */
  reset(): void {
    cache.clear()
    cacheHits = 0
    cacheParses = 0
    cacheEvictions = 0
  },
  /**
   * Snapshot cache occupancy and access counters.
   * @returns an immutable diagnostic snapshot.
   */
  snapshot(): {
    readonly limit: number
    readonly entries: number
    readonly hits: number
    readonly parses: number
    readonly evictions: number
  } {
    return Object.freeze({
      limit: cacheLimit,
      entries: cache.size,
      hits: cacheHits,
      parses: cacheParses,
      evictions: cacheEvictions,
    })
  },
}
