import {
  CARAVAN_SPREAD,
  OWN_FOOD,
  TRADE_ORG_PUNISH,
  canWork,
  carriageCapacity,
  inCityArea,
  isAt,
  isDown,
  middleOf,
  townHallOf,
  tradeOrgHq,
  tripFood,
  unitsThatFit,
  unitsThatFitCarriage,
  wagonFoodFor,
  warehouseKeeps,
  wrapDistance,
  type Building,
  type Carriage,
  type City,
  type Good,
  type GoodsSpot,
  type Punishment,
  type Resident,
  type Stock,
  type SupplyWagon,
  type WorldState,
  armySpot,
} from '@csp/shared'
import { freeHands, newCaravanCarriage } from './caravans.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome, walkTo } from './npc-behaviour.js'
import { newId } from './starting-city.js'
import { fetchFood, foodIn, takenBy, worthOf } from './trade-org-punishment.js'
import { hqLayout } from './trade-org.js'

/*
 * A Trade Org army's supply wagon (`CONTEXT.md`: Trade Org debt, Supply line, Caravan crew lost): a
 * carriage of the HQ with a driver, which loads Food at the HQ, follows the soldiers and takes on
 * what they took, comes home with them and unloads into the warehouses. The soldiers refill from it.
 * Taking from it or stealing it is a crime like any against the Trade Organization; without it they
 * go on with what they carry. It outlives its army: with nobody left to follow it goes home by
 * itself. Plain data (ADR 0002); each tick the game gives its driver orders a Player could give.
 */

/**
 * The punishment `p` of the Trade Org HQ `hq` sets out with a supply wagon, for a city `tiles` away:
 * a new carriage with a horse at the HQ's goods warehouse, and the nearest free adult of the HQ to
 * drive it (`freeHands`). With nobody free it goes without, on what its soldiers carry.
 */
export function sendWagon(world: WorldState, hq: City, p: Punishment, tiles: number, size: number) {
  const hall = townHallOf(world, hq)
  if (!hall) return
  const middle = middleOf(hall)
  const [x, y] = hqLayout(middle.x, middle.y).goodsWarehouse
  const free = freeHands(world, hq.id)
  if (free.length === 0) return
  const driver = free.reduce((a, b) =>
    wrapDistance(size, b, { x, y }) < wrapDistance(size, a, { x, y }) ? b : a,
  )
  driver.order = null
  world.supplyWagons.push({
    id: newId(world, 'wagon'),
    punishmentId: p.id,
    carriageId: newCaravanCarriage(world, hq, x, y, `${world.seed}:wagon-horse:${p.id}`),
    driverId: driver.id,
    food: wagonFoodFor(tiles, p.members.length),
    ownFood: 0,
    holding: null,
  })
}

/** The supply wagon following a punishment, if it has one, with its carriage. */
export function wagonOf(
  world: WorldState,
  p: Punishment,
): { wagon: SupplyWagon; carriage: Carriage } | undefined {
  const wagon = world.supplyWagons.find((w) => w.punishmentId === p.id)
  const carriage = wagon && world.carriages.find((k) => k.id === wagon.carriageId)
  return wagon && carriage ? { wagon, carriage } : undefined
}

/** What on a wagon's carriage was taken: all of it but the Food it set out with. */
function takenOn(wagon: SupplyWagon, carriage: Carriage): Stock {
  const load: Stock = { ...carriage.load }
  const food = (load.food ?? 0) - wagon.ownFood
  if (food > 0) load.food = food
  else delete load.food
  return load
}

/** The Coins' worth of what a punishment's army took that lies on its supply wagon. */
export function wagonTook(world: WorldState, p: Punishment): number {
  const on = wagonOf(world, p)
  return on ? worthOf(takenOn(on.wagon, on.carriage)) : 0
}

/**
 * The goods a resident may refill from on a supply wagon (`CONTEXT.md`: Supply line): a soldier of the
 * punishment it follows, or whoever drives it, with its carriage within `CARAVAN_SPREAD` tiles.
 */
