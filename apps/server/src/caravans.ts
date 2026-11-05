import {
  CARAVAN_ESCORTS,
  CARAVAN_GUARD_RANGE,
  CARAVAN_SPREAD,
  CARRIAGE_CAPACITY,
  DEFEND_CALM_TICKS,
  FOOD_PER_DAY,
  GOODS,
  GOOD_WEIGHT,
  HQ_PEOPLE_FOOD_DAYS,
  SET_OFF_FOOD_SLACK,
  START_CARRIED_FOOD,
  WAITING_HORSE_FOOD,
  WEAPONS,
  caravanEscortsWanted,
  caravanFoodFor,
  convoyOf,
  convoysOf,
  canWork,
  contractOf,
  crewIdsOf,
  foodForWay,
  inContact,
  isDown,
  isArmed,
  owedBy,
  punishers,
  stockWeight,
  townHallOf,
  unitsThatFit,
  unitsThatFitCarriage,
  carriageCapacity,
  wrapDistance,
  type Building,
  type Caravan,
  type Carriage,
  type City,
  type Good,
  type GoodsSpot,
  type Resident,
  type Stock,
  type Trader,
  type WorldState,
  isAt,
  middleOf,
} from '@csp/shared'
import { attackOrder } from './combat.js'
import { organizationOf } from './crimes.js'
import { deliveryRobbed, releaseDelivery, runDelivery, takeOnDelivery } from './deliveries.js'
import { releaseTransfer, runTransfer, takeOnTransfer, transferRobbed } from './transfers.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { newHorse } from './horses.js'
import { residentNamesTaken } from './names.js'
import { hash, mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { hqLayout, tradeOrgHq } from './trade-org.js'
import { tradingPosts } from './trading-posts.js'
import { worldIndex } from './world-index.js'

/*
 * Caravans (`CONTEXT.md`: Caravan): the Trade Organization's carriages, each on the fixed route
 * between one trading post and the HQ, driven by an HQ resident and escorted by others on foot.
 * For now they even out the two warehouses' own stock. The caravan is plain data (ADR 0002);
 * each tick the game gives its crew drive, pick-up, drop and walk orders, which request actions
 * like a Player's do.
 */

/** The goods caravans even out: not Food, which lives in the storages, nor coins. */
const CARRIED: readonly Good[] = GOODS.filter((g) => g !== 'food' && g !== 'coins')

/** A caravan or wandering trader, as far as its crew and carriage go (`CONTEXT.md`: Caravan crew lost). */
export type Convoy = Pick<Caravan, 'carriageId' | 'driverId' | 'escortIds' | 'holding'>

/** One end of a caravan's route: the storage it tops up its Food at, and the warehouse. */
export interface RouteEnd {
  storage: Building | undefined
  warehouse: Building | undefined
}

const finished = (b: Building) => !b.site

/**
 * The storage and warehouse at one end of a caravan's route: at the HQ its storage and its goods
 * warehouse (`hqLayout`), at the trading post its own.
 */
export function routeEnd(world: WorldState, caravan: Caravan, end: Caravan['heading']): RouteEnd {
  return end === 'post' ? postEnd(world, caravan.postId) : hqEnd(world)
}

/** The storage and warehouse of trading post `postId`. */
export function postEnd(world: WorldState, postId: string): RouteEnd {
  const own = world.buildings.filter((b) => b.cityId === postId && finished(b))
  return {
    storage: own.find((b) => b.kind === 'storage'),
    warehouse: own.find((b) => b.kind === 'warehouse'),
  }
}

/** The HQ's storage and its goods warehouse (`hqLayout`). */
export function hqEnd(world: WorldState): RouteEnd {
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hall) return { storage: undefined, warehouse: undefined }
  const middle = middleOf(hall)
  const { storage, goodsWarehouse } = hqLayout(middle.x, middle.y)
  const at = (kind: Building['kind'], [x, y]: [number, number]) =>
    world.buildings.find((b) => b.kind === kind && b.x === x && b.y === y && finished(b))
  return { storage: at('storage', storage), warehouse: at('warehouse', goodsWarehouse) }
}

/**
 * A caravan ends: it lets go of what it was carrying out, and its crew stop what it had them
 * doing, a drive above all, which only a caravan's driver may hold (`npcOrdersAllowed`). They are
 * still the HQ's, which runs them from here (`runResidents`). The caller takes it off the caravans.
 */
function endCaravan(world: WorldState, caravan: Caravan): void {
  releaseDelivery(world, caravan)
  releaseTransfer(world, caravan)
  const crew = new Set(crewIdsOf(caravan))
  for (const r of world.residents) if (crew.has(r.id)) r.order = null
}

