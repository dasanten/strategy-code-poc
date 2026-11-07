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

/**
 * The Organization a building belongs to, through its city, or an outpost storage's realm
 * (`CONTEXT.md`: Outpost storage); null for one of neither. A construction site laid out by a
 * realm's resident is that realm's (`CONTEXT.md`: Construction site).
 */
export function buildingOrganization(world: WorldState, b: Building): string | null {
  if (b.site && b.realmId !== undefined) return b.realmId
  const city = world.cities.find((c) => c.id === b.cityId)
  return city ? cityOrganization(city) : (b.realmId ?? null)
}

/**
 * The Organization a carriage belongs to: its realm, or for one of no realm its city (a caravan's
 * is the HQ's); null for one of neither.
 */
export function carriageOrganization(k: Carriage): string | null {
  return k.realmId ?? k.cityId
}

/** An Organization's name for the log: a realm by its realm name, a city by its own. */
export function organizationName(world: WorldState, org: string): string {
  const realm = world.realms.find((x) => x.id === org)
  if (realm) {
    const name = realm.name ?? world.residents.find((x) => x.id === realm.leaderId)?.name
    return name ? `the realm of ${name}` : 'a realm'
  }
  return world.cities.find((c) => c.id === org)?.name ?? 'nobody'
}

/** What a crime was against, besides its Organization. */
interface CrimeAgainst {
  victimOrg: string | null
  victim?: Resident
  goods?: Stock
  carriage?: true
  horse?: string
  building?: BuildingKind
  post?: string
}

/**
 * Notes a crime by `culprit` (`CONTEXT.md`: Crime, Witness), on a map of `size` tiles. It is one
 * only against another Organization. Its witnesses are the living residents of any other
 * Organization than the culprit's within sight range of the culprit, the victim among them while
 * they live. Thefts of goods by the same resident from the same Organization on the same tile, not
 * yet known to it, add up into one crime; each taking of a carriage or horse is one of its own
 * (`CONTEXT.md`: Stealing a carriage or horse).
 */
export function commitCrime(
  world: WorldState,
  size: number,
  kind: CrimeKind,
  culprit: Resident,
  against: CrimeAgainst,
): void {
  const org = organizationOf(culprit)
  const { victimOrg, victim, goods, carriage, horse, building, post } = against
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
  if (kind === 'theft' && !carriage && horse === undefined) {
    const open = world.crimes.find(
      (c) =>
        c.kind === 'theft' &&
        !c.carriage &&
        c.horse === undefined &&
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
  if (carriage) crime.carriage = true
  if (horse !== undefined) crime.horse = horse
  if (building) crime.building = building
  if (post !== undefined) crime.post = post
  world.crimes.push(crime)
}

/**
 * Who stole from an Organization, as far as it knows (`CONTEXT.md`: Crime, Trading post): the
 * culprits of thefts from it that it knows of or one of its residents saw.
 */
export function knownThieves(world: WorldState, org: string): Set<string> {
  const thefts = world.crimes.filter((c) => c.kind === 'theft' && c.victimOrg === org)
  if (thefts.length === 0) return new Set()
  const ours = new Set(world.residents.filter((r) => organizationOf(r) === org).map((r) => r.id))
  return new Set(
    thefts
      .filter((c) => c.knownBy.includes(org) || c.witnesses.some((id) => ours.has(id)))
      .map((c) => c.culprit.residentId),
  )
}

/**
 * Whether a captured post's crime is still waiting for a wandering trader to find it out
 * (`CONTEXT.md`: Lost post found out): the Trade Organization hasn't heard, and it is on a loop.
 */
export function awaitsTrader(world: WorldState, crime: Crime): boolean {
  const { post, knownBy, victimOrg } = crime
  if (post === undefined || knownBy.includes(victimOrg)) return false
  return world.traders.some((t) => t.loop.includes(post))
}

/**
 * Spreads news of crimes (`CONTEXT.md`: Witness), on a map of `size` tiles. A witness who died
 * takes the news with them, and so does one who has since joined the culprit's Organization. One
 * standing in the area of a city of their own Organization makes the crime known to it, and is
 * done; when that is the victim's Organization, the crime goes in its realm log, with who did it.
 * News of a captured post goes further: any resident of the Trade Organization makes it known to
 * the Trade Organization at any of its cities (`CONTEXT.md`: Lost post found out). A crime nobody
 * carries news of any more is forgotten at once when nobody knows it, unless a wandering trader may
 * still find it out (`awaitsTrader`), and `CRIME_MEMORY_DAYS` after it happened otherwise, or for a
 * captured post after the news came.
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
      if (org === crime.culprit.org) return false
      const lostPost =
        crime.kind === 'capture' &&
        isTradeOrgCity(world, org) &&
        isTradeOrgCity(world, crime.victimOrg)
      const home = world.cities.some(
        (c) =>
          (lostPost ? c.tradeOrg !== undefined : cityOrganization(c) === org) &&
          inCityArea(world, c, w.x, w.y, size),
      )
      if (!home) return true
      const hears = lostPost ? crime.victimOrg : org
      if (!crime.knownBy.includes(hears)) learn(world, crime, hears)
      return false
    })
  }
  const memory = CRIME_MEMORY_DAYS * TICKS_PER_GAME_DAY
  world.crimes = world.crimes.filter(
    (c) =>
      c.witnesses.length > 0 ||
      (c.knownBy.length > 0 && world.tick - (c.heardAt ?? c.tick) < memory) ||
      awaitsTrader(world, c),
  )
}

/**
 * `org` learns of `crime`. When it is the victim, its standing toward the culprit's Organization
 * falls (`CONTEXT.md`: Standing) and its realm logs it.
 */
function learn(world: WorldState, crime: Crime, org: string): void {
  crime.knownBy.push(org)
  if (org !== crime.victimOrg) return
  if (crime.kind === 'capture') crime.heardAt = world.tick
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
    ...(crime.carriage && { carriage: true as const }),
    ...(crime.horse !== undefined && { horse: crime.horse }),
    ...(crime.building && { building: crime.building }),
  })
}
