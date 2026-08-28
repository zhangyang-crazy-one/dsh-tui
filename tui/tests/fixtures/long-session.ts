/**
 * Deterministic 2000-message long-session fixture for the SC4 PTY measurement
 * (03-09). Writes an alternating user/assistant session through the JSONL
 * persistence backend and reports the session id and jsonl path; the spec
 * reuses the same entry points to pin byte determinism, the 2000-message
 * load/seed rebuild, first/last content, and a headless FrameProbe snapshot
 * smoke. The session materializes at runtime into the requested root — no
 * fixture data is committed. Running this file directly prints the session id
 * and the exact PTY command the operator runs in a real terminal.
 * @module fixture (tests/fixtures/long-session)
 */

import { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MessageId } from '@deepseek-ai/dsh-llm'

/** One thousand completed turns, each with one user and one assistant message. */
export const LONG_SESSION_TURNS = 1000
/** Total messages in the fixture (user + assistant per turn). */
export const LONG_SESSION_MESSAGES = LONG_SESSION_TURNS * 2
/** Stable id so the PTY run can `--resume` the fixture without copying paths. */
export const LONG_SESSION_ID = 'session-sc4-2000'

/** The fixture artifact: root, id, absolute jsonl path, and the seeded events. */
export interface LongSessionFixture {
  /** Persistence root the session was written into. */
  root: string
  /** Session id to resume with `--resume <id>`. */
  id: string
  /** Absolute jsonl artifact path (backend-located, exists after flush). */
  jsonlPath: string
  /** The deterministic seeded events (assertions and seed-rebuilds use it). */
  events: readonly SessionEvent[]
}

/**
 * One deterministic message body. Content is a pure function of the message
 * index, role, and seed, so two generations with the same seed are
 * byte-identical. Multi-line CJK + ASCII bodies give the scroll render path
 * realistic width and line variety without an RNG.
 * @param index - zero-based message index (0..1999).
 * @param role - user or assistant.
 * @param seed - determinism seed (default 0).
 * @returns the multi-line message text.
 */
export function longSessionText(
  index: number,
  role: 'user' | 'assistant',
  seed = 0,
): string {
  const n = index + 1
  const module = (index * 7 + seed) % 97
  const options = (index * 13 + seed) % 23
  if (role === 'user') {
    return [
      `问题 ${n}（seed ${seed}）：请解释模块 ${module} 的输入契约与失败语义。`,
      `背景：该模块负责解析上游参数，含 ${options} 个可配置项，超出即报错。`,
    ].join('\n')
  }
  return [
    `回答 ${n}（seed ${seed}）：模块 ${module} 的契约如下。`,
    `- 输入：${options} 个配置项，逐项校验，非法值 fail loud。`,
    '- 失败语义：不可写路径、超时与缺失依赖均显式报错，绝不静默降级。',
    `- 示例：\`dsh --profile deepseek-tui --resume ${(index * 3 + seed) % 1000}\``,
    `测量行：第 ${n} 条消息，确定性内容，用于 2000+ 消息滚动渲染成本测量。`,
  ].join('\n')
}

/**
 * The deterministic 4000-event log (turn/start, user/message,
 * assistant/message, turn/end per turn) for one seed.
 * @param seed - determinism seed (default 0).
 * @returns the contiguous event list, seq 0..3999.
 */