/**
 * A trading post that a realm took leaves the Trade Organization (`CONTEXT.md`: Trading post):
 * it becomes a plain city, its warehouse a storage with all it holds, so it has no stock floor
 * and no prices any more. Its caravan ends (`endCaravan`) and its route's robberies are forgotten.
 * The deliveries and transfers that wait at its warehouse go over to the HQ's goods warehouse,
 * which sends them out of its own stock (`CONTEXT.md`: Guaranteed carriage). It stays on the
 * wandering traders' loops until each of them reaches it (`CONTEXT.md`: Lost post found out).
 */
export function leaveTradeOrg(world: WorldState, post: City): void {
  if (post.tradeOrg !== 'post') return
  delete post.tradeOrg
  const warehouses = new Set<string>()
  for (const b of world.buildings) {
    if (b.cityId !== post.id || b.kind !== 'warehouse') continue
    b.kind = 'storage'
    warehouses.add(b.id)
  }
  world.caravans = world.caravans.filter((caravan) => {
    if (caravan.postId !== post.id) return true
    endCaravan(world, caravan)
    return false
  })
  delete world.routeRobberies[post.id]
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  const middle = hall && middleOf(hall)
  const [x, y] = middle ? hqLayout(middle.x, middle.y).goodsWarehouse : [NaN, NaN]
  const goods = world.buildings.find((b) => b.kind === 'warehouse' && b.x === x && b.y === y)
  for (const job of [...world.deliveries, ...world.transfers]) {
    if (warehouses.has(job.warehouseId) && goods) job.warehouseId = goods.id
  }
  world.deliveries = world.deliveries.filter((d) => !warehouses.has(d.warehouseId))
  world.transfers = world.transfers.filter((t) => !warehouses.has(t.warehouseId))
}

/**
 * Post `postId` leaves a wandering trader's loop (`CONTEXT.md`: Wandering trader). Bound for it, the
 * trader goes on to the stop after it instead, so with no post left to the HQ, which stays on it.
 */
export function dropFromLoop(trader: Trader, postId: string): void {
  const at = trader.loop.indexOf(postId)
  if (at < 0) return
  trader.loop.splice(at, 1)
  if (trader.postId !== postId) return
  trader.postId = trader.loop[at % trader.loop.length]!
  trader.stop = 'storage'
  trader.plan = null
  trader.misses = 0
  trader.calls = null
}

/**
 * A new carriage of the Trade Org HQ `hq` at (x, y), with a new horse hitched to it, drawn from
 * `seed`. Returns its id.
 */
export function newCaravanCarriage(
  world: WorldState,
  hq: City,
  x: number,
  y: number,
  seed: string,
): string {
  const horseId = newId(world, 'horse')
  const rand = mulberry32(hash(seed))
  world.horses.push(
    newHorse(rand, { id: horseId, realmId: null, cityId: hq.id, x, y, tick: world.tick }),
  )
  const carriageId = newId(world, 'carriage')
  world.carriages.push({ id: carriageId, realmId: null, cityId: hq.id, x, y, horseId, load: {} })
  return carriageId
}

/**
 * Gives the Trade Org HQ a caravan for every trading post that has none (`CONTEXT.md`: Caravan):
 * a carriage with a horse hitched to it, a driver and `CARAVAN_ESCORTS` escorts, new residents
 * of the HQ, all standing at its goods warehouse. Each starts by topping up its Food at the HQ.
 * Nothing when the world has no HQ.
 */
export function placeCaravans(world: WorldState): Caravan[] {
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hq || !hall) return []
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const served = new Set(world.caravans.map((c) => c.postId))
  const placed: Caravan[] = []
  for (const post of tradingPosts(world)) {
    if (served.has(post.id)) continue
    const rand = mulberry32(hash(`${world.seed}:caravan:${post.id}`))
    const horseSeed = `${world.seed}:caravan-horse:${post.id}`
    const carriageId = newCaravanCarriage(world, hq, x, y, horseSeed)
    const names = residentNamesTaken(world, null, hq.id)
    const crew = Array.from({ length: 1 + CARAVAN_ESCORTS }, () => {
      const r = newResident(
        rand,
        { id: newId(world, 'r'), owner: null, cityId: hq.id, x, y, tick: world.tick },
        names,
      )
      r.carried = { food: START_CARRIED_FOOD }
      return r
    })
    world.residents.push(...crew)
    const caravan: Caravan = {
      id: newId(world, 'caravan'),
      postId: post.id,
      carriageId,
      driverId: crew[0]!.id,
      escortIds: crew.slice(1).map((r) => r.id),
      heading: 'hq',
      stop: 'storage',
      toLoad: null,
      holding: null,
      job: null,
      transfer: null,
    }
    world.caravans.push(caravan)
    placed.push(caravan)
  }
  return placed
}

/** Everyone on a caravan or wandering trader, by id. */
export function caravanCrew(world: WorldState): Set<string> {
  return new Set(convoysOf(world).flatMap(crewIdsOf))
}

/**
 * Resident `residentId` is gone from the caravans and wandering traders they were on (`CONTEXT.md`:
 * Caravan crew lost): an escort leaves it, and a driver is replaced (`replaceDriver`).
 */
