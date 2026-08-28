/**
 * Checks the live ownership relationship between launcher signal handlers, TUI
 * signal handlers, root-effect phase, and asynchronous runtime work.
 * @module @deepseek-ai/dsh-tui/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { assertNever } from '@deepseek-ai/dsh-llm'
import {
  observeTuiRuntimeLifecycle,
  type TuiRuntimeLifecycleSnapshot,
} from '@deepseek-ai/dsh-tui'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui'

/** Cordis companion plugin name. */
export const name = 'tui-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** Validate one root-effect ownership transition. */
function validateLifecycle(
  fail: InvariantFailure,
  snapshot: TuiRuntimeLifecycleSnapshot,
): void {
  if (
    snapshot.launcherSignals === 'consumer-owned'
    && (snapshot.tuiSignals === 'absent' || snapshot.tuiSignals === 'disposed')
  ) {
    return fail('launcher signals are released while the TUI owns no protective hooks')
  }

  const phase = snapshot.phase
  switch (phase) {
    case 'starting':
      if (snapshot.runWork !== 'open') {
        fail('a starting TUI runtime must keep its run work open')
      }
      return
    case 'active':
      if (
        snapshot.runWork !== 'open'
        || snapshot.tuiSignals !== 'owned'
        || snapshot.launcherSignals === 'generic-owned'
      ) {
        fail('an active TUI runtime must exclusively own its hooks and open run work')
      }
      return
    case 'ordinary-unload':
      if (snapshot.runWork !== 'quiescing') {
        fail('ordinary TUI unload must quiesce its owned work')
      }
      return
    case 'process-exit':
      if (
        snapshot.tuiSignals !== 'retained'
        || snapshot.launcherSignals === 'generic-owned'
        || snapshot.runWork === 'open'
      ) {
        fail('process-exit teardown must retain exclusive TUI hooks while work drains')
      }
      return
    case 'settled':
      if (
        snapshot.runWork !== 'settled'
        || snapshot.tuiSignals !== 'disposed'
        || snapshot.launcherSignals === 'consumer-owned'
      ) {
        fail('settled ordinary unload must restore launcher ownership and release TUI resources')
      }
      return
    /* v8 ignore next -- lifecycle phases are closed; retain compile-time exhaustiveness. */
    default:
      assertNever(phase, 'TuiRuntimeLifecycleSnapshot.phase')
  }
}

/**
 * Validate one observable TUI runtime lifecycle snapshot.
 * @param snapshot - ownership facts published by the runtime.
 * @param fail - invariant failure sink.
 */
export function validateTuiRuntimeLifecycle(
  snapshot: TuiRuntimeLifecycleSnapshot,
  fail: InvariantFailure,
): void {
  validateLifecycle(fail, snapshot)
}

/**
 * Observe the package-owned lifecycle facts rather than service presence. A live
 * root effect always has a protective signal owner: ordinary unload restores
 * launcher ownership before dropping TUI hooks, while process exit retains the
 * exclusive TUI hooks until termination.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.effect(
    () => observeTuiRuntimeLifecycle(validateLifecycle.bind(undefined, fail)),
    'tuiInvariant.lifecycle',
  )
}

/**
 * Register the TUI signal/run-work relationship invariant.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns a promise for the registration disposer after setup succeeds.
 * @throws when invariant registration fails synchronously.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
