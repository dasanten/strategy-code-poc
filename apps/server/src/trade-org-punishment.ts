import {
  ARMY_SPREAD,
  CARRIAGE_STOLEN_WORTH,
  FOOD_PER_DAY,
  GOOD_WEIGHT,
  HORSE_STOLEN_WORTH,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  DIRECTIVE_PUNISH_WORTH,
  TRADE_ORG,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  WALK_TICKS_PER_TILE,
  WAREHOUSE_BASE_PRICE,
  carryCapacity,
  directiveTargets,
  inCityArea,
  standingOf,
  standingOrganization,
  stockWeight,
  townHallOf,
  tradeOrgHq,
  tripFood,
  unitsThatFit,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type City,
  type Crime,
  type Good,
  type Punishment,
  type PunishmentEnd,
  type Resident,
  type Stock,
  type WorldState,
  isAt,
} from '@csp/shared'
import { caravanThreats } from './caravans.js'
import { attackOrder } from './combat.js'
import { cityOrganization } from './crimes.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome, walkTo } from './npc-behaviour.js'
import { newId } from './starting-city.js'
import {
  goToWagonForFood,
  loadOnWagon,
  sendWagon,
  stepSupplyWagons,
  wagonOf,
  wagonTook,
} from './supply-wagons.js'
import { spareSoldiers } from './trade-org-army.js'
import { buyFood, packPurse } from './trade-org-buying.js'
import { oweTradeOrg } from './trade-org-debt.js'
import { findWorkplaces, tearDownNext, workplacesToWreck } from './trade-org-wrecks.js'

/*
 * The Trade Organization punishes (`CONTEXT.md`: Trade Org reaction, Self-interest): once it
 * holds an Organization below `TRADE_ORG_PUNISHES_BELOW` and knows of crimes it did against it,
 * it sends spare soldiers of its army to that Organization's city nearest the crime, to take
 * back `TRADE_ORG_PUNISH.times` what it lost from the city's storages, Coins first, fighting
 * whoever resists, and carry it home. What it came for and couldn't take stays owed (`CONTEXT.md`:
 * Trade Org debt), and past its demand's deadline an army comes to tear down workplaces for it
 * (`Punishment.wrecks`, `trade-org-wrecks.ts`). It never captures the city. Like the rest of the HQ it
 * only gives orders a Player could give (ADR 0002): walking, picking up, dropping, attacking, tearing
 * down.
 */

/** What goods are worth in Coins: a Coin one, any other good its warehouse base price. */
export function worthOf(stock: Stock): number {
  let worth = 0
  for (const [good, n] of Object.entries(stock) as [Good, number][]) {
    worth += n * (good === 'coins' ? 1 : WAREHOUSE_BASE_PRICE[good])
  }
  return worth
}

/**
 * What a crime cost the Trade Organization in Coins (`TRADE_ORG_LOSS`): for a theft, the worth of
 * the goods and of a carriage and horse (`CONTEXT.md`: Stealing a carriage or horse).
 */
export function lossOf(crime: Crime): number {
  if (crime.kind !== 'theft') return TRADE_ORG_LOSS[crime.kind]
  const carriage = crime.carriage ? CARRIAGE_STOLEN_WORTH : 0
  const horse = crime.horse !== undefined ? HORSE_STOLEN_WORTH : 0
  return worthOf(crime.goods ?? {}) + carriage + horse
}

/** What a member carries above what they set out with: what they took. */
export function takenBy(r: Resident, own: Stock): Stock {
  const taken: Stock = {}
  for (const [good, n] of Object.entries(r.carried) as [Good, number][]) {
    const more = n - (own[good] ?? 0)
    if (more > 0) taken[good] = more
  }
  return taken
}

/** A punishment's living members, with what they set out with. */
function living(world: WorldState, p: Punishment) {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  return p.members.flatMap((member) => {
    const r = byId.get(member.residentId)
    return r && r.health > 0 ? [{ r, own: member.own, member }] : []
  })
}

/** The Coins' worth a punishment's living members have taken, on them or on its supply wagon. */
export function tookSoFar(world: WorldState, p: Punishment): number {
  const carried = living(world, p).reduce((sum, m) => sum + worthOf(takenBy(m.r, m.own)), 0)
  return carried + wagonTook(world, p)
}

/**
 * Whether a crime is one the Trade Organization knows of against itself and hasn't punished yet. A
 * captured post never is: that is a debt (`lostPostsBecomeDebts`).
 */
