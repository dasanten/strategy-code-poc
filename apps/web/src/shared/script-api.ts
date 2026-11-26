// Ported from packages/shared/src/script-api.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { ScriptParam } from '@csp/shared-types'

export { isParamNumber } from '@csp/lang-wasm'

export { SCRIPT_PARAM_TYPES } from '@csp/shared-types'

/** Whether a value fits a `choice` param: one of the words its line lists. */
export function isParamChoice(param: Pick<ScriptParam, 'choices'>, value: unknown): boolean {
  return typeof value === 'string' && (param.choices?.includes(value) ?? false)
}
