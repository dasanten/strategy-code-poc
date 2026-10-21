import { PERSUADE_STANDING, SIGHT_RANGE, isArmed } from './balance.js'
import { forSale, townHallOf } from './city.js'
import { standingOf } from './standing.js'
import { wrapDistance } from './terrain.js'
import { isWallOrGate, wallSide } from './walls.js'
import type { City, Resident, WorldState } from './world.js'

/*
 * Respect and persuading a city (`CONTEXT.md`: Respect, Persuading a city). Queries here are the
 * game API that orders, scripts and the game's own NPC behaviour share (ADR 0002).
 */

/** The residents an NPC city sees through: those who live there, wherever they stand. */
function eyesOf(world: Pick<WorldState, 'residents'>, city: City): Resident[] {
  return world.residents.filter((r) => r.owner === null && r.cityId === city.id && r.health > 0)
}

/**
 * The respect an NPC city sees from an Organization (`CONTEXT.md`: Respect): how many of its
 * armed residents and its finished walls and gates are in the city's sight, within sight range of
 * anyone who lives there. `org` is a realm, or an NPC city by its id. Not stored; counted when
 * asked. `size` is the map's.
 */
export function respectSeenBy(
  world: Pick<WorldState, 'residents' | 'buildings' | 'cities'>,
  city: City,
  org: string,
  size: number,
): number {
  const eyes = eyesOf(world, city)
  if (eyes.length === 0) return 0
  const seen = (at: { x: number; y: number }) =>
    eyes.some((e) => wrapDistance(size, e, at) <= SIGHT_RANGE)
  const armed = world.residents.filter(
    (r) => r.health > 0 && wallSide(r) === org && isArmed(r) && seen(r),
  ).length
  const orgs = new Map(world.cities.map((c) => [c.id, c.realmId ?? c.id]))
  const walls = world.buildings.filter(
    (b) => isWallOrGate(b) && b.cityId !== null && orgs.get(b.cityId) === org && seen(b),
  ).length
  return armed + walls
}

/** An NPC city's soldiers (`CONTEXT.md`: Soldier): the armed residents who live there. */
export function citySoldiers(world: Pick<WorldState, 'residents'>, city: City): number {
  return eyesOf(world, city).filter(isArmed).length
}

/** Whether an NPC city holds a realm in high standing (`PERSUADE_STANDING`). */
export function holdsHigh(
  world: Pick<WorldState, 'standings' | 'cities'>,
  city: City,
  realmId: string,
): boolean {
  return standingOf(world, city.id, realmId) >= PERSUADE_STANDING
}

/**
 * Whether an NPC city would ask a realm to join (`CONTEXT.md`: Persuading a city): it is for
 * sale (no realm's, not the Trade Organization's), holds the realm in high standing and sees more
 * respect from it than it has soldiers.
 */
export function persuadedBy(
  world: Pick<WorldState, 'residents' | 'buildings' | 'cities' | 'standings'>,
  city: City,
  realmId: string,
  size: number,
): boolean {
  return (
    forSale(city) &&
    holdsHigh(world, city, realmId) &&
    respectSeenBy(world, city, realmId, size) > citySoldiers(world, city)
  )
}

/** An NPC city asking the Player's realm to join, as the Player sees it, with its town hall. */
export interface JoinRequestView {
  cityId: string
  city: string
  at: number
  x: number
  y: number
}

/** The NPC cities asking the realm to join it now, the oldest ask first. */
export function joinRequestsFor(
  world: Pick<WorldState, 'joinRequests' | 'cities' | 'buildings'>,
  realmId: string,
): JoinRequestView[] {
  const out: JoinRequestView[] = []
  for (const q of world.joinRequests) {
    if (q.declined || q.realmId !== realmId) continue
    const city = world.cities.find((c) => c.id === q.cityId)
    const hall = city && townHallOf(world, city)
    if (!city || !hall) continue
    out.push({ cityId: city.id, city: city.name, at: q.at, x: hall.x, y: hall.y })
  }
  return out.sort((a, b) => a.at - b.at)
}
