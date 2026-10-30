import {
  isParamNumber,
  targetParam,
  type OrderRequest,
  type ScriptParam,
  type ScriptParamValue,
  type ScriptParamValues,
  type ScriptSummary,
  type StartParamValues,
} from '@csp/shared'

/**
 * The form shown before a script starts (`CONTEXT.md`: Script parameter, Before it starts):
 * giving a task or Run script whose script declares params first shows them, filled with the
 * resident's kept values or the defaults; Start gives the order with them. The server checks the
 * values again (ADR 0002).
 */

/** What the form holds for each param: the value picked or typed, or none (empty). */
export type StartValues = Record<string, ScriptParamValue | undefined>

/**
 * The script an order starts, from the Player's library: the one Run script names, or the
 * Player's version of a task's default script. Undefined for an order that starts none.
 */
export function startedScript(
  order: OrderRequest,
  scripts: readonly ScriptSummary[],
): ScriptSummary | undefined {
  if (order.kind === 'runScript') return scripts.find((s) => s.id === order.scriptId)
  if (order.kind === 'task') return scripts.find((s) => s.task === order.task)
  return undefined
}

/**
 * The params the form shows for an order starting `script`: its `param` lines, but for a task
 * not the script's target param (`targetParam`; `CONTEXT.md`: Started directly), which the task
 * fills itself.
 */
export function startFormParams(order: OrderRequest, script: ScriptSummary): ScriptParam[] {
  const target = targetParam(script)
  return order.kind === 'task' ? script.params.filter((p) => p.name !== target) : script.params
}

/** A kept value that still fits the param's type: a number for a `number` param, else an id. */
function fits(param: ScriptParam, value: ScriptParamValue | undefined): boolean {
  return param.type === 'number' ? typeof value === 'number' : typeof value === 'string'
}

/**
 * The form's starting values for a resident: the value they keep for each param of the script,
 * else its default, else none. The script's `target` param is never kept between starts, so it
 * starts empty: the one they stand on.
 */
export function startValues(
  params: readonly ScriptParam[],
  kept: ScriptParamValues[string] | undefined,
  target?: string,
): StartValues {
  return Object.fromEntries(
    params.map((p) => {
      const value = p.name === target ? undefined : kept?.[p.name]
      return [p.name, fits(p, value) ? value : p.default]
    }),
  )
}

/**
 * The form's starting values for a group: a value all of them keep, else the param's default,
 * else none; the `target` param empty.
 */
export function groupStartValues(
  params: readonly ScriptParam[],
  keptByEach: readonly (ScriptParamValues[string] | undefined)[],
  target?: string,
): StartValues {
  const each = keptByEach.map((kept) => startValues(params, kept, target))
  return Object.fromEntries(
    params.map((p) => {
      const values = new Set(each.map((v) => v[p.name]))
      const [shared] = values
      return [p.name, values.size === 1 && shared !== undefined ? shared : p.default]
    }),
  )
}

/** Whether Start can give the values: every number typed is whole and zero or more. */
export function startValuesValid(params: readonly ScriptParam[], values: StartValues): boolean {
  return params.every(
    (p) => p.type !== 'number' || values[p.name] === undefined || isParamNumber(values[p.name]),
  )
}

/**
 * The values the order carries: one for each param, null for those left empty and for a number
 * equal to its default, which clears what was kept so the param reads its default.
 */
export function startParamValues(
  params: readonly ScriptParam[],
  values: StartValues,
): StartParamValues {
  return Object.fromEntries(
    params.map((p) => {
      const value = values[p.name]
      return [p.name, value === undefined || value === p.default ? null : value]
    }),
  )
}
