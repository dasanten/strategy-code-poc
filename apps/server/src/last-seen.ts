import type { Remembered, TerrainMap, WorldState } from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { buildingsBySquare, placesInSight, seenJson } from './sight.js'

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
      // world's own and changes in place once out of sight. Compared as JSON, the same string
      // sync sends (`seenJson`).
      const json = seenJson(world, e)
      if (was && jsonOf(was) === json) was.seenAt = world.tick
      else {
        const copy = { ...copyOf(e), seenAt: world.tick }
        remembered.set(copy, json)
        memory.set(e.id, copy)
      }
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

/**
 * What each remembered building or city was as JSON when it was seen, `seenAt` aside: only
 * `stepLastSeen` changes what it remembers, and then only `seenAt`. Scratch memory, never saved:
 * after a restart it is made again from what is remembered.
 */
const remembered = new WeakMap<Remembered, string>()

/** A remembered building or city as JSON, `seenAt` aside (`remembered`). */
function jsonOf(was: Remembered): string {
  let json = remembered.get(was)
  if (json === undefined) {
    // JSON leaves out what is undefined.
    json = JSON.stringify({ ...was, seenAt: undefined })
    remembered.set(was, json)
  }
  return json
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
