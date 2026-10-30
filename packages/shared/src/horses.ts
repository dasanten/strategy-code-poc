import { HORSE_REACH, STABLE_BREED_DAYS, STABLE_CAPACITY } from './balance.js'
import { carriagePulledBy, drivenCarriageId } from './carriages.js'
import { covers, isAt } from './footprint.js'
import { carriageCanGoTo } from './building.js'
import { pileAt } from './goods.js'
import { wrap, type TerrainMap } from './terrain.js'
import {
  TICKS_PER_GAME_DAY,
  type BreedOrder,
  type Building,
  type Horse,
  type KeptBreeding,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

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

/**
 * The pair a resident breeding at the stable carries on with first (`CONTEXT.md`: Breeding): of
 * the pairs it keeps progress for, the furthest along that they can breed (`breedProblem`), so
 * both still fed and nobody else tending either; undefined when there is none.
 */
export function keptPair(
  world: Pick<WorldState, 'horses' | 'residents'>,
  stable: Building,
  owner: HorseOwner,
  breeder: Pick<Resident, 'id'> | undefined,
): [string, string] | undefined {
  const kept = [...(stable.breedings ?? [])].sort((a, b) => b.progress - a.progress)
  const k = kept.find((x) => !breedProblem(world, stable, owner, breeder, x.horseIds))
  return k && [k.horseIds[0], k.horseIds[1]]
}

/**
 * Two fed horses of the owner's in a finished stable with room for a foal, which a resident there
 * can breed (`CONTEXT.md`: Breeding), or undefined when there are none. A pair whose breeding the
 * stable keeps comes first (`keptPair`).
 */
export function breedingPair(
  world: Pick<WorldState, 'horses' | 'residents'>,
  stable: Building,
  owner: HorseOwner,
): [Horse, Horse] | undefined {
  const kept = keptPair(world, stable, owner, undefined)
  if (kept) {
    const [a, b] = kept.map((id) => world.horses.find((h) => h.id === id)!)
    return [a!, b!]
  }
  const fed = horsesIn(world.horses, stable).filter((h) => ownsHorse(owner, h) && h.hunger > 0)
  const pair = fed.slice(0, 2)
  if (pair.length < 2) return undefined
  return breedProblem(world, stable, owner, undefined, [pair[0]!.id, pair[1]!.id])
    ? undefined
    : [pair[0]!, pair[1]!]
}

/**
 * Why a resident standing at the stable can't breed the two horses (`CONTEXT.md`: Breeding),
 * undefined when they can: the stable must be finished, the horses two fed ones of the owner's
 * standing in it, and the stable must have room for a foal. Horses another resident already
 * breeds can't be bred twice. `breeder` is the resident who would, left out of that check.
 */
export function breedProblem(
  world: Pick<WorldState, 'horses' | 'residents'>,
  stable: Building,
  owner: HorseOwner,
  breeder: Pick<Resident, 'id'> | undefined,
  horseIds: unknown,
): string | undefined {
  if (stable.kind !== 'stable') return 'not a stable'
  if (stable.site) return 'the stable isn’t finished'
  if (!Array.isArray(horseIds) || horseIds.length !== 2 || horseIds[0] === horseIds[1])
    return 'pick two horses'
  const horses = horseIds.map((id) => world.horses.find((h) => h.id === id))
  if (horses.some((h) => !h || !isAt(h, stable))) return 'both horses must stand in the stable'
  if (horses.some((h) => !ownsHorse(owner, h!))) return 'not horses of your realm'
  if (horses.some((h) => h!.hunger <= 0)) return 'a hungry horse can’t breed'
  if (horsesIn(world.horses, stable).length >= STABLE_CAPACITY)
    return 'the stable has no room for a foal'
  const taken = breedersAt(world.residents, stable).some(
    (r) =>
      r.id !== breeder?.id && (r.order as BreedOrder).horseIds.some((id) => horseIds.includes(id)),
  )
  if (taken) return 'those horses are already being bred'
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
 * resident must ride no other horse and drive no carriage. A horse left on Mountain whose road was
 * torn down can't be ridden there (`CONTEXT.md`: Road).
 */
export function mountProblem(
  world: WorldState,
  resident: Resident,
  horse: Horse | undefined,
  terrain?: TerrainMap,
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
  if (terrain && !carriageCanGoTo(world, terrain, horse.x, horse.y))
    return 'a horse can’t be ridden on Mountain without a road'
  return undefined
}
