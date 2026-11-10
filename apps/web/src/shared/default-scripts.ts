// Ported from packages/shared/src/default-scripts.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { ScriptParam, Task } from '@csp/shared-types'

/**
 * The param each task's default script takes its target in (`CONTEXT.md`: Default script,
 * Started directly). Giving the task fills it; unset, the default works the one on the
 * resident's tile when it starts. It is never kept between starts, unlike the script's other
 * params.
 */
export const TARGET_PARAMS: Partial<Readonly<Record<Task, string>>> = {
  work: 'workplace',
  build: 'site',
  haul: 'carriage',
  tearDown: 'building',
  breed: 'stable',
  feedStable: 'stable',
  train: 'ground',
}

/** The target param of a script (`TARGET_PARAMS`), if it is the default of a task with one. */
export function targetParam(script: { task?: Task | null }): string | undefined {
  return script.task ? TARGET_PARAMS[script.task] : undefined
}

/** The param a work script is given its workplace in: the Work default's target param. */
export const WORKPLACE_PARAM = 'workplace'

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
