import {
  DELIVERY_DRIVE_TRIES,
  commands,
  DELIVERY_LOAD,
  GOOD_WEIGHT,
  deliveryStorage,
  handInProblem,
  nearestWarehouse,
  realmName,
  pickUpTransferProblem,
  quoteTransfer,
  stockWeight,
  tradeCoinWarehouse,
  transferFee,
  transferLoad,
  transferTiles,
  unitsThatFit,
  unitsThatFitCarriage,
  wrapDistance,
  type Building,
  type Caravan,
  type Carriage,
  type Good,
  type GoodsSpot,
  type HandInOrder,
  type OrderRequest,
  type Resident,
  type Stock,
  type Transfer,
  type TransferJob,
  type WorldState,
  isAt,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Transfers between realms (`CONTEXT.md`: Transfer): the Trade Organization carries goods or
 * coins from one realm to a city of another. A caravan standing at a transfer's warehouse takes
 * it on, after the deliveries ordered there, and carries it out instead of going on along its
 * route (`TransferJob`), then goes back to its route. Like the route, each step is one drive,
 * pick-up or drop order of the driver's, which request actions like a Player's do (ADR 0002).
 */

/** The input of a transfer order: the sender's city, the recipient's city, the good and units. */
interface TransferRequest extends OrderRequest {
  fromCityId: string
  toCityId: string
  good: Good
  units: number
}

/**
 * A transfer order (`CONTEXT.md`: Transfer), given from the realm with nobody at a warehouse: a
 * caravan of the warehouse nearest the sender's city `fromCityId` picks up to `units` of a good
 * there, with its fee, and brings them to the storage of `toCityId`, another realm's city.
 */
export const transfer: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<TransferRequest>
    const realm = realmOf(world, sender.userId)
    if (!realm) return 'you have no realm'
    return pickUpTransferProblem(world, realm.id, o.fromCityId, o.good, o.units, o.toCityId)
  },
  apply(world, sender, order, terrain) {
    const o = order as TransferRequest
    const realm = realmOf(world, sender.userId)
    const from = world.cities.find((c) => c.id === o.fromCityId)
    const to = world.cities.find((c) => c.id === o.toCityId)
    const storage = deliveryStorage(world, o.fromCityId)
    if (!realm || !from || !to?.realmId || !storage) return
    if (pickUpTransferProblem(world, realm.id, o.fromCityId, o.good, o.units, o.toCityId)) return
    const warehouse = nearestWarehouse(world, storage, terrain?.size ?? Infinity)
    if (!warehouse) return
    world.transfers.push({
      id: newId(world, 'transfer'),
      realmId: realm.id,
      toRealmId: to.realmId,
      toCityId: to.id,
      warehouseId: warehouse.id,
      fromCityId: from.id,
      good: o.good,
      units: o.units,
      fee: 0,
      back: false,
      caravanId: null,
    })
    recordEvent(world, realm.id, {
      kind: 'transferOrdered',
      good: o.good,
      units: o.units,
      wanted: o.units,
      fee: 0,
      fromCity: from.name,
      name: null,
      toRealmId: to.realmId,
      toRealm: realmName(world, to.realmId),
      cityId: to.id,
      city: to.name,
      x: storage.x,
      y: storage.y,
    })
  },
}

/** The input of a hand-in order: the resident, the good, the units, maybe a carriage, the city. */
interface HandInRequest extends OrderRequest {
  residentId: string
  good: Good
  units: number
  carriageId?: string | null
  toCityId: string
}

/**
 * A hand-in order (`CONTEXT.md`: Transfer): one of the Player's residents, on a Trade Org
 * warehouse's tile, hands in up to `units` of a good from their hands or their carriage there,
 * paying the fee, for a caravan to bring to the storage of `toCityId`. It happens this tick
 * (`handIn`).
 */
export const handInOrder: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<HandInRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    return handInProblem(world, realm.id, r, o.good, o.units, o.carriageId, o.toCityId)
  },
  apply(world, _sender, order) {
    const o = order as HandInRequest
    const r = world.residents.find((x) => x.id === o.residentId)
    if (r) {
      r.order = {
        kind: 'handIn',
        good: o.good,
        units: o.units,
        carriageId: o.carriageId ?? null,
        toCityId: o.toCityId,
      }
    }
  },
}

