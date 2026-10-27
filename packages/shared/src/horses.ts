import { HORSE_REACH, STABLE_BREED_DAYS, STABLE_CAPACITY } from './balance.js'
import { carriagePulledBy, drivenCarriageId } from './carriages.js'
import { covers, isAt } from './footprint.js'
import { pileAt } from './goods.js'
import { wrap } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  type Building,
  type Horse,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

/** World queries about horses and stables (ADR 0002: the game API orders and scripts share). */

/** Ticks of breeding a stable needs for one foal (`STABLE_BREED_DAYS`). */
export const STABLE_BREED_TICKS = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY

/** The finished stable whose footprint covers a tile, if there is one. */
export function stableAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.kind === 'stable' && !b.site && covers(b, x, y))
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

/** The horse a resident rides (`CONTEXT.md`: Riding), if they ride one. */
export function horseRidden<H extends Pick<Horse, 'id'>>(
  world: { horses: readonly H[] },
  resident: Pick<Resident, 'riding'>,
): H | undefined {
  return resident.riding === undefined
    ? undefined
    : world.horses.find((h) => h.id === resident.riding)
}

/** The resident riding a horse, if anyone is. */
export function riderOf<R extends Pick<Resident, 'riding'>>(
  world: { residents: readonly R[] },
  horse: Pick<Horse, 'id'>,
): R | undefined {
  return world.residents.find((r) => r.riding === horse.id)
}

/**
 * Whether a horse is the resident's to ride: one of their realm, or for a resident of an NPC city
 * one of that city.
 */
export function horseOfResident(
  horse: Pick<Horse, 'realmId' | 'cityId'>,
  resident: Pick<Resident, 'owner' | 'cityId'>,
): boolean {
  if (resident.owner !== null) return horse.realmId === resident.owner
  return horse.realmId === null && resident.cityId !== null && horse.cityId === resident.cityId
}

/**
 * Why a resident can't mount a horse now, or undefined when they can (`CONTEXT.md`: Riding): the
 * horse must be of their realm and on their tile, pull no carriage, and nobody may ride it; the
 * resident must ride no other horse and drive no carriage.
 */
export function mountProblem(
  world: WorldState,
  resident: Resident,
  horse: Horse | undefined,
): string | undefined {
  if (!horse) return 'no such horse'
  if (resident.riding === horse.id) return 'already riding that horse'
  if (resident.riding !== undefined) return 'already riding another horse'
  if (!horseOfResident(horse, resident)) return 'not a horse of your realm'
  if (horse.x !== resident.x || horse.y !== resident.y) {
    return 'that horse is not on the resident’s tile'
  }
  if (carriagePulledBy(world, horse)) return 'that horse is hitched to a carriage'
  if (riderOf(world, horse)) return 'someone else rides that horse'
  if (drivenCarriageId(resident) !== undefined) return 'a driver can’t ride'
  return undefined
}
