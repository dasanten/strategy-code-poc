import {
  GOOD_WEIGHT,
  NODE_GOOD,
  NPC_NODE_REACH,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_TRADER_REACH,
  PRICED_GOODS,
  TICKS_PER_GAME_DAY,
  WALK_TICKS_PER_TILE,
  WEAPONS,
  allied,
  carryCapacity,
  inCityArea,
  isArmed,
  isAt,
  npcCityStock,
  npcReserve,
  putAwayUnits,
  quoteWithTrader,
  setOutFood,
  stockFloor,
  tradeCoinWarehouse,
  traderPrices,
  traderStanding,
  traderStock,
  wallSide,
  wrapDistance,
  type Building,
  type Carriage,
  type City,
  type CityJob,
  type CityPlan,
  type CityProject,
  type Good,
  type PricedGood,
  type Resident,
  type Stock,
  type Trader,
  type Weapon,
  type WorldState,
} from '@csp/shared'
import { caravanCrew } from './caravans.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome, walkTo } from './npc-behaviour.js'
import { chainInput, makes, shortGoods } from './npc-chain.js'
import { farmersWanted } from './npc-plan.js'

/*
 * An NPC city's own trade run (`CONTEXT.md`: NPC trader). Its planning pass sends one spare hand
 * with a full load of a surplus good to the nearest Trade Org warehouse in reach (`planTrader`);
 * between passes the city walks them through the run with orders a Player could give
 * (`runTrader`, ADR 0002): load up at the storage, walk to the warehouse, sell, buy, walk home,
 * put everything away. The run is kept in the city's plan (`CityPlan.trader`).
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
 * out (`traderOut`) once its other adults have their jobs. While Food isn't short and no armed
 * outsider stands in its area, a surplus good that makes a full load (`traderLoad`) and a Trade
 * Org warehouse within `NPC_TRADER_REACH` that prices it send one of its spare hands, idle ones
 * first, never a soldier: they sell the load there and buy the good shortest of the reserve it
 * has no node for (`buyGood`). Their job becomes `trade`.
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
  if (foodShort || armedOutsiders(world, city, size)) return
  const home = npcHome(world, city)
  if (!home) return
  const r = spareHand(world, city, adults, jobs)
  if (!r) return
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
 * The spare hand a city sends to trade (`CONTEXT.md`: NPC trader), idle ones first, never a soldier:
 * idle, at the chain's workplaces, or farming beyond the farmers it keeps.
 */
function spareHand(
  world: WorldState,
  city: City,
  adults: Resident[],
  jobs: Record<string, CityJob>,
): Resident | undefined {
  const farmers = adults.filter((r) => jobs[r.id]?.kind === 'farm')
  const extra = new Set(farmers.slice(farmersWanted(world, city)).map((r) => r.id))
  const rank = (r: Resident) => {
    const kind = jobs[r.id]?.kind
    if (isArmed(r) || r.carrying) return undefined
    return kind === 'idle' ? 0 : kind === 'work' ? 1 : extra.has(r.id) ? 2 : undefined
  }
  const spare = adults.filter((r) => rank(r) !== undefined)
  spare.sort((a, b) => rank(a)! - rank(b)!)
  return spare[0]
}

/**
 * An NPC city treats a wandering trader standing at it as its visiting trader (`CONTEXT.md`: Trader
 * stop), part of its planning pass with no trader out: while nobody armed but the trader's own crew
 * stands in its area, it sends a spare hand (`spareHand`) over with what it deals in (`visitDeal`),
 * and more on later passes for as long as the trader stands and there is a deal to make. Whether it
 * sent someone; their job becomes `trade`. Food short is no reason not to: Food may be what it buys.
 */
export function planVisit(
  world: WorldState,
  city: City,
  plan: CityPlan,
  adults: Resident[],
  jobs: Record<string, CityJob>,
  size: number,
): boolean {
  const visitor = world.traders.find((t) => traderStanding(world, t)?.cityId === city.id)
  const carriage = visitor && world.carriages.find((k) => k.id === visitor.carriageId)
  if (!visitor || !carriage) return false
  if (armedOutsiders(world, city, size, caravanCrew(world))) return false
  const r = spareHand(world, city, adults, jobs)
  if (!r) return false
  const deal = visitDeal(world, city, plan.project, r, visitor, carriage)
  if (!deal) return false
  plan.trader = {
    residentId: r.id,
    warehouseId: null,
    visitingId: visitor.id,
    sells: deal.sells,
    buys: deal.buys,
    since: world.tick,
  }
  jobs[r.id] = { kind: 'trade' }
  return true
}

/**
 * What a city deals in with its visiting trader (`CONTEXT.md`: Trader stop): it sells the surplus
 * good that brings most, as far as `r`'s arms, the trader's coins and its room go; and with the
 * coins that brings and those above its reserve it buys the good it is shortest of (`shortGoods`)
 * that the trader has to trade, Food included. Never a weapon, which would arm `r`. Undefined with
 * no deal to make.
 */