export function leaveCaravans(world: WorldState, residentId: string): void {
  for (const caravan of convoysOf(world)) {
    caravan.escortIds = caravan.escortIds.filter((id) => id !== residentId)
    if (caravan.driverId === residentId) replaceDriver(world, caravan)
  }
}

/**
 * A surviving escort takes over from the driver who is gone, one who is up if any is, or there is
 * no driver for now (`CONTEXT.md`: Caravan crew lost). What the old driver held for the caravan is
 * gone with them.
 */
function replaceDriver(world: WorldState, caravan: Convoy): void {
  const escorts = caravan.escortIds.flatMap((id) => world.residents.find((r) => r.id === id) ?? [])
  const next = escorts.find((r) => !isDown(r)) ?? escorts[0]
  caravan.holding = null
  caravan.driverId = next?.id ?? null
  if (!next) return
  caravan.escortIds = caravan.escortIds.filter((id) => id !== next.id)
  // They go on driving, out of whatever they were doing as an escort.
  next.order = null
}

/**
 * The adults of the HQ `hqId` who can be taken on for a caravan (`CONTEXT.md`: Caravan, Caravan
 * crew lost): unarmed and up, idle or at work, not on another caravan, punishing, or hired out.
 */
export function freeHands(world: WorldState, hqId: string | null): Resident[] {
  const crew = caravanCrew(world)
  const away = punishers(world)
  return world.residents.filter(
    (r) =>
      r.owner === null &&
      r.cityId === hqId &&
      r.health > 0 &&
      !isDown(r) &&
      canWork(r, world.tick) &&
      !isArmed(r) &&
      (r.order === null || r.order.kind === 'workAt') &&
      !crew.has(r.id) &&
      !away.has(r.id) &&
      !contractOf(world, r.id),
  )
}

/**
 * The HQ sends a caravan with no crew left a new driver on foot, the nearest to its carriage of
 * those free, once it has one (`CONTEXT.md`: Caravan crew lost). They walk out to it as any driver
 * parted from their carriage does.
 */
function sendDriver(
  world: WorldState,
  caravan: Convoy,
  carriage: Carriage,
  hq: City,
  size: number,
): void {
  const free = freeHands(world, hq.id)
  if (free.length === 0) return
  const nearest = free.reduce((a, b) =>
    wrapDistance(size, b, carriage) < wrapDistance(size, a, carriage) ? b : a,
  )
  nearest.order = null
  caravan.driverId = nearest.id
}

/**
 * What evens out two warehouses' stock: of each good (`CARRIED`), half of what `here` holds more
 * than `there`, as much of it as fits on the carriage (`capacity`, by its horse's Strength), in
 * the order of `GOODS`.
 */
export function evenOut(here: Stock, there: Stock, carriage: Carriage, capacity: number): Stock {
  let room = capacity - stockWeight(carriage.load)
  const out: Stock = {}
  for (const g of CARRIED) {
    const more = Math.floor(((here[g] ?? 0) - (there[g] ?? 0)) / 2)
    const units = Math.min(more, Math.floor(room / GOOD_WEIGHT[g] + 1e-9))
    if (units <= 0) continue
    out[g] = units
    room -= units * GOOD_WEIGHT[g]
  }
  return out
}

export const walkTo = (r: Resident, at: { x: number; y: number }) => {
  r.order = { kind: 'walkTo', target: { x: at.x, y: at.y }, path: null, progress: 0 }
}

/**
 * The escort walks along (`CONTEXT.md`: Caravan): an escort who is idle and out of contact with
 * the carriage walks to it. The driver waits for them on the way (`waitingForEscort`).
 */
function followCarriage(world: WorldState, caravan: Convoy, carriage: Carriage, size: number) {
  for (const id of caravan.escortIds) {
    const r = world.residents.find((x) => x.id === id)
    if (r && r.order === null && !inContact(size, r, carriage)) walkTo(r, carriage)
  }
}

/** Whether a resident is of the Trade Organization: of its HQ or a trading post. */
export const ofTradeOrg = (world: WorldState, r: Resident) => {
  const org = organizationOf(r)
  return world.cities.some((c) => c.id === org && c.tradeOrg !== undefined)
}

/**
 * Who threatens a caravan (`CONTEXT.md`: Caravan, Guaranteed carriage): anyone within
 * `CARAVAN_GUARD_RANGE` of its carriage taking goods off it who isn't of the Trade Organization,
 * or going after one of its crew on their own account (not fighting back).
 */
export function caravanThreats(
  world: WorldState,
  caravan: Pick<Caravan, 'driverId' | 'escortIds'>,
  carriage: Carriage,
  size: number,
): Resident[] {
  const crew = new Set(crewIdsOf(caravan))
  return world.residents.filter((r) => {
    if (r.health <= 0 || crew.has(r.id)) return false
    if (wrapDistance(size, r, carriage) > CARAVAN_GUARD_RANGE) return false
    const o = r.order
    if (o?.kind === 'attack') return !o.defending && crew.has(o.targetId)
    if (o?.kind !== 'pickUp' || o.from.kind !== 'carriage') return false
    return o.from.carriageId === carriage.id && !ofTradeOrg(world, r)
  })
}

