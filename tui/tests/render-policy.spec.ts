/**
 * Render-policy Config validation and frame-stats serialization (Decision 4/5/8
 * of the streaming-renderer change).
 *
 *  - Default Config loads with the schema defaults; no host value required.
 *  - Overrides at the cordis.yml layer pass through the schema unchanged.
 *  - Each rejected field reports the offending path so misconfiguration fails
 *    loud with the offending field name (the design's "Misconfiguration fails
 *    loud" rule).
 *  - writeFrameStatsFile adds the FrameMetricsSnapshot under a new top-level
 *    `frameMetrics` key, preserving every prior field for back-compat.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, internals, name } from '../src/index.ts'
import type { FrameProbeHandle } from '@deepseek-ai/dsh-tui-render'
import {
  createFrameMetrics,
  createFrameProbe,
  renderPolicyDefaults,
} from '@deepseek-ai/dsh-tui-render'
import type { FrameMetricsSnapshot } from '@deepseek-ai/dsh-tui-render'

const originalInternals = { ...internals }
const roots: string[] = []

afterEach(() => {
  Object.assign(internals, originalInternals)
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** One resolved schema-default render policy, used as the baseline. */
function baselinePolicy(): ReturnType<typeof renderPolicyDefaults> {
  return renderPolicyDefaults()
}

/** Merge invalid leaf overrides into an otherwise complete policy input. */
function policyWith(overrides: {
  readonly transcriptOverscan?: number
  readonly stream?: Partial<ReturnType<typeof renderPolicyDefaults>['stream']>
  readonly scroll?: Partial<ReturnType<typeof renderPolicyDefaults>['scroll']>
  readonly cache?: Partial<ReturnType<typeof renderPolicyDefaults>['cache']>
}): ReturnType<typeof renderPolicyDefaults> {
  const base = baselinePolicy()
  return {
    ...base,
    ...overrides,
    stream: { ...base.stream, ...overrides.stream },
    scroll: { ...base.scroll, ...overrides.scroll },
    cache: { ...base.cache, ...overrides.cache },
  }
}

