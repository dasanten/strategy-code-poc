import { SCRIPT_STEP_BUDGET } from '@csp/balance'
import type { Resident, ScriptRunError, ScriptRunSteps, ScriptSummary } from '@csp/shared-types'
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

/**
 * A waiting script's line (`CONTEXT.md`: Running a script, Waiting): "Waiting until the order
 * ends · began 5 minutes ago".
 */
export function waitingText(since: number, tick: number): string {
  return `Waiting until the order ends · began ${agoText(tick - since)}`
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

/**
 * The scripts the Alarm script picker offers after Alarm (default) and None (`CONTEXT.md`: Alarm
 * script): the Player's scripts with a version that can run, but for their Alarm, which is the
 * default already. `picked`, kept for a resident but gone from the library, stays listed, so the
 * picker shows it until an alarm falls back to Alarm.
 */
export function alarmChoices(
  scripts: readonly ScriptSummary[],
  picked?: number | 'none' | null,
): { id: number; name: string }[] {
  const choices = scripts.filter((s) => s.activeVersion !== null && s.task !== 'alarm')
  if (typeof picked === 'number' && !choices.some((s) => s.id === picked))
    return [...choices, { id: picked, name: 'a script no longer in your library' }]
  return choices
}

/**
 * The Alarm script a group keeps: the one all of them have picked or None, null when all run the
 * Alarm default, undefined when they differ.
 */
export function groupAlarmScript(
  residents: readonly Pick<Resident, 'alarmScriptId'>[],
): number | 'none' | null | undefined {
  const picked = new Set(residents.map((r) => r.alarmScriptId ?? null))
  return picked.size === 1 ? [...picked][0] : undefined
}

/**
 * The script Run script starts on: the one the Player picked, else the one the resident or army
 * runs now, else the one this browser last saw them run; each only while it can run. Undefined
 * leaves the picker on "Pick a script…" and Run disabled, rather than on whichever script comes
 * first.
 */
export function runScriptPick(
  runnable: readonly Pick<ScriptSummary, 'id'>[],
  { picked, running, last }: { picked?: number; running?: number; last?: number },
): number | undefined {
  return [picked, running, last].find((id) => runnable.some((s) => s.id === id))
}

/** Where the browser keeps the script each resident or army was last seen running, by id. */
const LAST_SCRIPT_KEY = 'csp.lastScript'

/** The script this browser last saw this resident or army run (or gave them), if any. */
export function rememberedLastScript(
  id: string,
  storage: () => Pick<Storage, 'getItem'> = () => localStorage,
): number | undefined {
  try {
    const last: unknown = JSON.parse(storage().getItem(LAST_SCRIPT_KEY) ?? '{}')?.[id]
    return typeof last === 'number' ? last : undefined
  } catch {
    // Storage can be off (a private window) or hold something else; then nothing is known.
    return undefined
  }
}

/** Remembers the script a resident or army runs, if the browser lets us. */
export function rememberLastScript(
  id: string,
  scriptId: number,
  storage: () => Pick<Storage, 'getItem' | 'setItem'> = () => localStorage,
): void {
  try {
    const all: unknown = JSON.parse(storage().getItem(LAST_SCRIPT_KEY) ?? '{}')
    const kept = all && typeof all === 'object' ? all : {}
    storage().setItem(LAST_SCRIPT_KEY, JSON.stringify({ ...kept, [id]: scriptId }))
  } catch {
    // Not remembered: Run script then starts on "Pick a script…".
  }
}