/** Moves units of one good between two stocks, dropping a good that reaches 0. */
function move(from: Stock, to: Stock, good: Good, units: number): void {
  if (units <= 0) return
  const left = (from[good] ?? 0) - units
  if (left > 0) from[good] = left
  else delete from[good]
  to[good] = (to[good] ?? 0) + units
}

/**
 * Carries out the hand-in order `o` of resident `r` of `realm` at `warehouse` (`CONTEXT.md`:
 * Transfer), from `payer` (their hands or carriage): as many of the units as they hold, within one
 * load, go into the warehouse (coins into its coin warehouse) with the fee for the way to the
 * recipient's storage and back (`quoteTransfer`), and the warehouse keeps them for a caravan.
 * Either way with a line in the realm log. Returns whether a transfer was handed in.
 */
export function handIn(
  world: WorldState,
  size: number,
  r: Resident,
  realm: string,
  o: HandInOrder,
  warehouse: Building,
  payer: Stock,
): boolean {
  const to = world.cities.find((c) => c.id === o.toCityId)
  const storage = deliveryStorage(world, o.toCityId)
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  if (!to?.realmId || to.realmId === realm || !storage || !coinWarehouse) return false
  if (!world.realms.some((x) => x.id === to.realmId)) return false
  const tiles = transferTiles(size, warehouse, null, storage)
  const q = quoteTransfer(payer, o.good, o.units, tiles)
  const coins = (coinWarehouse.stock ??= {})
  move(payer, o.good === 'coins' ? coins : (warehouse.stock ??= {}), o.good, q.units)
  move(payer, coins, 'coins', q.units > 0 ? q.fee : 0)
  if (q.units > 0) {
    world.transfers.push({
      id: newId(world, 'transfer'),
      realmId: realm,
      toRealmId: to.realmId,
      toCityId: to.id,
      warehouseId: warehouse.id,
      fromCityId: null,
      good: o.good,
      units: q.units,
      fee: q.fee,
      back: false,
      caravanId: null,
    })
  }
  recordEvent(world, realm, {
    kind: 'transferOrdered',
    good: o.good,
    units: q.units,
    wanted: o.units,
    fee: q.units > 0 ? q.fee : 0,
    fromCity: null,
    name: r.name,
    toRealmId: to.realmId,
    toRealm: realmName(world, to.realmId),
    cityId: to.id,
    city: to.name,
    x: warehouse.x,
    y: warehouse.y,
  })
  return q.units > 0
}

/**
 * Has `caravan`, standing at `warehouse`, take on the oldest transfer there that waits for a
 * caravan. Returns whether it took one.
 */
export function takeOnTransfer(world: WorldState, caravan: Caravan, warehouse: Building): boolean {
  const t = world.transfers.find((x) => x.caravanId === null && x.warehouseId === warehouse.id)
  if (!t) return false
  t.caravanId = caravan.id
  caravan.transfer = {
    transferId: t.id,
    warehouseId: t.warehouseId,
    good: t.good,
    step: t.fromCityId === null ? 'load' : 'collect',
    units: 0,
    coins: 0,
    target: null,
    fee: 0,
    misses: 0,
    robbed: 0,
    fromCityId: t.fromCityId,
  }
  return true
}

/** Lets go of a caravan's transfer, which waits for the next caravan (a caravan that broke up). */
export function releaseTransfer(world: WorldState, caravan: Caravan): void {
  const t = world.transfers.find((x) => x.id === caravan.transfer?.transferId)
  if (t?.caravanId === caravan.id) t.caravanId = null
}

/** The transfer a caravan's job is for, while it is still owed. */
const transferOf = (world: WorldState, job: TransferJob): Transfer | undefined =>
  world.transfers.find((t) => t.id === job.transferId)

/** Drops a transfer that is done or cancelled. */
function drop(world: WorldState, t: Transfer): void {
  world.transfers = world.transfers.filter((x) => x !== t)
}

/** The city's name, for the realm log. */
const cityName = (world: WorldState, cityId: string): string =>
  world.cities.find((c) => c.id === cityId)?.name ?? 'a lost city'

/** The realm a transfer goes to: the recipient's, or the sender's once it goes back. */
const receiver = (t: Transfer): string => (t.back ? t.realmId : t.toRealmId)

