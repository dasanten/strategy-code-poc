import {
  GOOD_WEIGHT,
  NODE_GOOD,
  NPC_NODE_REACH,
  NPC_OFFER_REACH,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_TRADER_REACH,
  PRICED_GOODS,
  TICKS_PER_GAME_DAY,
  WALK_TICKS_PER_TILE,
  WEAPONS,
  allied,
  carryCapacity,
  handsOf,
  inCityArea,
  isArmed,
  isAt,
  npcCityRefuses,
  npcCityStock,
  npcOfferTimes,
  npcReserve,
  npcStorages,
  putAwayUnits,
  setOutFood,
  stockFloor,
  tradeCoinWarehouse,
  wallSide,
  wrapDistance,
  type Building,
  type City,
  type CityJob,
  type CityPlan,
  type CityProject,
  type CityTrader,
  type Good,
  type Offer,
  type PricedGood,
  type Resident,
  type Stock,
  type Weapon,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome, walkTo } from './npc-behaviour.js'
import { chainInput, makes, projectNeeds, shortGoods } from './npc-chain.js'
import { farmersWanted } from './npc-plan.js'

/*
 * An NPC city's own trade run (`CONTEXT.md`: NPC trader). Its planning pass sends one spare hand
 * with a full load of a surplus good to the nearest Trade Org warehouse in reach (`planTrader`);
 * between passes the city walks them through the run with orders a Player could give
 * (`runTrader`, ADR 0002): load up at the storage, walk to the warehouse, sell, buy, walk home,
 * put everything away. The run is kept in the city's plan (`CityPlan.trader`). The same trader
 * goes to a Player's offer in reach when one suits the city (`CONTEXT.md`: NPC cities at an offer;
 * `planOfferRun`, `runToOffer`), and only the planning pass looks for one (ADR 0016).
 */

/** Ticks after it left that a city stops waiting for its trader (`NPC_TRADER_GIVE_UP_DAYS`). */
const GIVE_UP_TICKS = NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY

/**
 * The city's trader still out (`CONTEXT.md`: NPC trader), at the start of its planning pass: one
 * out longer than `NPC_TRADER_GIVE_UP_DAYS` (dead, robbed, stuck) is dropped from the plan first,
 * so the city may send another. The city doesn't know before then that a trader died.
 */
export function traderOut(world: WorldState, plan: CityPlan): string | undefined {
  if (plan.trader && world.tick - plan.trader.since > GIVE_UP_TICKS) delete plan.trader
  return plan.trader?.residentId
}

/**
 * The trader's part of a planning pass (`CONTEXT.md`: NPC trader), for an NPC city with no trader
 * out (`traderOut`) once its other adults have their jobs. While no armed outsider stands in its
 * area one of its spare hands, idle ones first, never a soldier, goes to a Player's offer that
 * suits the city (`planOfferRun`), the only run it makes while Food is short. Else a surplus good
 * that makes a full load (`traderLoad`) and a Trade Org warehouse within `NPC_TRADER_REACH` that
 * prices it send them: they sell the load there and buy the good shortest of the reserve it has no
 * node for (`buyGood`). Their job becomes `trade`.
 */
