import {
  CRIME_MEMORY_DAYS,
  CRIME_STANDING_LOSS,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  inCityArea,
  wrapDistance,
  type Building,
  type BuildingKind,
  type Carriage,
  type City,
  type Crime,
  type CrimeKind,
  type Good,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { changeStanding } from './standing.js'
import { newId } from './starting-city.js'

/**
 * The Organization a resident belongs to (`CONTEXT.md`: Organization): their realm, or for one of
 * no realm their city; null for one of neither.
 */
export function organizationOf(r: Resident): string | null {
  return r.owner ?? r.cityId
}

/** Whether an Organization is one of the Trade Organization's cities (`CONTEXT.md`: Trade Organization). */
const isTradeOrgCity = (world: WorldState, org: string) =>
  world.cities.some((c) => c.id === org && c.tradeOrg !== undefined)

/** The Organization a city belongs to: its realm, or the city itself when it has none. */
export function cityOrganization(c: City): string {
  return c.realmId ?? c.id
}

/** The Organization a building belongs to, through its city; null for one of no city. */
export function buildingOrganization(world: WorldState, b: Building): string | null {
  const city = world.cities.find((c) => c.id === b.cityId)
  return city ? cityOrganization(city) : null
}

/**
 * The Organization a carriage belongs to: its realm, or for one of no realm its city (a caravan's
 * is the Trade Org HQ's); null for one of neither.
 */
export function carriageOrganization(k: Carriage): string | null {
  return k.realmId ?? k.cityId
}

/** An Organization's name for the log: a realm by its Leader's name, a city by its own. */
function organizationName(world: WorldState, org: string): string {
  const realm = world.realms.find((x) => x.id === org)
  if (realm) {
    const leader = world.residents.find((x) => x.id === realm.leaderId)
    return leader ? `the realm of ${leader.name}` : 'a realm'
  }
  return world.cities.find((c) => c.id === org)?.name ?? 'nobody'
}

/** What a crime was against, besides its Organization. */
interface CrimeAgainst {
  victimOrg: string | null
  victim?: Resident
  goods?: Stock
  building?: BuildingKind
}

/**
 * Notes a crime by `culprit` (`CONTEXT.md`: Crime, Witness), on a map of `size` tiles. It is one
 * only against another Organization. Its witnesses are the living residents of any other
 * Organization than the culprit's within sight range of the culprit, the victim among them while
 * they live. Thefts by the same resident from the same Organization on the same tile, not yet
 * known to it, add up into one crime.
 */
export function commitCrime(
  world: WorldState,
  size: number,
  kind: CrimeKind,
  culprit: Resident,
  against: CrimeAgainst,
): void {
  const org = organizationOf(culprit)
  const { victimOrg, victim, goods, building } = against
  if (org === null || victimOrg === null || victimOrg === org) return
  // The Trade Organization's cities are one Organization: a caravan moving its stock steals nothing.
  if (isTradeOrgCity(world, org) && isTradeOrgCity(world, victimOrg)) return
  const witnesses = world.residents
    .filter((r) => r.health > 0 && r !== culprit && wrapDistance(size, r, culprit) <= SIGHT_RANGE)
    .filter((r) => {
      const theirs = organizationOf(r)
      return theirs !== null && theirs !== org
    })
    .map((r) => r.id)
  if (kind === 'theft') {
    const open = world.crimes.find(
      (c) =>
        c.kind === 'theft' &&
        c.culprit.residentId === culprit.id &&
        c.victimOrg === victimOrg &&
        c.x === culprit.x &&
        c.y === culprit.y &&
        !c.knownBy.includes(victimOrg),
    )
    if (open) {
      for (const [good, units] of Object.entries(goods ?? {}) as [Good, number][]) {
        open.goods![good] = (open.goods![good] ?? 0) + units
      }
      open.witnesses = [...new Set([...open.witnesses, ...witnesses])]
      return
    }
  }
  const crime: Crime = {
    id: newId(world, 'x'),
    kind,
    tick: world.tick,
    x: culprit.x,
    y: culprit.y,
    culprit: {
      residentId: culprit.id,
      name: culprit.name,
      org,
      orgName: organizationName(world, org),
    },
    victimOrg,
    witnesses,
    knownBy: [],
  }
  if (victim) crime.victim = { residentId: victim.id, name: victim.name }
  if (goods) crime.goods = { ...goods }
  if (building) crime.building = building
  world.crimes.push(crime)
}

/**
 * Spreads news of crimes (`CONTEXT.md`: Witness), on a map of `size` tiles. A witness who died
 * takes the news with them. One standing in the area of a city of their own Organization makes
 * the crime known to it, and is done; when that is the victim's Organization, the crime goes in
 * its realm log, with who did it. A crime nobody carries news of any more is forgotten at once
 * when nobody knows it, and `CRIME_MEMORY_DAYS` after it happened otherwise.
 */
export function stepCrimes(world: WorldState, size: number): void {
  if (world.crimes.length === 0) return
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  for (const crime of world.crimes) {
    crime.witnesses = crime.witnesses.filter((id) => {
      const w = byId.get(id)
      if (!w || w.health <= 0) return false
      const org = organizationOf(w)
      if (org === null) return true
      const home = world.cities.some(
        (c) => cityOrganization(c) === org && inCityArea(world, c, w.x, w.y, size),
      )
      if (!home) return true
      if (!crime.knownBy.includes(org)) learn(world, crime, org)
      return false
    })
  }
  const memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
  world.crimes = world.crimes.filter(
    (c) => c.witnesses.length > 0 || (c.knownBy.length > 0 && world.tick - c.tick < memory),
  )
}

/**
 * `org` learns of `crime`. When it is the victim, its standing toward the culprit's Organization
 * falls (`CONTEXT.md`: Standing) and its realm logs it.
 */
function learn(world: WorldState, crime: Crime, org: string): void {
  crime.knownBy.push(org)
  if (org !== crime.victimOrg) return
  changeStanding(world, org, crime.culprit.org, -CRIME_STANDING_LOSS[crime.kind])
  recordEvent(world, org, {
    kind: 'crimeKnown',
    crimeId: crime.id,
    crime: crime.kind,
    at: crime.tick,
    x: crime.x,
    y: crime.y,
    culpritId: crime.culprit.residentId,
    culprit: crime.culprit.name,
    culpritOrg: crime.culprit.orgName,
    ...(crime.victim && { victim: crime.victim.name }),
    ...(crime.goods && { goods: { ...crime.goods } }),
    ...(crime.building && { building: crime.building }),
  })
}