const toPunish = (world: WorldState, c: Crime) =>
  !c.punished &&
  c.post === undefined &&
  standingOrganization(world, c.victimOrg) === TRADE_ORG &&
  c.knownBy.includes(c.victimOrg)

/**
 * One tick of the Trade Organization punishing, on a map of `size` tiles: crimes of those who owe it
 * go on their debts (`addCrimesToDebts`), it sends out new punishments (`sendOut`, `sendOutForDebts`,
 * `sendOutForDirectives`) and runs those under way and their supply wagons. Run after
 * `stepTradeOrgArmy` and before `stepNpcCities`; the HQ leaves the members of a punishment to it.
 */
export function stepPunishments(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  if (!hq) {
    world.punishments = []
    world.supplyWagons = []
    world.debts = []
    return
  }
  addCrimesToDebts(world)
  sendOut(world, size)
  sendOutForDebts(world, size)
  sendOutForDirectives(world, size)
  for (const p of [...world.punishments]) runPunishment(world, hq, p, size)
  stepSupplyWagons(world, hq, size)
}

/**
 * A crime the Trade Organization comes to know of by an Organization that owes it adds what it cost
 * to the debt (`CONTEXT.md`: Trade Org debt) and sends no army of its own: it counts as punished.
 */
function addCrimesToDebts(world: WorldState): void {
  if (world.debts.length === 0) return
  for (const c of world.crimes) {
    if (!toPunish(world, c)) continue
    const debt = world.debts.find((d) => d.org === c.culprit.org)
    if (!debt) continue
    c.punished = true
    oweTradeOrg(world, debt.org, lossOf(c))
  }
}

/**
 * For each Organization the Trade Organization holds below `TRADE_ORG_PUNISHES_BELOW` and knows
 * of crimes by against itself, with none of its punishments under way: its army goes to the
 * Organization's city nearest the latest such crime, `TRADE_ORG_PUNISH.soldiers` of its spare
 * soldiers at most, to take back `TRADE_ORG_PUNISH.times` what those crimes cost it. Once it
 * goes, those crimes are punished. With no spare soldier, or no city to go to, it waits.
 */
function sendOut(world: WorldState, size: number): void {
  const crimes = world.crimes.filter((c) => toPunish(world, c))
  if (crimes.length === 0) return
  const byOrg = new Map<string, Crime[]>()
  for (const c of crimes) byOrg.set(c.culprit.org, [...(byOrg.get(c.culprit.org) ?? []), c])
  for (const [org, theirs] of byOrg) {
    if (world.punishments.some((p) => p.culpritOrg === org)) continue
    if (standingOrganization(world, org) === TRADE_ORG) continue
    if (standingOf(world, TRADE_ORG, org) >= TRADE_ORG_PUNISHES_BELOW) continue
    const latest = theirs.reduce((a, b) => (b.tick > a.tick ? b : a))
    const halls = world.cities.flatMap((c) => {
      const hall = !c.tradeOrg && cityOrganization(c) === org && townHallOf(world, c)
      return hall ? [{ c, hall }] : []
    })
    if (halls.length === 0) continue
    const city = halls.reduce((a, b) =>
      wrapDistance(size, latest, b.hall) < wrapDistance(size, latest, a.hall) ? b : a,
    ).c
    const busy = new Set(world.punishments.flatMap((p) => p.members.map((m) => m.residentId)))
    const soldiers = spareSoldiers(world)
      .filter((r) => !busy.has(r.id))
      .slice(0, TRADE_ORG_PUNISH.soldiers)
    if (soldiers.length === 0) continue
    const worth = TRADE_ORG_PUNISH.times * theirs.reduce((sum, c) => sum + lossOf(c), 0)
    for (const c of theirs) c.punished = true
    if (worth <= 0) continue
    setOut(world, city, size, {
      id: newId(world, 'punishment'),
      culpritOrg: org,
      cityId: city.id,
      worth,
      members: soldiers.map((r) => ({ residentId: r.id, own: { ...r.carried } })),
      heading: 'out',
      took: 0,
      startedAt: world.tick,
    })
    recordEvent(world, org, {
      kind: 'punished',
      what: 'coming',
      cityId: city.id,
      city: city.name,
      worth,
    })
  }
}

/**
 * For each debt at its step `wrecks`, with none of the Trade Organization's punishments under way
 * against who owes it: its next army goes to the city kept with the debt, or if that is no longer
 * theirs their city nearest the HQ, `TRADE_ORG_PUNISH.soldiers` of its spare soldiers at most, to tear
 * down workplaces for it (`CONTEXT.md`: Trade Org debt). It goes again each time it is back, with the
 * debt still owed. With no spare soldier, or no city to go to, it waits.
 */
