import {
  NPC_VILLAGE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  WAREHOUSE_FLOOR,
  canWork,
  freeHousing,
  tileIndex,
  warehouseKeeps,
  type Building,
  type City,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { hqProject } from './hq-growth.js'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { shortGoods, tradeOrgReserve, warehouseFor } from './npc-chain.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity, tradeOrgSendsNoOne } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { worldWithCity } from './test-terrain.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Trading posts and the HQ run the chain (`CONTEXT.md`: Trading post, Trade Org HQ): their
 * warehouses' stock floor is their reserve, their spare hands work and build for what is short of
 * it, and the output goes into the warehouse.
 */

/** A trading post alone on a Plains map, its warehouse at its floor but for no Iron ore. */
function post(ore: boolean): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(200)
  const world = createWorld(terrain)
  const city = foundTradingPost(world, terrain, 40, 40, undefined, mulberry32(3))
  if (ore) {
    const home = npcHome(world, city)!
    const node = { id: 'n-ore', kind: 'ironOre' as const, x: home.x + 30, y: home.y }
    world.nodes.push(node)
    terrain.tiles[tileIndex(terrain.size, node.x, node.y)] = Terrain.Hills
  }
  const stock: Partial<Record<Good, number>> = { ...WAREHOUSE_FLOOR, ironOre: 0 }
  warehouse(world, city).stock = { ...stock, wood: 200, stone: 200 }
  return { world, terrain, city }
}

const warehouse = (world: WorldState, city: City) =>
  world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!

describe('a trading post runs the chain for its warehouse', () => {
  it('is short of what its warehouse lacks of its floor, Food aside', () => {
    const { world, city } = post(false)
    expect(tradeOrgReserve(world, city)).toEqual(
      expect.objectContaining({ ironOre: WAREHOUSE_FLOOR.ironOre, coins: WAREHOUSE_FLOOR.coins }),
    )
    expect(tradeOrgReserve(world, city).food).toBeUndefined()
    expect(shortGoods(world, city)[0]).toBe('ironOre')
    // Its loads go to the warehouse, its Food to the storage its residents eat from.
    expect(warehouseFor(world, city, ['ironOre'])?.id).toBe(warehouse(world, city).id)
    expect(warehouseFor(world, city, ['food'])).toBeUndefined()
  })

  it('with no node in reach builds nothing and its warehouse is left to what is brought', () => {
    const { world, terrain, city } = post(false)
    const plan = planCity(world, city, terrain)
    expect(plan.project).toBeUndefined()
    expect(Object.values(plan.jobs).some((j) => j.kind === 'trade' || j.kind === 'found')).toBe(
      false,
    )
  })

  it(
    'with an iron node in reach builds a mine, and its ore goes into the warehouse',
    { tags: ['slow'], timeout: 180_000 },
    () => {
      const { world, terrain, city } = post(true)
      const store = warehouse(world, city)
      const walking = new Walking(terrain)
      const storage = npcHome(world, city)!
      expect(planCity(world, city, terrain).project).toEqual(
        expect.objectContaining({ kind: 'build', building: 'mine' }),
      )
      /**
       * Runs the world, checking the invariants once a game day, until `done` or `days` pass. With
       * `buyer`, each morning a buyer takes the warehouse's Iron ore while it holds no more than its
       * floor, so the post stays short of it.
       */
      const run = (days: number, done: () => boolean, buyer = false) => {
        for (let day = 0; day < days && !done(); day++) {
          for (let t = 0; t < TICKS_PER_GAME_DAY && !done(); t++) {
            const morning = world.tick % TICKS_PER_GAME_DAY === 0
            if (buyer && morning && (store.stock?.ironOre ?? 0) <= WAREHOUSE_FLOOR.ironOre) {
              store.stock = { ...store.stock, ironOre: 0 }
            }
            stepWorld(world, terrain, walking)
          }
          expect(checkInvariants(world, terrain)).toEqual([])
        }
      }
      const mine = () => world.buildings.find((b) => b.kind === 'mine' && !b.site)
      run(20, () => mine() !== undefined)
      expect(city.workplaceIds).toContain(mine()?.id)
      // Nothing tops the warehouse up: it holds Iron ore only by what its miners brought, and
      // nothing of it in the storage.
      run(30, () => (store.stock?.ironOre ?? 0) > WAREHOUSE_FLOOR.ironOre, true)
      expect(store.stock?.ironOre ?? 0).toBeGreaterThan(WAREHOUSE_FLOOR.ironOre)
      expect(storage.stock?.ironOre ?? 0).toBe(0)
      expect(world.cities.length).toBe(1)
    },
  )
})