export function planTrader(
  world: WorldState,
  city: City,
  plan: CityPlan,
  adults: Resident[],
  jobs: Record<string, CityJob>,
  foodShort: boolean,
  size: number,
): void {
  if ((foodShort && world.offers.length === 0) || armedOutsiders(world, city, size)) return
  const home = npcHome(world, city)
  if (!home) return
  // Spare hands: idle, at the chain's workplaces, or farming beyond the farmers it keeps.
  const farmers = adults.filter((r) => jobs[r.id]?.kind === 'farm')
  const extra = new Set(farmers.slice(farmersWanted(world, city)).map((r) => r.id))
  const rank = (r: Resident) => {
    const kind = jobs[r.id]?.kind
    if (isArmed(r) || r.carrying) return undefined
    return kind === 'idle' ? 0 : kind === 'work' ? 1 : extra.has(r.id) ? 2 : undefined
  }
  const spare = adults.filter((r) => rank(r) !== undefined)
  spare.sort((a, b) => rank(a)! - rank(b)!)
  const r = spare[0]
  if (!r) return
  if (planOfferRun(world, city, plan, r, foodShort, size)) {
    jobs[r.id] = { kind: 'trade' }
    return
  }
  if (foodShort) return
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  let best: { good: PricedGood; units: number; warehouse: Building; over: number } | undefined
  for (const good of PRICED_GOODS) {
    if (WEAPONS.includes(good as Weapon)) continue
    const surplus = (stock[good] ?? 0) - (reserve[good] ?? 0)
    if (surplus < 1) continue
    const warehouse = nearestWarehouse(world, home, good, size)
    if (!warehouse) continue
    const units = traderLoad(world, r, good, wrapDistance(size, home, warehouse))
    if (units < 1 || surplus < units) continue
    if (!best || surplus - units > best.over)
      best = { good, units, warehouse, over: surplus - units }
  }
  if (!best) return
  const buys: Stock = {}
  const buy = buyGood(world, city, home, best.warehouse, plan.project, size)
  if (buy) buys[buy] = Math.max(1, Math.ceil((reserve[buy] ?? 0) - (stock[buy] ?? 0)))
  plan.trader = {
    residentId: r.id,
    warehouseId: best.warehouse.id,
    sells: { [best.good]: best.units },
    buys,
    since: world.tick,
  }
  jobs[r.id] = { kind: 'trade' }
}

/**
 * Looks for a Player's offer for the city's trader `r` to take (`CONTEXT.md`: NPC cities at an
 * offer), the good it is shortest of first, then the nearest, and sends them if one suits: within
 * `NPC_OFFER_REACH` of its storage and of a realm it doesn't refuse, giving what it is short of
 * for what it has spare or Coins, at a rate at least as good as its own prices (`offerTimes`). The
 * cheap tests come first, so most offers cost a distance and a lookup, once a game hour. Food short
 * (`foodOnly`), only an offer that gives Food will do. Returns whether it sent them.
 */
function planOfferRun(
  world: WorldState,
  city: City,
  plan: CityPlan,
  r: Resident,
  foodOnly: boolean,
  size: number,
): boolean {
  if (world.offers.length === 0) return false
  const storage = npcStorages(world, city)[0]
  if (!storage) return false
  const order = shortGoods(world, city, plan.project)
  const rank = new Map(order.map((g, i) => [g, i]))
  let best: { offer: Offer; times: number; rank: number; d: number } | undefined
  for (const offer of world.offers) {
    if (foodOnly && offer.gives !== 'food') continue
    const place = rank.get(offer.gives)
    if (place === undefined) continue
    const d = wrapDistance(size, storage, offer)
    if (d > NPC_OFFER_REACH) continue
    if (best && (place > best.rank || (place === best.rank && d >= best.d))) continue
    if (npcCityRefuses(world, city, offer.realmId)) continue
    const times = offerTimes(world, city, storage, plan.project, r, offer, d)
    if (times > 0) best = { offer, times, rank: place, d }
  }
  if (!best) return false
  const { offer, times } = best
  plan.trader = {
    residentId: r.id,
    warehouseId: offer.storageId,
    offer: {
      offerId: offer.id,
      times,
      pays: offer.wants,
      units: times * offer.wantsUnits,
      leg: 'load',
    },
    sells: {},
    buys: {},
    since: world.tick,
  }
  return true
}

/**
 * How many times over the city's trader `r` would take an offer `tiles` from its storage: enough to
 * make up what the city lacks of the good, rounded up, as far as the offer stands, the city has the
 * good it wants to spare (any Coins in the storage: its war chest is for buying what it lacks,
 * `CONTEXT.md`: NPC reserve), both loads fit in their arms beside the Food for the walk, and the
 * rate stays at least as good as its own prices (`npcOfferTimes`). 0 when it doesn't suit: a weapon
 * either way, which would arm the trader, never does.
 */