/**
 * The escort defends its caravan (`CONTEXT.md`: Caravan, Combat): each armed escort not already
 * fighting goes after the nearest threat (`caravanThreats`), which is no crime. One whose target
 * has got further than `CARAVAN_GUARD_RANGE` from the carriage gives up the chase and comes back.
 */
function guardCaravan(world: WorldState, caravan: Convoy, carriage: Carriage, size: number) {
  const threats = caravanThreats(world, caravan, carriage, size)
  for (const id of caravan.escortIds) {
    const r = world.residents.find((x) => x.id === id)
    if (!r || r.health <= 0) continue
    const o = r.order
    if (o?.kind === 'attack') {
      const t = world.residents.find((x) => x.id === o.targetId)
      if (t && wrapDistance(size, t, carriage) > CARAVAN_GUARD_RANGE) r.order = null
      continue
    }
    if (threats.length === 0 || !isArmed(r)) continue
    const nearest = threats.reduce((a, b) =>
      wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
    )
    r.order = attackOrder(nearest.id, false, true)
  }
}

/**
 * The escort is made up at the HQ (`CONTEXT.md`: Caravan): while its carriage stands at
 * the HQ's goods warehouse, a caravan or trader takes on unarmed adults of the HQ who are idle or at
 * work (not on another caravan, punishing, or hired out), the nearest first, until it has
 * `wanted` escorts (`caravanEscortsWanted`, `traderEscortsWanted`), so one robbed more often gets
 * more, and lost escorts are made up. There, too, every unarmed
 * escort fetches a weapon from the warehouse, one it keeps for no delivery. Whether an escort is
 * still on the way to arm themselves, which the caravan waits for.
 */
function manEscort(
  world: WorldState,
  caravan: Convoy,
  carriage: Carriage,
  wanted: number,
  size: number,
): boolean {
  const warehouse = hqEnd(world).warehouse
  if (!warehouse || !isAt(carriage, warehouse, size)) return false
  if (caravan.escortIds.length < wanted) {
    const joining = freeHands(world, warehouse.cityId)
    // The nearest come, so the caravan waits for them least.
    joining.sort((a, b) => wrapDistance(size, a, warehouse) - wrapDistance(size, b, warehouse))
    for (const r of joining.slice(0, wanted - caravan.escortIds.length)) {
      r.order = null
      caravan.escortIds.push(r.id)
    }
  }
  const stock = warehouse.stock ?? {}
  let arming = false
  for (const id of caravan.escortIds) {
    const r = world.residents.find((x) => x.id === id)
    if (!r || isArmed(r)) continue
    const o = r.order
    if (o?.kind === 'pickUp' && o.from.kind === 'storage') arming = true
    if (o !== null) {
      const there = o.kind === 'walkTo' && o.target.x === warehouse.x && o.target.y === warehouse.y
      arming ||= there
      continue
    }
    const weapon = WEAPONS.find(
      (w) =>
        (stock[w] ?? 0) - owedBy(world, warehouse.id, w) > 0 && unitsThatFit(r, w, world.tick) > 0,
    )
    if (!weapon) continue
    arming = true
    if (isAt(r, warehouse, size)) {
      r.order = {
        kind: 'pickUp',
        from: { kind: 'storage', storageId: warehouse.id },
        goods: { [weapon]: 1 },
      }
    } else walkTo(r, warehouse)
  }
  return arming
}

/** Sets the caravan off for the other end of its route, to its storage first. */
function depart(caravan: Caravan): void {
  caravan.heading = caravan.heading === 'hq' ? 'post' : 'hq'
  caravan.stop = 'storage'
  caravan.toLoad = null
}

/** The driver's next take at a stop: `goods` from `from`, to put down next tick `onto`. */
export function take(
  caravan: Convoy,
  driver: Resident,
  from: GoodsSpot,
  goods: Stock,
  onto: 'carriage' | 'stop',
): void {
  driver.order = { kind: 'pickUp', from, goods }
  caravan.holding = { goods, onto }
}

/**
 * What the driver took last tick for the caravan or trader goes down, on the carriage or at `stop`.
 * Whether they have that to do. What they no longer hold is not put down.
 */
export function putDownHeld(
  caravan: Convoy,
  driver: Resident,
  stop: Building,
  carriage: Carriage,
): boolean {
  if (!caravan.holding) return false
  const { goods, onto } = caravan.holding
  caravan.holding = null
  const held: Stock = {}
  for (const [g, units] of Object.entries(goods) as [Good, number][]) {
    const n = Math.min(units, driver.carried[g] ?? 0)
    if (n > 0) held[g] = n
  }
  if (Object.keys(held).length === 0) return false
  const to: GoodsSpot =
    onto === 'carriage'
      ? { kind: 'carriage', carriageId: carriage.id }
      : { kind: 'storage', storageId: stop.id }
  driver.order = { kind: 'drop', to, goods: held }
  return true
}