function sendOutForDebts(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  const hqHall = hq && townHallOf(world, hq)
  if (!hqHall) return
  for (const debt of world.debts) {
    if (debt.step !== 'wrecks') continue
    if (world.punishments.some((p) => p.culpritOrg === debt.org)) continue
    const halls = world.cities.flatMap((c) => {
      const hall = !c.tradeOrg && cityOrganization(c) === debt.org && townHallOf(world, c)
      return hall ? [{ c, hall }] : []
    })
    if (halls.length === 0) continue
    const kept = halls.find((h) => h.c.id === debt.cityId)
    const city = (
      kept ??
      halls.reduce((a, b) =>
        wrapDistance(size, hqHall, b.hall) < wrapDistance(size, hqHall, a.hall) ? b : a,
      )
    ).c
    const busy = new Set(world.punishments.flatMap((p) => p.members.map((m) => m.residentId)))
    const soldiers = spareSoldiers(world)
      .filter((r) => !busy.has(r.id))
      .slice(0, TRADE_ORG_PUNISH.soldiers)
    if (soldiers.length === 0) return
    setOut(world, city, size, {
      id: newId(world, 'punishment'),
      culpritOrg: debt.org,
      cityId: city.id,
      worth: debt.coins,
      members: soldiers.map((r) => ({ residentId: r.id, own: { ...r.carried } })),
      heading: 'out',
      took: 0,
      startedAt: world.tick,
      wrecks: [],
    })
    recordEvent(world, debt.org, {
      kind: 'punished',
      what: 'coming',
      cityId: city.id,
      city: city.name,
      worth: debt.coins,
      wrecks: true,
    })
  }
}

/**
 * For each Organization an admin directive names (`CONTEXT.md`: Admin directive), with none of
 * the Trade Organization's punishments under way: its army goes to the Organization's city
 * nearest the HQ, `TRADE_ORG_PUNISH.soldiers` of its spare soldiers at most, to take
 * `DIRECTIVE_PUNISH_WORTH`, and goes again each time it is back, until the directive is lifted.
 * With no spare soldier, or no city to go to, it waits.
 */
function sendOutForDirectives(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  const hqHall = hq && townHallOf(world, hq)
  if (!hqHall) return
  for (const d of world.directives) {
    for (const org of directiveTargets(world, d)) {
      if (world.punishments.some((p) => p.culpritOrg === org)) continue
      if (standingOrganization(world, org) === TRADE_ORG) continue
      const halls = world.cities.flatMap((c) => {
        const hall = !c.tradeOrg && cityOrganization(c) === org && townHallOf(world, c)
        return hall ? [{ c, hall }] : []
      })
      if (halls.length === 0) continue
      const city = halls.reduce((a, b) =>
        wrapDistance(size, hqHall, b.hall) < wrapDistance(size, hqHall, a.hall) ? b : a,
      ).c
      const busy = new Set(world.punishments.flatMap((p) => p.members.map((m) => m.residentId)))
      const soldiers = spareSoldiers(world)
        .filter((r) => !busy.has(r.id))
        .slice(0, TRADE_ORG_PUNISH.soldiers)
      if (soldiers.length === 0) return
      setOut(world, city, size, {
        id: newId(world, 'punishment'),
        culpritOrg: org,
        cityId: city.id,
        worth: DIRECTIVE_PUNISH_WORTH,
        members: soldiers.map((r) => ({ residentId: r.id, own: { ...r.carried } })),
        heading: 'out',
        took: 0,
        startedAt: world.tick,
        directiveId: d.id,
      })
      recordEvent(world, org, {
        kind: 'punished',
        what: 'coming',
        cityId: city.id,
        city: city.name,
        worth: DIRECTIVE_PUNISH_WORTH,
        directive: d.reason,
      })
    }
  }
}

/** A punishment sets out for `city`, with a supply wagon if it can have one (`sendWagon`). */
function setOut(world: WorldState, city: City, size: number, p: Punishment): void {
  world.punishments.push(p)
  const hq = tradeOrgHq(world)
  const from = hq && townHallOf(world, hq)
  const to = townHallOf(world, city)
  if (hq && from && to) sendWagon(world, hq, p, wrapDistance(size, from, to), size)
}