/** Whether the city `cityId` is still `realmId`'s, with a storage. */
function holds(world: WorldState, realmId: string, cityId: string | null): boolean {
  const city = world.cities.find((c) => c.id === cityId)
  return (
    city !== undefined && city.realmId === realmId && deliveryStorage(world, city.id) !== undefined
  )
}

/**
 * What a transfer job counts on board is cut down to what the carriage holds. For a transfer of
 * coins the fee's coins go first, then the transfer's.
 */
function countOnBoard(job: TransferJob, carriage: Carriage): void {
  const coins = carriage.load.coins ?? 0
  if (job.good === 'coins') {
    job.units = Math.min(job.units, coins)
    job.coins = Math.min(job.coins, coins - job.units)
  } else {
    job.units = Math.min(job.units, carriage.load[job.good] ?? 0)
    job.coins = Math.min(job.coins, coins)
  }
}

/**
 * The building a job's step happens at: the sender's storage, the warehouse (its coin warehouse
 * for coins), or the recipient's storage. Returning, the warehouse while it carries goods of the
 * transfer, then the coin warehouse for the fee's coins.
 */
function stepBuilding(world: WorldState, job: TransferJob, t?: Transfer): Building | undefined {
  const warehouse = world.buildings.find((b) => b.id === job.warehouseId)
  if (!warehouse) return undefined
  const coinWarehouse = tradeCoinWarehouse(world, warehouse)
  switch (job.step) {
    case 'collect':
    case 'fee':
      return job.fromCityId === null ? undefined : deliveryStorage(world, job.fromCityId)
    case 'load':
      return job.good === 'coins' ? coinWarehouse : warehouse
    case 'deliver':
      return t && deliveryStorage(world, t.toCityId)
    case 'return':
      return job.units > 0 && job.good !== 'coins' ? warehouse : coinWarehouse
  }
}

/** Ends a caravan's transfer job: it goes back to its route, at this end's storage first. */
function finish(caravan: Caravan): void {
  caravan.transfer = null
  caravan.stop = 'storage'
}

/**
 * The caravan turns back to the warehouse (`return`) from a storage it couldn't get to: the
 * transfer waits for the next caravan, the warehouse keeping what it collected (or, before it
 * collected anything, the sender's city still holding it). With a line in the sender's log.
 */
function turnBack(world: WorldState, job: TransferJob, t: Transfer): void {
  const delivering = job.step === 'deliver'
  if (delivering) {
    t.fromCityId = null
    job.robbed = 0
  }
  t.caravanId = null
  job.step = 'return'
  job.misses = 0
  const cityId = delivering || job.fromCityId === null ? t.toCityId : job.fromCityId
  recordEvent(world, t.realmId, {
    kind: 'transferStuck',
    why: 'turnedBack',
    good: t.good,
    units: t.units,
    cityId,
    city: cityName(world, cityId),
  })
}

/**
 * The recipient's city is no longer that realm's, or the realm is gone (`CONTEXT.md`: Transfer):
 * the transfer is cancelled and goes back to the sender's city it was taken from (for a hand-in,
 * the sender's city nearest the warehouse), the fee kept. One already going back, or with no
 * city of the sender's to go to, is dropped, and the caravan brings what it carries to the
 * warehouse: the Trade Organization keeps it. With a line in the sender's log.
 */
function cancel(world: WorldState, job: TransferJob, t: Transfer, size: number): void {
  const lost = t.toCityId
  const home = t.back ? undefined : homeFor(world, job, t, size)
  if (home) {
    t.back = true
    t.toCityId = home
    job.misses = 0
  } else {
    drop(world, t)
    job.step = 'return'
  }
  recordEvent(world, t.realmId, {
    kind: 'transferStuck',
    why: home ? 'cancelled' : 'kept',
    good: t.good,
    units: job.units,
    cityId: lost,
    city: cityName(world, lost),
  })
}