/**
 * The Food of storage `stop` a carriage holding `onBoard` may take (`CONTEXT.md`: Waiting for Food):
 * at a post all of it; at the HQ what its own people off the carriages don't eat in
 * `HQ_PEOPLE_FOOD_DAYS`, but always up to `WAITING_HORSE_FOOD` on board, as its horse eats only from
 * the load.
 */
function foodToSpare(world: WorldState, stop: Building, onBoard: number): number {
  const held = stop.stock?.food ?? 0
  if (stop.cityId !== tradeOrgHq(world)?.id) return held
  const crew = caravanCrew(world)
  const people = world.residents.filter((r) => r.cityId === stop.cityId && !crew.has(r.id)).length
  const left = people * FOOD_PER_DAY * HQ_PEOPLE_FOOD_DAYS
  return Math.max(Math.floor(held - left), Math.min(held, WAITING_HORSE_FOOD - onBoard))
}

/**
 * The driver takes the Food the crew keep on board from storage `stop` (`caravanFoodFor`), as much
 * as may be taken there (`foodToSpare`) and they and the carriage have room for. Whether there was
 * any to take.
 */
export function topUpFood(
  world: WorldState,
  caravan: Convoy,
  driver: Resident,
  stop: Building,
  carriage: Carriage,
): boolean {
  const onBoard = carriage.load.food ?? 0
  const food = Math.min(
    caravanFoodFor(caravan.escortIds.length) - onBoard,
    foodToSpare(world, stop, onBoard),
    unitsThatFit(driver, 'food', world.tick),
    unitsThatFitCarriage(world, carriage, 'food'),
  )
  if (food <= 0) return false
  take(caravan, driver, { kind: 'storage', storageId: stop.id }, { food }, 'carriage')
  return true
}

/**
 * The Food caravan `caravan` wants on board to leave the HQ for its post (`CONTEXT.md`: Waiting for
 * Food): enough for the way there (`foodForWay`).
 */
function caravanWayFood(world: WorldState, caravan: Caravan, carriage: Carriage, size: number) {
  const post = world.cities.find((c) => c.id === caravan.postId)
  const hall = post && townHallOf(world, post)
  const tiles = hall ? wrapDistance(size, carriage, middleOf(hall)) : 0
  return foodForWay(caravan.escortIds.length, tiles)
}

/**
 * Whether a caravan at the HQ holds too little Food to leave (`CONTEXT.md`: Waiting for Food). With a
 * delivery or transfer waiting at the warehouse it wants all it keeps on board (`caravanFoodFor`),
 * as there is none for it on the way to a Player's city and back. Never at the post's end of its
 * route, nor at an HQ with no storage to wait at.
 */
function shortOfFood(
  world: WorldState,
  caravan: Caravan,
  carriage: Carriage,
  size: number,
): boolean {
  const { storage, warehouse } = hqEnd(world)
  if (caravan.heading !== 'hq' || !storage) return false
  const job = [...world.deliveries, ...world.transfers].some(
    (j) => j.caravanId === null && j.warehouseId === warehouse?.id,
  )
  const want = job
    ? caravanFoodFor(caravan.escortIds.length)
    : caravanWayFood(world, caravan, carriage, size)
  return (carriage.load.food ?? 0) < want
}

/** The whole units of Food a warehouse holds beyond what it keeps for deliveries. */
function warehouseFood(world: WorldState, warehouse: Building | undefined): number {
  if (!warehouse) return 0
  return Math.floor((warehouse.stock?.food ?? 0) - owedBy(world, warehouse.id, 'food'))
}

/**
 * One tick of a caravan whose driver is idle with the carriage: drive to the next stop; at a
 * storage, top up the Food on board for its crew (`caravanFoodFor`); at a warehouse, unload what was brought,
 * then take on a delivery ordered there (`takeOnDelivery`) or a transfer (`takeOnTransfer`), or else load what evens out the stock
 * with the other end's warehouse (`evenOut`) beyond what it keeps for deliveries, then set off.
 * At the HQ, with what it brought unloaded so the Food has room, one holding too little to leave
 * (`shortOfFood`) tops up from the goods warehouse, whose Food the HQ's people don't eat, or with none
 * there waits at the storage until some comes in. Each take or put is one pick-up or drop order of the
 * driver's, one a tick, like anyone's. An end without its storage is skipped to the warehouse; one
 * without its warehouse, passed by. A caravan carrying out a delivery or transfer does that instead
 * (`runDelivery`, `runTransfer`). `size` is the map's.
 */