/** The city's finished storages that hold anything. */
function storagesToTake(world: WorldState, city: City): Building[] {
  return world.buildings.filter(
    (b) =>
      b.cityId === city.id &&
      b.kind === 'storage' &&
      !b.site &&
      Object.values(b.stock ?? {}).some((n) => n > 0),
  )
}

/** The goods of a stock in the order the Trade Organization takes them: Coins, then most worth. */
function takingOrder(stock: Stock): Good[] {
  const worth = (g: Good) => (g === 'coins' ? Infinity : WAREHOUSE_BASE_PRICE[g])
  return (Object.keys(stock) as Good[])
    .filter((g) => (stock[g] ?? 0) > 0)
    .sort((a, b) => worth(b) - worth(a) || a.localeCompare(b))
}

/**
 * What a member standing at `storage` picks up: of each good in `takingOrder`, as many units as
 * are there, fit their carry capacity and still make up `left` Coins' worth. Returns the goods and
 * their worth.
 */
function toTake(world: WorldState, r: Resident, storage: Building, left: number) {
  const goods: Stock = {}
  let worth = 0
  const stock = storage.stock ?? {}
  for (const g of takingOrder(stock)) {
    if (worth >= left) break
    const each = g === 'coins' ? 1 : WAREHOUSE_BASE_PRICE[g]
    const units = Math.min(
      stock[g]!,
      unitsThatFit(r, g, world.tick),
      Math.ceil((left - worth) / each),
    )
    if (units <= 0) continue
    goods[g] = units
    worth += units * each
  }
  return { goods, worth }
}

/** Gives a resident an order to walk to a tile, unless they are already on their way there. */
export function headFor(r: Resident, to: { x: number; y: number }): void {
  const o = r.order
  if (r.x === to.x && r.y === to.y) return
  if (o?.kind === 'walkTo' && o.target.x === to.x && o.target.y === to.y) return
  walkTo(r, to)
}

/**
 * Why a punishment heads home now, if it does (`CONTEXT.md`: Punishment trip). Wherever it is, when
 * the debt it came about is no longer owed, the admin directive it was sent for is lifted or the city
 * is no longer the culprit's. On the road only when it has been trying for
 * `TRADE_ORG_PUNISH.roadTimes` the straight walk: it has no way there. At the city once it has taken
 * its worth, when the storages hold nothing (for an army that wrecks: no workplaces are left), or
 * `TRADE_ORG_PUNISH.giveUpDays` after it arrived.
 */
function whyHeadHome(
  world: WorldState,
  hq: City,
  p: Punishment,
  city: City | undefined,
  took: number,
  size: number,
): PunishmentEnd | undefined {
  if (p.wrecks && !world.debts.some((d) => d.org === p.culpritOrg)) {
    return took >= p.worth ? 'enough' : 'paid'
  }
  if (directiveLifted(world, p)) return 'directiveLifted'
  if (!city || !stillTheCulprits(world, p, city)) return 'cityLost'
  if (p.arrivedAt === undefined) {
    const hall = townHallOf(world, hq)
    const target = townHallOf(world, city)
    const tiles = hall && target ? wrapDistance(size, hall, target) : 0
    const most = Math.max(
      TRADE_ORG_PUNISH.giveUpDays * TICKS_PER_GAME_DAY,
      TRADE_ORG_PUNISH.roadTimes * tiles * WALK_TICKS_PER_TILE,
    )
    return world.tick - p.startedAt >= most ? 'noWay' : undefined
  }
  if (p.wrecks) {
    if (p.wrecks.length === 0) return 'noWorkplaces'
  } else {
    if (took >= p.worth) return 'enough'
    if (storagesToTake(world, city).length === 0) return 'empty'
  }
  const stayed = world.tick - p.arrivedAt
  return stayed >= TRADE_ORG_PUNISH.giveUpDays * TICKS_PER_GAME_DAY ? 'gaveUp' : undefined
}

/** Whether the admin directive a punishment was sent for is no longer in force. */
const directiveLifted = (world: WorldState, p: Punishment) =>
  p.directiveId !== undefined && !world.directives.some((d) => d.id === p.directiveId)

/** Whether the city is one of the culprit's still, with a town hall to walk to. */
function stillTheCulprits(world: WorldState, p: Punishment, city: City): boolean {
  return !city.tradeOrg && cityOrganization(city) === p.culpritOrg && !!townHallOf(world, city)
}

/**
 * The Food the rest of the trip takes a member, in units (`CONTEXT.md`: Punishment trip): on the way
 * there, for the walk there, their time there and the walk back; from then on, for the walk back to
 * the HQ.
 */
