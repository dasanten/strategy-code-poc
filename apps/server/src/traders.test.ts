import {
  AVERAGE_HORSE_STATS,
  CARAVAN_FOOD,
  CARAVAN_SPREAD,
  CARRIAGE_CAPACITY,
  TRADERS,
  TRADER_DRIVE_TRIES,
  TRADER_ESCORTS,
  Terrain,
  crewIdsOf,
  driveOffProblem,
  stockWeight,
  townHallOf,
  wrapDistance,
  type Good,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { hqEnd, leaveTradeOrg, postEnd } from './caravans.js'
import { resolveCarrying } from './carrying.js'
import { nothingLeftOfTheHq } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity } from './starting-city.js'
import { takeOver } from './stealing.js'
import { die } from './survival.js'
import { worldWithPost } from './test-terrain.js'
import { foundTradeOrgHq, hqLayout, tradeOrgHq } from './trade-org.js'
import { evenOutLoad, placeTraders, stepTraders, tradersSound } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** Where the fixture's trading posts stand, in the order they are founded. */
const SITES: readonly [number, number][] = [
  [220, 128],
  [220, 220],
  [128, 220],
]

/** The Trade Org HQ at (128, 128) and a trading post on each of `sites`, with the HQ's traders. */
function fixture(sites: readonly [number, number][] = SITES) {
  const terrain = plains(512)
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 128, 128, rand)
  const posts = sites.map(([x, y]) => foundTradingPost(world, terrain, x, y, undefined, rand))
  const traders = placeTraders(world, terrain.size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  return { world, terrain, hq, posts, traders, trader: traders[0]! }
}

const carriageOf = (world: WorldState, t: Trader) =>
  world.carriages.find((k) => k.id === t.carriageId)!

const crewOf = (world: WorldState, t: Trader) =>
  crewIdsOf(t).map((id) => world.residents.find((r) => r.id === id)!)

/** Stands a trader's carriage, its hitched horse and its crew on tile (x, y), out on its loop. */
function put(world: WorldState, t: Trader, x: number, y: number) {
  const carriage = carriageOf(world, t)
  const horse = world.horses.find((h) => h.id === carriage.horseId)!
  for (const thing of [carriage, horse, ...crewOf(world, t)]) {
    thing.x = x
    thing.y = y
  }
  for (const r of crewOf(world, t)) r.order = null
  t.heading = 'post'
}

/** Stands a trader at the warehouse of the post it is bound for, its Food topped up. */
function atWarehouse(world: WorldState, t: Trader) {
  const warehouse = postEnd(world, t.postId!).warehouse!
  put(world, t, warehouse.x, warehouse.y)
  t.stop = 'warehouse'
  carriageOf(world, t).load = { food: CARAVAN_FOOD }
  return warehouse
}

/** Every unit of a good in the world: in buildings, on carriages, carried and on the ground. */
function total(world: WorldState, good: Good): number {
  const stocks = [
    ...world.buildings.map((b) => b.stock ?? {}),
    ...world.carriages.map((k) => k.load),
    ...world.residents.map((r) => r.carried),
    ...world.piles.map((p) => p.goods),
  ]
  return stocks.reduce((n, s) => n + (s[good] ?? 0), 0)
}

function runUntil(world: WorldState, terrain: TerrainMap, done: () => boolean, ticks = 200) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && !done(); t++) stepWorld(world, terrain, walking)
  expect(done()).toBe(true)
}