/** The sender's city a cancelled transfer goes back to, if the sender still has one. */
function homeFor(
  world: WorldState,
  job: TransferJob,
  t: Transfer,
  size: number,
): string | undefined {
  if (job.fromCityId !== null) {
    return holds(world, t.realmId, job.fromCityId) ? job.fromCityId : undefined
  }
  const warehouse = world.buildings.find((b) => b.id === job.warehouseId)
  let best: string | undefined
  let bestTiles = Infinity
  for (const c of world.cities) {
    const storage = c.realmId === t.realmId ? deliveryStorage(world, c.id) : undefined
    if (!storage || !warehouse) continue
    const tiles = wrapDistance(size, warehouse, storage)
    if (tiles < bestTiles) [best, bestTiles] = [c.id, tiles]
  }
  return best
}

/**
 * One tick of a caravan carrying out a transfer (`TransferJob`), its driver idle with the
 * carriage and `holding` what they took last tick for it. At each step it drives to the step's
 * building, then takes and puts one load a tick; a drive to a storage that ends short of it
 * `DELIVERY_DRIVE_TRIES` times turns it back. A sender's city that is no longer the sender's
 * before anything was taken cancels the transfer; a recipient's city that is no longer the
 * recipient's sends it back (`cancel`). `size` is the map's.
 */
