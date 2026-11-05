import {
  AVERAGE_HORSE_STATS,
  CARAVAN_ESCORTS,
  CARAVAN_FOOD,
  CARAVAN_FOOD_PER_ESCORT,
  CARRIAGE_CAPACITY,
  FOOD_PER_DAY,
  HORSE_FOOD_PER_DAY,
  HQ_PEOPLE_FOOD_DAYS,
  NPC_FOOD_SHORT_DAYS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  TRADER_STOP_TICKS,
  Terrain,
  WAITING_HORSE_FOOD,
  WALK_TICKS_PER_TILE,
  WAY_FOOD_MARGIN,
  crewIdsOf,
  foodForWay,
  isAt,
  isDown,
  middleOf,
  stockWeight,
  townHallOf,
  wrapDistance,
  type Caravan,
  type Carriage,
  type City,
  type Horse,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { caravansSound, hqEnd, placeCaravans, postEnd, topUpFood } from './caravans.js'
import { checkInvariants } from './invariants.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { foundNpcCity } from './npc-cities.js'
import { evenOutLoad, placeTraders, tradersSound } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Waiting for Food (`CONTEXT.md`): a caravan or wandering trader stays at the HQ until it holds enough
 * Food for its crew and horse to reach its next stop. A brand-new world's storage can't fill every
 * carriage, and before this rule they set off anyway and starved on the road (PR #863).
 */

const SIZE = 1024
const HQ = 128
/** A post this many tiles from the HQ: a few game days' drive, so hunger shows on the way. */
const LEG = 600

const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** The HQ and one post `LEG` tiles east of it, with what each post's caravan and traders are. */
function world(options: { traders?: boolean; posts?: number } = {}) {
  const terrain = plains(SIZE)
  const w = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(w, terrain, HQ, HQ, rand)
  const posts: City[] = []
  for (let i = 0; i < (options.posts ?? 1); i++) {
    const x = HQ + LEG
    const y = HQ + i * 80
    posts.push(foundTradingPost(w, terrain, x, y, undefined, rand))
  }
  const caravans = options.traders ? [] : placeCaravans(w)
  const traders = options.traders ? placeTraders(w, SIZE) : []
  for (const h of w.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  return { world: w, terrain, hq, posts, caravans, traders, storage: hqEnd(w).storage! }
}

const carriageOf = (w: WorldState, c: Caravan | Trader): Carriage =>
  w.carriages.find((k) => k.id === c.carriageId)!

const horseOf = (w: WorldState, k: Carriage): Horse => w.horses.find((h) => h.id === k.horseId)!

const crewOf = (w: WorldState, c: Caravan | Trader) =>
  crewIdsOf(c).map((id) => w.residents.find((r) => r.id === id)!)

/** The storage holds only what the HQ's own people are left, so no carriage gets more than a ration. */
const peopleKeep = (w: WorldState, hq: City, convoys: readonly (Caravan | Trader)[]) => {
  const crew = new Set(convoys.flatMap(crewIdsOf))
  const people = w.residents.filter((r) => r.cityId === hq.id && !crew.has(r.id)).length
  return people * FOOD_PER_DAY * HQ_PEOPLE_FOOD_DAYS
}

function run(w: WorldState, terrain: TerrainMap, ticks: number, each?: () => void) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks; t++) {
    stepWorld(w, terrain, walking)
    each?.()
  }
}

/** The Food on board when a carriage first leaves the HQ's area, or undefined while it hasn't. */
function leftWith(w: WorldState, hq: City, c: Caravan | Trader, seen: Map<string, number>) {
  const k = carriageOf(w, c)
  const hall = middleOf(townHallOf(w, hq)!)
  const away = Math.hypot(k.x - hall.x, k.y - hall.y) > 60
  if (away && !seen.has(c.id)) seen.set(c.id, k.load.food ?? 0)
}

describe('how much Food reaches the next stop', () => {
  it('is what the crew and horse eat on a walk there, with a margin, in whole units', () => {
    const tiles = 960
    const days = (tiles * WALK_TICKS_PER_TILE * WAY_FOOD_MARGIN) / TICKS_PER_GAME_DAY
    const eaten = days * ((1 + CARAVAN_ESCORTS) * FOOD_PER_DAY + HORSE_FOOD_PER_DAY)
    expect(foodForWay(CARAVAN_ESCORTS, tiles)).toBe(Math.ceil(eaten))
  })

  it('grows with the way, the escort and the stops on it', () => {
    expect(foodForWay(CARAVAN_ESCORTS, 800)).toBeGreaterThan(foodForWay(CARAVAN_ESCORTS, 400))
    expect(foodForWay(4, 400)).toBeGreaterThan(foodForWay(CARAVAN_ESCORTS, 400))
    const stop = (TRADER_STOP_TICKS / TICKS_PER_GAME_DAY) * 2.25
    expect(foodForWay(CARAVAN_ESCORTS, 400, 2)).toBeGreaterThanOrEqual(
      foodForWay(CARAVAN_ESCORTS, 400) + Math.floor(2 * stop),
    )
  })

  it('is never more than a carriage keeps on board, so waiting always has an end', () => {
    expect(foodForWay(CARAVAN_ESCORTS, 100_000)).toBe(CARAVAN_FOOD)
    expect(foodForWay(CARAVAN_ESCORTS + 2, 100_000)).toBe(
      CARAVAN_FOOD + 2 * CARAVAN_FOOD_PER_ESCORT,
    )
  })

  it('leaves the HQ people no more short than an NPC city farms against, so farms fill it', () => {
    expect(HQ_PEOPLE_FOOD_DAYS).toBeLessThanOrEqual(NPC_FOOD_SHORT_DAYS)
  })
})

describe('a caravan waiting for Food at the HQ', () => {
  it('stays at the HQ with too little Food, and doesn’t leave for its post', () => {
    const { world: w, terrain, caravans, storage } = world()
    storage.stock = { food: 0 }
    run(w, terrain, 300, () => {
      storage.stock = { food: 0 }
      for (const r of w.residents) r.hunger = 100
    })
    const c = caravans[0]!
    const k = carriageOf(w, c)
    expect(c.heading).toBe('hq')
    expect(isAt(k, storage, SIZE)).toBe(true)
  })

  it('sets off as soon as it holds enough for the way, with Food that came in later', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    storage.stock = { food: 0 }
    run(w, terrain, 100, () => {
      storage.stock = { food: 0 }
    })
    expect(c.heading).toBe('hq')
    storage.stock = { food: peopleKeep(w, hq, caravans) + CARAVAN_FOOD }
    let setOffWith: number | undefined
    run(w, terrain, 200, () => {
      if (c.heading === 'post' && setOffWith === undefined) {
        setOffWith = carriageOf(w, c).load.food ?? 0
      }
    })
    expect(setOffWith).toBeGreaterThanOrEqual(foodForWay(CARAVAN_ESCORTS, LEG))
    expect(checkInvariants(w, terrain)).toEqual([])
  })

  it('needs only enough for the way, not a full carriage, to set off', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    const way = foodForWay(CARAVAN_ESCORTS, LEG) + 2
    expect(way).toBeLessThan(CARAVAN_FOOD)
    storage.stock = { food: peopleKeep(w, hq, caravans) + way }
    run(w, terrain, 200)
    expect(c.heading).toBe('post')
    expect(carriageOf(w, c).load.food ?? 0).toBeLessThan(CARAVAN_FOOD)
  })

  it('unloads what it brought before it waits, so a full carriage has room for its Food', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    const k = carriageOf(w, c)
    const goods = hqEnd(w).warehouse!
    const before = goods.stock?.wood ?? 0
    // Back from a post that had no Food for it, its carriage as full as a load goes.
    k.load = { wood: Math.floor(CARRIAGE_CAPACITY / 2) }
    storage.stock = { food: 0 }
    run(w, terrain, 900, () => {
      storage.stock = { food: 0 }
      for (const r of w.residents) r.hunger = 100
    })
    expect(k.load.wood ?? 0).toBe(0)
    expect(goods.stock?.wood).toBeGreaterThan(before)
    expect(c.heading).toBe('hq')
    expect(isAt(k, storage, SIZE)).toBe(true)
    // Then the Food comes in, and it fits.
    storage.stock = { food: peopleKeep(w, hq, caravans) + CARAVAN_FOOD }
    run(w, terrain, 300)
    expect(c.heading).toBe('post')
    expect(k.load.food ?? 0).toBeGreaterThanOrEqual(foodForWay(CARAVAN_ESCORTS, LEG))
  })

  it('wants a full carriage when a delivery waits at the warehouse, which has no Food on its way', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    const goods = hqEnd(w).warehouse!
    w.deliveries.push({
      id: 'd1',
      kind: 'delivery',
      realmId: 'r1',
      cityId: 'nowhere',
      warehouseId: goods.id,
      good: 'wood',
      units: 1,
      caravanId: null,
      orderedAt: 0,
    } as WorldState['deliveries'][number])
    storage.stock = { food: peopleKeep(w, hq, caravans) + foodForWay(CARAVAN_ESCORTS, LEG) + 2 }
    run(w, terrain, 100)
    expect(c.job).toBeNull()
    expect(isAt(carriageOf(w, c), storage, SIZE)).toBe(true)
  })

  it('tops up from the goods warehouse when short, leaving the storage to the HQ’s people', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    const goods = hqEnd(w).warehouse!
    const keep = peopleKeep(w, hq, caravans)
    storage.stock = { food: keep }
    goods.stock = { ...goods.stock, food: 300 }
    let setOffWith: number | undefined
    run(w, terrain, 200, () => {
      if (c.heading === 'post' && setOffWith === undefined) {
        setOffWith = carriageOf(w, c).load.food ?? 0
      }
    })
    expect(setOffWith).toBeGreaterThanOrEqual(foodForWay(CARAVAN_ESCORTS, LEG))
    expect(goods.stock.food).toBeLessThan(300)
    expect(checkInvariants(w, terrain)).toEqual([])
  })

  it('leaves the goods warehouse’s Food alone with enough on board', () => {
    const { world: w, terrain, hq, caravans, storage } = world()
    const c = caravans[0]!
    const goods = hqEnd(w).warehouse!
    storage.stock = { food: peopleKeep(w, hq, caravans) + CARAVAN_FOOD }
    goods.stock = { ...goods.stock, food: 300 }
    run(w, terrain, 200)
    expect(c.heading).toBe('post')
    expect(goods.stock.food).toBe(300)
  })

  it('waits only until the stock floor fills the warehouse at the end of the first day', () => {
    const { world: w, terrain, caravans, storage } = world()
    const c = caravans[0]!
    run(w, terrain, TICKS_PER_GAME_DAY - 100, () => {
      storage.stock = { food: 0 }
    })
    expect(c.heading).toBe('hq')
    run(w, terrain, 400, () => {
      storage.stock = { food: 0 }
    })
    expect(c.heading).toBe('post')
    expect(carriageOf(w, c).load.food ?? 0).toBeGreaterThanOrEqual(foodForWay(CARAVAN_ESCORTS, LEG))
  })

  it('goes on past a post’s empty storage: the rule names only the HQ', () => {
    const { world: w, terrain, caravans, posts } = world()
    const c = caravans[0]!
    const k = carriageOf(w, c)
    const post = postEnd(w, posts[0]!.id)
    const horse = horseOf(w, k)
    const crew = crewOf(w, c)
    for (const thing of [k, horse, ...crew]) {
      thing.x = post.storage!.x
      thing.y = post.storage!.y
    }
    for (const r of crew) r.order = null
    c.heading = 'post'
    c.stop = 'storage'
    k.load = {}
    post.storage!.stock = { food: 0 }
    run(w, terrain, 200, () => {
      post.storage!.stock = { food: 0 }
    })
    expect(c.heading).toBe('hq')
  })
})

