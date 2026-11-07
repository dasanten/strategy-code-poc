import {
  NPC_RESIDENTS_PER_TRADER,
  NPC_SMITHY_WEAPON,
  NPC_TOWN,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  canWork,
  cityResidents,
  isAt,
  npcReserve,
  npcStorages,
  type Building,
  type City,
  type CityPlan,
  type CityTrader,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { npcTradersSound, tradersWanted } from './npc-trader.js'
import { mulberry32 } from './residents.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { migrateWorld } from './world-format.js'
import { createWorld, stepWorld } from './world.js'

/*
 * The NPC trader (`CONTEXT.md`: NPC trader): a city with a full load of surplus sends a spare hand
 * to a Trade Org warehouse in reach, who sells it, buys what the city is short of and has no node
 * for, and walks home. A village sends one at a time, a bigger city more by its size.
 */

/**
 * A village on a Plains map with no nodes at all, and a trading post 500 tiles east of it. The
 * village's storage holds its reserve and 60 Wood over it, Food and Stone a little over; `ironShort` leaves
 * it short of Iron (the only good short of its reserve but weapons), else it holds a spear for
 * each soldier it lacks, so nothing is short but coins.
 */
function villageAndPost(ironShort: boolean): {
  world: WorldState
  terrain: TerrainMap
  city: City
  storage: Building
  warehouse: Building
} {
  const terrain = plains(1200)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  const storage = npcHome(world, city)!
  const post = foundTradingPost(world, terrain, storage.x + 500 - 14, 20, undefined, mulberry32(3))
  const warehouse = world.buildings.find((b) => b.cityId === post.id && b.kind === 'warehouse')!
  storage.stock = { food: 400 }
  const reserve = npcReserve(world, city)
  storage.stock.food = (reserve.food ?? 0) + 5
  storage.stock.wood = (reserve.wood ?? 0) + 60
  storage.stock.stone = (reserve.stone ?? 0) + 10
  storage.stock.coins = reserve.coins ?? 0
  if (!ironShort) storage.stock[NPC_SMITHY_WEAPON] = reserve[NPC_SMITHY_WEAPON] ?? 0
  return { world, terrain, city, storage, warehouse }
}

/**
 * A city of `residents` on a Plains map with no nodes at all and a trading post `tiles` east of it,
 * all at home with nothing to do. Its storage holds its reserve of everything, and `over` past it.
 */
function cityAndPost(residents: number, over: Stock, tiles = 500) {
  const terrain = plains(1200)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, { ...NPC_TOWN, residents }, 40, 40, mulberry32(7))
  const storage = npcHome(world, city)!
  const post = foundTradingPost(world, terrain, storage.x + tiles - 14, 40, undefined, mulberry32(3))
  const warehouse = world.buildings.find((b) => b.cityId === post.id && b.kind === 'warehouse')!
  for (const r of cityResidents(world, city)) {
    Object.assign(r, { x: storage.x, y: storage.y, order: null })
    delete r.script
  }
  for (const b of npcStorages(world, city)) b.stock = {}
  // Twice: with its spears in the storage, its reserve no longer asks for what makes them.
  storage.stock = { ...npcReserve(world, city) }
  const stock: Stock = { ...npcReserve(world, city) }
  for (const [good, n] of Object.entries(over) as [keyof Stock, number][]) {
    stock[good] = (stock[good] ?? 0) + n
  }
  storage.stock = stock
  return { world, terrain, city, storage, warehouse }
}

/** A city's trade runs under way. */
const runs = (world: WorldState, city: City): CityTrader[] =>
  world.cityPlans[city.id]?.traders ?? []

