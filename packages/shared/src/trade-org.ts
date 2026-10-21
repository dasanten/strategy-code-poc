import { TRADE_ORG_ARMY, TRADE_ORG_HQ, isArmed } from './balance.js'
import { townHallOf } from './city.js'
import { wrapDelta } from './terrain.js'
import type { City, Resident, WorldState } from './world.js'

/**
 * World queries about the Trade Organization as a side (ADR 0002: the game API orders and scripts
 * share).
 */

/**
 * The Trade Organization where a realm's id would go (`CONTEXT.md`: Trade Org army): in mercenary
 * contracts it is a side like a realm, lending its army or hiring mercenaries.
 */
export const TRADE_ORG = 'trade-org'

/** What Players call the Trade Organization where they would see a realm's name. */
export const TRADE_ORG_NAME = 'the Trade Organization'

/** The Trade Org HQ, if the world has one. */
export function tradeOrgHq(world: Pick<WorldState, 'cities'>): City | undefined {
  return world.cities.find((c) => c.tradeOrg === 'hq')
}

/** Whether the resident is one of the Trade Org HQ's own residents. */
export function ofTradeOrgHq(world: Pick<WorldState, 'cities'>, r: Resident): boolean {
  return r.owner === null && r.cityId !== null && r.cityId === tradeOrgHq(world)?.id
}

/**
 * The side a resident is on in a mercenary contract: their realm, `TRADE_ORG` for one of the
 * Trade Organization's cities, null for anyone else.
 */
export function contractSide(world: Pick<WorldState, 'cities'>, r: Resident): string | null {
  if (r.owner !== null) return r.owner
  const city = world.cities.find((c) => c.id === r.cityId)
  return city?.tradeOrg ? TRADE_ORG : null
}

/**
 * Whether a tile is on or inside the Trade Org HQ's inner ring (`CONTEXT.md`: Trade Org HQ), on a
 * map of `size` tiles: within its inner radius of the town hall, the ring itself included.
 */
export function inInnerRing(
  world: Pick<WorldState, 'cities' | 'buildings'>,
  at: { x: number; y: number },
  size: number,
): boolean {
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  return !!hall && inInnerRingAround(hall, at, size)
}

/** `inInnerRing` for the HQ whose town hall is `hall`. */
export function inInnerRingAround(
  hall: { x: number; y: number },
  at: { x: number; y: number },
  size: number,
): boolean {
  const d = Math.hypot(wrapDelta(hall.x, at.x, size), wrapDelta(hall.y, at.y, size))
  return d <= TRADE_ORG_HQ.innerRadius + 0.5
}

/**
 * The armed residents of the strongest Organization (`CONTEXT.md`: Trade Org HQ): the most
 * living armed residents any Player's side has, an alliance's members counted together and a
 * realm in none on its own. Residents the Trade Organization has hired don't count.
 */
export function strongestArmed(
  world: Pick<WorldState, 'residents' | 'alliances' | 'contracts'>,
): number {
  const hired = new Set(
    world.contracts.filter((c) => c.hirerId === TRADE_ORG).flatMap((c) => c.residentIds),
  )
  const sideOf = new Map<string, string>()
  for (const a of world.alliances) for (const m of a.members) sideOf.set(m.realmId, a.id)
  const armed = new Map<string, number>()
  for (const r of world.residents) {
    if (r.owner === null || r.health <= 0 || !isArmed(r) || hired.has(r.id)) continue
    const side = sideOf.get(r.owner) ?? r.owner
    armed.set(side, (armed.get(side) ?? 0) + 1)
  }
  return Math.max(0, ...armed.values())
}

/**
 * How many soldiers the Trade Org HQ wants (`CONTEXT.md`: Trade Org HQ, Trade Org army): its
 * army's size, or more when the strongest Organization has many armed residents
 * (`TRADE_ORG_ARMY.strongestMultiple` of them).
 */
export function tradeOrgArmyWanted(
  world: Pick<WorldState, 'residents' | 'alliances' | 'contracts'>,
): number {
  return Math.max(
    TRADE_ORG_ARMY.size,
    Math.ceil(TRADE_ORG_ARMY.strongestMultiple * strongestArmed(world)),
  )
}
