import {
  SIGHT_RANGE,
  cityPrice,
  commanderOf,
  forSale,
  npcCityRefuses,
  sellsTo,
  sharingSight,
  wrapDistance,
  type Army,
  type Caravan,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { ExploredTerrain } from './explored.js'
import type { InvariantViolation } from './invariants.js'

/** A spot something can be seen from or at. */
interface Spot {
  x: number
  y: number
}

/** Whether any of the observers is within sight range of the spot (plus `reach`). */
function seen(size: number, observers: Spot[], at: Spot, reach = 0): boolean {
  return observers.some((o) => wrapDistance(size, o, at) <= SIGHT_RANGE + reach)
}

/** Whether any of the army's members is in sight (`CONTEXT.md`: Sight). */
function armySeen(
  world: WorldState,
  army: Pick<Army, 'memberIds'>,
  inSight: (at: Spot) => boolean,
): boolean {
  return world.residents.some((r) => army.memberIds.includes(r.id) && inSight(r))
}

/**
 * The residents a realm's Player sees through: their own and their alliance's, an NPC city
 * member's included, those rented out too, and mercenaries they hired (`CONTEXT.md`: Mercenary
 * contract).
 */
function observersOf(world: WorldState, realmId: string): Spot[] {
  const members = new Set(sharingSight(world, realmId))
  return world.residents.filter((r) => {
    const by = commanderOf(world, r)
    const org = r.owner ?? r.cityId
    return (org !== null && members.has(org)) || (by !== null && members.has(by))
  })
}

/**
 * What a realm's Player sees (`CONTEXT.md`: Sight): everything within sight range of any of
 * their residents or their alliance's, their own things included. A city counts as seen when
 * any of it is.
 */
export function entitiesInSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string | undefined,
): SeenEntity[] {
  if (realmId === undefined) return []
  const observers = observersOf(world, realmId)
  if (observers.length === 0) return []
  const size = terrain.size
  const out: SeenEntity[] = []
  for (const r of world.residents) {
    if (!seen(size, observers, r)) continue
    // Which script a resident runs is seen; its memory stays on the server.
    const { script, ...rest } = r
    out.push({
      is: 'resident',
      ...rest,
      ...(script ? { script: { scriptId: script.scriptId } } : {}),
    })
  }
  const seenCities = new Set<string>()
  for (const b of world.buildings) {
    if (!seen(size, observers, b)) continue
    out.push({ is: 'building', ...b })
    if (b.cityId !== null) seenCities.add(b.cityId)
  }
  // An NPC city names the Player its price (`CONTEXT.md`: Buying a city), from all of it, or says
  // it won't sell to them or refuses them at all (`CONTEXT.md`: NPC city reaction).
  for (const c of world.cities) {
    if (!seenCities.has(c.id)) continue
    const sale = !forSale(c)
      ? {}
      : sellsTo(world, c, realmId)
        ? { price: cityPrice(world, c, realmId) }
        : { wontSell: true as const }
    const refuses = npcCityRefuses(world, c, realmId) ? { refuses: true as const } : {}
    out.push({ is: 'city', ...c, ...sale, ...refuses })
  }
  for (const h of world.horses) if (seen(size, observers, h)) out.push({ is: 'horse', ...h })
  for (const k of world.carriages) if (seen(size, observers, k)) out.push({ is: 'carriage', ...k })
  for (const p of world.piles) if (seen(size, observers, p)) out.push({ is: 'pile', ...p })
  // An army is seen through its members; the Player gets only their own.
  for (const a of world.armies) {
    if (a.realmId === realmId && armySeen(world, a, (at) => seen(size, observers, at))) {
      // As for residents: which script it runs is seen, its memory isn't.
      const { script, ...rest } = a
      out.push({
        is: 'army',
        ...rest,
        ...(script ? { script: { scriptId: script.scriptId } } : {}),
      })
    }
  }
  // A caravan is seen through its carriage and its crew (`CONTEXT.md`: Caravan).
  for (const c of world.caravans) {
    if (caravanSeen(world, c, (at) => seen(size, observers, at))) {
      const { id, postId, carriageId, driverId, escortIds, heading } = c
      out.push({ is: 'caravan', id, postId, carriageId, driverId, escortIds, heading })
    }
  }
  return out
}

