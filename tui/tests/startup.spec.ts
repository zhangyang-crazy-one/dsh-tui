import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  apply,
  parseTuiArgs,
  TUI_STARTUP_SERVICE,
  name,
  inject,
  type TuiStartupValues,
} from '../src/startup.ts'

describe('parseTuiArgs', () => {
  it('parses a plain task positional', () => {
    const values = parseTuiArgs(['说 hi', 'again'])
    expect(values.task).toBe('说 hi again')
    expect(values.resume).toBeUndefined()
    expect(values.cwd).toBeUndefined()
  })

  it('parses --resume and --cwd options', () => {
    const values = parseTuiArgs(['--resume', 's1', '--cwd', '/tmp/x', 'hello'])
    expect(values).toEqual({ task: 'hello', resume: 's1', cwd: '/tmp/x' })
  })

  it('parses --frame-stats and leaves it undefined when absent', () => {
    const values = parseTuiArgs([
      '--frame-stats',
      'stats/frames.json',
      'hi',
    ])
    expect(values.task).toBe('hi')
    expect(values.frameStats).toBe('stats/frames.json')
    expect(parseTuiArgs(['hi']).frameStats).toBeUndefined()
  })

  it('returns an empty task for no positional', () => {
    const values = parseTuiArgs([])
    expect(values.task).toBe('')
  })
})

describe('startup plugin surface', () => {
  it('exposes the stable plugin name and injection', () => {
    expect(name).toBe('tui-startup')
    expect(inject).toEqual(['cmdlineArgs'])
    expect(TUI_STARTUP_SERVICE).toBe('tuiStartup')
  })
})

describe('startup plugin through the cmdline seam', () => {
  /** What one provideCmdline boot observed. */
  interface Observed {
    exits: number[]
    out: string
  }

  afterEach(() => {
    internals.stdout = process.stdout
    internals.stderr = process.stderr
  })

  /**
   * Mount the real provider through provideCmdline, the seam the launcher
   * uses, so the action publishes exactly what the terminal driver reads.
   */
  async function boot(args: string[]): Promise<{ values: TuiStartupValues | undefined; observed: Observed }> {
    const observed: Observed = { exits: [], out: '' }
    const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
    internals.stdout = observing
    internals.stderr = observing
    const ctx = new Context()
    provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
    await ctx.plugin(apply)
    return { values: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined, observed }
  }

  it('publishes the task and every option the launcher handed over', async () => {
    const { values, observed } = await boot([
      '--resume', 's-42',
      '--cwd', '/tmp/work',
      '--frame-stats', 'stats/frames.json',
      '说 hi', 'again',
    ])
    expect(values).toEqual({
      task: '说 hi again',
      resume: 's-42',
      cwd: '/tmp/work',
      frameStats: 'stats/frames.json',
    })
    expect(observed.exits).toEqual([])
  })

  it('leaves each option absent when the invocation did not name it', async () => {
    const { values, observed } = await boot(['hi'])
    expect(values).toEqual({ task: 'hi' })
    expect(observed.exits).toEqual([])
  })

  it('publishes an empty task for a no-argument invocation (zero-arg boot)', async () => {
    const { values, observed } = await boot([])
    expect(values).toEqual({ task: '' })
    expect(observed.exits).toEqual([])
    expect(observed.out).toBe('')
  })

  it('treats a whitespace-only positional as an empty task', async () => {
    const { values, observed } = await boot(['   '])
    expect(values).toEqual({ task: '' })
    expect(observed.exits).toEqual([])
  })
})
