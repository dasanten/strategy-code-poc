import {
  LAST_SEEN_EVERY_TICKS,
  type Realm,
  type Remembered,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { InvariantViolation } from './invariants.js'
import { hash } from './residents.js'
import { buildingsBySquare, placesInSight, type SeenPlace } from './sight.js'

/**
 * When each realm's Last seen was last brought up to date, and whether it had anyone to see
 * through then. Scratch memory like the sight cache's: never saved, never world state (ADR 0006),
 * so after a restart every realm refreshes on the first tick.
 */
interface Refresh {
  tick: number
  looking: boolean
}
const refreshes = new WeakMap<WorldState, Map<string, Refresh>>()
/** Realms whose Player just connected: they refresh on the next tick (`refreshLastSeenSoon`). */
const soon = new WeakMap<WorldState, Set<string>>()

const refreshesOf = (world: WorldState) => {
  let of = refreshes.get(world)
  if (!of) refreshes.set(world, (of = new Map()))
  return of
}

/** Whether a realm's turn on the `LAST_SEEN_EVERY_TICKS` cycle is this tick, staggered by id. */
export function lastSeenTurn(world: WorldState, realmId: string): boolean {
  return (world.tick + hash(realmId)) % LAST_SEEN_EVERY_TICKS === 0
}

/**
 * Whether a realm's Last seen is brought up to date this tick: on its turn, and at once when it
 * was never refreshed, had nobody to see through at its last refresh (it may have founded a city
 * or got its Leader back since) or its Player just connected, so a fresh map is never a cycle
 * stale.
 */
function due(world: WorldState, realmId: string): boolean {
  const last = refreshes.get(world)?.get(realmId)
  return (
    !last || !last.looking || soon.get(world)?.has(realmId) === true || lastSeenTurn(world, realmId)
  )
}

/** Has a realm's Last seen brought up to date on the next tick, as a Player connects. */
export function refreshLastSeenSoon(world: WorldState, realmId: string): void {
  let of = soon.get(world)
  if (!of) soon.set(world, (of = new Set()))
  of.add(realmId)
}

/** The tick a realm's Last seen was last brought up to date, if it has been since the start. */
export function lastSeenRefreshedAt(world: WorldState, realmId: string): number | undefined {
  return refreshes.get(world)?.get(realmId)?.tick
}

/**
 * Brings Last seen up to date for the realms whose turn it is (`CONTEXT.md`: Last seen): each
 * realm once every `LAST_SEEN_EVERY_TICKS`, staggered by its id, and a fresh one at once
 * (`refreshLastSeen`). Runs each tick after the world has stepped. Returns how many realms
 * refreshed.
 */
export function stepLastSeen(world: WorldState, size: number): number {
  const realms = world.realms.filter((r) => due(world, r.id))
  soon.get(world)?.clear()
  refreshLastSeen(world, size, realms)
  return realms.length
}

/**
 * Brings the Players' Last seen up to date with their sight, every realm's or those given
 * (`CONTEXT.md`: Last seen): each building and city in sight is remembered as they see it now,
 * and a remembered building with any tile of its footprint back in sight that is no longer there
 * is forgotten. A city stays while any building of it is remembered. Things that move are never
 * remembered. What is in sight carries this tick.
 */
export function refreshLastSeen(
  world: WorldState,
  size: number,
  realms: readonly Realm[] = world.realms,
): void {
  const bySquare = realms.length > 0 ? buildingsBySquare(world, size) : undefined
  const done = refreshesOf(world)
  for (const realm of realms) {
    const { seen, sees, looking } = placesInSight(world, size, realm.id, { bySquare })
    done.set(realm.id, { tick: world.tick, looking })
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
 * What a Player remembers that is out of their sight now: no building with any tile of its
 * footprint in sight, no city in sight. This is what goes to them and their scripts apart from
 * what is in sight. Their sight now decides it, not when Last seen was refreshed, since that is
 * up to `LAST_SEEN_EVERY_TICKS` ago.
 */
export function lastSeenOutOfSight(world: WorldState, size: number, userId: number): Remembered[] {
  const memory = world.lastSeen[userId] ?? []
  const realm = world.realms.find((r) => r.userId === userId)
  if (memory.length === 0 || !realm) return [...memory]
  const { seen, sees, looking } = placesInSight(world, size, realm.id)
  if (!looking) return [...memory]
  const inSight = new Set(seen.map((e) => e.id))
  return memory.filter((e) => !inSight.has(e.id) && !(e.is === 'building' && sees(e)))
}

/**
 * Invariant (ADR 0004): a realm's Last seen keeps to its cadence (`CONTEXT.md`: Last seen): once
 * refreshed, it is refreshed again within `LAST_SEEN_EVERY_TICKS`, and nothing in it is newer
 * than its last refresh, so a building in sight is remembered as of that refresh, never older
 * than the cycle.
 */
export function lastSeenOnCadence(world: WorldState, realmId: string): InvariantViolation[] {
  const realm = world.realms.find((r) => r.id === realmId)
  const at = lastSeenRefreshedAt(world, realmId)
  if (!realm || at === undefined) return []
  const out: InvariantViolation[] = []
  if (world.tick - at >= LAST_SEEN_EVERY_TICKS) {
    out.push({
      invariant: 'last-seen-on-cadence',
      message: `realm ${realmId}'s last seen was refreshed at tick ${at}, ${world.tick - at} ticks ago`,
      entityIds: [realmId],
    })
  }
  for (const e of world.lastSeen[realm.userId] ?? []) {
    if (e.seenAt <= at) continue
    out.push({
      invariant: 'last-seen-on-cadence',
      message: `${e.is} ${e.id} is remembered by realm ${realmId} as of tick ${e.seenAt}, after its last refresh at ${at}`,
      entityIds: [e.id, realmId],
    })
  }
  return out
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
