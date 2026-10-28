import { HORSE_REACH, STABLE_BREED_DAYS, STABLE_CAPACITY } from './balance.js'
import { carriagePulledBy } from './carriages.js'
import { covers, isAt } from './footprint.js'
import { pileAt } from './goods.js'
import { wrap } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  type Building,
  type Horse,
  type Stock,
  type WorldState,
} from './world.js'

/** World queries about horses and stables (ADR 0002: the game API orders and scripts share). */

/** Ticks of breeding a stable needs for one foal (`STABLE_BREED_DAYS`). */
export const STABLE_BREED_TICKS = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY

/** The finished stable whose footprint covers a tile, if there is one. */
export function stableAt(
  world: WorldState,
  x: number,
  y: number,
  size?: number,
): Building | undefined {
  return world.buildings.find((b) => b.kind === 'stable' && !b.site && covers(b, x, y, size))
}

/** The horses standing on a tile. */
export function horsesAt(world: WorldState, x: number, y: number): Horse[] {
  return world.horses.filter((h) => h.x === x && h.y === y)
}

/**
 * Where a horse finds Food it can eat, in the order it eats from them (`CONTEXT.md`: Horses have
 * no inventory): the load of the carriage it pulls, then the storage of the stable it stands in,
 * then the Food on the ground on its tile and within `HORSE_REACH` of it. Only places that hold
 * Food are listed.
 */
export function horseFood(world: WorldState, horse: Horse, mapSize: number): Stock[] {
  const out: Stock[] = []
  const load = carriagePulledBy(world, horse)?.load
  if ((load?.food ?? 0) > 0) out.push(load!)
  const stock = stableAt(world, horse.x, horse.y)?.stock
  if ((stock?.food ?? 0) > 0) out.push(stock!)
  for (let dy = -HORSE_REACH; dy <= HORSE_REACH; dy++) {
    for (let dx = -HORSE_REACH; dx <= HORSE_REACH; dx++) {
      const x = wrap(horse.x + dx, mapSize)
      const y = wrap(horse.y + dy, mapSize)
      const pile = pileAt(world, x, y)
      if ((pile?.goods.food ?? 0) > 0 && !out.includes(pile!.goods)) out.push(pile!.goods)
    }
  }
  return out
}

/**
 * Two fed horses of one realm (or NPC city) at a stable, who can breed a foal there (`CONTEXT.md`: Stable), or
 * undefined when there are none or the stable has no room for another horse.
 */
export function breedingPair(world: WorldState, stable: Building): [Horse, Horse] | undefined {
  const here = world.horses.filter((h) => isAt(h, stable))
  if (stable.site || stable.kind !== 'stable' || here.length >= STABLE_CAPACITY) return undefined
  const fed = here.filter((h) => h.hunger > 0)
  for (const a of fed) {
    const b = fed.find((h) => h !== a && h.realmId === a.realmId && h.cityId === a.cityId)
    if (b) return [a, b]
  }
  return undefined
}