export function longSessionEvents(seed = 0): readonly SessionEvent[] {
  const events: SessionEvent[] = []
  const base = 1_700_000_000_000
  for (let turn = 1; turn <= LONG_SESSION_TURNS; turn += 1) {
    const seq = (turn - 1) * 4
    const time = base + (turn - 1) * 4000
    const userIndex = (turn - 1) * 2
    events.push({ type: 'turn/start', seq, time, data: { turn } })
    events.push({
      type: 'user/message',
      seq: seq + 1,
      time: time + 1,
      data: {
        role: 'user',
        // Deterministic identity: the createUserMessage factory assigns a
        // randomUUID, which would break the byte-identical regeneration pin.
        id: MessageId(`msg-${userIndex}`),
        content: [
          { type: 'text', text: longSessionText(userIndex, 'user', seed) },
        ],
        source: { kind: 'user' },
      },
      surfaceOp: 'append',
    })
    events.push({
      type: 'assistant/message',
      seq: seq + 2,
      time: time + 2,
      data: {
        turn,
        step: 1,
        message: {
          role: 'assistant',
          id: MessageId(`msg-${userIndex + 1}`),
          content: [
            {
              type: 'text',
              text: longSessionText(userIndex + 1, 'assistant', seed),
            },
          ],
          source: {
            kind: 'model',
            provider: 'test-provider',
            model: 'test-model',
          },
        },
      },
      surfaceOp: 'append',
    })
    events.push({
      type: 'turn/end',
      seq: seq + 3,
      time: time + 3,
      data: { turn, reason: { kind: 'completed' } },
    })
  }
  return events
}

/**
 * Persist the fixture session into `root` and report its id and jsonl path.
 * A previous fixture run under the same id is deleted first so the artifact
 * holds exactly 2000 messages again (the fixture session is disposable).
 * @param root - the JSONL persistence root.
 * @param options - id and seed overrides.
 * @returns the written fixture.
 */
export async function writeLongSession(
  root: string,
  options: { id?: string; seed?: number } = {},
): Promise<LongSessionFixture> {
  const id = options.id ?? LONG_SESSION_ID
  const events = longSessionEvents(options.seed ?? 0)
  const writer = new Context()
  await writer.plugin(SessionStore)
  await writer.plugin(JsonlSessionPersistence, { root })
  try {
    await writer.sessionPersistence.delete(SessionId(id))
  } catch {
    // Absent fixture session: nothing to replace.
  }
  const session = writer.sessions.create(SessionId(id), { seed: events })
  await writer.sessions.flush(session)
  const location = writer.sessionPersistence.locate(session.header)
  await writer.fiber.dispose()
  if (location === undefined) {
    throw new Error(
      `long-session fixture: ${id} has no durable artifact under ${root}`,
    )
  }
  return { root, id, jsonlPath: location.path, events }
}

/**
 * The app's JSONL persistence root: `$DSH_HOME/sessions`, else
 * `~/.dsh/sessions` (mirrors `@deepseek-ai/dsh-home-paths` precedence).
 */
function defaultSessionsRoot(): string {
  const home =
    process.env.DSH_HOME === undefined || process.env.DSH_HOME.trim() === ''
      ? join(homedir(), '.dsh')
      : process.env.DSH_HOME
  return join(home, 'sessions')
}

/** CLI: generate the fixture where the app reads it and print the PTY command. */
async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const homeFlag = argv.indexOf('--home')
  const explicit =
    homeFlag >= 0 && argv[homeFlag + 1] !== undefined
      ? argv[homeFlag + 1] ?? ''
      : ''
  const home = explicit === '' ? resolve(defaultSessionsRoot(), '..') : resolve(explicit)
  const root = join(home, 'sessions')
  const fixture = await writeLongSession(root)
  process.stdout.write(
    [
      `long-session fixture: wrote ${LONG_SESSION_MESSAGES} messages (${LONG_SESSION_TURNS} turns)`,
      `session id: ${fixture.id}`,
      `jsonl path: ${fixture.jsonlPath}`,
      '',
      'SC4 PTY run (real terminal, DEEPSEEK_API_KEY set):',
      `  DSH_HOME=${home} dsh --profile deepseek-tui --frame-stats /tmp/sc4-frames.json --resume ${fixture.id}`,
      '',
      'Exit orderly with double Ctrl+C (stop generation, then confirm exit) so',
      'the frame-stats JSON flushes to the --frame-stats path; then record its',
      'renderMs statistics (mean/max/p95 + count) and environment.',
      '',
    ].join('\n'),
  )
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `long-session fixture: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