function visitDeal(
  world: WorldState,
  city: City,
  project: CityProject | undefined,
  r: Resident,
  visitor: Trader,
  carriage: Carriage,
): { sells: Stock; buys: Stock } | undefined {
  const stock = npcCityStock(world, city)
  const reserve = npcReserve(world, city)
  const room = carryCapacity(r, world.tick)
  const sells: Stock = {}
  let bestCoins = 0
  for (const good of PRICED_GOODS) {
    if (WEAPONS.includes(good as Weapon)) continue
    const surplus = Math.floor((stock[good] ?? 0) - (reserve[good] ?? 0))
    if (surplus < 1) continue
    const arms = Math.min(surplus, Math.floor(room / GOOD_WEIGHT[good] + 1e-9))
    const holder = { stock: { [good]: arms }, room: Infinity }
    const q = quoteWithTrader(world, visitor, carriage, holder, 'sell', good, arms)
    if (q.units < 1 || q.coins <= bestCoins) continue
    bestCoins = q.coins
    delete sells[Object.keys(sells)[0] as Good]
    sells[good] = q.units
  }
  const coins = bestCoins + Math.max(0, (stock.coins ?? 0) - (reserve.coins ?? 0))
  const has = traderStock(visitor, carriage.load)
  const prices = traderPrices(visitor, carriage)
  const buys: Stock = {}
  const buy = shortGoods(world, city, project).find(
    (g): g is PricedGood =>
      g !== 'coins' &&
      !WEAPONS.includes(g as Weapon) &&
      (has[g] ?? 0) >= 1 &&
      coins >= prices.find((p) => p.good === g)!.sell,
  )
  if (buy) buys[buy] = Math.max(1, Math.ceil((reserve[buy] ?? 0) - (stock[buy] ?? 0)))
  return Object.keys(sells).length > 0 || buy ? { sells, buys } : undefined
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
 * Whether an armed outsider (anyone armed not of the city or its alliance, nor among `except`) stands
 * in the city's area: then it sends no trader (`CONTEXT.md`: NPC trader).
 */
function armedOutsiders(
  world: WorldState,
  city: City,
  size: number,
  except?: ReadonlySet<string>,
): boolean {
  return world.residents.some(
    (r) =>
      r.health > 0 &&
      isArmed(r) &&
      !except?.has(r.id) &&
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
 * still to sell and buy, so the run goes on after a restart.
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
  if (t.visitingId !== undefined) return runVisit(world, city, plan, r, storage, size)
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
  goHome(plan, r, storage, size)
}

/**
 * One tick of the city's spare hand on a run to its visiting trader, idle between orders
 * (`CONTEXT.md`: Trader stop): first they fetch what they sell and the coins above its reserve from
 * the storage, then walk to the trader's tile, sell, buy and walk home (`goHome`). A trader who
 * has gone on while they were on the way ends the run the same way.
 */
function runVisit(
  world: WorldState,
  city: City,
  plan: CityPlan,
  r: Resident,
  storage: Building | undefined,
  size: number,
): void {
  const t = plan.trader!
  const visitor = world.traders.find((x) => x.id === t.visitingId)
  const stand = visitor && traderStanding(world, visitor)
  const [sell, units] = (Object.entries(t.sells) as [PricedGood, number][])[0] ?? []
  const [buy, wanted] = (Object.entries(t.buys) as [PricedGood, number][])[0] ?? []
  if (!storage || stand?.cityId !== city.id || (!sell && !buy)) {
    return goHome(plan, r, storage, size)
  }
  if (!t.loaded) {
    if (!isAt(r, storage, size)) return walkTo(r, storage)
    t.loaded = true
    const goods: Stock = {}
    const has = sell ? (storage.stock?.[sell] ?? 0) : 0
    if (sell && has >= 1) goods[sell] = Math.min(units!, has)
    const coins = (storage.stock?.coins ?? 0) - (npcReserve(world, city).coins ?? 0)
    if (coins >= 1 && buy) goods.coins = Math.floor(coins)
    if (Object.keys(goods).length === 0) return endRun(plan, r)
    r.order = { kind: 'pickUp', from: { kind: 'storage', storageId: storage.id }, goods }
    return
  }
  if (r.x !== stand.x || r.y !== stand.y) return walkTo(r, stand)
  if (sell) {
    t.sells = {}
    if ((r.carried[sell] ?? 0) < 1) return
    r.order = { kind: 'trade', side: 'sell', good: sell, units: r.carried[sell]!, carriageId: null }
    return
  }
  t.buys = {}
  if ((r.carried.coins ?? 0) < 1) return
  r.order = { kind: 'trade', side: 'buy', good: buy!, units: wanted!, carriageId: null }
}

/**
 * The end of a trade run: the trader walks home to the storage and puts everything away but their
 * weapons, and the run is over.
 */
function goHome(plan: CityPlan, r: Resident, storage: Building | undefined, size: number): void {
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
 * NPC traders hold together (`CONTEXT.md`: NPC trader; ADR 0004): a city sends at most one, so
 * its plan gives the `trade` job to its trader alone; only an NPC city sends one, never the
 * Trade Organization's; a living trader is unarmed and of the city.
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
