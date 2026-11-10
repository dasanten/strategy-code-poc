// Ported from packages/shared/src/script-api.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { ScriptParam } from '@csp/shared-types'
/**
 * What a script's `param` line can hold (`CONTEXT.md`: Script parameter): `param name: type`
 * at the top of a script, read as `params.name`, picked per resident on their card. The same
 * types as `PARAM_TYPES` in `@csp/lang`.
 */
export const SCRIPT_PARAM_TYPES = ['building', 'storage', 'number', 'choice', 'waypoint'] as const

/** Whether a value fits a `number` param: a whole number of zero or more. */
export function isParamNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Whether a value fits a `choice` param: one of the words its line lists. */
export function isParamChoice(param: Pick<ScriptParam, 'choices'>, value: unknown): boolean {
  return typeof value === 'string' && (param.choices?.includes(value) ?? false)
}
