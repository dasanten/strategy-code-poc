import { commanderOf, type Resident, type WorldState } from '@csp/shared'
import type { Invariant } from './invariants.js'

/**
 * Defence scripts (`CONTEXT.md`: Defence script; ADR 0015). A blow that leaves a Player's
 * resident alive starts their defence script, the Defend default, which runs as `script` like
 * any other; what they were doing, their order and the script they ran with its memory, is kept
 * aside in `interrupted`, and their queue waits. When the defence script ends they go on with
 * it. A Player order given meanwhile ends both (`OrderQueue`).
 */

/**
 * Whether a struck resident `t` reacts by their defence script: one a realm commands, outside an
 * army, whose scripts that realm runs. Others, of an NPC city, of no city or in an army, react
 * as the game's Defend says by built-in orders (`react` in combat.ts).
 */
export function defendsByScript(world: WorldState, t: Resident): boolean {
  return (
    commanderOf(world, t) !== null && !world.armies.some((a) => a.memberIds.includes(t.id))
  )
}

/**
 * Starts `t`'s defence script, keeping what they were doing aside; not again while one runs
 * (`CONTEXT.md`: Defence script).
 */
export function startDefence(t: Resident): void {
  if (t.interrupted) return
  t.interrupted = { order: t.order, ...(t.script ? { script: t.script } : {}) }
  t.order = null
  t.script = { scriptId: 0, task: 'defend', memory: {} }
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