function foodNeeded(
  world: WorldState,
  hq: City,
  p: Punishment,
  city: City | undefined,
  r: Resident,
  size: number,
): number {
  const hall = townHallOf(world, hq)
  if (!hall) return 0
  const target = city && townHallOf(world, city)
  if (p.heading === 'home' || p.arrivedAt !== undefined || !target) {
    return tripFood(wrapDistance(size, r, hall))
  }
  const tiles = wrapDistance(size, r, target) + wrapDistance(size, target, hall)
  return tripFood(tiles) + TRADE_ORG_PUNISH.giveUpDays * FOOD_PER_DAY
}

/**
 * The Food a member still wants on them for the trip, in units (`foodNeeded`): on the way there never
 * into the room they keep for what they will carry home.
 */
function foodWanted(
  world: WorldState,
  hq: City,
  p: Punishment,
  city: City | undefined,
  r: Resident,
  size: number,
): number {
  const needed = foodNeeded(world, hq, p, city, r, size)
  if (p.heading === 'home' || p.arrivedAt !== undefined) return needed
  const others = stockWeight(r.carried) - (r.carried.food ?? 0) * GOOD_WEIGHT.food
  const room = carryCapacity(r, world.tick) - others - TRADE_ORG_PUNISH.packRoom
  return Math.min(needed, Math.floor(room / GOOD_WEIGHT.food))
}

/**
 * The Food a member on the road is short of and would buy (`CONTEXT.md`: Trade Org debt), in units:
 * what the rest of the trip takes them above what they carry and their share of what is on the wagon,
 * as far as they `wanted` it on them. Having eaten a meal is not being short.
 */
function foodToBuy(r: Resident, needed: number, wanted: number, wagonShare: number): number {
  const carried = r.carried.food ?? 0
  return Math.floor(Math.min(needed - carried - wagonShare, wanted - carried))
}

/**
 * The finished buildings of the given cities with Food to take: their storages, or where those
 * have none, their warehouses, which keep Food for sale.
 */
export function foodIn(world: WorldState, cityIds: Set<string>): Building[] {
  const stores = world.buildings.filter(
    (b) =>
      (b.kind === 'storage' || b.kind === 'warehouse') &&
      !b.site &&
      cityIds.has(b.cityId ?? '') &&
      (b.stock?.food ?? 0) > 0,
  )
  const storages = stores.filter((b) => b.kind === 'storage')
  return storages.length > 0 ? storages : stores
}

/**
 * Where a member may refill on the way, within `TRADE_ORG_PUNISH.postReach` tiles of them: the Trade
 * Organization's cities, the trading posts they pass, and `robbing`, the city the army reached, while
 * it may still take from it. Further off it is behind them: nobody walks back for a meal.
 */
function refillPlaces(
  world: WorldState,
  robbing: City | undefined,
  r: Resident,
  size: number,
): Building[] {
  const tradeOrg = new Set(world.cities.filter((c) => c.tradeOrg).map((c) => c.id))
  const places = robbing
    ? [...foodIn(world, tradeOrg), ...foodIn(world, new Set([robbing.id]))]
    : foodIn(world, tradeOrg)
  return places.filter((b) => wrapDistance(size, r, b) <= TRADE_ORG_PUNISH.postReach)
}

/**
 * Sends a member for the Food they are short of (`CONTEXT.md`: Punishment trip) to the nearest of
 * `places`, if they have any: whole units, none for less. What they take for the trip is their
 * own, not what the army came to take. Answers whether they are seeing to it.
 */
export function fetchFood(
  world: WorldState,
  places: () => Building[],
  r: Resident,
  own: Stock,
  wanted: number,
  size: number,
): boolean {
  const short = Math.min(
    Math.floor(wanted - (r.carried.food ?? 0)),
    unitsThatFit(r, 'food', world.tick),
  )
  if (short < 1) return false
  const found = places()
  if (found.length === 0) return false
  const storage = found.reduce((a, b) =>
    wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
  )
  if (!isAt(r, storage, size)) {
    headFor(r, storage)
    return true
  }
  const food = Math.min(short, Math.floor(storage.stock!.food!))
  if (food < 1) return false
  r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods: { food } }
  own.food = (own.food ?? 0) + food
  return true
}

/**
 * Which of the Trade Org's soldiers wait this tick, on a map of `size` tiles (`CONTEXT.md`: Army,
 * Punishment trip): those walking the road, to the city or home to the HQ, with more than `ARMY_SPREAD`
 * tiles fewer to go than the one furthest behind, so that they keep together with their supply wagon.
 */