export function wagonFood(world: WorldState, r: Resident, size: number): Stock | undefined {
  if (r.owner !== null || world.supplyWagons.length === 0) return undefined
  const wagon = world.supplyWagons.find(
    (w) =>
      w.driverId === r.id ||
      world.punishments
        .find((p) => p.id === w.punishmentId)
        ?.members.some((m) => m.residentId === r.id),
  )
  const carriage = wagon && world.carriages.find((k) => k.id === wagon.carriageId)
  if (!carriage || (carriage.load.food ?? 0) <= 0) return undefined
  return wrapDistance(size, r, carriage) <= CARAVAN_SPREAD ? carriage.load : undefined
}

/**
 * A soldier running out of Food whose wagon has some but is out of reach to refill from goes to meet
 * it (the wagon is on its way to them too). Answers whether they are doing that.
 */
export function goToWagonForFood(r: Resident, carriage: Carriage, size: number): boolean {
  if ((r.carried.food ?? 0) >= OWN_FOOD || (carriage.load.food ?? 0) <= 0) return false
  if (wrapDistance(size, r, carriage) <= CARAVAN_SPREAD) return false
  const o = r.order
  // Near enough where it was: a walk restarted at every step of the carriage would get nowhere.
  if (o?.kind === 'walkTo' && wrapDistance(size, o.target, carriage) <= CARAVAN_SPREAD) return true
  walkTo(r, carriage)
  return true
}

/**
 * A soldier who took goods and has their wagon within `TRADE_ORG_PUNISH.wagonReach` tiles, with room
 * on it, carries them over and puts them on it (`CONTEXT.md`: Trade Org debt). Answers whether they
 * are doing that.
 */
export function loadOnWagon(
  world: WorldState,
  r: Resident,
  own: Stock,
  carriage: Carriage,
  size: number,
): boolean {
  if (wrapDistance(size, r, carriage) > TRADE_ORG_PUNISH.wagonReach) return false
  const goods: Stock = {}
  for (const [g, n] of Object.entries(takenBy(r, own)) as [Good, number][]) {
    if (unitsThatFitCarriage(world, carriage, g) >= 1) goods[g] = n
  }
  if (Object.keys(goods).length === 0) return false
  if (r.x === carriage.x && r.y === carriage.y) {
    r.order = { kind: 'drop', to: { kind: 'carriage', carriageId: carriage.id }, goods }
    return true
  }
  const o = r.order
  if (o?.kind !== 'walkTo' || o.target.x !== carriage.x || o.target.y !== carriage.y) {
    walkTo(r, carriage)
  }
  return true
}

/** The driver leaves the wagon, which is done with them: one away from the HQ walks home. */
function release(world: WorldState, wagon: SupplyWagon, size: number): void {
  const driver = world.residents.find((r) => r.id === wagon.driverId)
  if (!driver) return
  driver.order = null
  const hq = tradeOrgHq(world)
  const home = hq && npcHome(world, hq)
  if (hq && home && !inCityArea(world, hq, driver.x, driver.y, size)) walkTo(driver, home)
}

/**
 * Its carriage was stolen (`CONTEXT.md`: Stealing a carriage or horse): the army goes on with what it
 * carries, and the carriage is the thief's with all on it. The driver walks home.
 */
export function wagonStolen(world: WorldState, carriage: Carriage, size: number): void {
  const wagon = world.supplyWagons.find((w) => w.carriageId === carriage.id)
  if (!wagon) return
  world.supplyWagons = world.supplyWagons.filter((w) => w !== wagon)
  release(world, wagon, size)
}

/**
 * The driver is gone (`CONTEXT.md`: Caravan crew lost): a soldier of its army takes over driving, the
 * nearest who is up, bringing on board what they took, so long as that leaves the army someone;
 * otherwise there is no driver for now and the HQ sends one (`sendDriver`).
 */
function replaceDriver(
  world: WorldState,
  wagon: SupplyWagon,
  carriage: Carriage,
  p: Punishment | undefined,
  size: number,
): void {
  wagon.driverId = null
  wagon.holding = null
  if (!p) return
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const alive = p.members.filter((m) => (byId.get(m.residentId)?.health ?? 0) > 0)
  const up = alive.filter((m) => !isDown(byId.get(m.residentId)!))
  if (alive.length < 2 || up.length === 0) return
  const nearest = up.reduce((a, b) =>
    wrapDistance(size, byId.get(b.residentId)!, carriage) <
    wrapDistance(size, byId.get(a.residentId)!, carriage)
      ? b
      : a,
  )
  const r = byId.get(nearest.residentId)!
  p.members = p.members.filter((m) => m !== nearest)
  wagon.driverId = r.id
  r.order = null
  const taken = takenBy(r, nearest.own)
  if (Object.keys(taken).length > 0) {
    wagon.holding = { goods: taken, to: { kind: 'carriage', carriageId: carriage.id } }
  }
}

