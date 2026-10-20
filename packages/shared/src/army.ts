import type { Army, WorldState } from './world.js'

/** World queries about armies (ADR 0002: the game API orders and scripts share). */

/** The longest an army's name may be. */
export const ARMY_NAME_MAX_LENGTH = 30

/** The army the resident is in, if any (`CONTEXT.md`: Army: at most one). */
export function armyOf(world: Pick<WorldState, 'armies'>, residentId: string): Army | undefined {
  return world.armies.find((a) => a.memberIds.includes(residentId))
}
