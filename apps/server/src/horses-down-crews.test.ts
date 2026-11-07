import {
  AVERAGE_HORSE_STATS,
  MAX_HUNGER,
  NPC_VILLAGE,
  Terrain,
  type Caravan,
  type Carriage,
  type Horse,
  type Resident,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { leaveTradeOrg, placeCaravans, routeEnd } from './caravans.js'
import { setup as deliveryWorld, order as deliveryOrder } from './deliveries.fixture.js'
import { horsesDownLieStill } from './horses.js'
import { checkInvariants } from './invariants.js'
import { foundNpcCity } from './npc-cities.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { placeTraders } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { setup as transferWorld, order as transferOrder } from './transfers.fixture.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * Walking in a busy world (bug #993): the pathfinder's time for this tick (`PATH_BUDGET_MS`) goes on
 * others' searches, so a search started now doesn't settle within the tick.
 */
function busyWalking(terrain: TerrainMap): Walking {
  const walking = new Walking(terrain)
  const requestSteps = walking.requestSteps.bind(walking)
  walking.requestSteps = (world) => requestSteps(world, 0)
  return walking
}

/** The Trade Org HQ, a far trading post, its caravan and the HQ's traders. */
function fixture() {
  const terrain = plains(1024)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  foundTradeOrgHq(world, terrain, 128, 128, rand)
  const post = foundTradingPost(world, terrain, 700, 700, undefined, rand)
  const [caravan] = placeCaravans(world)
  placeTraders(world, terrain.size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  return { world, terrain, post, caravan: caravan!, trader: world.traders[0]! }
}

const crewOf = (world: WorldState, convoy: Caravan | Trader): Resident[] =>
  [convoy.driverId, ...convoy.escortIds].map((id) => world.residents.find((r) => r.id === id)!)

/** A convoy's carriage, hitched horse and crew all stand on (x, y), with `load` on board. */
function standOn(
  world: WorldState,
  convoy: Caravan | Trader,
  x: number,
  y: number,
  load: Carriage['load'] = { goldOre: 40 },
): { carriage: Carriage; horse: Horse; driver: Resident } {
  const carriage = world.carriages.find((k) => k.id === convoy.carriageId)!
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  const crew = crewOf(world, convoy)
  for (const thing of [carriage, horse, ...crew]) {
    thing.x = x
    thing.y = y
    if ('order' in thing) thing.order = null
  }
  carriage.load = load
  return { carriage, horse, driver: crew[0]! }
}

/** The horse goes Down next tick: its meter is empty and its health all but gone. */
function starving(horse: Horse) {
  horse.hunger = 0
  horse.health = 1e-9
}

/** Steps the world `ticks` times with its people fed, checking the invariant after each tick. */
function run(world: WorldState, terrain: TerrainMap, walking: Walking, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, terrain, walking)
    expect(horsesDownLieStill.check(world, terrain)).toEqual([])
  }
}

/** More drives than any crew tries before it gives a stop up. */
const TICKS = 30

describe('a caravan whose horse is Down (`CONTEXT.md`: Down; bug #993)', () => {
  it('stands on the road with its load, its driver given no drive order', () => {
    const { world, terrain, caravan } = fixture()
    const { carriage, horse, driver } = standOn(world, caravan, 400, 400)
    caravan.heading = 'post'
    caravan.stop = 'storage'
    starving(horse)
    run(world, terrain, busyWalking(terrain), TICKS)
    expect(horse.downUntil).toBeDefined()
    expect(driver.order).toBeNull()
    expect(carriage).toMatchObject({ x: 400, y: 400, horseId: horse.id, load: { goldOre: 40 } })
    expect(caravan).toMatchObject({ heading: 'post', stop: 'storage' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('still loads at a stop, so Food put on board wakes the horse and it drives on', () => {
    const { world, terrain, caravan } = fixture()
    const storage = routeEnd(world, caravan, 'hq').storage!
    storage.stock = { ...storage.stock, food: 500 }
    const { carriage, horse } = standOn(world, caravan, storage.x, storage.y, {})
    caravan.heading = 'hq'
    caravan.stop = 'storage'
    starving(horse)
    const walking = new Walking(terrain)
    run(world, terrain, walking, 3)
    expect(carriage.load.food ?? 0).toBeGreaterThan(0)
    expect(horse.downUntil).toBeUndefined()
    const from = { x: carriage.x, y: carriage.y }
    run(world, terrain, walking, 400)
    expect({ x: carriage.x, y: carriage.y }).not.toEqual(from)
  })

  it('drives on once the horse has eaten where it lay', () => {
    const { world, terrain, caravan } = fixture()
    const { carriage, horse, driver } = standOn(world, caravan, 400, 400)
    caravan.heading = 'post'
    caravan.stop = 'storage'
    starving(horse)
    const walking = new Walking(terrain)
    run(world, terrain, walking, TICKS)
    expect(driver.order).toBeNull()
    world.piles.push({ x: 400, y: 400, goods: { food: 2 } })
    run(world, terrain, walking, 200)
    expect(horse.downUntil).toBeUndefined()
    expect(carriage.x).toBeGreaterThan(400)
  })

  it('keeps its delivery: no drive counts as ending short, so it doesn’t turn back', () => {
    const { world, terrain, caravan, queue, city } = deliveryWorld()
    expect(deliveryOrder(world, queue, { kind: 'buy', good: 'iron', units: 4, cityId: city.id })).toBe(
      'ack',
    )
    const walking = new Walking(terrain)
    run(world, terrain, walking, 1)
    const from = world.buildings.find((b) => b.id === world.deliveries[0]!.warehouseId)!
    const { horse, carriage, driver } = standOn(world, caravan, from.x, from.y, {})
    caravan.heading = routeEnd(world, caravan, 'hq').warehouse === from ? 'hq' : 'post'
    caravan.stop = 'warehouse'
    for (let i = 0; i < 100 && caravan.job?.step !== 'deliver'; i++) run(world, terrain, walking, 1)
    const job = caravan.job!
    expect(job.step).toBe('deliver')
    delete carriage.load.food
    starving(horse)
    run(world, terrain, walking, 1)
    const { misses } = job
    run(world, terrain, walking, TICKS)
    expect(horse.downUntil).toBeDefined()
    expect(caravan.job).toBe(job)
    expect(job).toMatchObject({ step: 'deliver', misses })
    expect(world.deliveries[0]!.caravanId).toBe(caravan.id)
    expect(driver.order).toBeNull()
  })

  it('keeps its transfer: no drive counts as ending short, so it doesn’t turn back', () => {
    const { world, terrain, caravan, warehouse, queue, city, toCity, storage } = transferWorld()
    storage.stock!.iron = 100
    const transfer = {
      kind: 'transfer',
      fromCityId: city.id,
      toCityId: toCity.id,
      good: 'iron',
      units: 12,
    }
    expect(transferOrder(world, queue, transfer)).toBe('ack')
    const { horse, carriage, driver } = standOn(world, caravan, warehouse.x, warehouse.y, {})
    caravan.heading = 'post'
    caravan.stop = 'warehouse'
    const walking = new Walking(terrain)
    for (let i = 0; i < 100 && !caravan.transfer; i++) run(world, terrain, walking, 1)
    const job = caravan.transfer!
    expect(job).toBeDefined()
    delete carriage.load.food
    starving(horse)
    run(world, terrain, walking, 1)
    const { misses, step } = job
    run(world, terrain, walking, TICKS)
    expect(horse.downUntil).toBeDefined()
    expect(caravan.transfer).toBe(job)
    expect(job).toMatchObject({ step, misses })
    expect(world.transfers[0]!.caravanId).toBe(caravan.id)
    expect(driver.order).toBeNull()
  })
})

describe('a wandering trader whose horse is Down (`CONTEXT.md`: Down; bug #993)', () => {
  it('stands on the road and doesn’t give up its next stop', () => {
    const { world, terrain, trader, post } = fixture()
    const { carriage, horse, driver } = standOn(world, trader, 400, 400)
    trader.postId = post.id
    trader.heading = 'post'
    trader.stop = 'storage'
    trader.misses = 0
    starving(horse)
    run(world, terrain, new Walking(terrain), TICKS)
    expect(horse.downUntil).toBeDefined()
    expect(trader).toMatchObject({ postId: post.id, heading: 'post', stop: 'storage', misses: 0 })
    expect(driver.order).toBeNull()
    expect(carriage).toMatchObject({ x: 400, y: 400 })
  })

  it('doesn’t give up a stop at a city on its way', () => {
    const { world, terrain, trader } = fixture()
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 500, 400, mulberry32(9))
    const { horse, driver } = standOn(world, trader, 400, 400)
    trader.heading = 'post'
    trader.stop = 'storage'
    trader.misses = 0
    trader.calls = []
    trader.stand = { cityId: city.id, x: 490, y: 410, until: null }
    starving(horse)
    run(world, terrain, new Walking(terrain), TICKS)
    expect(trader.stand).toMatchObject({ cityId: city.id, until: null })
    expect(trader.misses).toBe(0)
    expect(driver.order).toBeNull()
  })

  it('doesn’t give up driving to a lost post', () => {
    const { world, terrain, trader, post } = fixture()
    const { horse, driver } = standOn(world, trader, 400, 400)
    trader.postId = post.id
    trader.heading = 'post'
    trader.misses = 0
    leaveTradeOrg(world, post)
    starving(horse)
    run(world, terrain, new Walking(terrain), TICKS)
    expect(trader).toMatchObject({ postId: post.id, heading: 'post', misses: 0 })
    expect(driver.order).toBeNull()
  })
})