/**
 * With no crew left the HQ sends a new driver on foot, the nearest to the carriage of those free,
 * once it has one (`CONTEXT.md`: Caravan crew lost). They pack Food for the walk first.
 */
function sendDriver(
  world: WorldState,
  wagon: SupplyWagon,
  carriage: Carriage,
  hq: City,
  size: number,
) {
  const free = freeHands(world, hq.id)
  if (free.length === 0) return
  const nearest = free.reduce((a, b) =>
    wrapDistance(size, b, carriage) < wrapDistance(size, a, carriage) ? b : a,
  )
  nearest.order = null
  wagon.driverId = nearest.id
  wagon.sentOut = true
}

/** The driver drives the carriage to a tile, or with `army` after that punishment's soldiers. */
function driveTo(
  driver: Resident,
  carriage: Carriage,
  to: { x: number; y: number },
  army?: string,
): void {
  driver.order = {
    kind: 'drive',
    carriageId: carriage.id,
    target: { x: to.x, y: to.y },
    path: null,
    progress: 0,
    ...(army !== undefined && { army }),
  }
}

/** Whether a resident's order is a pick-up (one that `fetchFood` may have given them). */
const pickingUp = (r: Resident) => r.order?.kind === 'pickUp'

/** The driver's next take at a stop: `goods` from `from`, to put down next tick at `to`. */
function take(wagon: SupplyWagon, r: Resident, from: GoodsSpot, goods: Stock, to: GoodsSpot): void {
  r.order = { kind: 'pickUp', from, goods }
  wagon.holding = { goods, to }
}

/** The goods the driver holds for the wagon go down where they were meant to. */
function putDown(wagon: SupplyWagon, r: Resident): boolean {
  if (!wagon.holding) return false
  const { goods, to } = wagon.holding
  wagon.holding = null
  const held: Stock = {}
  for (const [g, units] of Object.entries(goods) as [Good, number][]) {
    const n = Math.min(units, Math.floor(r.carried[g] ?? 0))
    if (n > 0) held[g] = n
  }
  if (Object.keys(held).length === 0) return false
  r.order = { kind: 'drop', to, goods: held }
  // Food put on while loading is the wagon's own, not what the army took.
  if (!wagon.loaded && to.kind === 'carriage') wagon.ownFood += held.food ?? 0
  return true
}

/**
 * Loading at the HQ: the driver brings Food from its storage, or its warehouses where that has none
 * (`foodIn`), up to what the wagon means to set out with, keeping `TRADE_ORG_PUNISH.wagonRoom` free.
 * Once it has that, or the HQ has no more, it is loaded. Answers whether they are seeing to it.
 */
function loadFood(
  world: WorldState,
  wagon: SupplyWagon,
  driver: Resident,
  carriage: Carriage,
  hq: City,
  size: number,
): boolean {
  const most = carriageCapacity(world, carriage) - TRADE_ORG_PUNISH.wagonRoom
  const wanted = Math.floor(Math.min(wagon.food, most) - (carriage.load.food ?? 0))
  const stores = foodIn(world, new Set([hq.id]))
  if (wanted < 1 || stores.length === 0) {
    wagon.loaded = true
    return false
  }
  const store = stores.reduce((a, b) =>
    wrapDistance(size, carriage, b) < wrapDistance(size, carriage, a) ? b : a,
  )
  if (!isAt(driver, store, size)) {
    driveTo(driver, carriage, store)
    return true
  }
  const food = Math.min(
    wanted,
    Math.floor(store.stock!.food!),
    unitsThatFit(driver, 'food', world.tick),
  )
  if (food < 1) {
    wagon.loaded = true
    return false
  }
  const from: GoodsSpot = { kind: 'storage', storageId: store.id }
  take(wagon, driver, from, { food }, { kind: 'carriage', carriageId: carriage.id })
  return true
}

/**
 * The HQ's building a good goes into: the warehouse that keeps it, or for one none keeps its storage.
 */
