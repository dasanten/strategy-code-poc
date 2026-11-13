// Ported from packages/shared/src/persuasion.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { cityAreaTiles, forSale, townHallOf } from './city.js'
import { standingOf } from './standing.js'
import { bestWeapon, isArmed } from './stats.js'
import { wrapDistance } from './terrain.js'
import { isWallOrGate, wallSide } from './walls.js'
import { type WorldState } from './world.js'
import {
  BLOW_BASE,
  COMBAT_SKILL_EFFECT,
  COMBAT_SKILL_LIMIT,
  PERSUADE_STANDING,
  PROTECTION_DEFENCE,
  RESPECT_PER_WALL,
  SIGHT_RANGE,
  WEAPON_ATTACK,
} from '@csp/balance'
import type { City, Good, JoinRequestView, Resident } from '@csp/shared-types'

/*
 * Respect and persuading a city (`CONTEXT.md`: Respect, Persuading a city). Queries here are the
 * game API that orders, scripts and the game's own NPC behaviour share (ADR 0002).
 */

/** The residents who live in an NPC city, alive, wherever they stand. */
function cityPeople(world: Pick<WorldState, 'residents'>, city: City): Resident[] {
  return world.residents.filter((r) => r.owner === null && r.cityId === city.id && r.health > 0)
}

function tileKey(at: { x: number; y: number }): string {
  return `${Math.trunc(at.x)},${Math.trunc(at.y)}`
}

/**
 * How much an armed resident counts for in respect (`CONTEXT.md`: Respect): as combat weighs
 * them, from their gear and training, not their body: the blow of their best weapon, harder with
 * Combat skill, and what their shield and armour take off each blow struck at them. Nothing for
 * the unarmed.
 */
export function fighterStrength(r: Pick<Resident, 'carried' | 'skills'>): number {
  const weapon = bestWeapon(r)
  if (weapon === undefined) return 0
  const skill = Math.min(COMBAT_SKILL_LIMIT, (r.skills.combat ?? 0) * COMBAT_SKILL_EFFECT)
  const protection = (Object.entries(PROTECTION_DEFENCE) as [Good, number][])
    .filter(([g]) => (r.carried[g] ?? 0) > 0)
    .reduce((sum, [, d]) => sum + d, 0)
  return (BLOW_BASE + WEAPON_ATTACK[weapon]) * (1 + skill) + protection
}

/**
 * The respect an NPC city sees from an Organization (`CONTEXT.md`: Respect; ADR 0033): the
 * strength of its armed residents standing in the city's area or in sight of one of the city's
 * residents who is at home, in that area. The Organization's walls don't count, nor what the
 * city's people see far from home, nor residents the city lent it. `org` is a realm, or an NPC
 * city by its id. Not stored; weighed when asked. `size` is the map's.
 */
export function respectSeenBy(
  world: Pick<WorldState, 'residents' | 'buildings' | 'contracts'>,
  city: City,
  org: string,
  size: number,
): number {
  const area = cityAreaTiles(world, city, size)
  const home = cityPeople(world, city).filter((r) => area.has(tileKey(r)))
  if (home.length === 0) return 0
  const lent = new Set(
    world.contracts
      .filter((c) => c.startedAt !== null && c.lenderId === city.id)
      .flatMap((c) => c.residentIds),
  )
  const near = (r: Resident) =>
    area.has(tileKey(r)) ||
    home.some((e) => wrapDistance(size, tileOf(e), tileOf(r)) <= SIGHT_RANGE)
  return world.residents
    .filter((r) => r.health > 0 && wallSide(r) === org && isArmed(r) && !lent.has(r.id) && near(r))
    .reduce((sum, r) => sum + fighterStrength(r), 0)
}

function tileOf(at: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.trunc(at.x), y: Math.trunc(at.y) }
}

/**
 * An NPC city's own side (`CONTEXT.md`: Respect; ADR 0033): the strength of its soldiers, the
 * armed residents who live there, and `RESPECT_PER_WALL` for each of its finished walls and gates.
 */
export function cityStrength(
  world: Pick<WorldState, 'residents' | 'buildings'>,
  city: City,
): number {
  const soldiers = cityPeople(world, city).reduce((sum, r) => sum + fighterStrength(r), 0)
  const walls = world.buildings.filter((b) => isWallOrGate(b) && b.cityId === city.id).length
  return soldiers + RESPECT_PER_WALL * walls
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
 * respect from it than its own side weighs.
 */
export function persuadedBy(
  world: Pick<WorldState, 'residents' | 'buildings' | 'cities' | 'standings' | 'contracts'>,
  city: City,
  realmId: string,
  size: number,
): boolean {
  return (
    forSale(city) &&
    holdsHigh(world, city, realmId) &&
    respectSeenBy(world, city, realmId, size) > cityStrength(world, city)
  )
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
