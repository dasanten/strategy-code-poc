import {
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  WAREHOUSE_BASE_PRICE,
  inCityArea,
  standingOf,
  standingOrganization,
  townHallOf,
  tradeOrgHq,
  unitsThatFit,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type City,
  type Crime,
  type Good,
  type Punishment,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { attackOrder } from './combat.js'
import { cityOrganization } from './crimes.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome, walkTo } from './npc-behaviour.js'
import { newId } from './starting-city.js'
import { spareSoldiers } from './trade-org-army.js'

/*
 * The Trade Organization punishes (`CONTEXT.md`: Trade Org reaction, Self-interest): once it
 * holds an Organization below `TRADE_ORG_PUNISHES_BELOW` and knows of crimes it did against it,
 * it sends spare soldiers of its army to that Organization's city nearest the crime, to take
 * back `TRADE_ORG_PUNISH.times` what it lost from the city's storages, Coins first, fighting
 * whoever resists, and carry it home. It never captures the city. Like the rest of the HQ it
 * only gives orders a Player could give (ADR 0002): walking, picking up, dropping, attacking.
 */

/** What goods are worth in Coins: a Coin one, any other good its warehouse base price. */
export function worthOf(stock: Stock): number {
  let worth = 0
  for (const [good, n] of Object.entries(stock) as [Good, number][]) {
    worth += n * (good === 'coins' ? 1 : WAREHOUSE_BASE_PRICE[good])
  }
  return worth
}

/** What a crime cost the Trade Organization in Coins (`TRADE_ORG_LOSS`, stolen goods' worth). */
export function lossOf(crime: Crime): number {
  return crime.kind === 'theft' ? worthOf(crime.goods ?? {}) : TRADE_ORG_LOSS[crime.kind]
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
function living(world: WorldState, p: Punishment): { r: Resident; own: Stock }[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  return p.members.flatMap((m) => {
    const r = byId.get(m.residentId)
    return r && r.health > 0 ? [{ r, own: m.own }] : []
  })
}

/** The Coins' worth a punishment's living members have taken. */
export function tookSoFar(world: WorldState, p: Punishment): number {
  return living(world, p).reduce((sum, m) => sum + worthOf(takenBy(m.r, m.own)), 0)
}

/** Whether a crime is one the Trade Organization knows of against itself and hasn't punished yet. */
const toPunish = (world: WorldState, c: Crime) =>
  !c.punished &&
  standingOrganization(world, c.victimOrg) === TRADE_ORG &&
  c.knownBy.includes(c.victimOrg)

/**
 * One tick of the Trade Organization punishing, on a map of `size` tiles: it sends out new
 * punishments (`sendOut`) and runs those under way. Run after `stepTradeOrgArmy` and before
 * `stepNpcCities`; the HQ leaves the members of a punishment to it.
 */
export function stepPunishments(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  if (!hq) {
    world.punishments = []
    return
  }
  sendOut(world, size)
  for (const p of [...world.punishments]) runPunishment(world, hq, p, size)
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
    world.punishments.push({
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
function headFor(r: Resident, to: { x: number; y: number }): void {
  const o = r.order
  if (r.x === to.x && r.y === to.y) return
  if (o?.kind === 'walkTo' && o.target.x === to.x && o.target.y === to.y) return
  walkTo(r, to)
}

/**
 * One tick of a punishment (`CONTEXT.md`: Trade Org reaction). Out, each member goes after anyone
 * attacking one of them, otherwise to the city's nearest storage holding anything and picks up
 * what is still to take there. It heads home once it has taken its worth, when the city has
 * nothing left, when the city is no longer the culprit's, or after `TRADE_ORG_PUNISH.giveUpDays`.
 * Home, each member brings Coins they took to the HQ's coin warehouse and other goods to its goods
 * warehouse, then goes home; once every living member is home with nothing taken, or none is left,
 * it is over and the culprit hears what it took: what it carried as it headed home.
 */
function runPunishment(world: WorldState, hq: City, p: Punishment, size: number): void {
  const members = living(world, p)
  const city = world.cities.find((c) => c.id === p.cityId)
  const took = tookSoFar(world, p)
  const storages = city ? storagesToTake(world, city) : []
  const giveUp = world.tick - p.startedAt >= TRADE_ORG_PUNISH.giveUpDays * TICKS_PER_GAME_DAY
  if (p.heading === 'out') p.took = Math.min(took, p.worth)
  if (
    p.heading === 'out' &&
    (took >= p.worth ||
      !city ||
      city.tradeOrg ||
      cityOrganization(city) !== p.culpritOrg ||
      storages.length === 0 ||
      giveUp)
  ) {
    p.heading = 'home'
  }
  const ids = new Set(members.map((m) => m.r.id))
  const resisting = world.residents.filter(
    (r) =>
      r.health > 0 && !ids.has(r.id) && r.order?.kind === 'attack' && ids.has(r.order.targetId),
  )
  let left = p.worth - took
  for (const { r, own } of members) {
    if (r.order?.kind === 'attack') continue
    if (resisting.length > 0) {
      const nearest = resisting.reduce((a, b) =>
        wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
      )
      r.order = attackOrder(nearest.id)
      continue
    }
    if (p.heading === 'out') {
      const storage = storages.reduce((a, b) =>
        wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
      )
      if (r.x !== storage.x || r.y !== storage.y) {
        headFor(r, storage)
        continue
      }
      const { goods, worth } = toTake(world, r, storage, left)
      if (worth <= 0) continue
      r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
      left -= worth
      continue
    }
    bringHome(world, hq, r, takenBy(r, own), size)
  }
  const done =
    p.heading === 'home' &&
    members.every(
      (m) =>
        Object.keys(takenBy(m.r, m.own)).length === 0 && inCityArea(world, hq, m.r.x, m.r.y, size),
    )
  if (members.length > 0 && !done) return
  world.punishments = world.punishments.filter((x) => x !== p)
  recordEvent(world, p.culpritOrg, {
    kind: 'punished',
    what: 'left',
    cityId: p.cityId,
    city: city?.name ?? 'a city',
    worth: p.worth,
    took: p.took,
  })
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
    if (r.x !== b.x || r.y !== b.y) {
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
 * for each, for a positive worth of which it took no more than all; its members are residents of the HQ, each in one punishment at
 * most and in no contract; and the Trade Organization never captures a city.
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
      if (orgs.has(p.culpritOrg)) fail(`${p.culpritOrg} is punished twice at once`, [p.id])
      orgs.add(p.culpritOrg)
      for (const { residentId: id } of p.members) {
        const r = world.residents.find((x) => x.id === id)
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