function runCaravan(
  world: WorldState,
  caravan: Caravan,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  if (caravan.job) return runDelivery(world, caravan, driver, carriage, size)
  if (caravan.transfer) return runTransfer(world, caravan, driver, carriage, size)
  const end = routeEnd(world, caravan, caravan.heading)
  const stop = caravan.stop === 'storage' ? end.storage : end.warehouse
  if (!stop) {
    if (caravan.stop === 'storage') caravan.stop = 'warehouse'
    else depart(caravan)
    return
  }
  if (!isAt(driver, stop, size)) {
    const target = { x: stop.x, y: stop.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return
  }
  const here: GoodsSpot = { kind: 'storage', storageId: stop.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  if (putDownHeld(caravan, driver, stop, carriage)) return
  const stock = stop.stock ?? {}
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  if (caravan.stop === 'storage') {
    if (topUpFood(world, caravan, driver, stop, carriage)) return
    const unloaded = CARRIED.every((g) => (carriage.load[g] ?? 0) <= 0)
    const waits = unloaded && shortOfFood(world, caravan, carriage, size)
    if (!waits || warehouseFood(world, end.warehouse) >= 1) caravan.stop = 'warehouse'
    return
  }
  if (caravan.toLoad === null) {
    // Unloading what it brought comes first; loading is worked out once all of it is off.
    for (const g of CARRIED) {
      const units = Math.min(carriage.load[g] ?? 0, hands(g))
      if (units > 0) return take(caravan, driver, onCarriage, { [g]: units }, 'stop')
    }
    if (shortOfFood(world, caravan, carriage, size)) {
      const food = Math.min(
        caravanFoodFor(caravan.escortIds.length) - (carriage.load.food ?? 0),
        warehouseFood(world, stop),
        hands('food'),
        unitsThatFitCarriage(world, carriage, 'food'),
      )
      if (food > 0) return take(caravan, driver, here, { food }, 'carriage')
      caravan.stop = 'storage'
      return
    }
    if (takeOnDelivery(world, caravan, stop) || takeOnTransfer(world, caravan, stop)) return
    const other = routeEnd(world, caravan, caravan.heading === 'hq' ? 'post' : 'hq').warehouse
    const spare: Stock = { ...stock }
    for (const g of CARRIED) spare[g] = (stock[g] ?? 0) - owedBy(world, stop.id, g)
    caravan.toLoad = other
      ? evenOut(spare, other.stock ?? {}, carriage, carriageCapacity(world, carriage))
      : {}
  }
  for (const [g, wanted] of Object.entries(caravan.toLoad) as [Good, number][]) {
    const units = Math.min(
      wanted,
      stock[g] ?? 0,
      hands(g),
      unitsThatFitCarriage(world, carriage, g),
    )
    if (units <= 0) {
      delete caravan.toLoad[g]
      continue
    }
    if (wanted - units > 0) caravan.toLoad[g] = wanted - units
    else delete caravan.toLoad[g]
    return take(caravan, driver, here, { [g]: units }, 'carriage')
  }
  depart(caravan)
}

/**
 * One tick of the Trade Org's caravans (`CONTEXT.md`: Caravan), run before the actions are
 * requested: escorts who are gone leave their caravan; a caravan whose carriage, post or HQ is gone
 * breaks up, its crew left to the HQ; one whose driver is gone gets another (`CONTEXT.md`: Caravan
 * crew lost: `replaceDriver`, `sendDriver`), its carriage standing while it has none; the escort
 * defends it (`guardCaravan`), is made up and armed at the HQ (`manEscort`), which the caravan
 * waits for, and walks after the carriage; and a caravan whose driver is idle goes on with its
 * route (`runCaravan`). A driver parted from the carriage walks back to it. `size` is the map's.
 */
export function stepCaravans(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  world.caravans = world.caravans.filter((caravan) => {
    // Asked for each caravan: the last one breaking up may have changed the world.
    const index = worldIndex(world)
    caravan.escortIds = caravan.escortIds.filter((id) => index.residentById(id) !== undefined)
    const carriage = index.carriageById(caravan.carriageId)
    const post = world.cities.find((c) => c.id === caravan.postId && c.tradeOrg === 'post')
    if (!hq || !carriage || !post) {
      endCaravan(world, caravan)
      return false
    }
    const wanted = caravanEscortsWanted(world, caravan.postId)
    stepCrew(world, caravan, carriage, hq, wanted, size, (driver) =>
      runCaravan(world, caravan, driver, carriage, size),
    )
    return true
  })
}

/**
 * One tick of a caravan's or trader's crew, its carriage and the HQ still there: one whose driver is
 * gone gets another (`replaceDriver`, `sendDriver`), the carriage standing while it has none; the
 * escort defends it (`guardCaravan`), is made up to `wanted` and armed at the HQ (`manEscort`), which
 * it waits for, and walks after the carriage; and a driver idle with the carriage does what `run`
 * says, while one parted from it walks back to it.
 */
export function stepCrew(
  world: WorldState,
  convoy: Convoy,
  carriage: Carriage,
  hq: City,
  wanted: number,
  size: number,
  run: (driver: Resident) => void,
): void {
  const index = worldIndex(world)
  if (convoy.driverId !== null && !index.residentById(convoy.driverId)) {
    replaceDriver(world, convoy)
  }
  if (convoy.driverId === null) sendDriver(world, convoy, carriage, hq, size)
  const driver = convoy.driverId === null ? undefined : index.residentById(convoy.driverId)
  if (!driver) return
  guardCaravan(world, convoy, carriage, size)
  const arming = manEscort(world, convoy, carriage, wanted, size)
  followCarriage(world, convoy, carriage, size)
  if (arming || driver.order !== null || !canWork(driver, world.tick)) return
  if (driver.x !== carriage.x || driver.y !== carriage.y) walkTo(driver, carriage)
  else run(driver)
}

/**
 * Drivers of caravans and traders who wait this tick for their escort (`CONTEXT.md`: Caravan): those with an
 * escort fighting for the caravan, or on the way to them more than `CARAVAN_SPREAD` tiles away. A
 * driver under attack doesn't wait: they drive on (`CONTEXT.md`: On a carriage under attack). `size`
 * is the map's.
 */
export function waitingForEscort(world: WorldState, size: number): Set<string> {
  const waiting = new Set<string>()
  const index = worldIndex(world)
  for (const caravan of convoysOf(world)) {
    const driver = caravan.driverId === null ? undefined : index.residentById(caravan.driverId)
    if (driver?.order?.kind !== 'drive') continue
    if (driver.struck && world.tick - driver.struck.tick < DEFEND_CALM_TICKS) continue
    const behind = caravan.escortIds.some((id) => {
      const r = index.residentById(id)
      if (r?.order?.kind === 'attack') return true
      return r?.order?.kind === 'walkTo' && wrapDistance(size, r, driver) > CARAVAN_SPREAD
    })
    if (behind) waiting.add(driver.id)
  }
  return waiting
}

/**
 * The caravan or trader whose crew a resident is, when they may refill from its carriage (`CONTEXT.md`:
 * Caravan, Refilling from a carriage): the carriage's Food, within `CARAVAN_SPREAD` tiles of
 * them, since the escort keeps that close.
 */
export function caravanFood(world: WorldState, r: Resident, size: number): Stock | undefined {
  const caravan = r.owner === null ? convoyOf(world, r.id) : undefined
  const carriage = caravan && worldIndex(world).carriageById(caravan.carriageId)
  if (!carriage || (carriage.load.food ?? 0) <= 0) return undefined
  return wrapDistance(size, r, carriage) <= CARAVAN_SPREAD ? carriage.load : undefined
}

/**
 * Resident `r` took goods off carriage `carriageId` (`CONTEXT.md`: Guaranteed carriage): when it
 * is a caravan's and they aren't of the Trade Organization, they robbed it. Its route counts the
 * robbery, once a tick however many take from it (`robbed` holds the caravans robbed this tick),
 * and the Trade Organization makes good what was taken of its delivery or transfer
 * (`deliveryRobbed`, `transferRobbed`). With `whole`, the carriage itself was taken, so all its
 * load counts as taken, though it is still on it.
 */
export function robCaravan(
  world: WorldState,
  r: Resident,
  carriageId: string,
  robbed: Set<string>,
  whole = false,
): void {
  const caravan = world.caravans.find((c) => c.carriageId === carriageId)
  const carriage = world.carriages.find((k) => k.id === carriageId)
  if (!caravan || !carriage) return
  // One of the Trade Org's own, hired out to a realm, robs it too by taking the whole carriage.
  if (ofTradeOrg(world, r) && !whole) return
  if (!robbed.has(caravan.id)) {
    robbed.add(caravan.id)
    world.routeRobberies[caravan.postId] = (world.routeRobberies[caravan.postId] ?? 0) + 1
  }
  const left = whole ? { ...carriage, load: {} } : carriage
  deliveryRobbed(caravan, left)
  transferRobbed(caravan, left)
}

/**
 * `thief` stole a carriage (`CONTEXT.md`: Guaranteed carriage, Caravan crew lost): when it was a
 * caravan's that robs the caravan, its whole load counting as taken, and the same caravan gets a
 * new carriage and horse at the HQ's goods warehouse, where it starts its route over and any
 * surviving crew walk back to it. With no HQ left to give them, the caravan ends.
 */
export function caravanCarriageStolen(
  world: WorldState,
  thief: Resident,
  carriage: Carriage,
): void {
  const caravan = world.caravans.find((c) => c.carriageId === carriage.id)
  if (!caravan) return
  robCaravan(world, thief, carriage.id, new Set(), true)
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hq || !hall) {
    endCaravan(world, caravan)
    world.caravans = world.caravans.filter((c) => c !== caravan)
    return
  }
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const seed = `${world.seed}:caravan-horse:${caravan.postId}:${carriage.id}`
  caravan.carriageId = newCaravanCarriage(world, hq, x, y, seed)
  caravan.heading = 'hq'
  caravan.stop = 'storage'
  caravan.toLoad = null
}

/**
 * Robberies counted per caravan route hold together (`CONTEXT.md`: Guaranteed carriage; ADR
 * 0004): each route ends at a trading post and was robbed a whole number of times, at least once.
 */
export const routeRobberiesSound: Invariant = {
  name: 'route-robberies-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const [postId, n] of Object.entries(world.routeRobberies)) {
      const fail = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: [postId] })
      if (!world.cities.some((c) => c.id === postId && c.tradeOrg === 'post')) {
        fail(`robberies are counted for ${postId}, which is no trading post`)
      }
      if (!Number.isInteger(n) || n < 1) fail(`the route to ${postId} counts ${n} robberies`)
    }
    return out
  },
}

