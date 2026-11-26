// Ported from packages/shared/src/horses.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { carriagePulledBy } from './carriages.js'
import { covers, isAt } from './footprint.js'
import { pileAt } from './goods.js'
import { wrap } from './terrain.js'
import { HORSE_REACH, STABLE_BREED_DAYS, TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building, Horse, KeptBreeding, Resident, Stock, WorldState } from '@csp/shared-types'
import { riderSpareFood } from '@csp/lang-wasm'

export { riderSpareFood } from '@csp/lang-wasm'

/** World queries about horses and stables (ADR 0002: the game API orders and scripts share). */

/** Ticks a resident tends two horses at a stable before their foal is born (`STABLE_BREED_DAYS`). */
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
 * then the Food on the ground on its tile and within `HORSE_REACH` of it, then, for a ridden horse,
 * its rider's carried Food while they have a unit to spare (`riderSpareFood`). Only places that
 * hold Food the horse may eat are listed. `rider` saves looking up who rides it, for callers that
 * know.
 */
export function horseFood(
  world: WorldState,
  horse: Horse,
  mapSize: number,
  rider: Pick<Resident, 'carried'> | undefined = riderOf(world, horse),
): Stock[] {
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
  if (rider && riderSpareFood(rider) >= 1) out.push(rider.carried)
  return out
}

/** Whose horses a resident may breed (`CONTEXT.md`: Breeding): a realm's, or an NPC city's. */
export type HorseOwner = { realmId: string } | { cityId: string }

/** Whether a horse belongs to the realm or NPC city. */
export function ownsHorse(owner: HorseOwner, h: Pick<Horse, 'realmId' | 'cityId'>): boolean {
  return 'realmId' in owner
    ? h.realmId === owner.realmId
    : h.realmId === null && h.cityId === owner.cityId
}

/** The horses standing in a stable, hitched or not. */
export function horsesIn<H extends { x: number; y: number }>(
  horses: readonly H[],
  stable: Building,
): H[] {
  return horses.filter((h) => isAt(h, stable))
}

/** The residents breeding at a stable (`BreedOrder`). */
export function breedersAt<R extends Pick<Resident, 'order'>>(
  residents: readonly R[],
  stable: Building,
): R[] {
  return residents.filter((r) => r.order?.kind === 'breed' && r.order.stableId === stable.id)
}

/** The breeding progress the stable keeps for the two horses, in either order, if it keeps any. */
export function keptBreeding(
  stable: Pick<Building, 'breedings'>,
  horseIds: readonly string[],
): KeptBreeding | undefined {
  return stable.breedings?.find(
    (k) => horseIds.includes(k.horseIds[0]) && horseIds.includes(k.horseIds[1]),
  )
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