describe('placing wandering traders', () => {
  it('gives each a carriage, a horse and a crew of the HQ at its goods warehouse', () => {
    const { world, terrain, hq, traders } = fixture()
    expect(world.traders).toEqual(traders)
    const hall = townHallOf(world, hq)!
    const [x, y] = hqLayout(hall.x + 1, hall.y + 1).goodsWarehouse
    for (const t of traders) {
      expect(t.escortIds).toHaveLength(TRADER_ESCORTS)
      expect(t.heading).toBe('hq')
      const carriage = carriageOf(world, t)
      expect(carriage).toMatchObject({ realmId: null, cityId: hq.id, x, y, load: {} })
      expect(world.horses.find((h) => h.id === carriage.horseId)).toMatchObject({ cityId: hq.id })
      for (const r of crewOf(world, t)) {
        expect(r).toMatchObject({ owner: null, cityId: hq.id, x, y })
      }
    }
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('sends them round one loop of all the posts, each from a different place on it', () => {
    const { posts, traders } = fixture()
    const all = posts.map((p) => p.id).sort()
    expect(traders).toHaveLength(posts.length)
    for (const t of traders) expect([...t.loop].sort()).toEqual(all)
    expect(new Set(traders.map((t) => t.loop.join())).size).toBe(1)
    expect(traders.map((t) => t.postId).sort()).toEqual(all)
  })

  it('sends no more than the balance says, however many posts there are', () => {
    const sites: [number, number][] = [
      [220, 128],
      [220, 220],
      [128, 220],
      [320, 128],
      [320, 220],
      [320, 320],
      [220, 320],
      [128, 320],
    ]
    expect(sites.length).toBeGreaterThan(TRADERS)
    const { traders, posts } = fixture(sites)
    expect(traders).toHaveLength(TRADERS)
    expect(new Set(traders.map((t) => t.postId)).size).toBe(TRADERS)
    expect(traders[0]!.loop).toHaveLength(posts.length)
  })

  it('goes round without crossing itself on a square of posts', () => {
    const { posts, trader, world, terrain } = fixture()
    const places = trader.loop.map((id) =>
      townHallOf(
        world,
        posts.find((p) => p.id === id)!,
      )!,
    )
    const legs = places.map((p, i) =>
      wrapDistance(terrain.size, p, places[(i + 1) % places.length]!),
    )
    // Three corners of a square: two sides and a diagonal, whichever way round.
    expect(Math.max(...legs)).toBeLessThan(140)
  })

  it('places none twice, and none without an HQ or with no post', () => {
    const { world, terrain } = fixture()
    expect(placeTraders(world, terrain.size)).toEqual([])
    const bare = createWorld(terrain)
    foundTradingPost(bare, terrain, 320, 320, undefined, mulberry32(1))
    expect(placeTraders(bare, terrain.size)).toEqual([])
    const lonely = createWorld(terrain)
    foundTradeOrgHq(lonely, terrain, 128, 128, mulberry32(1))
    expect(placeTraders(lonely, terrain.size)).toEqual([])
  })

  it('comes with a generated world', () => {
    const { world, terrain } = worldWithPost()
    const posts = world.cities.filter((c) => c.tradeOrg === 'post')
    expect(posts.length).toBeGreaterThan(0)
    expect(world.traders).toHaveLength(Math.min(TRADERS, posts.length))
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('evening out a load', () => {
  it('leaves half of what the load has more of and takes half of what it has less of', () => {
    const plan = evenOutLoad(
      { wood: 100, iron: 2, coins: 2_000, spear: 11 },
      { iron: 30, stone: 20, coins: 400 },
      0,
      CARRIAGE_CAPACITY,
    )
    expect(plan).toEqual({
      leave: { iron: 14, stone: 10 },
      take: { wood: 50, coins: 800, spear: 5 },
    })
  })

  it('evens out Food like any good, but keeps the Food the crew keep on board', () => {
    expect(evenOutLoad({ food: 60 }, { food: 72 }, 72, CARRIAGE_CAPACITY)).toEqual({
      leave: {},
      take: { food: 30 },
    })
    expect(evenOutLoad({ food: 10 }, { food: 102 }, 72, CARRIAGE_CAPACITY)).toEqual({
      leave: { food: 10 },
      take: {},
    })
    // Short of its own Food it leaves none, and takes as if it had no load of it.
    expect(evenOutLoad({ food: 10 }, { food: 40 }, 72, CARRIAGE_CAPACITY)).toEqual({
      leave: {},
      take: { food: 5 },
    })
  })

  it('takes only what the carriage holds, cutting every good by the same share', () => {
    const { take } = evenOutLoad(
      { wood: 2_000, stone: 2_000, spear: 400 },
      { food: CARAVAN_FOOD },
      CARAVAN_FOOD,
      CARRIAGE_CAPACITY,
    )
    const weight = stockWeight(take) + CARAVAN_FOOD
    expect(weight).toBeLessThanOrEqual(CARRIAGE_CAPACITY)
    expect(weight).toBeGreaterThan(CARRIAGE_CAPACITY - 10)
    expect(take.wood).toBe(take.stone)
    expect(take.spear).toBeGreaterThan(0)
  })

  it('counts on the room what it leaves there', () => {
    const { leave, take } = evenOutLoad({ stone: 100 }, { wood: 400 }, 0, 400)
    expect(leave).toEqual({ wood: 200 })
    expect(take).toEqual({ stone: 50 })
  })

  it('takes nothing with no room, even with a load over what its horse can pull', () => {
    expect(evenOutLoad({ wood: 100 }, { stone: 500 }, 0, 100).take).toEqual({})
  })
})

describe('a wandering trader at a post', () => {
  it('evens out with the warehouse, every good, and goes on to the next post', () => {
    const { world, terrain, trader } = fixture()
    const bound = trader.postId!
    const warehouse = atWarehouse(world, trader)
    const carriage = carriageOf(world, trader)
    warehouse.stock = { wood: 100, stone: 10, coins: 2_000, food: 40 }
    carriage.load = { food: CARAVAN_FOOD, stone: 30, iron: 30 }
    const before = { wood: total(world, 'wood'), coins: total(world, 'coins') }
    runUntil(world, terrain, () => trader.postId !== bound)
    expect(warehouse.stock).toMatchObject({
      wood: 50,
      stone: 20,
      iron: 15,
      coins: 1_000,
      food: 20,
    })
    expect(carriage.load).toMatchObject({
      wood: 50,
      stone: 20,
      iron: 15,
      coins: 1_000,
      food: CARAVAN_FOOD + 20,
    })
    expect(trader.loop[(trader.loop.indexOf(bound) + 1) % trader.loop.length]).toBe(trader.postId)
    expect(trader.heading).toBe('post')
    expect(trader.stop).toBe('storage')
    expect(trader.plan).toBeNull()
    // Nothing was made or lost, and moving its own stock is no theft.
    expect(total(world, 'wood')).toBe(before.wood)
    expect(total(world, 'coins')).toBe(before.coins)
    expect(world.crimes).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves what the warehouse keeps for a delivery alone', () => {
    const { world, terrain, trader } = fixture()
    const bound = trader.postId!
    const warehouse = atWarehouse(world, trader)
    warehouse.stock = { wood: 100 }
    world.deliveries.push({
      id: 'd',
      kind: 'delivery',
      realmId: 'someone',
      warehouseId: warehouse.id,
      cityId: 'somewhere',
      good: 'wood',
      units: 60,
      fee: 1,
      caravanId: null,
    })
    runUntil(world, terrain, () => trader.postId !== bound)
    expect(warehouse.stock.wood).toBe(80)
    expect(carriageOf(world, trader).load.wood).toBe(20)
  })

  it('tops up its Food at the storage first, then goes to the warehouse', () => {
    const { world, terrain, trader } = fixture()
    const { storage, warehouse } = postEnd(world, trader.postId!)
    put(world, trader, storage!.x, storage!.y)
    trader.stop = 'storage'
    storage!.stock = { food: 200 }
    runUntil(world, terrain, () => trader.stop === 'warehouse')
    expect(carriageOf(world, trader).load.food).toBe(CARAVAN_FOOD)
    expect(storage!.stock.food).toBe(200 - CARAVAN_FOOD)
    const walking = new Walking(terrain)
    stepWorld(world, terrain, walking)
    expect(crewOf(world, trader)[0]!.order).toMatchObject({
      kind: 'drive',
      target: { x: warehouse!.x, y: warehouse!.y },
    })
  })

  it('waits at the HQ until its escort is armed, as it won’t be back there soon', () => {
    const { world, terrain, trader } = fixture()
    const warehouse = hqEnd(world).warehouse!
    warehouse.stock = { ...warehouse.stock, spear: 0, sword: 0 }
    put(world, trader, warehouse.x, warehouse.y)
    trader.heading = 'hq'
    trader.stop = 'warehouse'
    const crew = crewOf(world, trader)
    const walking = new Walking(terrain)
    for (let t = 0; t < 10; t++) stepWorld(world, terrain, walking)
    expect(trader).toMatchObject({ heading: 'hq', stop: 'warehouse' })
    expect(crew[1]!.carried.spear).toBeUndefined()
    warehouse.stock.spear = 2
    runUntil(world, terrain, () => trader.heading === 'post')
    expect(crew.slice(1).every((r) => r.carried.spear === 1)).toBe(true)
    expect(warehouse.stock.spear ?? 0).toBe(0)
  })

  it('goes on after too many drives that end short, so one post can’t hold up the loop', () => {
    const { world, terrain, trader } = fixture()
    const bound = trader.postId!
    put(world, trader, 300, 300)
    trader.misses = TRADER_DRIVE_TRIES
    stepTraders(world, terrain.size)
    expect(trader.postId).not.toBe(bound)
    expect(trader.misses).toBe(0)
    expect(trader.loop).toContain(bound)
  })

  it(
    'is sent from the HQ with only its Food, armed, and makes its way round its loop',
    {
      tags: ['slow'],
      timeout: 240_000,
    },
    () => {
      const { world, terrain, posts, trader } = fixture()
      world.traders = [trader]
      const warehouses = posts.map((p) => postEnd(world, p.id).warehouse!)
      for (const w of warehouses) w.stock = { wood: 0 }
      const first = postEnd(world, trader.postId!).warehouse!
      first.stock = { wood: 200, coins: 800 }
      const arms = hqEnd(world).warehouse!
      arms.stock = { ...arms.stock, spear: 10 }
      const start = trader.postId!
      const carriage = carriageOf(world, trader)
      const reached: string[] = []
      const walking = new Walking(terrain)
      let farthest = 0
      for (let t = 0; t < 20_000 && reached.length < trader.loop.length + 1; t++) {
        const was = trader.heading === 'post' ? trader.postId : null
        stepWorld(world, terrain, walking)
        if (was !== null && trader.postId !== was) reached.push(was)
        if (trader.heading === 'post') {
          for (const id of trader.escortIds) {
            const r = world.residents.find((x) => x.id === id)!
            farthest = Math.max(farthest, wrapDistance(terrain.size, r, carriage))
          }
        }
        if (t % 500 === 0) expect(checkInvariants(world, terrain)).toEqual([])
      }
      // Round the whole loop, in its order, and to the first post again.
      const i = trader.loop.indexOf(start)
      const inOrder = trader.loop.map((_, n) => trader.loop[(i + n) % trader.loop.length])
      expect(reached).toEqual([...inOrder, start])
      // What the first post held has spread to the others.
      for (const w of warehouses) expect(w.stock?.wood ?? 0).toBeGreaterThan(0)
      expect(warehouses.some((w) => w !== first && (w.stock?.coins ?? 0) > 0)).toBe(true)
      expect(
        crewOf(world, trader)
          .slice(1)
          .every((r) => (r.carried.spear ?? 0) + (r.carried.sword ?? 0) > 0),
      ).toBe(true)
      expect(farthest).toBeLessThanOrEqual(CARAVAN_SPREAD + 2)
      expect(world.crimes).toEqual([])
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )
})

describe('a wandering trader losing its crew', () => {
  it('has a surviving escort take over driving when its driver dies', () => {
    const { world, terrain, trader } = fixture()
    put(world, trader, 300, 300)
    const [driver, next, last] = crewOf(world, trader)
    die(world, driver!)
    expect(trader.driverId).toBe(next!.id)
    expect(trader.escortIds).toEqual([last!.id])
    stepTraders(world, terrain.size)
    expect(next!.order?.kind).toBe('drive')
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stands with no crew left until the HQ sends a new driver on foot', () => {
    const { world, terrain, hq, trader } = fixture()
    put(world, trader, 300, 300)
    for (const r of crewOf(world, trader)) die(world, r)
    expect(trader.driverId).toBeNull()
    const carriage = carriageOf(world, trader)
    // Nobody free at the HQ yet: each of its adults is at the bottom of the list.
    const others = world.residents.filter((r) => r.cityId === hq.id)
    const saved = others.map((r) => r.health)
    for (const r of others) r.health = 0
    stepTraders(world, terrain.size)
    expect(trader.driverId).toBeNull()
    others.forEach((r, i) => (r.health = saved[i]!))
    stepTraders(world, terrain.size)
    const driver = world.residents.find((r) => r.id === trader.driverId)!
    expect(driver).toMatchObject({ owner: null, cityId: hq.id })
    expect(driver.order).toMatchObject({ kind: 'walkTo', target: { x: 300, y: 300 } })
    expect(carriage).toMatchObject({ x: 300, y: 300 })
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('has its escort defend it against someone taking goods off the carriage', () => {
    const { world, terrain, trader } = fixture()
    put(world, trader, 300, 300)
    const escort = world.residents.find((r) => r.id === trader.escortIds[0])!
    escort.carried.sword = 1
    const thief = newResident(mulberry32(9), { id: 'thief', owner: null, x: 300, y: 300, tick: 0 })
    thief.order = {
      kind: 'pickUp',
      from: { kind: 'carriage', carriageId: trader.carriageId },
      goods: { food: 1 },
    }
    world.residents.push(thief)
    stepTraders(world, terrain.size)
    expect(escort.order).toMatchObject({ kind: 'attack', targetId: 'thief' })
  })

  it('counts the crew as run by the trader, not by the HQ’s plans', () => {
    const { world, terrain, trader, hq } = fixture()
    const walking = new Walking(terrain)
    stepWorld(world, terrain, walking)
    expect(crewOf(world, trader).every((r) => r.cityId === hq.id)).toBe(true)
    expect(crewOf(world, trader).some((r) => r.order?.kind === 'workAt')).toBe(false)
  })
})

describe('robbing a wandering trader', () => {
  /** A trader out in the open with something on board, and a resident of Mara's on its tile. */
  function outInTheOpen() {
    const s = fixture()
    const { world, terrain, trader } = s
    put(world, trader, 300, 300)
    carriageOf(world, trader).load = { food: 8, iron: 4 }
    const realm = foundStartingCity(world, terrain, 7)
    const thief = newResident(mulberry32(11), {
      id: 'p1',
      owner: realm.id,
      x: 300,
      y: 300,
      tick: world.tick,
    })
    world.residents.push(thief)
    return { ...s, realm, thief }
  }

  it('is a theft against the Trade Organization, with nothing sent again', () => {
    const { world, terrain, trader, thief, hq } = outInTheOpen()
    resolveCarrying(
      world,
      [
        {
          kind: 'take',
          residentId: thief.id,
          spot: { kind: 'carriage', carriageId: trader.carriageId },
          goods: { iron: 2 },
        },
      ],
      terrain.size,
    )
    expect(thief.carried.iron).toBe(2)
    expect(world.crimes).toEqual([
      expect.objectContaining({ kind: 'theft', victimOrg: hq.id, goods: { iron: 2 } }),
    ])
    expect(trader.robberies).toBe(1)
    // It owes nobody a delivery, and no caravan's route counts it.
    expect(world.deliveries).toEqual([])
    expect(world.transfers).toEqual([])
    expect(world.routeRobberies).toEqual({})
    expect(carriageOf(world, trader).load.iron).toBe(2)
  })

  it('counts one robbery a tick, however many take from it', () => {
    const { world, terrain, trader, thief } = outInTheOpen()
    const spot = { kind: 'carriage', carriageId: trader.carriageId } as const
    const take = { kind: 'take', residentId: thief.id, spot, goods: { iron: 1 } } as const
    resolveCarrying(world, [take, take], terrain.size)
    expect(trader.robberies).toBe(1)
  })

  it('is no robbery when one of the Trade Org’s own takes from it', () => {
    const { world, terrain, trader } = outInTheOpen()
    const driver = crewOf(world, trader)[0]!
    resolveCarrying(
      world,
      [
        {
          kind: 'take',
          residentId: driver.id,
          spot: { kind: 'carriage', carriageId: trader.carriageId },
          goods: { iron: 1 },
        },
      ],
      terrain.size,
    )
    expect(trader.robberies).toBe(0)
    expect(world.crimes).toEqual([])
  })

  it('earns it more escorts, made up at the HQ, once it has a new carriage', () => {
    const { world, terrain, trader } = outInTheOpen()
    const warehouse = hqEnd(world).warehouse!
    trader.robberies = 2
    put(world, trader, warehouse.x, warehouse.y)
    trader.heading = 'hq'
    stepTraders(world, terrain.size)
    expect(trader.escortIds).toHaveLength(TRADER_ESCORTS + 1)
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('refuses to drive off with its carriage while its crew hold it', () => {
    const { world, terrain, trader, thief, realm } = outInTheOpen()
    const problem = () =>
      driveOffProblem(world, thief, carriageOf(world, trader), realm.id, terrain.size)
    expect(problem()).toBe('its driver is still with that trader’s carriage')
    const [driver, armed, other] = crewOf(world, trader)
    armed!.carried.spear = 1
    armed!.x += 1
    driver!.x += 1000
    other!.x += 1000
    expect(problem()).toBe('its escort guards that trader’s carriage')
    die(world, driver!)
    die(world, other!)
    // The one left has taken over driving.
    expect(trader.driverId).toBe(armed!.id)
    die(world, armed!)
    expect(problem()).toBeUndefined()
  })

  it('stolen, it gets a new carriage and horse at the HQ, bound for the same post', () => {
    const { world, terrain, trader, thief, realm, hq } = outInTheOpen()
    const stolen = carriageOf(world, trader)
    const bound = trader.postId
    trader.stop = 'warehouse'
    const crew = crewOf(world, trader)
    takeOver(world, thief, realm.id, { carriage: stolen }, terrain.size)
    expect(stolen).toMatchObject({ realmId: realm.id, cityId: null, load: { food: 8, iron: 4 } })
    expect(world.crimes).toEqual([
      expect.objectContaining({ kind: 'theft', victimOrg: hq.id, carriage: true }),
    ])
    expect(trader.robberies).toBe(1)
    expect(world.deliveries).toEqual([])
    expect(world.traders).toContain(trader)
    const fresh = carriageOf(world, trader)
    const warehouse = hqEnd(world).warehouse!
    expect(fresh).not.toBe(stolen)
    expect(fresh).toMatchObject({
      realmId: null,
      cityId: hq.id,
      x: warehouse.x,
      y: warehouse.y,
      load: {},
    })
    expect(world.horses.find((h) => h.id === fresh.horseId)).toMatchObject({ cityId: hq.id })
    expect(trader).toMatchObject({ heading: 'hq', stop: 'storage', postId: bound, plan: null })
    // Its surviving crew walk back to it.
    stepTraders(world, terrain.size)
    for (const r of crew) {
      expect(r.order).toMatchObject({ kind: 'walkTo', target: { x: fresh.x, y: fresh.y } })
    }
    expect(tradersSound.check(world, terrain)).toEqual([])
  })
})

describe('a wandering trader’s loop', () => {
  it('loses a post that leaves the Trade Organization, going on to the one after it', () => {
    const { world, terrain, trader, posts } = fixture()
    const bound = trader.postId!
    const after = trader.loop[(trader.loop.indexOf(bound) + 1) % trader.loop.length]
    trader.plan = { leave: {}, take: { wood: 1 } }
    trader.stop = 'warehouse'
    leaveTradeOrg(
      world,
      posts.find((p) => p.id === bound)!,
    )
    expect(trader.loop).not.toContain(bound)
    expect(trader.postId).toBe(after)
    expect(trader).toMatchObject({ stop: 'storage', plan: null })
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('keeps its way when a post it isn’t bound for goes, wrapping round the end', () => {
    const { world, trader, posts } = fixture()
    const bound = trader.postId!
    const other = trader.loop.find((id) => id !== bound)!
    trader.stop = 'warehouse'
    leaveTradeOrg(
      world,
      posts.find((p) => p.id === other)!,
    )
    expect(trader.postId).toBe(bound)
    expect(trader.stop).toBe('warehouse')
    // The last of the loop goes: on to the first.
    const last = trader.loop[trader.loop.length - 1]!
    const first = trader.loop[0]
    trader.postId = last
    leaveTradeOrg(
      world,
      posts.find((p) => p.id === last)!,
    )
    expect(trader.postId).toBe(first)
  })

  it('follows a captured post when the capture comes through a captor', () => {
    const { world, terrain, trader, posts } = fixture()
    const realm = foundStartingCity(world, terrain, 7)
    const post = posts[0]!
    captureCity(world, post, realm.id, terrain.size)
    expect(trader.loop).not.toContain(post.id)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes in a new post where it adds the least way, the rest in the same order', () => {
    const { world, terrain, trader } = fixture()
    const order = [...trader.loop]
    const bound = trader.postId
    const post = foundTradingPost(world, terrain, 320, 174, undefined, mulberry32(3))
    stepTraders(world, terrain.size)
    expect(trader.loop).toHaveLength(order.length + 1)
    expect(trader.loop.filter((id) => id !== post.id)).toEqual(order)
    expect(trader.postId).toBe(bound)
    // Beside the two posts on the east side of the square, so between them.
    const i = trader.loop.indexOf(post.id)
    const neighbours = [
      trader.loop[(i + trader.loop.length - 1) % trader.loop.length],
      trader.loop[(i + 1) % trader.loop.length],
    ].sort()
    const east = trader.loop.filter((id) => {
      const hall = townHallOf(
        world,
        world.cities.find((c) => c.id === id)!,
      )!
      return hall.x > 200 && hall.x < 280
    })
    expect(neighbours).toEqual(east.sort())
    expect(tradersSound.check(world, terrain)).toEqual([])
  })

  it('goes back to the HQ with no post left, and out again when there is one', () => {
    const { world, terrain, trader, posts } = fixture([[220, 128]])
    expect(world.traders).toEqual([trader])
    put(world, trader, 300, 300)
    leaveTradeOrg(world, posts[0]!)
    expect(trader).toMatchObject({ loop: [], postId: null, heading: 'hq', stop: 'storage' })
    expect(tradersSound.check(world, terrain)).toEqual([])
    stepTraders(world, terrain.size)
    const storage = hqEnd(world).storage!
    expect(crewOf(world, trader)[0]!.order).toMatchObject({
      kind: 'drive',
      target: { x: storage.x, y: storage.y },
    })
    const post = foundTradingPost(world, terrain, 128, 320, undefined, mulberry32(3))
    stepTraders(world, terrain.size)
    expect(trader).toMatchObject({ loop: [post.id], postId: post.id, heading: 'hq' })
  })

  it('stays at the HQ’s warehouse with no post left, not shuttling to and fro', () => {
    const { world, terrain, trader, posts } = fixture([[220, 128]])
    leaveTradeOrg(world, posts[0]!)
    const warehouse = hqEnd(world).warehouse!
    put(world, trader, warehouse.x, warehouse.y)
    trader.heading = 'hq'
    trader.stop = 'warehouse'
    for (const r of crewOf(world, trader)) r.carried.spear = 1
    stepTraders(world, terrain.size)
    expect(trader.stop).toBe('warehouse')
    expect(crewOf(world, trader)[0]!.order).toBeNull()
  })
})

describe('wandering traders and the fall of the HQ', () => {
  it('ends them: crew, carriage, horse and load join the captor where they stand', () => {
    const { world, terrain, hq, trader } = fixture()
    const realm = foundStartingCity(world, terrain, 7)
    put(world, trader, 300, 300)
    const carriage = carriageOf(world, trader)
    carriage.load = { iron: 3 }
    const crew = crewOf(world, trader)
    captureCity(world, hq, realm.id, terrain.size)
    expect(tradeOrgHq(world)).toBeUndefined()
    expect(world.traders).toEqual([])
    expect(carriage).toMatchObject({ realmId: realm.id, x: 300, y: 300, load: { iron: 3 } })
    for (const r of crew) expect(r).toMatchObject({ owner: realm.id, x: 300, y: 300 })
    expect(nothingLeftOfTheHq.check(world, terrain)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
    // And should one be left, the invariant says so.
    world.traders.push(trader)
    expect(nothingLeftOfTheHq.check(world, terrain).map((v) => v.message)).toEqual([
      'the world has no Trade Org HQ but still has wandering traders',
    ])
  })

  it('ends any left with no HQ on the next tick', () => {
    const { world, terrain, hq, trader } = fixture()
    world.cities = world.cities.filter((c) => c !== hq)
    expect(world.traders).toContain(trader)
    stepTraders(world, terrain.size)
    expect(world.traders).toEqual([])
  })
})

describe('what is seen of a wandering trader', () => {
  it('is what is seen of a caravan: seen through its carriage and crew', () => {
    const { world, terrain, trader } = fixture()
    const realm = foundStartingCity(world, terrain, 7)
    const seen = () => entitiesInSight(world, terrain, realm.id).filter((e) => e.is === 'trader')
    expect(seen()).toEqual([])
    const scout = newResident(mulberry32(3), {
      id: 'scout',
      owner: realm.id,
      x: 300,
      y: 300,
      tick: world.tick,
    })
    world.residents.push(scout)
    put(world, trader, 300, 300)
    expect(seen()).toEqual([
      {
        is: 'trader',
        id: trader.id,
        carriageId: trader.carriageId,
        driverId: trader.driverId,
        escortIds: trader.escortIds,
        postId: trader.postId,
        heading: 'post',
      },
    ])
  })
})

describe('the invariant on wandering traders', () => {
  const messages = (world: WorldState, terrain: TerrainMap) =>
    tradersSound.check(world, terrain).map((v) => v.message)

  it('catches a loop naming what is no post, or a post twice', () => {
    const { world, terrain, trader, hq } = fixture()
    trader.loop.push(hq.id)
    expect(messages(world, terrain)).toEqual([
      `trader ${trader.id} has ${hq.id} on its loop, which is no trading post`,
    ])
    trader.loop.pop()
    trader.loop.push(trader.loop[0]!)
    expect(messages(world, terrain)).toEqual([`trader ${trader.id} has a post twice on its loop`])
  })

  it('catches going to a post off its loop', () => {
    const { world, terrain, trader } = fixture()
    trader.postId = 'nowhere'
    expect(messages(world, terrain)[0]).toContain('goes to nowhere')
  })

  it('catches crew who aren’t of the HQ, and crew shared with another', () => {
    const { world, terrain, trader, traders, posts } = fixture()
    const r = crewOf(world, trader)[0]!
    r.cityId = posts[0]!.id
    expect(messages(world, terrain)).toEqual([
      `trader ${trader.id} has crew ${r.id}, who isn't of the Trade Org HQ`,
    ])
    r.cityId = tradeOrgHq(world)!.id
    traders[1]!.escortIds[0] = r.id
    expect(messages(world, terrain)[0]).toContain('twice or shared')
  })

  it('catches a lost carriage, a driverless crew, too many escorts and an oversized plan', () => {
    const { world, terrain, trader } = fixture()
    const k = carriageOf(world, trader)
    k.realmId = 'someone'
    expect(messages(world, terrain)[0]).toContain("isn't the Trade Org HQ's")
    k.realmId = null
    const driverId = trader.driverId
    trader.driverId = null
    expect(messages(world, terrain)[0]).toContain('has no driver')
    trader.driverId = driverId
    trader.escortIds.push('a', 'b', 'c')
    expect(messages(world, terrain).join()).toContain('walks with')
    trader.escortIds.splice(-3)
    trader.plan = { leave: {}, take: { stone: CARRIAGE_CAPACITY * 2 } }
    expect(messages(world, terrain).join()).toContain('means to take')
  })

  it('is one of the world’s invariants', () => {
    const { world, terrain, trader } = fixture()
    trader.postId = 'nowhere'
    expect(checkInvariants(world, terrain).map((v) => v.invariant)).toContain('traders-sound')
  })
})
