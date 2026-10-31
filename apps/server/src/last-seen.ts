import type { Remembered, TerrainMap, WorldState } from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { buildingsBySquare, placesInSight, type SeenPlace } from './sight.js'

/**
 * Brings every Player's Last seen up to date with their sight (`CONTEXT.md`: Last seen): each
 * building and city in sight is remembered as they see it now, and a remembered building with any
 * tile of its footprint back in sight that is no longer there is forgotten. A city stays while
 * any building of it is remembered. Things that move are never remembered. Runs each tick after
 * the world has stepped, so what is in sight carries this tick.
 */
export function stepLastSeen(world: WorldState, size: number): void {
  const bySquare = world.realms.length > 0 ? buildingsBySquare(world, size) : undefined
  for (const realm of world.realms) {
    const { seen, sees } = placesInSight(world, size, realm.id, { bySquare })
    const before = world.lastSeen[realm.userId] ?? []
    if (seen.length === 0 && before.length === 0) continue
    const memory = new Map(before.map((e) => [e.id, e]))
    const inSight = new Set(seen.map((e) => e.id))
    // Its spot is in sight again and it is not there any more.
    for (const e of before) {
      if (e.is === 'building' && !inSight.has(e.id) && sees(e)) memory.delete(e.id)
    }
    for (const e of seen) {
      const was = memory.get(e.id)
      // Most of it is as it was a tick ago; anything else is copied, since what it holds is the
      // world's own and changes in place once out of sight.
      if (was && sameAs(e, was)) was.seenAt = world.tick
      else memory.set(e.id, { ...copyOf(e), seenAt: world.tick })
    }
    const cities = new Set<string>()
    for (const e of memory.values()) {
      if (e.is === 'building' && e.cityId !== null) cities.add(e.cityId)
    }
    for (const e of memory.values()) if (e.is === 'city' && !cities.has(e.id)) memory.delete(e.id)
    world.lastSeen[realm.userId] = [...memory.values()]
  }
}

/** A copy of plain data all the way down, quicker than `structuredClone` for it. */
function copyOf<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(copyOf) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = copyOf(v)
  return out as T
}

/** Whether plain data is the same all the way down. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]))
  }
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => same(at(a, k), at(b, k)))
}

const at = (o: object, k: string) => (o as Record<string, unknown>)[k]

/** Whether something seen now is what is remembered of it, `seenAt` aside. */
function sameAs(seen: SeenPlace, was: Remembered): boolean {
  const keys = Object.keys(seen)
  return (
    keys.length === Object.keys(was).length - 1 && keys.every((k) => same(at(seen, k), at(was, k)))
  )
}

/**
 * What a Player remembers that is out of their sight now: everything `stepLastSeen` did not see
 * this tick. This is what goes to them and their scripts apart from what is in sight.
 */
export function lastSeenOutOfSight(world: WorldState, userId: number): Remembered[] {
  return (world.lastSeen[userId] ?? []).filter((e) => e.seenAt < world.tick)
}

/**
 * Invariant (ADR 0004): what goes to a Player as Last seen is out of their sight
 * (`CONTEXT.md`: Last seen): no remembered building with any tile of its footprint in sight, no
 * remembered city with a building in sight, so nothing in sight is shown as it was.
 */
export function lastSeenInSight(
  world: WorldState,
  terrain: TerrainMap,
  realmId: string,
  sent: Remembered[],
): InvariantViolation[] {
  const { seen, sees } = placesInSight(world, terrain.size, realmId, { afresh: true })
  const inSight = new Set(seen.map((e) => e.id))
  const out = sent.filter((e) => inSight.has(e.id) || (e.is === 'building' && sees(e)))
  return out.map((e) => ({
    invariant: 'last-seen-out-of-sight',
    message: `${e.is} ${e.id} was sent to realm ${realmId} as last seen while in its sight`,
    entityIds: [e.id, realmId],
  }))
}
