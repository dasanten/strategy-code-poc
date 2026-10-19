import {
  SIGHT_RANGE,
  sharingSight,
  wrapDistance,
  type Army,
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
function armySeen(world: WorldState, army: Army, inSight: (at: Spot) => boolean): boolean {
  return world.residents.some((r) => army.memberIds.includes(r.id) && inSight(r))
}

/** The residents a realm's Player sees through: their own and their alliance's. */
function observersOf(world: WorldState, realmId: string): Spot[] {
  const realms = new Set(sharingSight(world, realmId))
  return world.residents.filter((r) => r.owner !== null && realms.has(r.owner))
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
  for (const r of world.residents) if (seen(size, observers, r)) out.push({ is: 'resident', ...r })
  const seenCities = new Set<string>()
  for (const b of world.buildings) {
    if (!seen(size, observers, b)) continue
    out.push({ is: 'building', ...b })
    if (b.cityId !== null) seenCities.add(b.cityId)
  }
  for (const c of world.cities) if (seenCities.has(c.id)) out.push({ is: 'city', ...c })
  for (const h of world.horses) if (seen(size, observers, h)) out.push({ is: 'horse', ...h })
  for (const k of world.carriages) if (seen(size, observers, k)) out.push({ is: 'carriage', ...k })
  for (const p of world.piles) if (seen(size, observers, p)) out.push({ is: 'pile', ...p })
  // An army is seen through its members; the Player gets only their own.
  for (const a of world.armies) {
    if (a.realmId === realmId && armySeen(world, a, (at) => seen(size, observers, at))) {
      out.push({ is: 'army', ...a })
    }
  }
  return out
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
    // Per realm, the Players who see through its residents.
    const viewersOf = new Map<string, number[]>()
    for (const realm of world.realms) {
      const viewers = sharingSight(world, realm.id).flatMap((id) => userOf.get(id) ?? [])
      viewersOf.set(realm.id, viewers)
    }
    const grown = new Map<number, Set<number>>()
    const looking = new Set<string>()
    for (const r of world.residents) {
      const viewers = r.owner === null ? undefined : viewersOf.get(r.owner)
      const here = `${r.x},${r.y}`
      for (const userId of viewers ?? []) {
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
