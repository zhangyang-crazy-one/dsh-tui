/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-render`.
 * @module @deepseek-ai/dsh-tui-render/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-render'

/** Cordis companion plugin name. */
export const name = 'tui-render-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the render layer is a pure consumer over session
 * events whose observable contract (styled output, frozen history, throttled
 * frames) is asserted by tests; it registers no service and holds no
 * mutable relation to audit inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
