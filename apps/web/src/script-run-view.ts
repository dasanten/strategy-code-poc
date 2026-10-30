import { SCRIPT_STEP_BUDGET, type ScriptRunError, type ScriptRunSteps } from '@csp/shared'
import { agoText } from './last-seen.js'

/**
 * The Script tab's view of how a running script last ran (`CONTEXT.md`: Debugging a script,
 * Step budget): its last runtime error and the steps it used last tick.
 */

/** "312 / 2000 steps", and why it stopped when it ran out. */
export function stepsText(run: ScriptRunSteps): string {
  const used = `${run.steps} / ${SCRIPT_STEP_BUDGET} steps`
  if (run.outOfSteps === 'own') return `${used}: ran out, stopped for the tick`
  if (run.outOfSteps === 'realm') return `${used}: your realm’s scripts used up their steps`
  return used
}

/** Where and when the error was: "Line 3, column 9 · 5 minutes ago". */
export function errorWhen(error: ScriptRunError, tick: number): string {
  const where = error.line === undefined ? '' : `Line ${error.line}, column ${error.column} · `
  const ago = agoText(tick - error.tick)
  return `${where}${ago.charAt(0).toUpperCase()}${ago.slice(1)}`
}