describe('what a waiting carriage leaves the HQ’s people', () => {
  it('takes only what they don’t need from the storage', () => {
    const { world: w, hq, caravans, storage } = world()
    const c = caravans[0]!
    const keep = peopleKeep(w, hq, caravans)
    storage.stock = { food: keep + 10 }
    const driver = w.residents.find((r) => r.id === c.driverId)!
    expect(topUpFood(w, c, driver, storage, carriageOf(w, c))).toBe(true)
    expect(driver.order).toMatchObject({ kind: 'pickUp', goods: { food: 10 } })
  })

  it('at what they need, takes just a ration for its horse, then nothing', () => {
    const { world: w, hq, caravans, storage } = world()
    const c = caravans[0]!
    const k = carriageOf(w, c)
    storage.stock = { food: peopleKeep(w, hq, caravans) }
    const driver = w.residents.find((r) => r.id === c.driverId)!
    expect(topUpFood(w, c, driver, storage, k)).toBe(true)
    expect(driver.order).toMatchObject({ kind: 'pickUp', goods: { food: WAITING_HORSE_FOOD } })
    k.load = { food: WAITING_HORSE_FOOD }
    driver.order = null
    c.holding = null
    expect(topUpFood(w, c, driver, storage, k)).toBe(false)
  })

  it('takes all it wants from a post’s storage, as ever', () => {
    const { world: w, caravans, posts } = world()
    const c = caravans[0]!
    const storage = postEnd(w, posts[0]!.id).storage!
    storage.stock = { food: 20 }
    const driver = w.residents.find((r) => r.id === c.driverId)!
    expect(topUpFood(w, c, driver, storage, carriageOf(w, c))).toBe(true)
    expect(driver.order).toMatchObject({ kind: 'pickUp', goods: { food: 20 } })
  })

  it(
    'a waiting horse doesn’t go Down, nor the HQ’s people go hungry for it',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world: w, terrain, hq, caravans, storage } = world({ posts: 3 })
      const keep = peopleKeep(w, hq, caravans)
      const goods = hqEnd(w).warehouse!
      storage.stock = { food: keep }
      const crew = new Set(caravans.flatMap(crewIdsOf))
      // No Food in the warehouse, so they stand and wait, on what the farms bring.
      run(w, terrain, 6 * TICKS_PER_GAME_DAY, () => {
        goods.stock = { ...goods.stock, food: 0 }
      })
      for (const c of caravans) expect(isDown(horseOf(w, carriageOf(w, c)))).toBe(false)
      const people = w.residents.filter((r) => r.cityId === hq.id && !crew.has(r.id))
      expect(people.filter((r) => r.hunger < 20)).toEqual([])
      expect(checkInvariants(w, terrain)).toEqual([])
    },
  )
})

