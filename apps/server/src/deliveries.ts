import {
  DELIVERY_DRIVE_TRIES,
  DELIVERY_LOAD,
  STANDING_TRADE_COINS_PER_POINT,
  TRADE_ORG,
  GOOD_WEIGHT,
  deliveryStorage,
  quotePickUp,
  stockWeight,
  tradeCoinWarehouse,
  unitsThatFit,
  unitsThatFitCarriage,
  wrapDistance,
  type Building,
  type Caravan,
  type CaravanJob,
  type Carriage,
  type Delivery,
  type Good,
  type GoodsSpot,
  type Resident,
  type WorldState,
  isAt,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { raiseStandingBothWays } from './standing.js'

/*
 * Deliveries (`CONTEXT.md`: Delivery): a caravan standing at a warehouse takes on the oldest
 * delivery or pick-up ordered there and carries it out instead of going on along its route
 * (`CaravanJob`), then goes back to its route. Like the route, each step is one drive, pick-up or
 * drop order of the driver's, which request actions like a Player's do (ADR 0002).
 */

/**
 * Has `caravan`, standing at `warehouse`, take on the oldest delivery there that waits for a
 * caravan. Returns whether it took one.
 */
export function takeOnDelivery(world: WorldState, caravan: Caravan, warehouse: Building): boolean {
  const d = world.deliveries.find((x) => x.caravanId === null && x.warehouseId === warehouse.id)
  if (!d) return false
  d.caravanId = caravan.id
  caravan.job = {
    deliveryId: d.id,
    kind: d.kind,
    warehouseId: d.warehouseId,
    good: d.good,
    step: 'load',
    units: 0,
    coins: 0,
    target: null,
    toPay: 0,
    paid: 0,
    fee: 0,
    misses: 0,
    robbed: 0,
  }
  return true
}

/** Lets go of a caravan's delivery, which waits for the next caravan (a caravan that broke up). */
export function releaseDelivery(world: WorldState, caravan: Caravan): void {
  const d = world.deliveries.find((x) => x.id === caravan.job?.deliveryId)
  if (d?.caravanId === caravan.id) d.caravanId = null
}

/** The delivery a caravan's job is for, while it is still owed. */
const deliveryOf = (world: WorldState, job: CaravanJob): Delivery | undefined =>
  world.deliveries.find((d) => d.id === job.deliveryId)

/** Drops a delivery that is done or cancelled. */
function drop(world: WorldState, d: Delivery): void {
  world.deliveries = world.deliveries.filter((x) => x !== d)
}

/** The building a job's step happens at: the warehouse, its coin warehouse or the city's storage. */
function stepBuilding(world: WorldState, job: CaravanJob): Building | undefined {
  const warehouse = world.buildings.find((b) => b.id === job.warehouseId)
  if (!warehouse) return undefined
  if (job.step === 'returnCoins' || (job.step === 'load' && job.kind === 'pickUp')) {
    return tradeCoinWarehouse(world, warehouse)
  }
  if (job.step === 'load' || job.step === 'return') return warehouse
  const d = deliveryOf(world, job)
  return d && deliveryStorage(world, d.cityId)
}

/** Ends a caravan's job: it goes back to its route, at this end's storage first. */
function finish(caravan: Caravan): void {
  caravan.job = null
  caravan.stop = 'storage'
}

/**
 * The caravan turns back to the warehouse with what it carries for its delivery (`return`). When
 * the city is no longer the realm's, the delivery is cancelled; otherwise it waits for the next
 * caravan. Either way with a line in the realm log.
 */
function turnBack(world: WorldState, caravan: Caravan, job: CaravanJob, d: Delivery): void {
  const city = world.cities.find((c) => c.id === d.cityId)
  const cancelled = city?.realmId !== d.realmId
  if (cancelled) drop(world, d)
  else d.caravanId = null
  job.step = 'return'
  job.misses = 0
  recordEvent(world, d.realmId, {
    kind: 'deliveryStuck',
    delivery: d.kind,
    good: d.good,
    units: d.units,
    cityId: d.cityId,
    city: city?.name ?? 'a lost city',
    cancelled,
  })
}

/**
 * One tick of a caravan carrying out a delivery (`CaravanJob`), its driver idle with the carriage
 * and `holding` what they took last tick for it. At each step it drives to the step's building,
 * then takes and puts one load a tick; a drive to the city's storage that ends short of it
 * `DELIVERY_DRIVE_TRIES` times turns it back, as does a city that is no longer the realm's or has
 * no storage. `size` is the map's.
 */
export function runDelivery(
  world: WorldState,
  caravan: Caravan,
  driver: Resident,
  carriage: Carriage,
  size: number,
): void {
  const job = caravan.job!
  job.units = Math.min(job.units, carriage.load[job.good] ?? 0)
  job.coins = Math.min(job.coins, carriage.load.coins ?? 0)
  const d = deliveryOf(world, job)
  const atStorage = job.step === 'deliver' || job.step === 'collect' || job.step === 'pay'
  if (atStorage && !d) {
    job.step = 'return'
    return
  }
  if (atStorage && d) {
    const city = world.cities.find((c) => c.id === d.cityId)
    const gone = city?.realmId !== d.realmId || !deliveryStorage(world, d.cityId)
    // Halfway through paying it pays what it has paid and is done, as when the storage went.
    if (gone && job.step === 'pay') return paidUp(world, job, d)
    if (gone) return turnBack(world, caravan, job, d)
  }
  // Robbed of all it carried for a delivery, it has nothing left to bring.
  if (job.step === 'deliver' && d && job.units === 0 && job.robbed > 0 && !caravan.holding) {
    return sendAgain(world, job, d, deliveryStorage(world, d.cityId))
  }
  const b = stepBuilding(world, job)
  if (!b) return finish(caravan)
  if (!isAt(driver, b)) {
    if (atStorage && job.misses >= DELIVERY_DRIVE_TRIES) return turnBack(world, caravan, job, d!)
    job.misses++
    const target = { x: b.x, y: b.y }
    driver.order = { kind: 'drive', carriageId: carriage.id, target, path: null, progress: 0 }
    return
  }
  job.misses = 0
  const here: GoodsSpot = { kind: 'storage', storageId: b.id }
  const onCarriage: GoodsSpot = { kind: 'carriage', carriageId: carriage.id }
  // What the job counts on board changes with each order that puts onto or takes off the
  // carriage, so it matches the carriage once the tick's actions are resolved.
  const count = (good: Good, units: number) => {
    if (good === 'coins') job.coins += units
    else job.units += units
  }
  if (caravan.holding) {
    const { goods, onto } = caravan.holding
    caravan.holding = null
    const [good, wanted] = (Object.entries(goods) as [Good, number][])[0]!
    const fits = onto === 'carriage' ? unitsThatFitCarriage(world, carriage, good) : Infinity
    const units = Math.min(wanted, driver.carried[good] ?? 0, fits)
    if (units > 0) {
      const to = onto === 'carriage' ? onCarriage : here
      driver.order = { kind: 'drop', to, goods: { [good]: units } }
      if (onto === 'carriage') count(good, units)
      if (good === 'coins' && job.step === 'pay') job.paid += units
      return
    }
  }
  const stock = b.stock ?? {}
  const hands = (g: Good) => unitsThatFit(driver, g, world.tick)
  const take = (from: GoodsSpot, good: Good, units: number, onto: 'carriage' | 'stop') => {
    driver.order = { kind: 'pickUp', from, goods: { [good]: units } }
    caravan.holding = { goods: { [good]: units }, onto }
    if (from.kind === 'carriage') count(good, -units)
  }
  const g = job.good
  const tiles = (storage: Building) => {
    const warehouse = world.buildings.find((x) => x.id === job.warehouseId)
    return warehouse ? wrapDistance(size, warehouse, storage) : 0
  }
  switch (job.step) {
    case 'load': {
      if (job.kind === 'delivery') {
        const want = (d?.units ?? 0) - job.units
        const units = Math.min(
          want,
          stock[g] ?? 0,
          hands(g),
          unitsThatFitCarriage(world, carriage, g),
        )
        if (units > 0) return take(here, g, units, 'carriage')
        // Nothing to load yet: it waits at the warehouse for its stock.
        if (job.units === 0 && want > 0 && (stock[g] ?? 0) === 0) return
        job.step = 'deliver'
        return
      }
      // A pick-up loads the coins its goods fetch at the warehouse's prices now, or, robbed while
      // it paid, what it has still to pay.
      const paying = job.target !== null
      const storage = d && deliveryStorage(world, d.cityId)
      const warehouse = world.buildings.find((x) => x.id === job.warehouseId)
      const need = paying
        ? job.toPay - job.paid
        : d && storage && warehouse
          ? quotePickUp(world, warehouse, g, d.units, d.units, tiles(storage), Infinity).coins
          : 0
      const units = Math.min(
        need - job.coins,
        stock.coins ?? 0,
        hands('coins'),
        unitsThatFitCarriage(world, carriage, 'coins'),
      )
      if (units > 0) return take(here, 'coins', units, 'carriage')
      // With no coins to pay with, it waits at the coin warehouse for some.
      if (paying && need > 0 && job.coins === 0) return
      job.step = paying ? 'pay' : 'collect'
      return
    }
    case 'deliver': {
      job.target ??= job.units
      const units = Math.min(job.units, hands(g))
      if (units > 0) return take(onCarriage, g, units, 'stop')
      if (job.robbed > 0) return sendAgain(world, job, d!, b)
      deliveredAll(world, job, d!, b)
      job.step = 'return'
      return
    }
    case 'collect': {
      const warehouse = world.buildings.find((x) => x.id === job.warehouseId)
      if (job.target === null) {
        const q = warehouse
          ? quotePickUp(world, warehouse, g, d!.units, stock[g] ?? 0, tiles(b), job.coins)
          : { units: 0 }
        job.target = Math.min(q.units, unitsThatFitCarriage(world, carriage, g))
      }
      // What robbers took off the carriage was collected all the same.
      const collected = job.units + job.robbed
      const units = Math.min(
        job.target - collected,
        stock[g] ?? 0,
        hands(g),
        unitsThatFitCarriage(world, carriage, g),
      )
      if (units > 0) return take(here, g, units, 'carriage')
      const q = warehouse
        ? quotePickUp(world, warehouse, g, collected, collected, tiles(b), Infinity)
        : { coins: 0, fee: 0 }
      job.toPay = q.coins
      job.fee = q.fee
      job.step = 'pay'
      return
    }
    case 'pay': {
      const units = Math.min(job.toPay - job.paid, job.coins, hands('coins'))
      if (units > 0) return take(onCarriage, 'coins', units, 'stop')
      // Short of coins (robbed, or the price rose), it fetches the rest at the coin warehouse.
      if (job.paid < job.toPay && job.coins === 0) {
        job.step = 'load'
        return
      }
      return paidUp(world, job, d!)
    }
    case 'return': {
      const units = Math.min(job.units, hands(g))
      if (units > 0) return take(onCarriage, g, units, 'stop')
      if (job.coins > 0) job.step = 'returnCoins'
      else finish(caravan)
      return
    }
    case 'returnCoins': {
      const units = Math.min(job.coins, hands('coins'))
      if (units > 0) return take(onCarriage, 'coins', units, 'stop')
      return finish(caravan)
    }
  }
}

/** A delivery's goods are all in the city's storage `b`: it is done. */
function deliveredAll(world: WorldState, job: CaravanJob, d: Delivery, b: Building): void {
  drop(world, d)
  recordEvent(world, d.realmId, {
    kind: 'delivered',
    delivery: 'delivery',
    good: d.good,
    units: job.target ?? 0,
    coins: 0,
    fee: d.fee,
    cityId: d.cityId,
    city: world.cities.find((c) => c.id === d.cityId)?.name ?? '',
    x: b.x,
    y: b.y,
  })
}

/**
 * Robbers took some of a delivery off the caravan, which put the rest into the city's storage `b`
 * (none when it had nothing left to bring): the Trade Organization sends what was taken again
 * (`CONTEXT.md`: Guaranteed carriage). The delivery waits for the next caravan, the warehouse
 * keeping its goods for it, and this caravan goes back to its route.
 */
function sendAgain(world: WorldState, job: CaravanJob, d: Delivery, b?: Building): void {
  const city = world.cities.find((c) => c.id === d.cityId)?.name ?? ''
  if (b && (job.target ?? 0) > 0) {
    recordEvent(world, d.realmId, {
      kind: 'delivered',
      delivery: 'delivery',
      good: d.good,
      units: job.target!,
      coins: 0,
      fee: d.fee,
      cityId: d.cityId,
      city,
      x: b.x,
      y: b.y,
    })
  }
  recordEvent(world, d.realmId, {
    kind: 'deliveryRobbed',
    good: d.good,
    units: job.robbed,
    cityId: d.cityId,
    city,
  })
  d.units = job.robbed
  d.caravanId = null
  job.robbed = 0
  job.step = 'return'
}

/**
 * Robbers took goods off `caravan`'s carriage (`CONTEXT.md`: Guaranteed carriage): what its job
 * counts on board is cut down to what is left. Units of a delivery on the way to the storage, or
 * of a pick-up after it collected them, count as `robbed`; coins of a pick-up on the way to
 * collect are fetched again at the coin warehouse first. Taken while it loads, it loads again.
 */
export function deliveryRobbed(caravan: Caravan, carriage: Carriage): void {
  const job = caravan.job
  if (!job) return
  const units = Math.min(job.units, carriage.load[job.good] ?? 0)
  const coins = Math.min(job.coins, carriage.load.coins ?? 0)
  const lost = job.units - units
  const coinsLost = job.coins - coins
  job.units = units
  job.coins = coins
  const collected =
    job.kind === 'pickUp' && job.target !== null && ['load', 'collect', 'pay'].includes(job.step)
  if (job.step === 'deliver' || collected) job.robbed += lost
  // What was put into the storage is the rest: the target less what was taken.
  if (job.step === 'deliver' && job.target !== null) job.target -= lost
  if (coinsLost > 0 && job.step === 'collect' && job.target === null) job.step = 'load'
}

/** A pick-up is paid for: it is done, and the caravan brings the goods to the warehouse. */
function paidUp(world: WorldState, job: CaravanJob, d: Delivery): void {
  drop(world, d)
  // Paying for goods sold is trade, which raises standing (`CONTEXT.md`: Standing).
  if (job.paid > 0) {
    const points = job.paid / STANDING_TRADE_COINS_PER_POINT
    raiseStandingBothWays(world, d.realmId, TRADE_ORG, points)
  }
  const storage = deliveryStorage(world, d.cityId)
  recordEvent(world, d.realmId, {
    kind: 'delivered',
    delivery: 'pickUp',
    good: d.good,
    units: job.units + job.robbed,
    coins: job.paid,
    fee: job.fee,
    cityId: d.cityId,
    city: world.cities.find((c) => c.id === d.cityId)?.name ?? '',
    x: storage?.x ?? 0,
    y: storage?.y ?? 0,
  })
  job.step = 'return'
}

/**
 * Whether resident `r` takes from storage `storageId` for a pick-up (`CONTEXT.md`: Delivery):
 * they drive a caravan collecting there, so it is no theft.
 */
export function collectsFrom(world: WorldState, r: Resident, storageId: string): boolean {
  const job = world.caravans.find((c) => c.driverId === r.id)?.job
  if (job?.step !== 'collect') return false
  const d = deliveryOf(world, job)
  return d !== undefined && deliveryStorage(world, d.cityId)?.id === storageId
}

/**
 * Deliveries hold together (`CONTEXT.md`: Delivery; ADR 0004): each is for a whole, positive
 * number of units within one delivery load, with a fee of at least 0; one a caravan carries out
 * is that caravan's job, and no caravan's job is for a delivery another carries out or for one
 * gone before its goods reached the storage; what a caravan counts on board for its job is on
 * its carriage, but for Food its crew may have eaten; and what it counts robbed is a whole
 * number, no more than its delivery is for.
 */
export const deliveriesSound: Invariant = {
  name: 'deliveries-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const fail = (id: string, message: string) =>
      out.push({ invariant: this.name, message, entityIds: [id] })
    for (const d of world.deliveries) {
      if (!Number.isInteger(d.units) || d.units <= 0)
        fail(d.id, `delivery ${d.id} is for ${d.units} units`)
      if (d.units * GOOD_WEIGHT[d.good] > DELIVERY_LOAD + 1e-9) {
        fail(d.id, `delivery ${d.id} weighs more than one delivery load`)
      }
      if (!(d.fee >= 0)) fail(d.id, `delivery ${d.id} has a fee of ${d.fee}`)
      if (d.caravanId === null) continue
      const c = world.caravans.find((x) => x.id === d.caravanId)
      if (c?.job?.deliveryId !== d.id) {
        fail(d.id, `delivery ${d.id} is carried out by ${d.caravanId}, whose job is another`)
      }
    }
    for (const c of world.caravans) {
      const job = c.job
      if (!job) continue
      const d = world.deliveries.find((x) => x.id === job.deliveryId)
      const owed = ['load', 'deliver', 'collect', 'pay'].includes(job.step)
      if (owed && d?.caravanId !== c.id) {
        fail(c.id, `caravan ${c.id} carries out ${job.deliveryId}, which isn't its own`)
      }
      const k = world.carriages.find((x) => x.id === c.carriageId)
      const load = k?.load ?? {}
      // The crew eat the Food on board, a delivery's too.
      const short = job.good !== 'food' && job.units > (load[job.good] ?? 0)
      if (short || job.coins > (load.coins ?? 0)) {
        fail(c.id, `caravan ${c.id} counts more on board for its delivery than its carriage holds`)
      }
      if (stockWeight({ [job.good]: job.units }) > DELIVERY_LOAD + 1e-9) {
        fail(c.id, `caravan ${c.id} carries more than one delivery load for its delivery`)
      }
      if (!Number.isInteger(job.robbed) || job.robbed < 0 || (d && job.robbed > d.units)) {
        fail(c.id, `caravan ${c.id} counts ${job.robbed} units robbed, not within its delivery`)
      }
    }
    return out
  },
}