function homeFor(world: WorldState, hq: City, good: Good): Building | undefined {
  const own = world.buildings.filter((b) => b.cityId === hq.id && !b.site)
  return (
    own.find((b) => warehouseKeeps(world, b).includes(good)) ??
    own.find((b) => b.kind === 'storage')
  )
}

/**
 * Home, its army's trip over: the driver drives to where the first good on board goes (`homeFor`) and
 * unloads it there through their hands, like a caravan. Answers false once there is nothing left to
 * unload, or nowhere to take it.
 */
function unload(
  world: WorldState,
  wagon: SupplyWagon,
  driver: Resident,
  carriage: Carriage,
  hq: City,
  size: number,
): boolean {
  const onBoard: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  for (const [g, n] of Object.entries(carriage.load) as [Good, number][]) {
    if (n < 1) continue
    const b = homeFor(world, hq, g)
    if (!b) continue
    if (!isAt(driver, b, size)) {
      driveTo(driver, carriage, b)
      return true
    }
    const units = Math.min(Math.floor(n), unitsThatFit(driver, g, world.tick))
    if (units < 1) continue
    take(wagon, driver, onBoard, { [g]: units }, { kind: 'storage', storageId: b.id })
    return true
  }
  return false
}

/**
 * Its trip is over: what is left of the carriage and horse goes back into the HQ's stock, as they came
 * out of it (a carriage with goods it can't put anywhere stands where it is).
 */
function retire(world: WorldState, carriage: Carriage): void {
  if (Object.values(carriage.load).some((n) => n >= 1)) return
  world.carriages = world.carriages.filter((k) => k !== carriage)
  world.horses = world.horses.filter((h) => h.id !== carriage.horseId)
}

/**
 * A driver on the way to where the army was goes after it step by step once they are within
 * `TRADE_ORG_PUNISH.wagonFollowReach` tiles of it; one going after it step by step who has fallen twice
 * as far behind drives to where it is now, as finding the way again at every step of theirs would no
 * longer end (`CONTEXT.md`: Supply line).
 */
function keepAfterArmy(
  world: WorldState,
  wagon: SupplyWagon,
  driver: Resident,
  carriage: Carriage,
  p: Punishment,
  size: number,
): void {
  const o = driver.order
  if (o?.kind !== 'drive' || !wagon.loaded) return
  const spot = armySpot(world, p.id, carriage, size)
  if (!spot) return
  const tiles = wrapDistance(size, carriage, spot)
  const reach = TRADE_ORG_PUNISH.wagonFollowReach
  if (o.army === undefined && tiles <= reach) driveTo(driver, carriage, spot, p.id)
  else if (o.army !== undefined && tiles > 2 * reach) driveTo(driver, carriage, spot)
}

/**
 * One tick of a supply wagon, answering whether it goes on. It ends once its carriage is no longer
 * the HQ's or has no horse to pull it, standing where it is, and once it is unloaded at home. A driver
 * who is gone is replaced (`replaceDriver`, `sendDriver`); one parted from the carriage walks to it,
 * packing first if they were sent on foot. A driver who is idle with the carriage loads Food, then
 * follows its army (`keepAfterArmy`), then comes home.
 */
function runWagon(world: WorldState, hq: City, wagon: SupplyWagon, size: number): boolean {
  const carriage = world.carriages.find((k) => k.id === wagon.carriageId)
  if (!carriage || carriage.realmId !== null || carriage.cityId !== hq.id || !carriage.horseId) {
    release(world, wagon, size)
    return false
  }
  const p = world.punishments.find((x) => x.id === wagon.punishmentId)
  let driver = world.residents.find((r) => r.id === wagon.driverId)
  if (!p && wagon.punishmentId !== null) {
    wagon.punishmentId = null
    // Its army is gone or home, so its drive after them is over.
    if (driver?.order?.kind === 'drive' && driver.order.army !== undefined) driver.order = null
  }
  wagon.ownFood = Math.min(wagon.ownFood, carriage.load.food ?? 0)
  if (wagon.driverId !== null && !driver) replaceDriver(world, wagon, carriage, p, size)
  if (wagon.driverId === null) sendDriver(world, wagon, carriage, hq, size)
  driver = world.residents.find((r) => r.id === wagon.driverId)
  if (driver && p) keepAfterArmy(world, wagon, driver, carriage, p, size)
  if (!driver || driver.order !== null || isDown(driver) || !canWork(driver, world.tick)) {
    return true
  }
  if (driver.x !== carriage.x || driver.y !== carriage.y) {
    if (wagon.sentOut) {
      const wanted = tripFood(wrapDistance(size, driver, carriage))
      const stores = () => foodIn(world, new Set([hq.id]))
      if (fetchFood(world, stores, driver, {}, wanted, size)) {
        if (pickingUp(driver)) delete wagon.sentOut
        return true
      }
      delete wagon.sentOut
    }
    walkTo(driver, carriage)
    return true
  }
  if (putDown(wagon, driver)) return true
  if (!wagon.loaded) {
    if (p?.heading !== 'out') wagon.loaded = true
    else if (loadFood(world, wagon, driver, carriage, hq, size)) return true
  }
  if (p) {
    if (world.tick % TRADE_ORG_PUNISH.wagonRetryTicks !== 0) return true
    const spot = armySpot(world, p.id, driver, size)
    if (spot) {
      const near = wrapDistance(size, carriage, spot) <= TRADE_ORG_PUNISH.wagonFollowReach
      driveTo(driver, carriage, spot, near ? p.id : undefined)
    }
    return true
  }
  if (unload(world, wagon, driver, carriage, hq, size)) return true
  retire(world, carriage)
  release(world, wagon, size)
  return false
}

