import {
  commanderOf,
  DEFEND_CALM_TICKS,
  type Resident,
  type ResidentOrder,
  type WorldState,
} from '@csp/shared'
import type { Invariant } from './invariants.js'

/**
 * Defence scripts (`CONTEXT.md`: Defence script; ADR 0015). A blow that leaves a Player's
 * resident alive starts their defence script, the Defend default, which runs as `script` like
 * any other; what they were doing, their order and the script they ran with its memory, is kept
 * aside in `interrupted`, and their queue waits. When the defence script ends they go on with
 * it. A Player order given meanwhile ends both (`OrderQueue`), and further blows leave it alone
 * (`CONTEXT.md`: A Player's order under attack; `Resident.givenUnderAttack`).
 */

/**
 * Whether a struck resident `t` reacts by their defence script: one a realm commands, outside an
 * army, whose scripts that realm runs. Others, of an NPC city, of no city or in an army, react
 * as the game's Defend says by built-in orders (`react` in combat.ts).
 */
export function defendsByScript(world: WorldState, t: Resident): boolean {
  return commanderOf(world, t) !== null && !world.armies.some((a) => a.memberIds.includes(t.id))
}

/**
 * Starts `t`'s defence script, keeping what they were doing aside; not again while one runs
 * (`CONTEXT.md`: Defence script). It is the script their Player picked for them
 * (`Resident.defenceScriptId`) while that Player commands them, else the Defend default of the
 * realm commanding them (script id 0, which the runner resolves). Either runs as task `defend`.
 * Nor does it start over what the Player gave them under attack, while that holds.
 */
export function startDefence(world: WorldState, t: Resident): void {
  if (t.interrupted || t.givenUnderAttack) return
  // Being struck ends a wait (`CONTEXT.md`: Running a script, Waiting): back, it runs again.
  if (t.script) delete t.script.waitingSince
  t.interrupted = { order: t.order, ...(t.script ? { script: t.script } : {}) }
  t.order = null
  const picked = commanderOf(world, t) === t.owner ? t.defenceScriptId : undefined
  t.script = { scriptId: picked ?? 0, task: 'defend', memory: {} }
}

/**
 * The defence script ended: what it interrupted goes on, the script with its memory, the order
 * where it was, the queue step with them. An order on its way finds its way again from where
 * they stand now. False when no defence script ran.
 */
export function resumeInterrupted(r: Resident): boolean {
  const kept = r.interrupted
  if (!kept) return false
  delete r.interrupted
  const o = kept.order
  if (o && 'path' in o && o.path) Object.assign(o, { path: null, progress: 0 })
  r.order = o
  if (kept.script) r.script = kept.script
  else delete r.script
  return true
}

/**
 * The order kinds that go on until stopped (`CONTEXT.md`: A Player's order under attack); every
 * other order ends by itself.
 */
const GOES_ON_UNTIL_STOPPED: ReadonlySet<ResidentOrder['kind']> = new Set([
  'haul',
  'workAt',
  'teach',
  'train',
])

/**
 * Whether `r` counts as under attack for an order given now (`CONTEXT.md`: A Player's order under
 * attack): their defence script runs, or the last blow is within the calm time Defend waits for.
 */
export function underAttack(world: WorldState, r: Resident): boolean {
  if (r.interrupted) return true
  return r.struck !== undefined && world.tick - r.struck.tick < DEFEND_CALM_TICKS
}

/**
 * A Player's order was just applied to `r`, who had `orderBefore` and was `wasUnderAttack` when it
 * came: marks what it gave them, if it holds against further blows (`Resident.givenUnderAttack`).
 * Only an order that replaced what they do counts; one that changed nothing leaves the mark as it
 * is. Army members and residents with no Player don't defend by script, so they get none.
 */
export function noteGiven(
  world: WorldState,
  r: Resident,
  wasUnderAttack: boolean,
  orderBefore: ResidentOrder | null,
): void {
  if (r.order === orderBefore && !r.script && !r.queue) return
  delete r.givenUnderAttack
  if (!wasUnderAttack || !defendsByScript(world, r)) return
  if (r.script || r.queue || (r.order && GOES_ON_UNTIL_STOPPED.has(r.order.kind))) {
    r.givenUnderAttack = 'untilCalm'
  } else if (r.order) {
    r.givenUnderAttack = 'untilDone'
  }
}

/**
 * A blow is coming at `r`, before it counts as their last: what the Player gave them under attack
 * no longer holds if nothing of it goes on, or if it is to hold until calm and no blow has landed
 * for the calm time. Dodged blows count, as for Defend.
 */
export function endHoldIfOver(world: WorldState, r: Resident): void {
  if (!r.givenUnderAttack) return
  const goesOn = r.order !== null || r.script !== undefined || r.queue !== undefined
  const calm =
    r.givenUnderAttack === 'untilCalm' &&
    (r.struck === undefined || world.tick - r.struck.tick >= DEFEND_CALM_TICKS)
  if (!goesOn || calm) delete r.givenUnderAttack
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: A Player's order under attack): a resident whose order is
 * marked as standing has no defence script running and nothing kept in `interrupted`.
 */
export const givenUnderAttackSound: Invariant = {
  name: 'given-under-attack-sound',
  check: (world) =>
    world.residents
      .filter((r) => r.givenUnderAttack && (r.interrupted || r.script?.task === 'defend'))
      .map((r) => ({
        invariant: 'given-under-attack-sound',
        message: `${r.id} has an order standing under attack but runs their defence script`,
        entityIds: [r.id],
      })),
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Defence script): a resident with something kept aside in
 * `interrupted` is running their defence script.
 */
export const interruptedSound: Invariant = {
  name: 'interrupted-runs-defence',
  check: (world) =>
    world.residents
      .filter((r) => r.interrupted && r.script?.task !== 'defend')
      .map((r) => ({
        invariant: 'interrupted-runs-defence',
        message: `${r.id} has something interrupted but runs no defence script`,
        entityIds: [r.id],
      })),
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Defence script): a resident's picked defence script is a
 * script id, a whole positive number.
 */
export const defenceScriptSound: Invariant = {
  name: 'defence-script-sound',
  check: (world) =>
    world.residents
      .filter(
        (r) =>
          r.defenceScriptId !== undefined &&
          (!Number.isInteger(r.defenceScriptId) || r.defenceScriptId <= 0),
      )
      .map((r) => ({
        invariant: 'defence-script-sound',
        message: `${r.id} keeps defence script ${r.defenceScriptId}, which can't be one`,
        entityIds: [r.id],
      })),
}
