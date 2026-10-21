import {
  CARAVAN_ESCORTS,
  CARAVAN_FOOD,
  CARAVAN_SPREAD,
  CARRIAGE_CAPACITY,
  GOODS,
  GOOD_WEIGHT,
  MAX_HEALTH,
  MAX_HUNGER,
  START_CARRIED_FOOD,
  caravanOf,
  canWork,
  inContact,
  owedBy,
  stockWeight,
  townHallOf,
  unitsThatFit,
  unitsThatFitCarriage,
  wrapDistance,
  type Building,
  type Caravan,
  type Carriage,
  type Good,
  type GoodsSpot,
  type Resident,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { releaseDelivery, runDelivery, takeOnDelivery } from './deliveries.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { hash, mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { hqLayout, tradeOrgHq } from './trade-org.js'
import { tradingPosts } from './trading-posts.js'

/*
 * Caravans (`CONTEXT.md`: Caravan): the Trade Organization's carriages, each on the fixed route
 * between one trading post and the HQ, driven by an HQ resident and escorted by others on foot.
 * For now they even out the two warehouses' own stock. The caravan is plain data (ADR 0002);
 * each tick the game gives its crew drive, pick-up, drop and walk orders, which request actions
 * like a Player's do.
 */

/** The goods caravans even out: not Food, which lives in the storages, nor coins. */
const CARRIED: readonly Good[] = GOODS.filter((g) => g !== 'food' && g !== 'coins')

/** One end of a caravan's route: the storage it tops up its Food at, and the warehouse. */
interface RouteEnd {
  storage: Building | undefined
  warehouse: Building | undefined
}

const finished = (b: Building) => !b.site

/**
 * The storage and warehouse at one end of a caravan's route: at the HQ its storage and its goods
 * warehouse (`hqLayout`), at the trading post its own.
 */
export function routeEnd(world: WorldState, caravan: Caravan, end: Caravan['heading']): RouteEnd {
  if (end === 'post') {
    const own = world.buildings.filter((b) => b.cityId === caravan.postId && finished(b))
    return {
      storage: own.find((b) => b.kind === 'storage'),
      warehouse: own.find((b) => b.kind === 'warehouse'),
    }
  }
  const hq = tradeOrgHq(world)
  const hall = hq && townHallOf(world, hq)
  if (!hall) return { storage: undefined, warehouse: undefined }
  const { storage, goodsWarehouse } = hqLayout(hall.x, hall.y)
  const at = (kind: Building['kind'], [x, y]: [number, number]) =>
    world.buildings.find((b) => b.kind === kind && b.x === x && b.y === y && finished(b))
  return { storage: at('storage', storage), warehouse: at('warehouse', goodsWarehouse) }
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
  const [x, y] = hqLayout(hall.x, hall.y).goodsWarehouse
  const served = new Set(world.caravans.map((c) => c.postId))
  const placed: Caravan[] = []
  for (const post of tradingPosts(world)) {
    if (served.has(post.id)) continue
    const rand = mulberry32(hash(`${world.seed}:caravan:${post.id}`))
    const horseId = newId(world, 'horse')
    world.horses.push({
      id: horseId,
      realmId: null,
      cityId: hq.id,
      x,
      y,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
    })
    const carriageId = newId(world, 'carriage')
    world.carriages.push({ id: carriageId, realmId: null, cityId: hq.id, x, y, horseId, load: {} })
    const crew = Array.from({ length: 1 + CARAVAN_ESCORTS }, () => {
      const r = newResident(rand, {
        id: newId(world, 'r'),
        owner: null,
        cityId: hq.id,
        x,
        y,
        tick: world.tick,
      })
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
    }
    world.caravans.push(caravan)
    placed.push(caravan)
  }
  return placed
}

/** Everyone on a caravan, by id. */
export function caravanCrew(world: WorldState): Set<string> {
  return new Set(world.caravans.flatMap((c) => [c.driverId, ...c.escortIds]))
}

/**
 * What evens out two warehouses' stock: of each good (`CARRIED`), half of what `here` holds more
 * than `there`, as much of it as fits on the carriage, in the order of `GOODS`.
 */
export function evenOut(here: Stock, there: Stock, carriage: Carriage): Stock {
  let room = CARRIAGE_CAPACITY - stockWeight(carriage.load)
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

const walkTo = (r: Resident, at: { x: number; y: number }) => {
  r.order = { kind: 'walkTo', target: { x: at.x, y: at.y }, path: null, progress: 0 }
}

/**
 * The escort walks along (`CONTEXT.md`: Caravan): an escort who is idle and out of contact with
 * the carriage walks to it. The driver waits for them on the way (`waitingForEscort`).
 */
function followCarriage(world: WorldState, caravan: Caravan, carriage: Carriage, size: number) {
  for (const id of caravan.escortIds) {
    const r = world.residents.find((x) => x.id === id)
    if (r && r.order === null && !inContact(size, r, carriage)) walkTo(r, carriage)
  }
}

/** Sets the caravan off for the other end of its route, to its storage first. */
function depart(caravan: Caravan): void {
  caravan.heading = caravan.heading === 'hq' ? 'post' : 'hq'
  caravan.stop = 'storage'
  caravan.toLoad = null
}

/** The driver's next take at a stop: `goods` from `from`, to put down next tick `onto`. */
function take(
  caravan: Caravan,
  driver: Resident,
  from: GoodsSpot,
  goods: Stock,
  onto: 'carriage' | 'stop',
): void {
  driver.order = { kind: 'pickUp', from, goods }
  caravan.holding = { goods, onto }
}

/**
 * One tick of a caravan whose driver is idle with the carriage: drive to the next stop; at a
 * storage, top up the Food on board to `CARAVAN_FOOD`; at a warehouse, unload what was brought,
 * then take on a delivery ordered there (`takeOnDelivery`), or else load what evens out the stock
 * with the other end's warehouse (`evenOut`) beyond what it keeps for deliveries, then set off.
 * Each take or put is one pick-up or drop order of the driver's, one a tick, like anyone's. An
 * end without its storage is skipped to the warehouse; one without its warehouse, passed by. A
 * caravan carrying out a delivery does that instead (`runDelivery`). `size` is the map's.
 */
function runCaravan(
  world: WorldState,
  caravan: Caravan,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  if (caravan.job) return runDelivery(world, caravan, driver, carriage, size)
  const end = routeEnd(world, caravan, caravan.heading)
  const stop = caravan.stop === 'storage' ? end.storage : end.warehouse
  if (!stop) {
    if (caravan.stop === 'storage') caravan.stop = 'warehouse'
    else depart(caravan)
    return
  }
  if (driver.x !== stop.x || driver.y !== stop.y) {
    const target = { x: stop.x, y: stop.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return
  }
  const here: GoodsSpot = { kind: 'storage', storageId: stop.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  if (caravan.holding) {
    const { goods, onto } = caravan.holding
    caravan.holding = null
    const held: Stock = {}
    for (const [g, units] of Object.entries(goods) as [Good, number][]) {
      const n = Math.min(units, driver.carried[g] ?? 0)
      if (n > 0) held[g] = n
    }
    if (Object.keys(held).length > 0) {
      driver.order = { kind: 'drop', to: onto === 'carriage' ? onCarriage : here, goods: held }
      return
    }
  }
  const stock = stop.stock ?? {}
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  if (caravan.stop === 'storage') {
    const food = Math.min(
      CARAVAN_FOOD - (carriage.load.food ?? 0),
      stock.food ?? 0,
      hands('food'),
      unitsThatFitCarriage(carriage, 'food'),
    )
    if (food > 0) take(caravan, driver, here, { food }, 'carriage')
    else caravan.stop = 'warehouse'
    return
  }
  if (caravan.toLoad === null) {
    // Unloading what it brought comes first; loading is worked out once all of it is off.
    for (const g of CARRIED) {
      const units = Math.min(carriage.load[g] ?? 0, hands(g))
      if (units > 0) return take(caravan, driver, onCarriage, { [g]: units }, 'stop')
    }
    if (takeOnDelivery(world, caravan, stop)) return
    const other = routeEnd(world, caravan, caravan.heading === 'hq' ? 'post' : 'hq').warehouse
    const spare: Stock = { ...stock }
    for (const g of CARRIED) spare[g] = (stock[g] ?? 0) - owedBy(world, stop.id, g)
    caravan.toLoad = other ? evenOut(spare, other.stock ?? {}, carriage) : {}
  }
  for (const [g, wanted] of Object.entries(caravan.toLoad) as [Good, number][]) {
    const units = Math.min(wanted, stock[g] ?? 0, hands(g), unitsThatFitCarriage(carriage, g))
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
 * requested: escorts who are gone leave their caravan; a caravan whose driver, carriage, post or
 * HQ is gone breaks up, its crew left to the HQ; the escort walks after the carriage; and a
 * caravan whose driver is idle goes on with its route (`runCaravan`). A driver parted from the
 * carriage walks back to it. `size` is the map's.
 */
export function stepCaravans(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  world.caravans = world.caravans.filter((caravan) => {
    caravan.escortIds = caravan.escortIds.filter((id) => world.residents.some((r) => r.id === id))
    const driver = world.residents.find((r) => r.id === caravan.driverId)
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)
    const post = world.cities.find((c) => c.id === caravan.postId && c.tradeOrg === 'post')
    if (!hq || !driver || !carriage || !post) {
      releaseDelivery(world, caravan)
      return false
    }
    followCarriage(world, caravan, carriage, size)
    if (driver.order !== null || !canWork(driver, world.tick)) return true
    if (driver.x !== carriage.x || driver.y !== carriage.y) walkTo(driver, carriage)
    else runCaravan(world, caravan, driver, carriage, size)
    return true
  })
}

/**
 * Drivers of caravans who wait this tick for their escort to catch up (`CONTEXT.md`: Caravan):
 * those with an escort on the way to them more than `CARAVAN_SPREAD` tiles away. `size` is the
 * map's.
 */
export function waitingForEscort(world: WorldState, size: number): Set<string> {
  const waiting = new Set<string>()
  for (const caravan of world.caravans) {
    const driver = world.residents.find((r) => r.id === caravan.driverId)
    if (driver?.order?.kind !== 'drive') continue
    const behind = caravan.escortIds.some((id) => {
      const r = world.residents.find((x) => x.id === id)
      return r?.order?.kind === 'walkTo' && wrapDistance(size, r, driver) > CARAVAN_SPREAD
    })
    if (behind) waiting.add(driver.id)
  }
  return waiting
}

/**
 * The caravan whose crew a resident is, when they may refill from its carriage (`CONTEXT.md`:
 * Caravan, Refilling from a carriage): the carriage's Food, within `CARAVAN_SPREAD` tiles of
 * them, since the escort keeps that close.
 */
export function caravanFood(world: WorldState, r: Resident, size: number): Stock | undefined {
  const caravan = r.owner === null ? caravanOf(world, r.id) : undefined
  const carriage = caravan && world.carriages.find((k) => k.id === caravan.carriageId)
  if (!carriage || (carriage.load.food ?? 0) <= 0) return undefined
  return wrapDistance(size, r, carriage) <= CARAVAN_SPREAD ? carriage.load : undefined
}

/**
 * Caravans hold together (`CONTEXT.md`: Caravan; ADR 0004): each runs to a trading post that
 * exists, at most one to each; its carriage, driver and escorts exist and are the HQ's (of no
 * realm, of the HQ city); nobody is on two caravans or both drives and escorts; the driver drives
 * only the caravan's carriage; and the Food it is set to load fits on a carriage.
 */
export const caravansSound: Invariant = {
  name: 'caravans-sound',
  check(world) {
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
      for (const id of [c.driverId, ...c.escortIds]) {
        const r = world.residents.find((x) => x.id === id)
        if (!r) fail(c, `has crew ${id}, who doesn't exist`)
        else if (r.owner !== null || r.cityId !== hq?.id) {
          fail(c, `has crew ${id}, who isn't of the Trade Org HQ`, [id])
        }
        if (crew.has(id)) fail(c, `has crew ${id} twice or shared with another caravan`, [id])
        crew.add(id)
      }
      const driver = world.residents.find((x) => x.id === c.driverId)
      const o = driver?.order
      if (o?.kind === 'drive' && o.carriageId !== c.carriageId) {
        fail(c, `has its driver driving ${o.carriageId}`, [c.driverId])
      }
      if (c.toLoad && stockWeight(c.toLoad) > CARRIAGE_CAPACITY + 1e-9) {
        fail(c, `means to load ${stockWeight(c.toLoad)} kg, more than a carriage holds`)
      }
    }
    return out
  },
}