/** One tick of the Trade Organization's supply wagons (`runWagon`). Run after its punishments. */
export function stepSupplyWagons(world: WorldState, hq: City, size: number): void {
  world.supplyWagons = world.supplyWagons.filter((w) => runWagon(world, hq, w, size))
}

/**
 * Supply wagons hold together (`CONTEXT.md`: Trade Org debt, Caravan crew lost; ADR 0004): each has a
 * carriage of the HQ and follows a punishment under way, at most one to each, or none; its driver, if
 * it has one, is one of the HQ's, on no other wagon or caravan and none of its soldiers, and drives
 * only its carriage; the Food it calls its own is no less than none.
 */
export const supplyWagonsSound: Invariant = {
  name: 'supply-wagons-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (w: SupplyWagon, message: string, ids: string[] = []) =>
      out.push({
        invariant: this.name,
        message: `supply wagon ${w.id} ${message}`,
        entityIds: [w.id, ...ids],
      })
    const hq = tradeOrgHq(world)
    const followed = new Set<string>()
    const drivers = new Set<string>()
    const soldiers = new Set(world.punishments.flatMap((p) => p.members.map((m) => m.residentId)))
    for (const w of world.supplyWagons ?? []) {
      const k = world.carriages.find((x) => x.id === w.carriageId)
      if (!k) fail(w, `has carriage ${w.carriageId}, which doesn't exist`)
      else if (k.realmId !== null || k.cityId !== hq?.id) {
        fail(w, `has carriage ${k.id}, which isn't the Trade Org HQ's`, [k.id])
      }
      if (w.punishmentId !== null) {
        if (!world.punishments.some((p) => p.id === w.punishmentId)) {
          fail(w, `follows ${w.punishmentId}, which is no punishment under way`)
        }
        if (followed.has(w.punishmentId)) fail(w, `shares ${w.punishmentId} with another wagon`)
        followed.add(w.punishmentId)
      }
      if (!(w.ownFood >= 0)) fail(w, `calls ${w.ownFood} Food its own`)
      if (w.driverId === null) continue
      const r = world.residents.find((x) => x.id === w.driverId)
      if (!r) fail(w, `has driver ${w.driverId}, who doesn't exist`)
      else if (r.owner !== null || r.cityId !== hq?.id) {
        fail(w, `has driver ${r.id}, who isn't of the Trade Org HQ`, [r.id])
      }
      if (drivers.has(w.driverId)) fail(w, `shares its driver ${w.driverId}`, [w.driverId])
      drivers.add(w.driverId)
      if (soldiers.has(w.driverId)) fail(w, `is driven by its soldier ${w.driverId}`, [w.driverId])
      if (
        world.caravans.some((c) => c.driverId === w.driverId || c.escortIds.includes(w.driverId!))
      ) {
        fail(w, `shares its driver ${w.driverId} with a caravan`, [w.driverId])
      }
      const o = r?.order
      if (o?.kind === 'drive' && o.carriageId !== w.carriageId) {
        fail(w, `has its driver driving ${o.carriageId}`, [w.driverId])
      }
    }
    return out
  },
}
