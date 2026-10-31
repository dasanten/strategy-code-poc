import {
  SCRIPT_STEP_BUDGET,
  type Resident,
  type ScriptRunError,
  type ScriptRunSteps,
  type ScriptSummary,
} from '@csp/shared'
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

/**
 * The scripts the Defence script picker offers after Defend (default) (`CONTEXT.md`: Defence
 * script): the Player's scripts with a version that can run, but for their Defend, which is the
 * default already. `picked`, kept for a resident but gone from the library, stays listed, so the
 * picker shows it until a blow falls back to Defend.
 */
export function defenceChoices(
  scripts: readonly ScriptSummary[],
  picked?: number | null,
): { id: number; name: string }[] {
  const choices = scripts.filter((s) => s.activeVersion !== null && s.task !== 'defend')
  if (typeof picked === 'number' && !choices.some((s) => s.id === picked))
    return [...choices, { id: picked, name: 'a script no longer in your library' }]
  return choices
}

/**
 * The defence script a group keeps: the one all of them have picked, null when all run the
 * Defend default, undefined when they differ.
 */
export function groupDefenceScript(
  residents: readonly Pick<Resident, 'defenceScriptId'>[],
): number | null | undefined {
  const picked = new Set(residents.map((r) => r.defenceScriptId ?? null))
  return picked.size === 1 ? [...picked][0] : undefined
}
