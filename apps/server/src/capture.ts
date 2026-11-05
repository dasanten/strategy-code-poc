import {
  OCCUPATION_GAME_DAYS,
  OCCUPATION_TICKS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_DEBT_TRIPS,
  occupierOf,
  townHallOf,
  tradeOrgHq,
  drivenCarriageId,
  inCityArea,
  isArmed,
  isAt,
  realmName,
  type Carriage,
  type City,
  type Horse,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { joinTradeOrg, leaveTradeOrg, rejoinTradeOrg } from './caravans.js'
import { commitCrime, cityOrganization } from './crimes.js'
import { recordEvent } from './events.js'
import { hqFalls } from './hq-fall.js'
import { residentNamesTaken, uniqueName } from './names.js'
import { noteCityTaken } from './trade-org-takes.js'
import { workplacesOfCity } from './trade-org-wrecks.js'

/** A city that changed realm by capture this tick. */
export interface Capture {
  cityId: string
  /** The realm it belonged to; null for an NPC city. */
  from: string | null
  to: string
}

/**
 * Runs the occupations of town halls (`CONTEXT.md`: Occupying a town hall, Capturing a city): one
 * starts the tick a realm occupies a hall (`occupierOf`) with none
 * running; the first tick another realm or nobody does, it is broken and its days are lost; held
 * `OCCUPATION_TICKS`, the city is captured, or for the Trade Organization taken (`takeCity`). Both
 * realms' logs say when one starts and when it is broken (`occupationLogged`). Runs once fights,
 * deaths and dropped weapons are settled, and before refilling, so whoever is at home in a city
 * captured this tick refills there.
 */
export function stepCaptures(world: WorldState, terrain: TerrainMap): Capture[] {
  const size = terrain.size
  const captures: Capture[] = []
  for (const city of world.cities) {
    const occupier = occupierOf(world, city, size)
    if (city.occupation && city.occupation.realmId !== occupier) {
      occupationLogged(world, city, city.occupation.realmId, 'occupationBroken')
      city.occupation = null
    }
    if (occupier === null) continue
    if (!city.occupation) {
      city.occupation = { realmId: occupier, since: world.tick }
      occupationLogged(world, city, occupier, 'hallOccupied')
    }
    if (world.tick - city.occupation.since < OCCUPATION_TICKS) continue
    city.occupation = null
    captures.push({ cityId: city.id, from: city.realmId, to: occupier })
    if (occupier === TRADE_ORG) takeCity(world, city, terrain)
    else captureCity(world, city, occupier, size)
  }
  return captures
}

/**
 * The logs of the city's realm and of the realm `occupier` say its town hall is occupied by
 * `occupier`, or that its occupation is broken (`CONTEXT.md`: Occupying a town hall). An NPC city
 * has no log. A city that joined the occupier's realm otherwise (bought, persuaded) meanwhile
 * just ends it, unlogged.
 */
function occupationLogged(
  world: WorldState,
  city: City,
  occupier: string,
  kind: 'hallOccupied' | 'occupationBroken',
): void {
  if (city.realmId === occupier) return
  const hall = townHallOf(world, city)
  const at = { cityId: city.id, city: city.name, ...(hall && { x: hall.x, y: hall.y }) }
  // Occupying needs the hall standing (`occupierOf`), so a new occupation always has its place.
  const what =
    kind === 'hallOccupied'
      ? { kind, ...at, x: hall!.x, y: hall!.y, days: OCCUPATION_GAME_DAYS }
      : { kind, ...at }
  const owner = city.realmId
  recordEvent(world, occupier, { ...what, other: owner && realmName(world, owner), occupier: true })
  recordEvent(world, owner, { ...what, other: realmName(world, occupier), occupier: false })
}

/**
 * A city joins the realm `captor` with everything in it (`CONTEXT.md`: Capturing a city,
 * Integrating): its buildings, the residents who live there, wherever they stand, loyal at once,
 * and its horses and carriages (`comesWithCity`). A Leader is never
 * captured: one who lived there stays in their realm and is homeless. Those who join drop the
 * orders their former owner gave them, and their pair unless the partner joins too; whoever else
 * drove a carriage that joins stops driving it, and nobody keeps attacking their own realm. Both
 * realms' logs show it. One who joins with a name from the game that the realm already has gets a
 * numeral added (`CONTEXT.md`: Game-given names). A trading post's capture is a crime against the
 * Trade Organization, which it hears of only by news (`CONTEXT.md`: Lost post found out); its
 * witnesses are counted once its residents have joined, so that they are none of them.
 */
export function captureCity(world: WorldState, city: City, captor: string, size: number): void {
  const from = city.realmId
  const hall = townHallOf(world, city)
  const culprit =
    city.tradeOrg === 'post' && hall
      ? world.residents.find((r) => r.owner === captor && isArmed(r) && isAt(r, hall, size))
      : undefined
  const residents = joinRealm(world, city, captor, size)
  const what = { kind: 'cityCaptured', cityId: city.id, city: city.name, residents } as const
  recordEvent(world, captor, { ...what, other: from && realmName(world, from), captor: true })
  recordEvent(world, from, { ...what, other: realmName(world, captor), captor: false })
  const hq = tradeOrgHq(world)
  if (culprit && hq) {
    commitCrime(world, size, 'capture', culprit, { victimOrg: hq.id, post: city.id })
  }
}

/**
 * The Trade Organization's army held the town hall to the end (`CONTEXT.md`: Trade Org debt): the city
 * joins it as a new trading post (`joinTradeOrg`) and that settles all the debt of its Organization.
 * Those who live there stay as the post's and its horses and carriages are the post's, a Leader staying
 * in their realm, homeless, as in any capture (`changeHands`). What its residents worked it goes on
 * working. No crime: it only collects what it is owed. Capturing this post later goes like any other's.
 */
function takeCity(world: WorldState, city: City, terrain: TerrainMap): void {
  const from = city.realmId
  const org = cityOrganization(city)
  const worked = workplacesOfCity(world, city, terrain.size)
  const residents = changeHands(world, city, null, terrain.size)
  const own = worked.filter((b) => b.cityId !== city.id).map((b) => b.id)
  city.workplaceIds = [...new Set([...(city.workplaceIds ?? []), ...own])]
  joinTradeOrg(world, city, terrain)
  recordEvent(world, from, {
    kind: 'cityCaptured',
    cityId: city.id,
    city: city.name,
    residents,
    other: realmName(world, TRADE_ORG),
    captor: false,
  })
  const debt = world.debts.find((d) => d.org === org)
  noteCityTaken(world, {
    cityId: city.id,
    org,
    trips: debt?.trips ?? 0,
    enoughTrips: (debt?.trips ?? 0) >= TRADE_ORG_DEBT_TRIPS,
  })
  if (!debt) return
  world.debts = world.debts.filter((d) => d !== debt)
  recordEvent(world, org, { kind: 'debt', what: 'cityTaken', coins: debt.coins, owed: 0 })
}

/**
 * A city handed over joins the realm `to` as a captured one does (`CONTEXT.md`: Demand), though
 * nobody captured it, so the logs that say so are the caller's. An occupation by a third realm
 * goes on against the new owner, whose log says how long is left (`CONTEXT.md`: Occupying a town
 * hall). One by `to` itself ends with the tick (`stepCaptures`), unlogged.
 */
export function handOverCity(world: WorldState, city: City, to: string, size: number): void {
  joinRealm(world, city, to, size)
  const running = city.occupation
  const hall = townHallOf(world, city)
  if (!running || running.realmId === to || !hall) return
  const ticksLeft = running.since + OCCUPATION_TICKS - world.tick
  recordEvent(world, to, {
    kind: 'hallOccupied',
    cityId: city.id,
    city: city.name,
    x: hall.x,
    y: hall.y,
    days: Math.max(1, Math.ceil(ticksLeft / TICKS_PER_GAME_DAY)),
    other: realmName(world, running.realmId),
    occupier: false,
  })
}

/**
 * A city joins the realm `captor` with everything in it, as `captureCity` says, whether captured
 * or bought (`CONTEXT.md`: Buying a city); a trading post leaves the Trade Organization
 * (`leaveTradeOrg`), and so does its HQ (`hqFalls`). Returns how many of its residents joined.
 */
export function joinRealm(world: WorldState, city: City, captor: string, size: number): number {
  const joined = changeHands(world, city, captor, size)
  if (city.tradeOrg === 'hq') hqFalls(world, city)
  else leaveTradeOrg(world, city)
  return joined
}

/**
 * A captured post goes back to the Trade Organization (`CONTEXT.md`: Trade Org debt). Everything
 * that joins a realm with a city goes the other way (`changeHands`): those who live there are the
 * post's again, a Leader staying in their realm, homeless, and its horses and carriages are the
 * post's. The game runs it from here. Then it is a post again (`rejoinTradeOrg`).
 */
export function returnPost(world: WorldState, city: City, size: number): void {
  changeHands(world, city, null, size)
  rejoinTradeOrg(world, city, size)
}

/**
 * The city and all that goes with it change hands, to the realm `to` or, for none, to the city
 * itself (`joinRealm`, `returnPost`). Returns how many of its residents went with it.
 */
function changeHands(world: WorldState, city: City, to: string | null, size: number): number {
  const leaders = new Set(world.realms.map((r) => r.leaderId))
  const joining = world.residents.filter((r) => r.cityId === city.id && !leaders.has(r.id))
  const joined = new Set(joining.map((r) => r.id))
  // Asked before those who join drop their orders, a drive or haul among them.
  const comesAlong = comesWithCity(world, city, joining, size)
  const names = residentNamesTaken(world, to, to === null ? city.id : null)
  for (const r of world.residents) {
    if (r.cityId !== city.id) continue
    if (joined.has(r.id)) {
      if (r.gameName) r.name = uniqueName(r.name, names)
      names.add(r.name)
      r.owner = to
      r.order = null
      if (r.pair && !joined.has(r.pair.partnerId)) delete r.pair
    } else {
      r.cityId = null
      delete r.pair
    }
  }
  const join = (t: Horse | Carriage) => {
    t.realmId = to
    t.cityId = to === null ? city.id : null
  }
  const carriages = new Set<string>()
  for (const k of world.carriages) {
    if (!comesAlong(k)) continue
    join(k)
    carriages.add(k.id)
    const horse = world.horses.find((h) => h.id === k.horseId)
    if (horse) join(horse)
  }
  for (const h of world.horses) if (comesAlong(h)) join(h)
  const owners = new Map(world.residents.map((r) => [r.id, r.owner]))
  for (const r of world.residents) {
    const driven = drivenCarriageId(r)
    if (driven && carriages.has(driven) && !joined.has(r.id)) r.order = null
    const o = r.order
    if (o?.kind === 'attack' && r.owner !== null && owners.get(o.targetId) === r.owner)
      r.order = null
  }
  city.realmId = to
  // Only a city of no realm has a plan (`cityPlansSound`), and this tick's planning is over.
  delete world.cityPlans[city.id]
  return joining.length
}

/**
 * Which horses and carriages join with a city (`CONTEXT.md`: What joins with a city). An NPC
 * city's are all its own, wherever they stand. A Player's aren't tied to one city, so of those the
 * ones in its area or at its stables; a stable is no city building, so it isn't in the area by
 * itself. Either way a horse one of the `joining` residents rides and a carriage one drives.
 */
function comesWithCity(
  world: WorldState,
  city: City,
  joining: Resident[],
  size: number,
): (t: Horse | Carriage) => boolean {
  const from = city.realmId
  const along = new Set(joining.flatMap((r) => [r.riding, drivenCarriageId(r)]))
  const stables = world.buildings.filter(
    (b) => b.kind === 'stable' && !b.site && b.cityId === city.id,
  )
  return (t) => {
    if (along.has(t.id)) return true
    if (from === null) return t.realmId === null && t.cityId === city.id
    if (t.realmId !== from) return false
    return inCityArea(world, city, t.x, t.y, size) || stables.some((s) => isAt(t, s, size))
  }
}
