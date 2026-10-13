/** Route test stream chunks through the live projector API beside durable events. */
import { createProjector } from '../src/projection.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'

export type ProjectorInput = SessionEvent | {
  type: 'test/stream-chunk'
  time: number
  data: { chunk: StreamChunk }
}

export function createTestProjector() {
  const projector = createProjector()
  const push = (input: ProjectorInput): void => {
    if (input.type === 'test/stream-chunk') {
      projector.pushStreamFrame({ type: 'chunk', time: input.time, chunk: input.data.chunk })
    } else {
      projector.push(input)
    }
  }
  return { ...projector, push, seed: (events?: readonly ProjectorInput[]): void => {
    for (const event of events ?? []) push(event)
  } }
}
