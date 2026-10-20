import { wrapDistance } from './terrain.js'
import type { Army, Carriage, Resident, WorldState } from './world.js'

/** World queries about armies (ADR 0002: the game API orders and scripts share). */

/** The longest an army's name may be. */
export const ARMY_NAME_MAX_LENGTH = 30

/** The army the resident is in, if any (`CONTEXT.md`: Army: at most one). */
export function armyOf(world: Pick<WorldState, 'armies'>, residentId: string): Army | undefined {
  return world.armies.find((a) => a.memberIds.includes(residentId))
}

/**
 * The army a driver's carriage goes after now (`CONTEXT.md`: Supply line): the one a drive order
 * follows as its supply wagon, or the one a haul route has as its second stop while it is bound
 * there or stands with it.
 */
export function armyDrivenTo(driver: Resident): string | undefined {
  const o = driver.order
  if (o?.kind === 'drive') return o.army
  if (o?.kind === 'haul' && o.stop === 'to') return o.toArmy
  return undefined
}

/**
 * Where an army is for a carriage at `from` that goes after it: the tile of its member nearest
 * `from`, on a map of `size` tiles. Undefined when the army is gone.
 */
export function armySpot(
  world: Pick<WorldState, 'armies' | 'residents'>,
  armyId: string,
  from: { x: number; y: number },
  size: number,
): { x: number; y: number } | undefined {
  const army = world.armies.find((a) => a.id === armyId)
  if (!army) return undefined
  let best: { at: { x: number; y: number }; d: number } | undefined
  for (const r of world.residents) {
    if (!army.memberIds.includes(r.id)) continue
    const d = wrapDistance(size, from, r)
    if (!best || d < best.d) best = { at: { x: r.x, y: r.y }, d }
  }
  return best?.at
}

/**
 * The Food on a carriage that army members may take (`CONTEXT.md`: Refilling from a carriage):
 * all of it, except what a haul route keeps on board for the horse.
 */
export function spareFood(world: Pick<WorldState, 'residents'>, carriage: Carriage): number {
  const driver = world.residents.find((r) => {
    const o = r.order
    return o?.kind === 'haul' && o.carriageId === carriage.id
  })
  const o = driver?.order
  const keep = o?.kind === 'haul' ? o.keepFood : 0
  return Math.max(0, (carriage.load.food ?? 0) - keep)
}