export function waitingOnTheRoad(world: WorldState, size: number): Set<string> {
  const waiting = new Set<string>()
  for (const p of world.punishments) {
    if (p.heading === 'out' && p.arrivedAt !== undefined) continue
    const city = world.cities.find((c) => c.id === p.cityId)
    const hall = city && townHallOf(world, city)
    const hq = tradeOrgHq(world)
    const walkers = living(world, p).flatMap(({ r }) => {
      const o = r.order
      if (o?.kind !== 'walkTo' || !o.path) return []
      const onTheRoad =
        p.heading === 'out'
          ? hall && o.target.x === hall.x && o.target.y === hall.y
          : hq && inCityArea(world, hq, o.target.x, o.target.y, size)
      return onTheRoad ? [{ id: r.id, left: o.path.length }] : []
    })
    if (walkers.length < 2) continue
    const behind = Math.max(...walkers.map((m) => m.left))
    for (const m of walkers) if (m.left < behind - ARMY_SPREAD) waiting.add(m.id)
  }
  return waiting
}

/**
 * What a member has eaten stops counting as their own, so that Food they take later is told from
 * it. Their own food (`OWN_FOOD`) always counts, or a meal taken at home would look like loot. So do
 * Coins they spent (`buyFood`), or Coins they take later would look like what they brought.
 */
function eatFromOwn(r: Resident, own: Stock): void {
  own.food = Math.max(OWN_FOOD, Math.min(own.food ?? 0, r.carried.food ?? 0))
  if (own.coins !== undefined) own.coins = Math.min(own.coins, r.carried.coins ?? 0)
}

/** A line in the culprit's log about a punishment (`CONTEXT.md`: Punishment trip). */
function logPunished(
  world: WorldState,
  p: Punishment,
  city: City | undefined,
  line: { what: 'arrived' | 'left' | 'turnedBack' | 'lost'; why?: PunishmentEnd },
  where?: 'wayThere' | 'atCity' | 'wayHome',
): void {
  recordEvent(world, p.culpritOrg, {
    kind: 'punished',
    cityId: p.cityId,
    city: city?.name ?? 'a city',
    worth: p.worth,
    took: p.took,
    ...line,
    ...(where && { where }),
    ...(p.wrecks && { wrecks: true as const }),
  })
}

/**
 * What a punishment for crimes came for and didn't take stays owed (`CONTEXT.md`: Trade Org debt),
 * from when it heads home or is lost. `took` is what it got; one sent for an admin directive leaves
 * no debt, nor does one that came to tear down workplaces for a debt, which still stands.
 */
function leaveDebt(world: WorldState, p: Punishment, took: number): void {
  if (p.directiveId === undefined && !p.wrecks) {
    oweTradeOrg(world, p.culpritOrg, p.worth - took, p.cityId)
  }
}

/**
 * One tick of a punishment (`CONTEXT.md`: Trade Org reaction, Punishment trip). Each member first
 * packs at the HQ, then walks to the city's town hall, however long that takes, refilling at
 * trading posts they pass and buying Food if they are short (`buyFood`). Once one of them is in the
 * city's area it has arrived: each
 * goes after anyone attacking one of them, otherwise to the city's nearest storage holding
 * anything, takes Food for the way back and picks up what is still to take there.
 * With a supply wagon, a member short of Food goes to meet it (`goToWagonForFood`) and one who took
 * goods puts them on it (`loadOnWagon`); it comes home after them and unloads (`stepSupplyWagons`).
 * Heading home (`whyHeadHome`), each member brings Coins they took to the HQ's coin warehouse and
 * other goods to its goods warehouse, then goes home; once every living member is home with
 * nothing taken, it is over. The culprit reads what happens as it happens: it arrived, it left with
 * what it took, it turned back without reaching the city and why, or it was lost, and what that
 * leaves owed (`leaveDebt`). An army that wrecks takes no goods: at the city its soldiers tear down
 * the workplaces it finds (`findWorkplaces`), and what comes down counts against the debt
 * (`countWrecked`).
 */
