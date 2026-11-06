import {
  WORKPLACE_PARAM,
  isParamChoice,
  isParamNumber,
  isWorkScript,
  paramNeedsValue,
  targetParam,
  type OrderRequest,
  type ScriptParam,
  type ScriptParamValue,
  type ScriptParamValues,
  type ScriptSummary,
  type StartParamValues,
  type WorkplaceSettings,
} from '@csp/shared'

/**
 * The form shown before a script starts (`CONTEXT.md`: Script parameter, Starting at once, Before
 * it starts): a task or Run script starts at once, with no params in the order, so each resident
 * goes on with what they keep. Customise beside the order opens the form, filled with the
 * resident's kept values or the defaults, and Start gives the order with them; it opens by itself
 * for a param the script has nothing to go on without (`startFormOpens`). The server checks the
 * values again (ADR 0002).
 */

/** What the form holds for each param: the value picked or typed, or none (empty). */
export type StartValues = Record<string, ScriptParamValue | undefined>

/** The orders that pick a script for later, leaving what the resident does as it is. */
const PICKS_A_SCRIPT: ReadonlySet<string> = new Set(['setDefenceScript', 'setAlarmScript'])

/**
 * The script an order starts, from the Player's library: the one Run script names, the defence or
 * Alarm script picked (`CONTEXT.md`: Defence script, Alarm script), whose params are picked then,
 * the work script of the workplace Work is given at (`workScriptOf`), or the Player's version of any other task's
 * default script. Undefined for an order that starts none.
 */
export function startedScript(
  order: OrderRequest,
  scripts: readonly ScriptSummary[],
  workSettings: Readonly<Record<string, WorkplaceSettings>> = {},
): ScriptSummary | undefined {
  if (order.kind === 'runScript' || PICKS_A_SCRIPT.has(order.kind))
    return scripts.find((s) => s.id === order.scriptId)
  if (isWorkTask(order)) return workScriptOf(scripts, workSettings[order.workplaceId as string])
  if (order.kind === 'task') return scripts.find((s) => s.task === order.task)
  return undefined
}

/** Whether the order gives Work at a workplace, which runs by its settings. */
export function isWorkTask(order: OrderRequest): boolean {
  return order.kind === 'task' && order.task === 'work' && typeof order.workplaceId === 'string'
}

/**
 * The work script a workplace's settings name (`CONTEXT.md`: Workplace settings), while it is
 * still one of the Player's work scripts, else their Work default; as the server picks it.
 */
export function workScriptOf(
  scripts: readonly ScriptSummary[],
  settings: WorkplaceSettings | undefined,
): ScriptSummary | undefined {
  const picked = scripts.find((s) => s.id === settings?.scriptId)
  if (picked && isWorkScript(picked.params)) return picked
  return scripts.find((s) => s.task === 'work')
}

/**
 * The params the form shows for an order starting `script`: its `param` lines, but for a task
 * not the script's target param (`targetParam`; `CONTEXT.md`: Started directly), which the task
 * fills itself; for Work, `workplace`, whatever the work script.
 */
export function startFormParams(order: OrderRequest, script: ScriptSummary): ScriptParam[] {
  const target = isWorkTask(order) ? WORKPLACE_PARAM : targetParam(script)
  return order.kind === 'task' ? script.params.filter((p) => p.name !== target) : script.params
}

/**
 * Whether the order opens the form instead of starting at once, given the params it shows
 * (`startFormParams`): when Customise asked for it, or a param needs a value (`paramNeedsValue`).
 * A defence or Alarm script starts nothing, so its params are still picked when it is picked.
 */
export function startFormOpens(
  order: OrderRequest,
  params: readonly ScriptParam[],
  customise: boolean,
): boolean {
  if (params.length === 0) return false
  return customise || PICKS_A_SCRIPT.has(order.kind) || params.some(paramNeedsValue)
}

/** Whether Customise has anything to show for the order: its script has params in the form. */
export function canCustomise(
  order: OrderRequest,
  scripts: readonly ScriptSummary[],
  workSettings: Readonly<Record<string, WorkplaceSettings>> = {},
): boolean {
  const script = startedScript(order, scripts, workSettings)
  return script !== undefined && startFormParams(order, script).length > 0
}

/**
 * A kept value that still fits the param: a number for a `number` param, one of its words for a
 * `choice` param, else an id.
 */
function fits(param: ScriptParam, value: ScriptParamValue | undefined): boolean {
  if (param.type === 'number') return typeof value === 'number'
  if (param.type === 'choice') return isParamChoice(param, value)
  return typeof value === 'string'
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

/**
 * The values Work gives with the form filled from the workplace's settings (`CONTEXT.md`:
 * Workplace settings): only those the Player changed from what the form started with, which
 * become the resident's overrides. Those left as they were read the workplace's, live; one
 * emptied too.
 */
export function overrideParamValues(
  params: readonly ScriptParam[],
  base: StartValues,
  values: StartValues,
): StartParamValues {
  const changed: StartParamValues = {}
  for (const p of params) {
    const value = values[p.name]
    if (value !== undefined && value !== base[p.name]) changed[p.name] = value
  }
  return changed
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