describe('renderPolicy Config schema', () => {
  it('accepts the bare minimum {task} without a renderPolicy (fallback defaults apply at run())', () => {
    const config = Config({ task: 'hi' })
    expect(config.renderPolicy).toBeUndefined()
    // The fallback mirrors the schema defaults the host expects when nothing
    // is supplied through cordis.yml.
    expect(renderPolicyDefaults()).toEqual(baselinePolicy())
  })

  it('returns the same numeric values that the render-policy defaults publish when policy is fully provided', () => {
    const config = Config({ task: 'hi', renderPolicy: baselinePolicy() })
    expect(config.renderPolicy).toBeDefined()
    expect(config.renderPolicy).toEqual(baselinePolicy())
    expect(config.renderPolicy?.scroll.wheelRows).toBe(3)
  })

  it('accepts host overrides for every leaf field without regression', () => {
    const config = Config({
      task: 'hi',
      renderPolicy: {
        transcriptOverscan: 8,
        stream: {
          frameIntervalMs: 8,
          entryDepth: 128,
          exitDepth: 32,
          entryOldestAgeMs: 750,
          exitOldestAgeMs: 200,
          entryDrainBackpressureMs: 80,
          exitDrainBackpressureMs: 25,
          catchUpRowsPerFrame: 24,
        },
        scroll: {
          frameIntervalMs: 12,
          stepPerFrame: 2,
          wheelRows: 4,
          catchUpThreshold: 12,
          maxCatchUpStep: 12,
        },
        cache: {
          maxRows: 8192,
          maxBytes: 8 * 1024 * 1024,
        },
      },
    })
    expect(config.renderPolicy?.transcriptOverscan).toBe(8)
    expect(config.renderPolicy?.stream.frameIntervalMs).toBe(8)
    expect(config.renderPolicy?.stream.entryDepth).toBe(128)
    expect(config.renderPolicy?.stream.catchUpRowsPerFrame).toBe(24)
    expect(config.renderPolicy?.scroll.wheelRows).toBe(4)
    expect(config.renderPolicy?.scroll.maxCatchUpStep).toBe(12)
    expect(config.renderPolicy?.cache.maxRows).toBe(8192)
    expect(config.renderPolicy?.cache.maxBytes).toBe(8 * 1024 * 1024)
  })

  it('rejects a negative transcript overscan and reports the field name', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ transcriptOverscan: -1 }),
    })).toThrow(/transcriptOverscan/)
  })

  it('rejects an overscan above the hard cap (one viewport = 50 rows)', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ transcriptOverscan: 64 }),
    })).toThrow(/transcriptOverscan/)
  })

  it('rejects a non-positive stream frame interval', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { frameIntervalMs: 0, exitDepth: 1, entryDepth: 2 } }),
    })).toThrow(/stream\.frameIntervalMs/)
  })

  it('rejects a non-positive scroll frame interval', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ scroll: { frameIntervalMs: -1 } }),
    })).toThrow(/scroll\.frameIntervalMs/)
  })

  it('rejects a non-positive mouse-wheel row count', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ scroll: { wheelRows: 0 } }),
    })).toThrow(/scroll\.wheelRows/)
  })

  it('rejects exitDepth >= entryDepth and names both fields', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { entryDepth: 32, exitDepth: 32 } }),
    })).toThrow(/exitDepth/)
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { entryDepth: 32, exitDepth: 64 } }),
    })).toThrow(/exitDepth/)
  })

  it('rejects exitOldestAgeMs >= entryOldestAgeMs and names both fields', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { entryOldestAgeMs: 100, exitOldestAgeMs: 100 } }),
    })).toThrow(/exitOldestAgeMs/)
  })

  it('rejects exitDrainBackpressureMs >= entryDrainBackpressureMs', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { entryDrainBackpressureMs: 50, exitDrainBackpressureMs: 50 } }),
    })).toThrow(/exitDrainBackpressureMs/)
  })

  it('rejects an unbounded cache.maxRows above the hard cap', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ cache: { maxRows: 10 ** 9 } }),
    })).toThrow(/cache\.maxRows/)
  })

  it('rejects an unbounded cache.maxBytes above the hard cap (32 MiB)', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ cache: { maxBytes: 64 * 1024 * 1024 } }),
    })).toThrow(/cache\.maxBytes/)
  })

  it('rejects a zero cache budget', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ cache: { maxRows: 0 } }),
    })).toThrow(/cache\.maxRows/)
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ cache: { maxBytes: 0 } }),
    })).toThrow(/cache\.maxBytes/)
  })

  it('rejects a non-integer frame interval', () => {
    expect(() => Config({
      task: 'hi',
      renderPolicy: policyWith({ stream: { frameIntervalMs: 16.5, entryDepth: 2, exitDepth: 1 } }),
    })).toThrow(/stream\.frameIntervalMs/)
  })
})

