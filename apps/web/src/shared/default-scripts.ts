// Ported from packages/shared/src/default-scripts.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { Task } from '@csp/shared-types'
import { TARGET_PARAMS as ALL_TARGET_PARAMS } from '@csp/shared-types'

export { targetParam, isWorkScript, paramNeedsValue } from '@csp/lang-wasm'

export { WORKPLACE_PARAM } from '@csp/shared-types'

/**
 * The param each task's default script takes its target in (`CONTEXT.md`: Default script,
 * Started directly). Giving the task fills it; unset, the default works the one on the
 * resident's tile when it starts. It is never kept between starts, unlike the script's other
 * params. Repair's is left out for now, as it was before the table came from Rust (decided
 * overnight, Daniel to confirm: bug #1630).
 */
export const TARGET_PARAMS: Partial<Readonly<Record<Task, string>>> = Object.fromEntries(
  Object.entries(ALL_TARGET_PARAMS).filter(([task]) => task !== 'repair'),
)
