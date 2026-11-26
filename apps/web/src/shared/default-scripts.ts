// Ported from packages/shared/src/default-scripts.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { ScriptParam, Task } from '@csp/shared-types'
import { TARGET_PARAMS as ALL_TARGET_PARAMS, WORKPLACE_PARAM } from '@csp/shared-types'

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

/** The target param of a script (`TARGET_PARAMS`), if it is the default of a task with one. */
export function targetParam(script: { task?: Task | null }): string | undefined {
  return script.task ? TARGET_PARAMS[script.task] : undefined
}

/**
 * Whether a script's `param` lines make it a work script (`CONTEXT.md`: Workplace settings): it
 * declares `param workplace: building`, as the Work default does.
 */
export function isWorkScript(params: readonly Pick<ScriptParam, 'name' | 'type'>[]): boolean {
  return params.some((p) => p.name === WORKPLACE_PARAM && p.type === 'building')
}

/**
 * Whether a script has nothing to go on without this param (`CONTEXT.md`: Script parameter, Before
 * it starts): it has no default and its comment says nothing after `none:`. The form before it
 * starts then opens by itself.
 */
export function paramNeedsValue(p: Pick<ScriptParam, 'default' | 'description'>): boolean {
  return p.default === undefined && !/\bnone:/.test(p.description ?? '')
}
