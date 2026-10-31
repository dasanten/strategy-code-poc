import {
  NPC_SMITHY_WEAPON,
  NPC_TRADER_GIVE_UP_DAYS,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  canWork,
  cityResidents,
  isAt,
  npcReserve,
  type Building,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * The NPC trader (`CONTEXT.md`: NPC trader): a city with a full load of surplus sends one spare
 * hand to a Trade Org warehouse in reach, who sells it, buys what the city is short of and has no
 * node for, and walks home.
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
    const t = world.cityPlans[city.id]?.trader
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
      expect(world.cityPlans[city.id]?.trader).toBeUndefined()
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
    const first = world.cityPlans[city.id]!.trader!
    expect(traders(world, city)).toEqual([first.residentId])
    // Two traders never: the next pass keeps the one out.
    planCity(world, city, terrain)
    expect(traders(world, city)).toEqual([first.residentId])
    world.residents = world.residents.filter((r) => r.id !== first.residentId)
    world.tick += (NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY) / 2
    planCity(world, city, terrain)
    expect(world.cityPlans[city.id]!.trader?.residentId).toBe(first.residentId)
    expect(traders(world, city)).toEqual([])
    world.tick += NPC_TRADER_GIVE_UP_DAYS * TICKS_PER_GAME_DAY
    planCity(world, city, terrain)
    const next = world.cityPlans[city.id]!.trader
    expect(next?.residentId).toBeDefined()
    expect(next?.residentId).not.toBe(first.residentId)
    expect(next?.since).toBe(world.tick)
  })

  it('sells a full load of its surplus and plans to buy the Iron it has no node for', () => {
    const { world, terrain, city, warehouse } = villageAndPost(true)
    const plan = planCity(world, city, terrain)
    const t = plan.trader!
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
    expect(planCity(short.world, short.city, short.terrain).trader).toBeUndefined()
    const little = villageAndPost(true)
    little.storage.stock!.wood = (npcReserve(little.world, little.city).wood ?? 0) + 3
    expect(planCity(little.world, little.city, little.terrain).trader).toBeUndefined()
    const far = villageAndPost(true)
    far.world.buildings = far.world.buildings.filter((b) => b.kind !== 'warehouse')
    expect(planCity(far.world, far.city, far.terrain).trader).toBeUndefined()
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
    expect(planCity(watched.world, watched.city, watched.terrain).trader).toBeUndefined()
    // And never a soldier: with every adult armed there is nobody to send.
    const armed = villageAndPost(true)
    for (const r of cityResidents(armed.world, armed.city)) r.carried.spear = 1
    expect(planCity(armed.world, armed.city, armed.terrain).trader).toBeUndefined()
  })
})