describe('a wandering trader waiting for Food at the HQ', () => {
  /** Everyone armed and the storage and warehouse out of Food, so nothing but what comes in moves it. */
  function hungry() {
    const f = world({ traders: true, posts: 2 })
    const goods = hqEnd(f.world).warehouse!
    f.storage.stock = { food: 0 }
    goods.stock = { ...goods.stock, food: 0 }
    goods.stock = { ...goods.stock, spear: 20 }
    return { ...f, goods }
  }

  it('stays with too little Food, whatever it evened out, until the warehouse has some', () => {
    const { world: w, terrain, traders, goods, storage } = hungry()
    const t = traders[0]!
    const start = t.postId
    run(w, terrain, 200, () => {
      storage.stock = { food: 0 }
      goods.stock = { ...goods.stock, food: 0 }
    })
    expect(t.heading).toBe('hq')
    expect(t.postId).toBe(start)
    expect(isAt(carriageOf(w, t), goods, SIZE)).toBe(true)
  })

  it('takes what comes into the goods warehouse, and sets off with enough', () => {
    const { world: w, terrain, traders, goods, storage } = hungry()
    const t = traders[0]!
    run(w, terrain, 100, () => {
      storage.stock = { food: 0 }
      goods.stock = { ...goods.stock, food: 0 }
    })
    expect(t.heading).toBe('hq')
    goods.stock = { ...goods.stock, food: 300 }
    let setOffWith: number | undefined
    run(w, terrain, 200, () => {
      storage.stock = { food: 0 }
      if (t.heading === 'post' && setOffWith === undefined) {
        setOffWith = carriageOf(w, t).load.food ?? 0
      }
    })
    expect(setOffWith).toBeGreaterThanOrEqual(foodForWay(t.escortIds.length, LEG))
    expect(checkInvariants(w, terrain)).toEqual([])
  })

  it('waits on the first day of a new world only until the stock floor fills the warehouse', () => {
    const { world: w, terrain, traders, storage } = hungry()
    run(w, terrain, TICKS_PER_GAME_DAY + 300, () => {
      storage.stock = { food: 0 }
    })
    for (const t of traders) expect(t.heading).toBe('post')
  })

  it('keeps room for the Food the way needs when it evens out', () => {
    const there = { wood: 2000, stone: 2000 }
    const { leave, take } = evenOutLoad(there, { food: 5 }, CARAVAN_FOOD, CARRIAGE_CAPACITY, 40)
    expect(leave).toEqual({})
    expect(stockWeight(take) + 5).toBeLessThanOrEqual(CARRIAGE_CAPACITY - 35)
  })

  it('takes at least what the way lacks when it evens out, as far as the warehouse has it', () => {
    const plan = (food: number) =>
      evenOutLoad(
        { wood: 2000, stone: 2000, food },
        { food: 5 },
        CARAVAN_FOOD,
        CARRIAGE_CAPACITY,
        40,
      )
    expect(plan(300).take.food).toBeGreaterThanOrEqual(35)
    expect(plan(10).take.food).toBe(10)
    expect(stockWeight(plan(300).take) + 5).toBeLessThanOrEqual(CARRIAGE_CAPACITY)
  })

  it('evens out as ever when it asks for no room', () => {
    const there = { wood: 2000, stone: 2000 }
    expect(evenOutLoad(there, { food: 5 }, CARAVAN_FOOD, CARRIAGE_CAPACITY)).toEqual(
      evenOutLoad(there, { food: 5 }, CARAVAN_FOOD, CARRIAGE_CAPACITY, 0),
    )
  })

  it('counts the time at a city it stops at on the way as part of the way', () => {
    const { world: w, terrain, traders, goods, storage } = hungry()
    foundNpcCity(w, terrain, NPC_VILLAGE, HQ + LEG / 2, HQ + 120, mulberry32(9))
    const t = traders[0]!
    const k = carriageOf(w, t)
    const post = w.cities.find((c) => c.id === t.postId)!
    const tiles = wrapDistance(SIZE, k, middleOf(townHallOf(w, post)!))
    const noFood = () => {
      storage.stock = { food: 0 }
      goods.stock = { ...goods.stock, food: 0 }
    }
    k.load = { food: foodForWay(t.escortIds.length, tiles) }
    run(w, terrain, 100, noFood)
    expect(t.heading).toBe('hq')
    k.load = { food: foodForWay(t.escortIds.length, tiles, 1) + 2 }
    run(w, terrain, 100, noFood)
    expect(t.heading).toBe('post')
  })
})