function offerTimes(
  world: WorldState,
  city: City,
  storage: Building,
  project: CityProject | undefined,
  r: Resident,
  offer: Offer,
  tiles: number,
): number {
  if (WEAPONS.includes(offer.gives as Weapon) || WEAPONS.includes(offer.wants as Weapon)) return 0
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  const held = storage.stock?.[offer.wants] ?? 0
  const spare =
    offer.wants === 'coins'
      ? held
      : Math.min(held, (stock[offer.wants] ?? 0) - (reserve[offer.wants] ?? 0))
  const wanted = (reserve[offer.gives] ?? 0) + (projectNeeds(world, project)[offer.gives] ?? 0)
  const lacks = wanted - (stock[offer.gives] ?? 0)
  const hands = handsOf(r, world.tick)
  const food = setOutFood(tiles * WALK_TICKS_PER_TILE) - (hands.stock.food ?? 0)
  const room = hands.room - Math.max(0, food) * GOOD_WEIGHT.food
  const times = Math.min(
    offer.times,
    Math.ceil(lacks / offer.givesUnits),
    Math.floor(spare / offer.wantsUnits),
    Math.floor((room + 1e-9) / (offer.givesUnits * GOOD_WEIGHT[offer.gives])),
    Math.floor((room + 1e-9) / (offer.wantsUnits * GOOD_WEIGHT[offer.wants])),
  )
  return times > 0 ? npcOfferTimes(world, city, offer, times) : 0
}

/**
 * Units of a good that make a trader's full load (`CONTEXT.md`: NPC trader): what fits in their
 * arms beside the Food for the walk to a warehouse `tiles` away and back (`setOutFood`).
 */
export function traderLoad(world: WorldState, r: Resident, good: Good, tiles: number): number {
  const food = setOutFood(tiles * WALK_TICKS_PER_TILE) * GOOD_WEIGHT.food
  return Math.max(0, Math.floor((carryCapacity(r, world.tick) - food) / GOOD_WEIGHT[good] + 1e-9))
}

/**
 * The nearest finished Trade Org warehouse (a trading post's or the HQ's) within
 * `NPC_TRADER_REACH` of `home` that prices `good` and has its coins at hand.
 */
function nearestWarehouse(
  world: WorldState,
  home: Building,
  good: Good,
  size: number,
): Building | undefined {
  let best: { b: Building; d: number } | undefined
  for (const b of world.buildings) {
    if (b.kind !== 'warehouse' || b.site || stockFloor(world, b)[good] === undefined) continue
    if (!tradeCoinWarehouse(world, b)) continue
    const d = wrapDistance(size, home, b)
    if (d <= NPC_TRADER_REACH && (!best || d < best.d)) best = { b, d }
  }
  return best?.b
}

/**
 * What a trader buys (`CONTEXT.md`: NPC trader): the good shortest of the city's reserve
 * (`shortGoods`) that it has no node for (`hasNodeFor`) and the warehouse prices. Never Food,
 * which its farms grow, nor Coins, and never a weapon, which would arm them.
 */
function buyGood(
  world: WorldState,
  city: City,
  home: Building,
  warehouse: Building,
  project: CityProject | undefined,
  size: number,
): PricedGood | undefined {
  const priced = stockFloor(world, warehouse)
  return shortGoods(world, city, project).find(
    (g): g is PricedGood =>
      g !== 'food' &&
      g !== 'coins' &&
      !WEAPONS.includes(g as Weapon) &&
      priced[g] !== undefined &&
      !hasNodeFor(world, city, home, g, size),
  )
}

/**
 * Whether an NPC city can make a good from its own land (`CONTEXT.md`: NPC city): one of its
 * workplaces makes it, a resource node yielding it lies within `NPC_NODE_REACH` of home, or for a
 * good a workplace processes, it can make every input. `seen` keeps it from going round.
 */
export function hasNodeFor(
  world: WorldState,
  city: City,
  home: Building,
  good: Good,
  size: number,
  seen: Set<Good> = new Set(),
): boolean {
  if (good === 'food' || makes(world, city, good)) return true
  if (seen.has(good)) return false
  seen.add(good)
  const input = chainInput(good)
  if (input) {
    return Object.keys(input).every((g) => hasNodeFor(world, city, home, g as Good, size, seen))
  }
  return world.nodes.some(
    (n) => NODE_GOOD[n.kind] === good && wrapDistance(size, home, n) <= NPC_NODE_REACH,
  )
}

