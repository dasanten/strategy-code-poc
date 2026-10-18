import {
  SIGHT_RANGE,
  wrapDistance,
  type Realm,
  type SeenEntity,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { ExploredTerrain } from './explored.js'

/** A spot something can be seen from or at. */
interface Spot {
  x: number
  y: number
}

/** Whether any of the observers is within sight range of the spot (plus `reach`). */
function seen(size: number, observers: Spot[], at: Spot, reach = 0): boolean {
  return observers.some((o) => wrapDistance(size, o, at) <= SIGHT_RANGE + reach)
}

/**
 * What a realm's Player sees (`CONTEXT.md`: Sight): everything within sight range of any of
 * their residents, their own things included. A city counts as seen when any of it is.
 * Alliances share sight later (Epic 12).
 */
export function entitiesInSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string | undefined,
): SeenEntity[] {
  if (realmId === undefined) return []
  const observers = world.residents.filter((r) => r.owner === realmId)
  if (observers.length === 0) return []
  const size = terrain.size
  const out: SeenEntity[] = []
  for (const r of world.residents) if (seen(size, observers, r)) out.push({ is: 'resident', ...r })
  for (const c of world.cities) {
    // From its middle, a city reaches out as far as its corners.
    const middle = { x: c.x + c.size / 2, y: c.y + c.size / 2 }
    if (seen(size, observers, middle, (c.size / 2) * Math.SQRT2)) out.push({ is: 'city', ...c })
  }
  for (const b of world.buildings) if (seen(size, observers, b)) out.push({ is: 'building', ...b })
  for (const h of world.horses) if (seen(size, observers, h)) out.push({ is: 'horse', ...h })
  for (const k of world.carriages) if (seen(size, observers, k)) out.push({ is: 'carriage', ...k })
  for (const p of world.piles) if (seen(size, observers, p)) out.push({ is: 'pile', ...p })
  return out
}

/**
 * Grows each Player's explored terrain from what their residents see. Only residents that came
 * to a new tile since the last call look around again, so a quiet tick costs next to nothing.
 * The positions it remembers are scratch memory: after a restart everyone looks around once.
 */
export class SightTracker {
  private lastSeenFrom = new Map<string, string>()

  /** Explores around residents that moved; returns, per Player, the chunks that grew. */
  update(world: WorldState, explored: ExploredTerrain): Map<number, Set<number>> {
    const userOf = new Map(world.realms.map((r: Realm) => [r.id, r.userId]))
    const grown = new Map<number, Set<number>>()
    const alive = new Set<string>()
    for (const r of world.residents) {
      alive.add(r.id)
      const userId = r.owner === null ? undefined : userOf.get(r.owner)
      const here = `${r.x},${r.y}`
      if (userId === undefined || this.lastSeenFrom.get(r.id) === here) continue
      this.lastSeenFrom.set(r.id, here)
      const chunks = explored.explore(userId, r.x, r.y, SIGHT_RANGE)
      if (chunks.size === 0) continue
      const mine = grown.get(userId) ?? new Set<number>()
      for (const c of chunks) mine.add(c)
      grown.set(userId, mine)
    }
    for (const id of this.lastSeenFrom.keys()) if (!alive.has(id)) this.lastSeenFrom.delete(id)
    return grown
  }
}