describe('setting off with enough (invariants)', () => {
  it('flags a caravan just set off from the HQ with too little Food', () => {
    const { world: w, terrain, caravans, storage } = world()
    const c = caravans[0]!
    const k = carriageOf(w, c)
    k.x = storage.x
    k.y = storage.y
    c.heading = 'post'
    k.load = {}
    expect(caravansSound.check(w, terrain).map((v) => v.message)).toEqual([
      expect.stringContaining('set off from the HQ with 0 Food'),
    ])
    k.load = { food: foodForWay(CARAVAN_ESCORTS, LEG) }
    expect(caravansSound.check(w, terrain)).toEqual([])
  })

  it('flags a trader just set off from the HQ with too little Food', () => {
    const { world: w, terrain, traders, storage } = world({ traders: true, posts: 2 })
    const t = traders[0]!
    const k = carriageOf(w, t)
    k.x = storage.x
    k.y = storage.y
    t.heading = 'post'
    k.load = {}
    expect(tradersSound.check(w, terrain).map((v) => v.message)).toEqual([
      expect.stringContaining('set off from the HQ with 0 Food'),
    ])
    k.load = { food: CARAVAN_FOOD }
    expect(tradersSound.check(w, terrain)).toEqual([])
  })
})

describe('a new world with too little Food at the HQ', () => {
  it(
    'its carriages wait, then leave with enough; nobody goes Down on the first legs, and supply goes on',
    { tags: ['slow'], timeout: 900_000 },
    () => {
      const terrain = plains(SIZE)
      const w = createWorld(terrain)
      const rand = mulberry32(5)
      const hq = foundTradeOrgHq(w, terrain, HQ, HQ, rand)
      const posts = [0, 160, 320, 480].map((dy) =>
        foundTradingPost(w, terrain, HQ + LEG, HQ + dy, undefined, rand),
      )
      const caravans = placeCaravans(w)
      const traders = placeTraders(w, SIZE)
      for (const h of w.horses) h.stats = { ...AVERAGE_HORSE_STATS }
      const storage = hqEnd(w).storage!
      // Far too little for eight carriages and everyone at the HQ.
      storage.stock = { food: 90 }
      // Gold ore a post's hands neither dig nor spend: what it holds came by carriage.
      const warehouses = posts.map((p) => postEnd(w, p.id).warehouse!)
      for (const b of warehouses) b.stock = { ...b.stock, goldOre: 0 }
      const convoys = [...caravans, ...traders]
      const seen = new Map<string, number>()
      const walking = new Walking(terrain)
      for (let day = 1; day <= 15; day++) {
        for (let t = 0; t < TICKS_PER_GAME_DAY; t++) {
          stepWorld(w, terrain, walking)
          for (const c of convoys) leftWith(w, hq, c, seen)
        }
        expect(checkInvariants(w, terrain)).toEqual([])
        const crewDown = convoys.flatMap((c) => crewOf(w, c)).filter((r) => r && isDown(r))
        expect(crewDown.map((r) => r.id)).toEqual([])
        expect(w.horses.filter((h) => isDown(h)).map((h) => h.id)).toEqual([])
      }
      // All of them got away in the end, none of them short for the way.
      expect(seen.size).toBe(convoys.length)
      for (const c of convoys) {
        expect(seen.get(c.id)).toBeGreaterThanOrEqual(foodForWay(CARAVAN_ESCORTS, LEG) - 2)
      }
      // And every post got what only a carriage brings it.
      for (const b of warehouses) expect(b.stock?.goldOre ?? 0).toBeGreaterThan(0)
    },
  )
})