/*
 * What an idle resident of a Trade Org city holds goes back to where its chain can use it
 * (`CONTEXT.md`: Trade Org HQ, Trading post, Everything is physical; #933): Iron from a building
 * site would otherwise stay in a soldier's hands for good.
 */
describe('an idle resident of a Trade Org city puts their load away', () => {
  /** One of the city's adults, made idle at the city's storage, holding `carried`. */
  function idle(world: WorldState, city: City, carried: Stock): Resident {
    const home = npcHome(world, city)!
    const r = world.residents.find(
      (x) => x.cityId === city.id && canWork(x, world.tick) && !x.carrying,
    )!
    Object.assign(r, { x: home.x, y: home.y, order: null, carried })
    delete r.script
    return r
  }

  /** Runs the world until `done`, checking the invariants as it goes. */
  function runUntil(world: WorldState, terrain: TerrainMap, done: () => boolean): void {
    const walking = new Walking(terrain)
    for (let t = 0; t < 400 && !done(); t++) {
      stepWorld(world, terrain, walking)
      if (t % 25 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(done()).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  }

  /** The Trade Org HQ alone on a Plains map, with its coin and its goods warehouse. */
  function hq() {
    const terrain = plains(640)
    const world = createWorld(terrain)
    const city = foundTradeOrgHq(world, terrain, 320, 320, mulberry32(7))
    const keeping = (good: Good) =>
      world.buildings.find((b) => b.cityId === city.id && warehouseKeeps(world, b).includes(good))!
    return { world, terrain, city, goods: keeping('iron'), coins: keeping('coins') }
  }

  it('a post’s soldier takes Iron to the warehouse, and keeps their weapon and Food', () => {
    const { world, terrain, city } = post(false)
    const store = warehouse(world, city)
    const iron = store.stock?.iron ?? 0
    const r = idle(world, city, { spear: 1, shield: 1, iron: 10, food: OWN_FOOD })
    runUntil(world, terrain, () => r.carried.iron === undefined)
    expect(store.stock?.iron).toBe(iron + 10)
    expect(r.carried.spear).toBe(1)
    expect(r.carried.shield).toBe(1)
    expect(r.carried.food).toBeGreaterThan(0)
    expect(npcHome(world, city)!.stock?.iron ?? 0).toBe(0)
  })

  it('the HQ’s soldier takes Iron to its goods warehouse', () => {
    const { world, terrain, city, goods } = hq()
    const iron = goods.stock?.iron ?? 0
    const r = idle(world, city, { spear: 1, iron: 10, food: OWN_FOOD })
    runUntil(world, terrain, () => r.carried.iron === undefined)
    expect(goods.stock?.iron).toBe(iron + 10)
    expect(r.carried.spear).toBe(1)
    expect(npcHome(world, city)!.stock?.iron ?? 0).toBe(0)
  })

  it('materials go to the warehouse, Coins to the coin warehouse, spare Food to the storage', () => {
    const { world, terrain, city, goods, coins } = hq()
    const before = { wood: goods.stock?.wood ?? 0, coins: coins.stock?.coins ?? 0 }
    const storage = npcHome(world, city)!
    const food = storage.stock?.food ?? 0
    const r = idle(world, city, { wood: 6, coins: 5, food: OWN_FOOD + 3 })
    const put = () => !r.carried.wood && !r.carried.coins && (r.carried.food ?? 0) <= OWN_FOOD
    runUntil(world, terrain, put)
    expect(goods.stock?.wood).toBe(before.wood + 6)
    expect(coins.stock?.coins).toBe(before.coins + 5)
    expect(goods.stock?.coins ?? 0).toBe(0)
    expect(storage.stock?.wood ?? 0).toBe(0)
    expect(storage.stock?.food ?? 0).toBeGreaterThan(food)
  })

  it('a worker keeps the input of the workplace they go to process at', () => {
    const { world, city, goods } = hq()
    const smelter = world.buildings.find((b) => b.kind === 'smelter')!
    const r = idle(world, city, { ironOre: 4, iron: 3 })
    Object.assign(r, { x: goods.x, y: goods.y })
    world.cityPlans[city.id] = {
      plannedAt: 0,
      jobs: { [r.id]: { kind: 'work', buildingId: smelter.id } },
    }
    stepNpcCities(world, 640)
    expect(r.order).toEqual({
      kind: 'drop',
      to: { kind: 'storage', storageId: goods.id },
      goods: { iron: 3 },
    })
  })

  it('a resident with a site to bring Iron to brings it there first', () => {
    const { world, terrain, city, goods } = hq()
    const hall = world.buildings.find((b) => b.id === city.townHallId)!
    const at = { x: hall.x + 60, y: hall.y + 60 }
    const site: Building = {
      id: 'site',
      kind: 'mint',
      cityId: city.id,
      ...at,
      site: { delivered: {}, work: 0 },
    }
    world.buildings.push(site)
    const r = idle(world, city, { iron: 10 })
    Object.assign(r, { x: goods.x, y: goods.y })
    world.residents = [r]
    world.cityPlans[city.id] = {
      plannedAt: 0,
      jobs: {},
      project: { kind: 'build', building: 'mint', ...at },
    }
    stepNpcCities(world, terrain.size, terrain)
    expect(r.order).toBeNull()
    expect(r.script?.task).toBe('build')
  })

  it('an NPC city goes on as before: Wood to its storage, Iron left in hand', () => {
    const terrain = plains(64)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
    const storage = npcHome(world, city)!
    const r = idle(world, city, { wood: 6, iron: 10, food: OWN_FOOD })
    stepNpcCities(world, terrain.size)
    expect(r.order).toEqual({
      kind: 'drop',
      to: { kind: 'storage', storageId: storage.id },
      goods: { wood: 6 },
    })
  })

  it('a Player’s city is not touched', () => {
    const { world, terrain } = worldWithCity()
    const r = world.residents[0]!
    Object.assign(r, { order: null, carried: { iron: 10 } })
    delete r.script
    stepNpcCities(world, terrain.size)
    expect(r.order).toBeNull()
    expect(r.carried.iron).toBe(10)
  })
})

describe('the Trade Org HQ runs the chain', () => {
  it('grows its rings and houses first while too weak, else builds for its warehouses', () => {
    const terrain = plains(640)
    const world = createWorld(terrain)
    const hq = foundTradeOrgHq(world, terrain, 320, 320, mulberry32(7))
    const storage = world.buildings.find((b) => b.cityId === hq.id && b.kind === 'storage')!
    storage.stock = { food: 20_000 }
    const one = world.residents.find((r) => r.cityId === hq.id)!
    for (let i = 0; freeHousing(world, hq) > 0; i++) {
      world.residents.push({ ...structuredClone(one), id: `h${i}` })
    }
    // Strong enough: no house, though its housing is full.
    expect(planCity(world, hq, terrain).project?.building).not.toBe('house')
    // Far too weak against an Organization of many armed residents: a house, as before.
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
    for (let i = 0; i < 200; i++) {
      world.residents.push({
        ...structuredClone(one),
        id: `x${i}`,
        owner: 'r1',
        cityId: null,
        carried: { spear: 1 },
      })
    }
    const before = hqProject(world, hq, terrain)
    expect(before?.building).toBe('house')
    expect(planCity(world, hq, terrain).project).toEqual(before)
    expect(tradeOrgSendsNoOne.check(world, terrain)).toEqual([])
  })

  it('flags a trade or found job given by the Trade Organization', () => {
    const terrain = plains(200)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 40, 40, undefined, mulberry32(3))
    const r = world.residents.find((x) => x.cityId === city.id)!
    world.cityPlans[city.id] = { plannedAt: 0, jobs: { [r.id]: { kind: 'trade' } } }
    expect(tradeOrgSendsNoOne.check(world, terrain)).toHaveLength(1)
  })
})
