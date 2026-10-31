import {
  TICKS_PER_GAME_DAY,
  Terrain,
  WAREHOUSE_FLOOR,
  freeHousing,
  tileIndex,
  type City,
  type Good,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { hqProject } from './hq-growth.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { shortGoods, tradeOrgReserve, warehouseFor } from './npc-chain.js'
import { plains } from './npc-growth.fixture.js'
import { planCity, tradeOrgSendsNoOne } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
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

  it('with no node in reach builds nothing and its warehouse is left to the floor', () => {
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
      // The floor tops the warehouse up to it and never past: above it only by what its miners
      // brought, and nothing of it in the storage.
      run(30, () => (store.stock?.ironOre ?? 0) > WAREHOUSE_FLOOR.ironOre, true)
      expect(store.stock?.ironOre ?? 0).toBeGreaterThan(WAREHOUSE_FLOOR.ironOre)
      expect(storage.stock?.ironOre ?? 0).toBe(0)
      expect(world.cities.length).toBe(1)
    },
  )
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