/** Runs the world tick by tick until `done` or `days` pass, checking the invariants each day. */
function run(world: WorldState, terrain: TerrainMap, days: number, each: () => boolean): void {
  const walking = new Walking(terrain)
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    stepWorld(world, terrain, walking)
    if (t % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (each()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** The ids of the city's residents its plan gives the `trade` job. */
const traders = (world: WorldState, city: City) =>
  Object.entries(world.cityPlans[city.id]?.jobs ?? {})
    .filter(([, j]) => j.kind === 'trade')
    .map(([id]) => id)

/**
 * Sends the village's trader and follows them until their run is over: one trader at a time,
 * never a second while one is out. Returns what the trader carried as they came home to the
 * storage, before putting it away, and the warehouse's Wood before.
 */
function followRun(world: WorldState, terrain: TerrainMap, city: City, storage: Building) {
  let traderId: string | undefined
  let home: Record<string, number> | undefined
  let left = false
  run(world, terrain, 12, () => {
    const t = world.cityPlans[city.id]?.traders?.[0]
    expect(traders(world, city).length).toBeLessThanOrEqual(1)
    if (t) {
      if (traderId === undefined) traderId = t.residentId
      expect(t.residentId).toBe(traderId)
      const r = world.residents.find((x) => x.id === traderId)!
      if (!isAt(r, storage, terrain.size)) left = true
      else if (left && !home && Object.keys(t.sells).length === 0) home = { ...r.carried }
    }
    return traderId !== undefined && !t
  })
  return { traderId, home }
}

describe('the NPC trader', () => {
  it(
    'a village with 60 surplus Wood and a post 500 tiles away sends one resident who comes back with Iron when Iron is short',
    { timeout: 60_000 },
    () => {
      const { world, terrain, city, storage, warehouse } = villageAndPost(true)
      const woodBefore = warehouse.stock?.wood ?? 0
      const { traderId, home } = followRun(world, terrain, city, storage)
      expect(traderId).toBeDefined()
      expect(world.cityPlans[city.id]?.traders?.[0]).toBeUndefined()
      // 500 tiles there and back: days on the road.
      expect(world.tick).toBeGreaterThan(4 * TICKS_PER_GAME_DAY)
      // They sold Wood there and brought Iron home, now in the storage.
      expect(warehouse.stock?.wood ?? 0).toBeGreaterThan(woodBefore)
      expect(home?.iron ?? 0).toBeGreaterThan(0)
      expect(storage.stock?.iron ?? 0).toBeGreaterThan(0)
      const r = world.residents.find((x) => x.id === traderId)!
      expect(r.health).toBeGreaterThan(0)
      expect(r.carried.wood ?? 0).toBe(0)
    },
  )

  it(
    'with nothing short it has no node for, the trader comes back with coins',
    { timeout: 60_000 },
    () => {
      const { world, terrain, city, storage } = villageAndPost(false)
      const coinsBefore = storage.stock?.coins ?? 0
      const { traderId, home } = followRun(world, terrain, city, storage)
      expect(traderId).toBeDefined()
      expect(home?.coins ?? 0).toBeGreaterThan(0)
      expect(home?.iron ?? 0).toBe(0)
      expect(storage.stock?.coins ?? 0).toBeGreaterThan(coinsBefore)
    },
  )

  it('a trader who dies is replaced only after the give-up time', () => {
    const { world, terrain, city } = villageAndPost(true)
    planCity(world, city, terrain)
    const first = world.cityPlans[city.id]!.traders![0]!
    expect(traders(world, city)).toEqual([first.residentId])
    // Two traders never: the next pass keeps the one out.
    planCity(world, city, terrain)
    expect(traders(world, city)).toEqual([first.residentId])
    world.residents = world.residents.filter((r) => r.id !== first.residentId)
    world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) / 2
    planCity(world, city, terrain)
    expect(world.cityPlans[city.id]!.traders?.[0]?.residentId).toBe(first.residentId)
    expect(traders(world, city)).toEqual([])
    world.tick += NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY
    planCity(world, city, terrain)
    const next = world.cityPlans[city.id]!.traders?.[0]
    expect(next?.residentId).toBeDefined()
    expect(next?.residentId).not.toBe(first.residentId)
    expect(next?.since).toBe(world.tick)
  })

  it('sells a full load of its surplus and plans to buy the Iron it has no node for', () => {
    const { world, terrain, city, warehouse } = villageAndPost(true)
    const plan = planCity(world, city, terrain)
    const t = plan.traders![0]!
    expect(t.warehouseId).toBe(warehouse.id)
    expect(Object.keys(t.sells)).toEqual(['wood'])
    expect(t.sells.wood).toBeGreaterThan(0)
    expect(t.sells.wood).toBeLessThanOrEqual(60)
    expect(Object.keys(t.buys)).toEqual(['iron'])
    const r = world.residents.find((x) => x.id === t.residentId)!
    expect(canWork(r, world.tick)).toBe(true)
    expect(plan.jobs[r.id]).toEqual({ kind: 'trade' })
  })

  it('sends no trader while Food is short, with too little surplus, or with no warehouse in reach', () => {
    const short = villageAndPost(true)
    short.storage.stock!.food = 0
    expect(planCity(short.world, short.city, short.terrain).traders?.[0]).toBeUndefined()
    const little = villageAndPost(true)
    little.storage.stock!.wood = (npcReserve(little.world, little.city).wood ?? 0) + 3
    expect(planCity(little.world, little.city, little.terrain).traders?.[0]).toBeUndefined()
    const far = villageAndPost(true)
    far.world.buildings = far.world.buildings.filter((b) => b.kind !== 'warehouse')
    expect(planCity(far.world, far.city, far.terrain).traders?.[0]).toBeUndefined()
    // Nor with an armed outsider in its area.
    const watched = villageAndPost(true)
    const one = cityResidents(watched.world, watched.city)[0]!
    watched.world.residents.push({
      ...structuredClone(one),
      id: 'outsider',
      owner: 'realm-x',
      cityId: null,
      x: watched.storage.x,
      y: watched.storage.y,
      carried: { spear: 1 },
    })
    expect(planCity(watched.world, watched.city, watched.terrain).traders?.[0]).toBeUndefined()
    // And never a soldier: with every adult armed there is nobody to send.
    const armed = villageAndPost(true)
    for (const r of cityResidents(armed.world, armed.city)) r.carried.spear = 1
    expect(planCity(armed.world, armed.city, armed.terrain).traders?.[0]).toBeUndefined()
  })
})

describe('more traders from a bigger city', () => {
  /** More of each than any one load, so the number of traders is all that holds them back. */
  const plenty: Stock = { wood: 500, stone: 500, iron: 500, planks: 500 }

  it('goes by its residents, and a village keeps one', () => {
    const count = (residents: number) => {
      const { world, city } = cityAndPost(residents, {})
      return tradersWanted(world, city)
    }
    expect(count(NPC_VILLAGE.residents)).toBe(1)
    expect(count(NPC_TOWN.residents)).toBe(1)
    expect(count(2 * NPC_RESIDENTS_PER_TRADER - 1)).toBe(1)
    expect(count(2 * NPC_RESIDENTS_PER_TRADER)).toBe(2)
    expect(count(3 * NPC_RESIDENTS_PER_TRADER + 10)).toBe(3)
  })

  it('a village with goods for several still sends one', () => {
    const { world, terrain, city } = cityAndPost(NPC_VILLAGE.residents, plenty)
    planCity(world, city, terrain)
    expect(runs(world, city)).toHaveLength(1)
    expect(traders(world, city)).toHaveLength(1)
    // And keeps to one on the next pass.
    planCity(world, city, terrain)
    expect(runs(world, city)).toHaveLength(1)
    expect(npcTradersSound.check(world, terrain)).toEqual([])
  })

  it('a big city sends as many as the number, each with their own load of their own good', () => {
    const { world, terrain, city, warehouse } = cityAndPost(3 * NPC_RESIDENTS_PER_TRADER, plenty)
    planCity(world, city, terrain)
    const out = runs(world, city)
    expect(out).toHaveLength(3)
    expect(traders(world, city).sort()).toEqual(out.map((t) => t.residentId).sort())
    expect(new Set(out.map((t) => t.residentId)).size).toBe(3)
    const goods = out.map((t) => Object.keys(t.sells))
    expect(goods.every((g) => g.length === 1)).toBe(true)
    expect(new Set(goods.flat()).size).toBe(3)
    expect(out.every((t) => t.warehouseId === warehouse.id)).toBe(true)
    expect(npcTradersSound.check(world, terrain)).toEqual([])
    // The next pass keeps them and sends nobody more.
    planCity(world, city, terrain)
    expect(runs(world, city).map((t) => t.residentId)).toEqual(out.map((t) => t.residentId))
    expect(traders(world, city)).toHaveLength(3)
  })

  it('sends no more than it has goods to sell', () => {
    const size = 3 * NPC_RESIDENTS_PER_TRADER
    const first = cityAndPost(size, { wood: 500 })
    planCity(first.world, first.city, first.terrain)
    // With only Wood to sell and plenty of it, they all take Wood.
    expect(runs(first.world, first.city).map((t) => Object.keys(t.sells))).toEqual([
      ['wood'],
      ['wood'],
      ['wood'],
    ])
    // Each carries what fits in their own arms.
    const [one, two] = runs(first.world, first.city).map((t) => t.sells.wood!) as [number, number]
    const sent = (wood: number) => {
      const f = cityAndPost(size, { wood })
      planCity(f.world, f.city, f.terrain)
      return runs(f.world, f.city).map((t) => t.sells.wood)
    }
    expect(sent(one - 1)).toEqual([])
    expect(sent(one)).toEqual([one])
    // Less than a second load more sends no second: the first isn't fetched yet, and it is spoken for.
    expect(sent(one + two - 1)).toEqual([one])
    expect(sent(one + two)).toEqual([one, two])
  })

  it('counts a load already fetched as gone from the storage, not as spoken for', () => {
    const { world, terrain, city, storage } = cityAndPost(3 * NPC_RESIDENTS_PER_TRADER, {
      wood: 500,
    })
    planCity(world, city, terrain)
    const [one, two] = runs(world, city).map((t) => t.sells.wood!) as [number, number]
    const reserve = npcReserve(world, city).wood ?? 0
    world.cityPlans[city.id]!.traders = runs(world, city).slice(0, 1)
    const r = world.residents.find((x) => x.id === runs(world, city)[0]!.residentId)!
    // Not quite both loads past the reserve: while the first is theirs to fetch, nobody else goes.
    storage.stock!.wood = reserve + one + two - 1
    planCity(world, city, terrain)
    expect(runs(world, city)).toHaveLength(1)
    // Fetched, it has left the storage, and what is there now makes the next one's load.
    r.carried.wood = one
    planCity(world, city, terrain)
    expect(runs(world, city)).toHaveLength(2)
  })

  it('buys what is short only once between them', () => {
    const { world, terrain, city, storage } = cityAndPost(3 * NPC_RESIDENTS_PER_TRADER, plenty)
    delete storage.stock![NPC_SMITHY_WEAPON]
    storage.stock!.iron = 0
    planCity(world, city, terrain)
    expect(runs(world, city).length).toBeGreaterThan(1)
    expect(runs(world, city).filter((t) => t.buys.iron)).toHaveLength(1)
  })

  it('never makes a trader of a soldier', () => {
    const { world, terrain, city } = cityAndPost(3 * NPC_RESIDENTS_PER_TRADER, plenty)
    const everyone = cityResidents(world, city)
    for (const r of everyone) r.carried.spear = 1
    planCity(world, city, terrain)
    expect(runs(world, city)).toEqual([])
    for (const r of everyone.slice(-40)) delete r.carried.spear
    planCity(world, city, terrain)
    const armed = new Set(everyone.slice(0, -40).map((r) => r.id))
    expect(runs(world, city).length).toBeGreaterThan(0)
    expect(runs(world, city).filter((t) => armed.has(t.residentId))).toEqual([])
  })

  it('replaces a dead trader after the give-up time, and only them', () => {
    const { world, terrain, city } = cityAndPost(3 * NPC_RESIDENTS_PER_TRADER + 10, plenty)
    planCity(world, city, terrain)
    const [dead, ...rest] = runs(world, city)
    expect(rest).toHaveLength(2)
    world.residents = world.residents.filter((r) => r.id !== dead!.residentId)
    world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) / 2
    for (const t of rest) t.since = world.tick
    // Not before then: the city doesn't know.
    planCity(world, city, terrain)
    expect(runs(world, city).map((t) => t.residentId)).toContain(dead!.residentId)
    expect(traders(world, city)).toHaveLength(2)
    world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) / 2 + 1
    planCity(world, city, terrain)
    const now = runs(world, city)
    expect(now).toHaveLength(3)
    expect(now.map((t) => t.residentId)).not.toContain(dead!.residentId)
    for (const t of rest) expect(now.map((n) => n.residentId)).toContain(t.residentId)
    expect(now.at(-1)!.since).toBe(world.tick)
  })

  it('two traders walk out at once, sell their own loads and come home', { timeout: 60_000 }, () => {
    const { world, terrain, city, storage, warehouse } = cityAndPost(
      2 * NPC_RESIDENTS_PER_TRADER,
      { wood: 500, stone: 500 },
      150,
    )
    const before = { wood: warehouse.stock?.wood ?? 0, stone: warehouse.stock?.stone ?? 0 }
    planCity(world, city, terrain)
    const first = runs(world, city).map((t) => t.residentId)
    expect(first).toHaveLength(2)
    let both = false
    run(world, terrain, 6, () => {
      const out = runs(world, city).map((t) => t.residentId)
      expect(out.length).toBeLessThanOrEqual(2)
      const away = first.filter(
        (id) => !isAt(world.residents.find((r) => r.id === id)!, storage, terrain.size),
      )
      if (away.length === 2) both = true
      return !first.some((id) => out.includes(id))
    })
    expect(both).toBe(true)
    expect(runs(world, city).map((t) => t.residentId)).not.toContain(first[0])
    expect(runs(world, city).map((t) => t.residentId)).not.toContain(first[1])
    expect(warehouse.stock?.wood ?? 0).toBeGreaterThan(before.wood)
    expect(warehouse.stock?.stone ?? 0).toBeGreaterThan(before.stone)
  })

  it('a trader out in the old format carries on after the migration', { timeout: 60_000 }, () => {
    const { world, terrain, city, storage, warehouse } = villageAndPost(true)
    planCity(world, city, terrain)
    const woodBefore = warehouse.stock?.wood ?? 0
    const run_ = runs(world, city)[0]!
    const old = world.cityPlans[city.id] as CityPlan & { trader?: CityTrader }
    old.trader = run_
    delete old.traders
    const migrated = migrateWorld(structuredClone(world), 104, { terrain })
    const city2 = migrated.cities.find((c) => c.id === city.id)!
    const storage2 = migrated.buildings.find((b) => b.id === storage.id)!
    expect(migrated.cityPlans[city.id]).not.toHaveProperty('trader')
    expect(runs(migrated, city2)).toEqual([run_])
    const { traderId } = followRun(migrated, terrain, city2, storage2)
    expect(traderId).toBe(run_.residentId)
    const sold = migrated.buildings.find((b) => b.id === warehouse.id)!
    expect(sold.stock?.wood ?? 0).toBeGreaterThan(woodBefore)
    expect(runs(migrated, city2)).toEqual([])
  })

  describe('the invariant', () => {
    const staged = () => {
      const f = cityAndPost(2 * NPC_RESIDENTS_PER_TRADER, { wood: 500, stone: 500 })
      planCity(f.world, f.city, f.terrain)
      expect(npcTradersSound.check(f.world, f.terrain)).toEqual([])
      return { ...f, plan: f.world.cityPlans[f.city.id]! }
    }

    it('flags a trade job with no run', () => {
      const { world, terrain, plan } = staged()
      plan.traders!.pop()
      expect(npcTradersSound.check(world, terrain)).toHaveLength(1)
    })

    it('flags one resident on two runs', () => {
      const { world, terrain, plan } = staged()
      plan.traders![1]!.residentId = plan.traders![0]!.residentId
      expect(npcTradersSound.check(world, terrain).length).toBeGreaterThan(0)
    })

    it('flags more sent than its size allows, past one for a death', () => {
      const { world, terrain, plan } = staged()
      const others = world.residents.filter((r) => !plan.jobs[r.id] || plan.jobs[r.id]!.kind !== 'trade')
      const extra = (id: string): CityTrader => ({ ...plan.traders![0]!, residentId: id })
      plan.traders!.push(extra(others[0]!.id))
      expect(npcTradersSound.check(world, terrain)).toEqual([])
      plan.traders!.push(extra(others[1]!.id))
      expect(npcTradersSound.check(world, terrain).length).toBeGreaterThan(0)
    })

    it('does not flag more out than its size allows now, sent before it shrank', () => {
      const { world, terrain, plan, city } = staged()
      const kept = new Set(plan.traders!.map((t) => t.residentId))
      world.residents = world.residents.filter((r) => r.cityId !== city.id || kept.has(r.id))
      world.tick++
      expect(npcTradersSound.check(world, terrain)).toEqual([])
    })
  })
})