/** Whether a caravan's carriage or any of its crew is in sight. */
function caravanSeen(
  world: WorldState,
  caravan: Pick<Caravan, 'carriageId' | 'driverId' | 'escortIds'>,
  inSight: (at: Spot) => boolean,
): boolean {
  const crew = [caravan.driverId, ...caravan.escortIds]
  return (
    world.carriages.some((k) => k.id === caravan.carriageId && inSight(k)) ||
    world.residents.some((r) => crew.includes(r.id) && inSight(r))
  )
}

/**
 * Invariant (ADR 0004): nothing is sent to a Player outside their own or their alliance's sight.
 * Checks the entities about to go out to a realm's Player against the world as it is, each on
 * its own: a city is in sight when any of its buildings is.
 */
export function sentOutOfSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string,
  sent: SeenEntity[],
): InvariantViolation[] {
  const observers = observersOf(world, realmId)
  const inSight = (at: Spot) => seen(terrain.size, observers, at)
  const out = sent.filter((e) =>
    e.is === 'city'
      ? !world.buildings.some((b) => b.cityId === e.id && inSight(b))
      : e.is === 'army'
        ? !armySeen(world, e, inSight)
        : e.is === 'caravan'
          ? !caravanSeen(world, e, inSight)
          : !inSight(e),
  )
  return out.map((e) => ({
    invariant: 'sent-only-in-sight',
    message: `${e.is} ${e.id} was sent to realm ${realmId}, outside its sight`,
    entityIds: [e.id, realmId],
  }))
}

/**
 * Grows each Player's explored terrain from what they see: their residents and their alliance's.
 * Only residents that came to a new tile since the last call look around again, for a Player
 * that shares their sight, so a quiet tick costs next to nothing; a Player who joins an alliance
 * explores around its residents on the next call. The positions it remembers are scratch memory:
 * after a restart everyone looks around once.
 */
export class SightTracker {
  /** Per Player and resident (`userId:residentId`), the tile they last looked around from. */
  private lastSeenFrom = new Map<string, string>()

  /** Explores around residents that moved; returns, per Player, the chunks that grew. */
  update(world: WorldState, explored: ExploredTerrain): Map<number, Set<number>> {
    const userOf = new Map(world.realms.map((r) => [r.id, r.userId]))
    // Per realm, and per NPC city in an alliance, the Players who see through its residents.
    const viewersOf = new Map<string, number[]>()
    const members = [
      ...world.realms.map((r) => r.id),
      ...world.alliances.flatMap((a) => a.members.map((m) => m.realmId)),
    ]
    for (const id of new Set(members)) {
      viewersOf.set(
        id,
        sharingSight(world, id).flatMap((x) => userOf.get(x) ?? []),
      )
    }
    const grown = new Map<number, Set<number>>()
    const looking = new Set<string>()
    for (const r of world.residents) {
      const by = commanderOf(world, r)
      const org = r.owner ?? r.cityId
      const viewers = [org, by === r.owner ? null : by].flatMap((id) =>
        id === null ? [] : (viewersOf.get(id) ?? []),
      )
      const here = `${r.x},${r.y}`
      for (const userId of new Set(viewers)) {
        const key = `${userId}:${r.id}`
        looking.add(key)
        if (this.lastSeenFrom.get(key) === here) continue
        this.lastSeenFrom.set(key, here)
        const chunks = explored.explore(userId, r.x, r.y, SIGHT_RANGE)
        if (chunks.size === 0) continue
        const mine = grown.get(userId) ?? new Set<number>()
        for (const c of chunks) mine.add(c)
        grown.set(userId, mine)
      }
    }
    for (const key of this.lastSeenFrom.keys()) if (!looking.has(key)) this.lastSeenFrom.delete(key)
    return grown
  }
}