/**
 * Whether an armed outsider (anyone armed not of the city or its alliance) stands in the city's
 * area: then it sends no trader (`CONTEXT.md`: NPC trader).
 */
function armedOutsiders(world: WorldState, city: City, size: number): boolean {
  return world.residents.some(
    (r) =>
      r.health > 0 &&
      isArmed(r) &&
      !allied(world, city.id, wallSide(r) ?? '') &&
      inCityArea(world, city, r.x, r.y, size),
  )
}

/**
 * One tick of the city's trader, idle between orders (`CONTEXT.md`: NPC trader): with a load
 * still to sell and not carrying it, they pick it up at the storage with the Food for the run and
 * the city's coins above its reserve; carrying it, they walk to the warehouse and sell it there;
 * then they buy what the run buys; with nothing left to sell or buy they walk home and put
 * everything away but their own food, and the run is over. A run whose warehouse or storage is
 * gone, or whose load the storage no longer holds, ends too. `sells` and `buys` keep what is
 * still to sell and buy, so the run goes on after a restart. A run to an offer goes by `runToOffer`
 * until they have been there, and home the same way.
 */
export function runTrader(
  world: WorldState,
  city: City,
  plan: CityPlan,
  r: Resident,
  storage: Building | undefined,
  size: number,
): void {
  const t = plan.trader!
  if (t.offer && runToOffer(world, r, t, storage, size)) return
  const warehouse = world.buildings.find((b) => b.id === t.warehouseId)
  const [sell, units] = (Object.entries(t.sells) as [PricedGood, number][])[0] ?? []
  const [buy, wanted] = (Object.entries(t.buys) as [PricedGood, number][])[0] ?? []
  if (!storage || (!warehouse && (sell || buy))) {
    t.sells = {}
    t.buys = {}
  } else if (sell && warehouse) {
    if ((r.carried[sell] ?? 0) < 1) {
      if (!isAt(r, storage, size)) return walkTo(r, storage)
      const has = storage.stock?.[sell] ?? 0
      if (has < 1) return endRun(plan, r)
      const goods: Stock = {}
      const food = setOutFood(wrapDistance(size, r, warehouse) * WALK_TICKS_PER_TILE)
      const lacks = Math.min(storage.stock?.food ?? 0, food - (r.carried.food ?? 0))
      if (lacks >= 1) goods.food = Math.floor(lacks)
      goods[sell] = Math.min(units!, has)
      const coins = (storage.stock?.coins ?? 0) - (npcReserve(world, city).coins ?? 0)
      if (coins >= 1 && buy) goods.coins = Math.floor(coins)
      r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
      return
    }
    if (!isAt(r, warehouse, size)) return walkTo(r, warehouse)
    r.order = { kind: 'trade', side: 'sell', good: sell, units: r.carried[sell]!, carriageId: null }
    t.sells = {}
    return
  } else if (buy && warehouse) {
    if (!isAt(r, warehouse, size)) return walkTo(r, warehouse)
    t.buys = {}
    if ((r.carried.coins ?? 0) < 1) return
    r.order = { kind: 'trade', side: 'buy', good: buy, units: wanted!, carriageId: null }
    return
  }
  if (!storage) return endRun(plan, r)
  if (!isAt(r, storage, size)) return walkTo(r, storage)
  const load: Stock = {}
  for (const [good, n] of Object.entries(r.carried) as [Good, number][]) {
    const put = putAwayUnits(good, n)
    if (put > 0 && !WEAPONS.includes(good as Weapon)) load[good] = put
  }
  if (Object.keys(load).length > 0) {
    r.order = { kind: 'drop', to: { kind: 'storage', storageId: storage.id }, goods: load }
  } else endRun(plan, r)
}