function runPunishment(world: WorldState, hq: City, p: Punishment, size: number): void {
  const members = living(world, p)
  const city = world.cities.find((c) => c.id === p.cityId)
  if (members.length === 0) {
    world.punishments = world.punishments.filter((x) => x !== p)
    const where =
      p.heading === 'home' ? 'wayHome' : p.arrivedAt === undefined ? 'wayThere' : 'atCity'
    logPunished(world, p, city, { what: 'lost' }, where)
    // Nobody is left carrying anything but its wagon, which goes home by itself; on the way home the
    // debt was settled as it left.
    if (p.heading === 'out') leaveDebt(world, p, Math.min(wagonTook(world, p), p.worth))
    return
  }
  for (const { r, own } of members) eatFromOwn(r, own)
  const took = p.wrecks ? p.took : tookSoFar(world, p)
  const debt = p.wrecks && world.debts.find((d) => d.org === p.culpritOrg)
  if (p.heading === 'out') {
    if (debt) p.worth = p.took + debt.coins
    p.took = Math.min(took, p.worth)
    if (
      p.arrivedAt === undefined &&
      city &&
      stillTheCulprits(world, p, city) &&
      members.some((m) => inCityArea(world, city, m.r.x, m.r.y, size))
    ) {
      p.arrivedAt = world.tick
      logPunished(world, p, city, { what: 'arrived' })
    }
    if (p.wrecks && p.arrivedAt !== undefined && city && stillTheCulprits(world, p, city)) {
      findWorkplaces(world, p, city, size)
    }
    const why = whyHeadHome(world, hq, p, city, took, size)
    if (why) {
      p.heading = 'home'
      logPunished(world, p, city, { what: p.arrivedAt === undefined ? 'turnedBack' : 'left', why })
      leaveDebt(world, p, p.took)
    }
  }
  const robbing =
    city &&
    p.arrivedAt !== undefined &&
    stillTheCulprits(world, p, city) &&
    !directiveLifted(world, p)
      ? city
      : undefined
  const storages = robbing && !p.wrecks ? storagesToTake(world, robbing) : []
  const wrecking =
    robbing && debt && p.heading === 'out' ? workplacesToWreck(world, p, debt.coins) : []
  const target = city && townHallOf(world, city)
  const ids = new Set(members.map((m) => m.r.id))
  const on = wagonOf(world, p)
  const resisting = world.residents.filter(
    (r) =>
      r.health > 0 && !ids.has(r.id) && r.order?.kind === 'attack' && ids.has(r.order.targetId),
  )
  // Those robbing its supply wagon or going after its driver are fought too, like a caravan's.
  if (on) {
    const crew = { driverId: on.wagon.driverId, escortIds: [...ids] }
    for (const t of caravanThreats(world, crew, on.carriage, size)) {
      if (!resisting.includes(t)) resisting.push(t)
    }
  }
  let left = p.worth - took
  const onTheRoad = p.heading === 'home' || p.arrivedAt === undefined
  const wagonShare = on ? (on.carriage.load.food ?? 0) / (members.length + 1) : 0
  for (const { r, own, member } of members) {
    const o = r.order
    if (o?.kind === 'tearDown' && !wrecking.some((b) => b.id === o.buildingId)) r.order = null
    if (r.order?.kind === 'attack') continue
    if (resisting.length > 0) {
      const nearest = resisting.reduce((a, b) =>
        wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
      )
      r.order = attackOrder(nearest.id)
      continue
    }
    const wanted = foodWanted(world, hq, p, city, r, size)
    if (p.heading === 'out' && !member.packed) {
      if (packPurse(world, hq, r, own, size)) continue
      if (fetchFood(world, () => foodIn(world, new Set([hq.id])), r, own, wanted, size)) {
        if (r.order?.kind === 'pickUp') member.packed = true
        continue
      }
      member.packed = true
    }
    if (onTheRoad) {
      const needed = foodNeeded(world, hq, p, city, r, size)
      const units = foodToBuy(r, needed, wanted, wagonShare)
      if (buyFood(world, hq, p, member, r, units, size)) continue
    }
    if (on && goToWagonForFood(r, on.carriage, size)) continue
    const places = () => refillPlaces(world, robbing, r, size)
    if (fetchFood(world, places, r, own, wanted, size)) continue
    if (on && loadOnWagon(world, r, own, on.carriage, size)) continue
    if (p.heading === 'home') {
      bringHome(world, hq, r, handingIn(world, hq, r, own), size)
      continue
    }
    if (p.arrivedAt === undefined) {
      if (target) headFor(r, target)
      continue
    }
    if (p.wrecks) {
      tearDownNext(r, wrecking, size, headFor)
      continue
    }
    if (storages.length === 0) continue
    const storage = storages.reduce((a, b) =>
      wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
    )
    if (!isAt(r, storage, size)) {
      headFor(r, storage)
      continue
    }
    const { goods, worth } = toTake(world, r, storage, left)
    if (worth <= 0) continue
    r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
    left -= worth
  }
  const done =
    p.heading === 'home' &&
    members.every(
      (m) =>
        Object.keys(handingIn(world, hq, m.r, m.own)).length === 0 &&
        inCityArea(world, hq, m.r.x, m.r.y, size),
    )
  if (done) world.punishments = world.punishments.filter((x) => x !== p)
}

