// The Creative section of a card (`CONTEXT.md`: Creative mode, ADR 0043): the creative actions
// an admin on a server started with `CREATIVE=1` can give by hand for the building or carriage
// the card shows. The server checks every action; this only picks which to offer.
import { MAX_HEALTH } from '@csp/balance'
import type {
  AdminPlaces,
  Building,
  Carriage,
  City,
  CreativeDone,
  Resident,
} from '@csp/shared-types'
import { KEEPS_GOODS } from './building.js'
import { canWork } from '@csp/lang-wasm'

/** Something goods can be given to or taken from, as the section lists it. */
interface CreativeHolder {
  id: string
  label: string
}

/** What the section offers for a card. */
export interface CreativeOffer {
  /** Where goods can be given or taken: the building's storage, the carriage on the tile. */
  holders: CreativeHolder[]
  /** What Finish now finishes, if anything: the building's id and the button's words. */
  finish?: { buildingId: string; label: string; title: string }
}

/**
 * The creative actions for a card's building and the carriage on its tile, if any. `shared` are
 * the buildings on the tile that share it (`SHARES_A_TILE`: road, carriage, boat, ship, ram and
 * catapult), which the card's building never is: a site among them is finished now too.
 */
export function creativeOffer(
  building: Pick<Building, 'id' | 'kind' | 'site'> | undefined,
  carriage: Pick<Carriage, 'id'> | undefined,
  buildingName: string,
  shared: readonly Pick<Building, 'id' | 'kind' | 'site'>[] = [],
): CreativeOffer {
  const holders: CreativeHolder[] = []
  if (building && !building.site && KEEPS_GOODS.includes(building.kind)) {
    holders.push({ id: building.id, label: `The ${buildingName}` })
  }
  if (carriage) holders.push({ id: carriage.id, label: 'The carriage' })
  const site = building?.site ? building : shared.find((b) => b.site)
  const finish = site
    ? {
        buildingId: site.id,
        label: 'Finish now',
        title: 'Build the site now, and the rest of any road or wall line building on it',
      }
    : building?.kind === 'trainingGround'
      ? {
          buildingId: building.id,
          label: 'Finish trainings now',
          title: 'Every trainee here trains as far as the teacher takes them, and stops',
        }
      : undefined
  return { holders, finish }
}

/** Whether a card has anything to offer in its Creative section. */
export function offersAnything(offer: CreativeOffer): boolean {
  return offer.holders.length > 0 || offer.finish !== undefined
}

/** A city a new Resident or horse can join, as the tile card's Creative section lists it. */
export interface CreativeCity {
  id: string
  label: string
}

/**
 * The cities a creative Resident or horse can join, each with whose it is: the admin's own realm
 * first, then the rest by name. A Player's city gives them to its realm; an NPC city or the Trade
 * Organization keeps them as its own.
 */
export function creativeCities(
  cities: readonly Pick<City, 'id' | 'name' | 'realmId' | 'tradeOrg'>[],
  homeRealmId: string | undefined,
): CreativeCity[] {
  const whose = (c: (typeof cities)[number]) =>
    c.realmId
      ? c.realmId === homeRealmId
        ? 'your realm'
        : 'a Player’s realm'
      : c.tradeOrg
        ? 'Trade Organization'
        : 'NPC city'
  const own = (c: (typeof cities)[number]) => (c.realmId && c.realmId === homeRealmId ? 0 : 1)
  return [...cities]
    .sort((a, b) => own(a) - own(b) || a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, label: `${c.name} (${whose(c)})` }))
}

/**
 * Every city in the world a creative Resident or horse can join, from the admin's jump list
 * (`adminPlaces`), seen or not: the admin's own realm first, then other Players' by realm, the NPC
 * cities and the Trade Organization's.
 */
export function citiesFromPlaces(
  places: Pick<AdminPlaces, 'realms' | 'npcCities' | 'tradeOrg'>,
  homeRealmId: string | undefined,
): CreativeCity[] {
  const realms = [...places.realms].sort(
    (a, b) => Number(a.id !== homeRealmId) - Number(b.id !== homeRealmId),
  )
  return [
    ...realms.flatMap((r) =>
      r.cities.map((c) => ({
        id: c.id,
        label: `${c.name} (${r.id === homeRealmId ? 'your realm' : r.name})`,
      })),
    ),
    ...places.npcCities.map((c) => ({ id: c.id, label: `${c.name} (NPC city)` })),
    ...[...(places.tradeOrg.hq ? [places.tradeOrg.hq] : []), ...places.tradeOrg.posts].map((c) => ({
      id: c.id,
      label: `${c.name} (Trade Organization)`,
    })),
  ]
}

/**
 * The city picked at first: the one whose area holds the tile, else the admin's home city, else
 * the first listed.
 */
export function defaultCreativeCity(
  cities: readonly CreativeCity[],
  tileCityId: string | undefined,
  homeCityId: string | undefined,
): string | undefined {
  const listed = (id: string | undefined) =>
    id && cities.some((c) => c.id === id) ? id : undefined
  return listed(tileCityId) ?? listed(homeCityId) ?? cities[0]?.id
}

/** A Resident as the Creative section reads them: another realm's health may be unseen. */
export type CreativeResident = Pick<Resident, 'id' | 'name' | 'bornAt' | 'downUntil'> & {
  health?: number
  down?: true
}

/**
 * What a Resident's Creative section offers: heal the hurt or Down (or whose health is unseen),
 * grow up a child, kill.
 */
export function residentActions(
  r: Omit<CreativeResident, 'id' | 'name'>,
  tick: number,
): { heal: boolean; growUp: boolean } {
  const hurt = r.health === undefined || r.health < MAX_HEALTH
  return { heal: r.downUntil !== undefined || r.down === true || hurt, growUp: !canWork(r, tick) }
}

/** A whole number typed in `[min, max]`, or undefined when the field is empty or out of range. */
export function pickedNumber(text: string, min: number, max: number): number | undefined {
  const t = text.trim()
  const n = Number(t)
  return t !== '' && Number.isFinite(n) && n >= min && n <= max ? n : undefined
}

/** The amount typed, if it is a whole number of units, at least one. */
export function creativeAmount(text: string): number | undefined {
  const n = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(n) && n >= 1 ? n : undefined
}

/**
 * What a creative action that was done says is wrong, or nothing: the invariants it broke, which
 * the server reports as a tick's (ADR 0004).
 */
export function creativeProblem(done: CreativeDone): string | undefined {
  if (done.violations.length === 0) return undefined
  return `${done.message} Invariants broken: ${done.violations.join('; ')}`
}