/**
 * Caravans hold together (`CONTEXT.md`: Caravan, Caravan crew lost; ADR 0004): each runs to a
 * trading post that exists, at most one to each; its carriage, of the Trade Organization or it
 * ends, and its crew exist and are the HQ's (of no realm, of the HQ city); it has no driver only
 * with no crew left; nobody is on two caravans or both drives and escorts; the driver drives only
 * the caravan's carriage; it walks with no more escorts than its route gets
 * (`caravanEscortsWanted`); the Food it is set to load fits on a carriage; and one just set off from
 * the HQ holds enough for its way (`CONTEXT.md`: Waiting for Food), but for what it ate since it
 * loaded (`SET_OFF_FOOD_SLACK`).
 */
export const caravansSound: Invariant = {
  name: 'caravans-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (c: Caravan, message: string, ids: string[] = []) =>
      out.push({
        invariant: this.name,
        message: `caravan ${c.id} ${message}`,
        entityIds: [c.id, ...ids],
      })
    const hq = tradeOrgHq(world)
    const posts = new Set<string>()
    const crew = new Set<string>()
    for (const c of world.caravans) {
      if (!world.cities.some((x) => x.id === c.postId && x.tradeOrg === 'post')) {
        fail(c, `runs to ${c.postId}, which is no trading post`)
      }
      if (posts.has(c.postId)) fail(c, `shares the route to ${c.postId} with another caravan`)
      posts.add(c.postId)
      const k = world.carriages.find((x) => x.id === c.carriageId)
      if (!k) fail(c, `has carriage ${c.carriageId}, which doesn't exist`)
      else if (k.realmId !== null || k.cityId !== hq?.id) {
        fail(c, `has carriage ${k.id}, which isn't the Trade Org HQ's`, [k.id])
      }
      if (c.driverId === null && c.escortIds.length > 0) {
        fail(c, 'has no driver, though an escort could take over')
      }
      for (const id of crewIdsOf(c)) {
        const r = world.residents.find((x) => x.id === id)
        if (!r) fail(c, `has crew ${id}, who doesn't exist`)
        else if (r.owner !== null || r.cityId !== hq?.id) {
          fail(c, `has crew ${id}, who isn't of the Trade Org HQ`, [id])
        }
        if (crew.has(id)) fail(c, `has crew ${id} twice or shared with another caravan`, [id])
        crew.add(id)
      }
      const wanted = caravanEscortsWanted(world, c.postId)
      if (c.escortIds.length > wanted) {
        fail(c, `walks with ${c.escortIds.length} escorts, more than the ${wanted} of its route`)
      }
      const driver = world.residents.find((x) => x.id === c.driverId)
      const o = driver?.order
      if (driver && o?.kind === 'drive' && o.carriageId !== c.carriageId) {
        fail(c, `has its driver driving ${o.carriageId}`, [driver.id])
      }
      const holds = k ? carriageCapacity(world, k) : CARRIAGE_CAPACITY
      if (c.toLoad && stockWeight(c.toLoad) > holds + 1e-9) {
        fail(c, `means to load ${stockWeight(c.toLoad)} kg, more than a carriage holds`)
      }
      if (k && driver && justLeftTheHq(world, c, k, terrain.size)) {
        const want = caravanWayFood(world, c, k, terrain.size) - SET_OFF_FOOD_SLACK
        const food = k.load.food ?? 0
        if (food < want) fail(c, `set off from the HQ with ${food} Food, wanting ${want}`, [k.id])
      }
    }
    return out
  },
}

/** Whether a caravan is on its way to its post, its carriage still on the HQ's stop it left from. */
function justLeftTheHq(world: WorldState, c: Caravan, k: Carriage, size: number): boolean {
  if (c.heading !== 'post' || c.job || c.transfer) return false
  return standsAtHqStop(world, k, size)
}

/** Whether a carriage stands at the HQ's storage or goods warehouse, of an HQ with a storage. */
export function standsAtHqStop(world: WorldState, k: Carriage, size: number): boolean {
  const { storage, warehouse } = hqEnd(world)
  if (!storage) return false
  return isAt(k, storage, size) || (warehouse !== undefined && isAt(k, warehouse, size))
}