/**
 * One tick of the trader's way to an offer (`CONTEXT.md`: NPC cities at an offer), by orders a
 * Player could give: they take the good they pay with and the Food for the run from the storage,
 * walk to the offer's storage and accept it, cut down to what still stands and what they can pay
 * and carry (`resolveOffers`). With the offer gone, or no way there, or nothing to pay with, the
 * run to it is over and they go home like any trader (`runTrader`), with what they took along.
 * Returns whether they got an order.
 */
function runToOffer(
  world: WorldState,
  r: Resident,
  t: CityTrader,
  storage: Building | undefined,
  size: number,
): boolean {
  const run = t.offer!
  const offer = world.offers.find((o) => o.id === run.offerId)
  const target = world.buildings.find((b) => b.id === offer?.storageId)
  if (offer && target && run.leg === 'load' && storage) {
    if (!isAt(r, storage, size)) {
      walkTo(r, storage)
      return true
    }
    const has = storage.stock?.[run.pays] ?? 0
    if (has >= offer.wantsUnits) {
      const units = Math.min(run.units, has)
      const goods: Stock = { [run.pays]: units }
      const food = setOutFood(wrapDistance(size, r, target) * WALK_TICKS_PER_TILE)
      const left = (storage.stock?.food ?? 0) - (run.pays === 'food' ? units : 0)
      const lacks = Math.floor(Math.min(left, food - (r.carried.food ?? 0)))
      if (lacks >= 1) goods.food = (goods.food ?? 0) + lacks
      r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
      run.leg = 'setOff'
      return true
    }
  } else if (offer && target && run.leg !== 'load') {
    if (isAt(r, target, size)) {
      r.order = { kind: 'acceptOffer', offerId: offer.id, times: run.times, carriageId: null }
      delete t.offer
      return true
    }
    if (run.leg === 'setOff') {
      walkTo(r, target)
      run.leg = 'walking'
      return true
    }
  }
  delete t.offer
  return false
}

/**
 * NPC traders hold together (`CONTEXT.md`: NPC trader; ADR 0004): a city sends at most one, so
 * its plan gives the `trade` job to its trader alone; only an NPC city sends one, never the
 * Trade Organization's; a living trader is unarmed and of the city; a run to an offer takes it a
 * whole, positive number of times, for a whole, positive load.
 */
export const npcTradersSound: Invariant = {
  name: 'npc-traders-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const residents = new Map(world.residents.map((r) => [r.id, r]))
    for (const [cityId, plan] of Object.entries(world.cityPlans)) {
      const traders = Object.entries(plan.jobs).filter(([, j]) => j.kind === 'trade')
      const t = plan.trader
      const city = world.cities.find((c) => c.id === cityId)
      if (traders.length > 1 || traders.some(([id]) => id !== t?.residentId)) {
        out.push({
          invariant: this.name,
          message: `${cityId} plans ${traders.length} traders: ${traders.map(([id]) => id).join(', ')}`,
          entityIds: [cityId, ...traders.map(([id]) => id)],
        })
      }
      if (!t) continue
      if (t.offer && ![t.offer.times, t.offer.units].every((n) => Number.isInteger(n) && n > 0)) {
        out.push({
          invariant: this.name,
          message: `${cityId}'s trader goes to ${t.offer.offerId} ${t.offer.times} times for ${t.offer.units} ${t.offer.pays}`,
          entityIds: [cityId, t.residentId, t.offer.offerId],
        })
      }
      if (city?.tradeOrg) {
        out.push({
          invariant: this.name,
          message: `${cityId}, the Trade Organization's, sends trader ${t.residentId}`,
          entityIds: [cityId, t.residentId],
        })
      }
      const r = residents.get(t.residentId)
      if (!r || r.health <= 0) continue
      if (r.cityId !== cityId || r.owner !== null || isArmed(r)) {
        out.push({
          invariant: this.name,
          message: `${cityId}'s trader ${r.id} is ${isArmed(r) ? 'armed' : 'not of the city'}`,
          entityIds: [cityId, r.id],
        })
      }
    }
    return out
  },
}

/** The trader's run is over: the plan forgets it, and they are idle until the next pass. */
function endRun(plan: CityPlan, r: Resident): void {
  delete plan.trader
  plan.jobs[r.id] = { kind: 'idle' }
}
