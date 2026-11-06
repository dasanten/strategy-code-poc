import {
  TRADE_ORG,
  contractOf,
  defendsCity,
  isArmed,
  isAt,
  townHallOf,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'

/*
 * The Trade Organization's last step on a debt (`CONTEXT.md`: Trade Org debt; ADR 0025): its army holds
 * the town hall of the culprit's city as anyone occupies one (`occupierOf`), and the city joins it as a
 * new trading post (`takeCity`). This is what its soldiers fight there and what holds true after.
 */

/**
 * Who stops the Trade Organization's army `ids` occupying the hall of `city` by standing on it
 * (`CONTEXT.md`: Occupying a town hall): armed defenders of the city, and armed residents of any realm,
 * as nobody occupies a hall they share. Not soldiers another realm hired from it, who count for nobody
 * there, nor those it hired itself.
 */
export function hallBlockers(
  world: WorldState,
  city: City,
  ids: Set<string>,
  size: number,
): Resident[] {
  const hall = townHallOf(world, city)
  if (!hall) return []
  return world.residents.filter(
    (r) =>
      r.health > 0 &&
      !ids.has(r.id) &&
      isArmed(r) &&
      isAt(r, hall, size) &&
      contractOf(world, r.id)?.hirerId !== TRADE_ORG &&
      (r.owner !== null || defendsCity(world, city, r, size)),
  )
}

/** A city the Trade Organization took this tick, for the invariant. */
export interface CityTaken {
  cityId: string
  /** The Organization it belonged to. */
  org: string
  /** How many armies came to tear down workplaces for the debt. */
  trips: number
  /** Whether that was enough for this step (`TRADE_ORG_DEBT_TRIPS`). */
  enoughTrips: boolean
}

/** The cities taken in the latest tick, kept beside the world. */
const ledger = new WeakMap<WorldState, { tick: number; taken: CityTaken[] }>()

/** Writes down that a city was taken (`takeCity`). */
export function noteCityTaken(world: WorldState, taken: CityTaken): void {
  const kept = ledger.get(world)
  if (kept?.tick === world.tick) kept.taken.push(taken)
  else ledger.set(world, { tick: world.tick, taken: [taken] })
}

/** Test hook: the cities taken in the latest tick that took one, so a test can tamper with them. */
export function citiesTakenOf(world: WorldState): CityTaken[] {
  return ledger.get(world)?.taken ?? []
}

/**
 * A city the Trade Organization takes comes at the end of its steps and makes a working post
 * (`CONTEXT.md`: Trade Org debt; ADR 0004): only after the set number of trips, with no debt of that
 * Organization left, as a post of no realm with no occupation, with a warehouse and a storage to eat
 * from, and no Food in a warehouse beside that storage as it joined.
 */
export const citiesTakenSound: Invariant = {
  name: 'cities-taken-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const kept = ledger.get(world)
    if (kept?.tick !== world.tick) return out
    for (const t of kept.taken) {
      const fail = (message: string) =>
        out.push({ invariant: this.name, message: `${t.cityId}: ${message}`, entityIds: [t.cityId] })
      if (!t.enoughTrips) fail(`taken after ${t.trips} trips`)
      if (world.debts.some((d) => d.org === t.org)) fail(`${t.org} still owes after it was taken`)
      const city = world.cities.find((c) => c.id === t.cityId)
      if (!city) continue
      if (city.tradeOrg !== 'post') fail('taken, but no trading post')
      if (city.realmId !== null) fail(`taken, but of realm ${city.realmId}`)
      if (city.occupation) fail('taken, but still occupied')
      const own = world.buildings.filter((b) => b.cityId === city.id && !b.site)
      if (!own.some((b) => b.kind === 'storage')) fail('taken, with no storage to eat from')
      if (!own.some((b) => b.kind === 'warehouse')) fail('taken, with no warehouse')
    }
    return out
  },
}