/**
 * What a member heading home hands in at the HQ: what they took, and all the Coins they carry, what
 * they brought to buy Food with included, as long as a warehouse there keeps Coins.
 */
function handingIn(world: WorldState, hq: City, r: Resident, own: Stock): Stock {
  const taken = takenBy(r, own)
  const coins = r.carried.coins ?? 0
  if (coins <= 0) return taken
  const kept = world.buildings.some(
    (b) => b.cityId === hq.id && warehouseKeeps(world, b).includes('coins'),
  )
  return kept ? { ...taken, coins } : taken
}

/**
 * A member heading home puts what they took into the HQ's warehouses: Coins into the one that
 * keeps them, other goods into the one that keeps those. With nothing left to bring, they walk
 * home.
 */
function bringHome(world: WorldState, hq: City, r: Resident, taken: Stock, size: number): void {
  const goods = Object.keys(taken) as Good[]
  for (const b of world.buildings) {
    if (b.cityId !== hq.id) continue
    const keeps = warehouseKeeps(world, b)
    const here = goods.filter((g) => keeps.includes(g))
    if (here.length === 0) continue
    if (!isAt(r, b, size)) {
      headFor(r, b)
      return
    }
    const put: Stock = {}
    for (const g of here) put[g] = taken[g]!
    r.order = { kind: 'drop', to: { kind: 'storage', storageId: b.id }, goods: put }
    return
  }
  // Goods no HQ warehouse keeps stay carried, like a soldier's own.
  const home = npcHome(world, hq)
  if (home && !inCityArea(world, hq, r.x, r.y, size)) headFor(r, home)
}

/**
 * The Trade Organization's punishments hold together (`CONTEXT.md`: Trade Org reaction; ADR
 * 0004): each punishes an Organization other than the Trade Organization, at most one under way
 * for each, for a positive worth of which it took no more than all and nothing before it arrived
 * (Punishment trip); its members are residents of the HQ, each in one punishment at most and in no
 * contract, having brought no less than no Coins; and the Trade Organization never captures a city. Its supply wagons have their own
 * invariant (`supplyWagonsSound`).
 */
export const punishmentsSound: Invariant = {
  name: 'punishments-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const hq = tradeOrgHq(world)
    const orgs = new Set<string>()
    const members = new Set<string>()
    for (const p of world.punishments ?? []) {
      if (standingOrganization(world, p.culpritOrg) === TRADE_ORG) {
        fail(`punishment ${p.id} punishes the Trade Organization itself`, [p.id])
      }
      if (!(p.worth > 0)) fail(`punishment ${p.id} is worth ${p.worth}`, [p.id])
      if (!(p.took >= 0 && p.took <= p.worth)) {
        fail(`punishment ${p.id} took ${p.took} of its ${p.worth}`, [p.id])
      }
      if (p.took > 0 && p.arrivedAt === undefined) {
        fail(`punishment ${p.id} took ${p.took} before it arrived`, [p.id])
      }
      if (p.arrivedAt !== undefined && p.arrivedAt < p.startedAt) {
        fail(`punishment ${p.id} arrived before it set out`, [p.id])
      }
      if (orgs.has(p.culpritOrg)) fail(`${p.culpritOrg} is punished twice at once`, [p.id])
      orgs.add(p.culpritOrg)
      for (const { residentId: id, own } of p.members) {
        const r = world.residents.find((x) => x.id === id)
        if ((own.coins ?? 0) < 0) fail(`${id} brought ${own.coins} Coins`, [p.id, id])
        if (r && (r.owner !== null || r.cityId !== hq?.id)) {
          fail(`punishment ${p.id} sends ${id}, who is not of the Trade Org HQ`, [p.id, id])
        }
        if (members.has(id)) fail(`${id} is in two punishments`, [p.id, id])
        members.add(id)
        if (world.contracts.some((c) => c.residentIds.includes(id))) {
          fail(`punishment ${p.id} sends ${id}, who is in a contract`, [p.id, id])
        }
      }
    }
    for (const c of world.cities) {
      if (c.realmId === TRADE_ORG) fail(`the Trade Organization holds city ${c.id}`, [c.id])
    }
    return out
  },
}