export function runTransfer(
  world: WorldState,
  caravan: Caravan,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  const job = caravan.transfer!
  countOnBoard(job, carriage)
  const t = transferOf(world, job)
  if (job.step !== 'return' && !t) {
    job.step = 'return'
    return
  }
  const collecting = job.step === 'collect' || job.step === 'fee'
  if (t && collecting && !holds(world, t.realmId, job.fromCityId)) {
    // The sender's city is gone: with nothing taken yet there is nothing to carry.
    if (job.units + job.robbed === 0) return nothing(world, job, t)
    return collected(world, job, t)
  }
  if (t && job.step === 'deliver') {
    if (!holds(world, receiver(t), t.toCityId)) return cancel(world, job, t, size)
    // Robbed of all it carried, it has nothing left to bring.
    if (job.units === 0 && job.robbed > 0 && !caravan.holding) {
      return sendAgain(world, job, t, deliveryStorage(world, t.toCityId))
    }
  }
  const b = stepBuilding(world, job, t)
  if (!b) return finish(caravan)
  if (!isAt(driver, b)) {
    const toStorage = collecting || job.step === 'deliver'
    if (toStorage && job.misses >= DELIVERY_DRIVE_TRIES) return turnBack(world, job, t!)
    job.misses++
    const target = { x: b.x, y: b.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return
  }
  job.misses = 0
  const here: GoodsSpot = { kind: 'storage', storageId: b.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  // The fee's coins count apart from the transfer's units, coins or not.
  const feeStep = job.step === 'fee'
  if (caravan.holding) {
    const { goods, onto } = caravan.holding
    caravan.holding = null
    const [good, wanted] = (Object.entries(goods) as [Good, number][])[0]!
    const fits = onto === 'carriage' ? unitsThatFitCarriage(carriage, good) : Infinity
    const units = Math.min(wanted, driver.carried[good] ?? 0, fits)
    if (units > 0) {
      driver.order = {
        kind: 'drop',
        to: onto === 'carriage' ? onCarriage : here,
        goods: { [good]: units },
      }
      if (onto === 'carriage' && feeStep) {
        job.coins += units
        t!.fee += units
      } else if (onto === 'carriage') job.units += units
      return
    }
  }
  const stock = b.stock ?? {}
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  const fits = (g: Good) => unitsThatFitCarriage(carriage, g)
  const take = (from: GoodsSpot, good: Good, units: number, onto: 'carriage' | 'stop') => {
    driver.order = { kind: 'pickUp', from, goods: { [good]: units } }
    caravan.holding = { goods: { [good]: units }, onto }
  }
  const off = (good: Good, units: number, fee: boolean) => {
    take(onCarriage, good, units, 'stop')
    if (fee) job.coins -= units
    else job.units -= units
  }
  const g = job.good
  switch (job.step) {
    case 'collect': {
      const warehouse = world.buildings.find((x) => x.id === job.warehouseId)!
      const to = deliveryStorage(world, t!.toCityId)
      const tiles = to ? transferTiles(size, warehouse, b, to) : 0
      if (job.target === null) {
        const q = quoteTransfer(stock, g, t!.units, tiles)
        job.target = Math.min(q.units, fits(g))
        if (job.target === 0) return nothing(world, job, t!)
      }
      // What robbers took off the carriage was collected all the same.
      const have = job.units + job.robbed
      const units = Math.min(job.target - have, stock[g] ?? 0, hands(g), fits(g))
      if (units > 0) return take(here, g, units, 'carriage')
      job.fee = have > 0 ? transferFee(have * GOOD_WEIGHT[g], tiles) : 0
      job.step = 'fee'
      return
    }
    case 'fee': {
      const units = Math.min(job.fee - t!.fee, stock.coins ?? 0, hands('coins'), fits('coins'))
      if (units > 0) return take(here, 'coins', units, 'carriage')
      return collected(world, job, t!)
    }
    case 'load': {
      const want = t!.units - job.units
      const units = Math.min(want, stock[g] ?? 0, hands(g), fits(g))
      if (units > 0) return take(here, g, units, 'carriage')
      // Nothing to load yet: it waits at the warehouse for its stock.
      if (job.units === 0 && want > 0) return
      job.step = 'deliver'
      return
    }
    case 'deliver': {
      job.target ??= job.units
      const units = Math.min(job.units, hands(g))
      if (units > 0) return off(g, units, false)
      if (job.robbed > 0) return sendAgain(world, job, t!, b)
      arrived(world, job, t!, b)
      job.step = 'return'
      return
    }
    case 'return': {
      const units = Math.min(job.units, hands(g))
      if (units > 0) return off(g, units, false)
      const coins = Math.min(job.coins, hands('coins'))
      if (coins > 0) return off('coins', coins, true)
      return finish(caravan)
    }
  }
}

/**
 * The caravan has what it collected at the sender's storage, with the fee: the transfer is for
 * what it took, and it sets off for the recipient's storage.
 */
function collected(world: WorldState, job: TransferJob, t: Transfer): void {
  const units = job.units + job.robbed
  if (units === 0) return nothing(world, job, t)
  t.units = units
  job.target = null
  job.step = 'deliver'
}

/**
 * The sender's storage held none of the good, or not the fee for one, or the sender's city is
 * gone before anything was taken: the transfer is dropped, with a line in the sender's log.
 */
function nothing(world: WorldState, job: TransferJob, t: Transfer): void {
  drop(world, t)
  job.step = 'return'
  const cityId = job.fromCityId ?? t.toCityId
  recordEvent(world, t.realmId, {
    kind: 'transferStuck',
    why: 'nothing',
    good: t.good,
    units: t.units,
    cityId,
    city: cityName(world, cityId),
  })
}

/** The line a transfer put into storage `b` leaves in both realms' logs (the sender's, going back). */
function logArrived(world: WorldState, t: Transfer, units: number, b: Building): void {
  const what = {
    kind: 'transferred' as const,
    good: t.good,
    units,
    fee: t.fee,
    fromRealmId: t.realmId,
    fromRealm: realmName(world, t.realmId),
    toRealmId: t.toRealmId,
    toRealm: realmName(world, t.toRealmId),
    back: t.back,
    cityId: t.toCityId,
    city: cityName(world, t.toCityId),
    x: b.x,
    y: b.y,
  }
  recordEvent(world, t.realmId, what)
  if (!t.back) recordEvent(world, t.toRealmId, what)
}

/** A transfer's goods are all in the storage `b`: it is done. */
function arrived(world: WorldState, job: TransferJob, t: Transfer, b: Building): void {
  drop(world, t)
  logArrived(world, t, job.target ?? 0, b)
}

/**
 * Robbers took some of a transfer off the caravan, which put the rest into the storage `b` (none
 * when it had nothing left to bring): the Trade Organization sends what was taken again out of
 * the warehouse's stock (`CONTEXT.md`: Guaranteed carriage). The transfer waits for the next
 * caravan, and this caravan goes back to its route.
 */
function sendAgain(world: WorldState, job: TransferJob, t: Transfer, b?: Building): void {
  if (b && (job.target ?? 0) > 0) logArrived(world, t, job.target!, b)
  recordEvent(world, t.realmId, {
    kind: 'transferStuck',
    why: 'robbed',
    good: t.good,
    units: job.robbed,
    cityId: t.toCityId,
    city: cityName(world, t.toCityId),
  })
  t.units = job.robbed
  t.fromCityId = null
  t.caravanId = null
  job.robbed = 0
  job.step = 'return'
}

/**
 * Robbers took goods off `caravan`'s carriage (`CONTEXT.md`: Guaranteed carriage): what its
 * transfer job counts on board is cut down to what is left. Units it collected at the sender's
 * storage or carries to the recipient's count as `robbed`, to be made good; taken while it loads,
 * it loads again; the fee's coins are the Trade Organization's loss.
 */
export function transferRobbed(caravan: Caravan, carriage: Carriage): void {
  const job = caravan.transfer
  if (!job) return
  const before = job.units
  countOnBoard(job, carriage)
  const lost = before - job.units
  if (job.step === 'collect' || job.step === 'fee' || job.step === 'deliver') job.robbed += lost
  // What was put into the storage is the rest: the target less what was taken.
  if (job.step === 'deliver' && job.target !== null) job.target -= lost
}

/**
 * Whether resident `r` takes from storage `storageId` for a transfer (`CONTEXT.md`: Transfer):
 * they drive a caravan collecting a transfer, or its fee, there, so it is no theft.
 */
export function collectsTransferFrom(world: WorldState, r: Resident, storageId: string): boolean {
  const job = world.caravans.find((c) => c.driverId === r.id)?.transfer
  if (job?.step !== 'collect' && job?.step !== 'fee') return false
  return job.fromCityId !== null && deliveryStorage(world, job.fromCityId)?.id === storageId
}

/**
 * Transfers hold together (`CONTEXT.md`: Transfer; ADR 0004): each is for a whole, positive
 * number of units within one load, with a whole fee of at least 0, between two realms unless it
 * goes back; one a caravan carries out is that caravan's job, and no caravan's job is for a
 * transfer another carries out or for one gone before its goods reached the storage; a caravan
 * carries out a delivery or a transfer, never both; what it counts on board for its transfer is
 * on its carriage, but for Food its crew may have eaten; and what it counts robbed is a whole
 * number, no more than its transfer is for.
 */
export const transfersSound: Invariant = {
  name: 'transfers-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message, entityIds: [id] })
    for (const t of world.transfers) {
      if (!Number.isInteger(t.units) || t.units <= 0) {
        fail(t.id, `transfer ${t.id} is for ${t.units} units`)
      }
      if (t.units > transferLoad(t.good)) fail(t.id, `transfer ${t.id} is more than one load`)
      if (!Number.isInteger(t.fee) || t.fee < 0)
        fail(t.id, `transfer ${t.id} has a fee of ${t.fee}`)
      if (!t.back && t.realmId === t.toRealmId) fail(t.id, `transfer ${t.id} goes to its sender`)
      if (t.caravanId === null) continue
      const c = world.caravans.find((x) => x.id === t.caravanId)
      if (c?.transfer?.transferId !== t.id) {
        fail(t.id, `transfer ${t.id} is carried out by ${t.caravanId}, whose job is another`)
      }
    }
    for (const c of world.caravans) {
      const job = c.transfer
      if (!job) continue
      if (c.job) fail(c.id, `caravan ${c.id} carries out a delivery and a transfer at once`)
      const t = world.transfers.find((x) => x.id === job.transferId)
      if (job.step !== 'return' && t?.caravanId !== c.id) {
        fail(c.id, `caravan ${c.id} carries out ${job.transferId}, which isn't its own`)
      }
      const k = world.carriages.find((x) => x.id === c.carriageId)
      const load = k?.load ?? {}
      const coins = job.coins + (job.good === 'coins' ? job.units : 0)
      // The crew eat the Food on board, a transfer's too.
      const short = job.good !== 'food' && job.good !== 'coins' && job.units > (load[job.good] ?? 0)
      if (short || coins > (load.coins ?? 0)) {
        fail(c.id, `caravan ${c.id} counts more on board for its transfer than its carriage holds`)
      }
      if (stockWeight({ [job.good]: job.units }) > DELIVERY_LOAD + 1e-9) {
        fail(c.id, `caravan ${c.id} carries more than one load for its transfer`)
      }
      if (!Number.isInteger(job.robbed) || job.robbed < 0 || (t && job.robbed > t.units)) {
        fail(c.id, `caravan ${c.id} counts ${job.robbed} units robbed, not within its transfer`)
      }
    }
    return out
  },
}