describe('writeFrameStatsFile serialization shape', () => {
  /** Build a probe with a known elapsed time and counter state. */
  function buildProbe(): FrameProbeHandle {
    return createFrameProbe()
  }

  /** Build a frame-metrics probe with a known snapshot shape. */
  function buildMetricsProbe(): FrameMetricsSnapshot {
    const probe = createFrameMetrics()
    probe.addMarkdownParseBytes(64)
    probe.addStableRowsReused(9)
    probe.addTailRowsRerendered(2)
    probe.addMountedRows(15)
    probe.addWrittenCells(180)
    probe.addCacheBytes(512)
    probe.addCacheEvictions(1)
    probe.recordDeltaIngressToStdoutDrain(8)
    probe.recordScrollInputToPaint(14)
    probe.recordRenderQueue(4, 22)
    return probe.snapshot()
  }

  it('keeps every prior field unchanged when frameMetrics is omitted', async () => {
    const root = mkdtempSync(join(tmpdir(), 'frame-stats-back-compat-'))
    roots.push(root)
    const target = join(root, 'frames.json')
    const captured: string[] = []
    internals.stderr = { write: (chunk: string) => { captured.push(chunk); return true } }
    await internals.writeFrameStatsFile(target, buildProbe(), { stdout: process.stdout, stderr: process.stderr, exit: () => {} })
    const payload = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
    expect(payload.renderMs).toBeDefined()
    expect(payload.brandRenderMs).toBeDefined()
    expect(payload.pacing).toBeDefined()
    expect(payload.brandRevealTimers).toBeDefined()
    expect(payload.environment).toBeDefined()
    expect(payload.path).toBe(target)
    // Back-compat: omitting frameMetrics keeps the field absent, not null,
    // so legacy readers see exactly the prior shape.
    expect(payload.frameMetrics).toBeUndefined()
    expect(captured).toEqual([])
  })

  it('adds frameMetrics as a new top-level field with the expected snapshot shape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'frame-stats-with-metrics-'))
    roots.push(root)
    const target = join(root, 'frames.json')
    internals.stderr = { write: () => true }
    const snapshot = buildMetricsProbe()
    await internals.writeFrameStatsFile(
      target,
      buildProbe(),
      { stdout: process.stdout, stderr: process.stderr, exit: () => {} },
      undefined,
      snapshot,
    )
    const payload = JSON.parse(readFileSync(target, 'utf8')) as Record<string, unknown>
    expect(payload.frameMetrics).toBeDefined()
    const metrics = payload.frameMetrics as Record<string, unknown>
    // Every channel documented by frame-metrics.ts is present; the new top
    // level field exposes the same shape as `FrameMetricsSnapshot`.
    expect(metrics.deltaIngressToStdoutDrainMs).toBeDefined()
    expect(metrics.markdownParseBytes).toBeDefined()
    expect(metrics.stableRowsReused).toBeDefined()
    expect(metrics.tailRowsRerendered).toBeDefined()
    expect(metrics.mountedRows).toBeDefined()
    expect(metrics.writtenCells).toBeDefined()
    expect(metrics.renderQueue).toBeDefined()
    expect(metrics.scrollInputToPaintMs).toBeDefined()
    expect(metrics.cacheBytes).toBeDefined()
    expect(metrics.cacheEvictions).toBeDefined()
    expect(typeof metrics.elapsedMs).toBe('number')
  })

  it('writes the frame-metrics counter totals that were recorded before exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'frame-stats-counters-'))
    roots.push(root)
    const target = join(root, 'frames.json')
    internals.stderr = { write: () => true }
    const snapshot = buildMetricsProbe()
    await internals.writeFrameStatsFile(
      target,
      buildProbe(),
      { stdout: process.stdout, stderr: process.stderr, exit: () => {} },
      undefined,
      snapshot,
    )
    const payload = JSON.parse(readFileSync(target, 'utf8')) as {
      frameMetrics: FrameMetricsSnapshot
    }
    expect(payload.frameMetrics.markdownParseBytes.total).toBe(64)
    expect(payload.frameMetrics.stableRowsReused.total).toBe(9)
    expect(payload.frameMetrics.mountedRows.total).toBe(15)
    expect(payload.frameMetrics.writtenCells.total).toBe(180)
    expect(payload.frameMetrics.cacheBytes.total).toBe(512)
    expect(payload.frameMetrics.cacheEvictions.total).toBe(1)
    expect(payload.frameMetrics.renderQueue.currentDepth).toBe(4)
    expect(payload.frameMetrics.renderQueue.maxDepth).toBe(4)
    expect(payload.frameMetrics.deltaIngressToStdoutDrainMs.samples).toEqual([8])
    expect(payload.frameMetrics.scrollInputToPaintMs.samples).toEqual([14])
  })

  it('reports the frame-metrics write failure on stderr instead of throwing', async () => {
    const captured: string[] = []
    internals.stderr = { write: (chunk: string) => { captured.push(chunk); return true } }
    // A path inside a non-existent parent directory triggers ENOENT.
    await internals.writeFrameStatsFile(
      '/nonexistent-root-does-not-exist/frames.json',
      buildProbe(),
      { stdout: process.stdout, stderr: internals.stderr, exit: () => {} },
      undefined,
      buildMetricsProbe(),
    )
    expect(captured.some(line => line.includes('--frame-stats write failed'))).toBe(true)
  })
})

describe('TUI plugin Config surface', () => {
  it('keeps the stable plugin name and injects no extra dependencies', () => {
    expect(name).toBe('tui-runtime')
  })
})
