/** Keep the generation clock below the conversation/composer render owner. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getBrailleSpinnerFrame } from './ui-copy.ts'

export function GeneratingSpinner({ active, children }: {
  readonly active: boolean
  readonly children: (frame: string | undefined) => ReactNode
}): ReactNode {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick(tick => (tick + 1) % 10000), 100)
    return () => clearInterval(timer)
  }, [active])
  return children(active ? getBrailleSpinnerFrame(Date.now()) : undefined)
}
