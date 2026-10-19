import {
  BATCHES_PER_DAY,
  RECIPES,
  Terrain,
  TICKS_PER_GAME_DAY,
  WORKPLACE_MAX_WORKERS,
  batchWork,
  buildProblem,
  inputAt,
  pileAt,
  workplaceGood,
  type BuildingKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { buildingsInPlace, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with Mountain at (5, 5) and Hills (an iron ore node) at (7, 5). */
const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
terrain.tiles[5 * 16 + 5] = Terrain.Mountain
terrain.tiles[5 * 16 + 7] = Terrain.Hills
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world with realm r1 (Player 7), a finished `kind` at (2, 2) and resident w1 working it. */
function setup(kind: BuildingKind) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.nodes.push({ id: 'n1', kind: 'ironOre', x: 7, y: 5 })
  world.buildings.push({ id: kind, kind, cityId: null, x: 2, y: 2 })
  const r = resident(world, 'w1')
  const queue = new OrderQueue()
  expect(queue.receive(world, me, 'q', { kind: 'workAt', residentId: 'w1' })).toEqual({
    type: 'ack',
    requestId: 'q',
  })
  queue.applyAll(world)
  return { world, r, place: world.buildings[0]!, queue }
}

/** A resident of r1 on (2, 2) with Strength, Intellect and Endurance 10. */
function resident(world: WorldState, id: string) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    x: 2,
    y: 2,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  r.stats.endurance = { base: 10, trained: 0 }
  world.residents.push(r)
  return r
}

/** Steps the world, keeping residents fed. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

/** All units of a good anywhere: carried, in piles and in storages. */
function total(world: WorldState, good: 'ironOre' | 'iron' | 'goldOre' | 'coins') {
  return (
    world.residents.reduce((n, r) => n + (r.carried[good] ?? 0), 0) +
    world.piles.reduce((n, p) => n + (p.goods[good] ?? 0), 0) +
    world.buildings.reduce((n, b) => n + (b.stock?.[good] ?? 0), 0)
  )
}

describe('conversion rates (balance file)', () => {
  it('a smelter turns 2 iron ore into 1 iron, a mint 1 gold ore into 20 coins', () => {
    expect(RECIPES.smelter).toEqual({ input: { ironOre: 2 }, output: { iron: 1 } })
    expect(RECIPES.mint).toEqual({ input: { goldOre: 1 }, output: { coins: 20 } })
    expect(BATCHES_PER_DAY.smelter).toBeGreaterThan(0)
    expect(BATCHES_PER_DAY.mint).toBeGreaterThan(0)
  })

  it('an average worker gets through BATCHES_PER_DAY a game day', () => {
    const { r } = setup('smelter')
    expect(batchWork(r, 'smelter', 0) * TICKS_PER_GAME_DAY).toBeCloseTo(BATCHES_PER_DAY.smelter!)
    r.skills.smelting = 10
    expect(batchWork(r, 'smelter', 0) * TICKS_PER_GAME_DAY).toBeGreaterThan(
      BATCHES_PER_DAY.smelter!,
    )
  })
})

describe('smelter and mint', () => {
  it('make iron and coins', () => {
    const smelter = setup('smelter')
    const mint = setup('mint')
    expect(workplaceGood(smelter.world, smelter.place)).toBe('iron')
    expect(workplaceGood(mint.world, mint.place)).toBe('coins')
  })

  it('a smelter turns the iron ore its worker carries into iron on its pile, and teaches Smelting', () => {
    const { world, r } = setup('smelter')
    r.carried.ironOre = 10
    run(world, TICKS_PER_GAME_DAY + 2)
    const batches = BATCHES_PER_DAY.smelter!
    expect(pileAt(world, 2, 2)?.goods.iron).toBe(batches)
    expect(r.carried.iron ?? 0).toBe(0)
    expect(r.carried.ironOre).toBe(10 - 2 * batches)
    expect(r.skills.smelting).toBeCloseTo(1, 1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('a mint turns gold ore lying on its tile into coins left there', () => {
    const { world, r } = setup('mint')
    world.piles.push({ id: 'p1', x: 2, y: 2, goods: { goldOre: 1 } })
    run(world, TICKS_PER_GAME_DAY)
    expect(r.carried.coins ?? 0).toBe(0)
    expect(world.piles).toEqual([expect.objectContaining({ goods: { coins: 20 } })])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stands idle without ore: no work, nothing learned', () => {
    const { world, r } = setup('smelter')
    r.carried.ironOre = 1
    run(world, TICKS_PER_GAME_DAY)
    expect(r.order).toMatchObject({ kind: 'workAt', progress: 0 })
    expect(r.skills.smelting ?? 0).toBe(0)
    expect(r.carried).toEqual({ ironOre: 1 })
  })

  it('uses up the workers’ ore first, then the pile, and conserves goods by the recipe', () => {
    const { world, r, place, queue } = setup('smelter')
    const helpers = Array.from({ length: WORKPLACE_MAX_WORKERS.smelter! - 1 }, (_, i) =>
      resident(world, `h${i}`),
    )
    for (const h of helpers) queue.receive(world, me, 'q', { kind: 'workAt', residentId: h.id })
    queue.applyAll(world)
    r.carried.ironOre = 3
    helpers[0]!.carried.ironOre = 1
    world.piles.push({ id: 'p1', x: 2, y: 2, goods: { ironOre: 20, stone: 1 } })
    expect(inputAt(world, place)).toEqual({ ironOre: 24 })
    const ore = (w: WorldState) => total(w, 'ironOre') + 2 * total(w, 'iron')
    for (let half = 0; half < 4; half++) {
      run(world, TICKS_PER_GAME_DAY / 2)
      expect(ore(world)).toBe(24)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(total(world, 'iron')).toBeGreaterThan(0)
    expect(r.carried.ironOre ?? 0).toBe(0)
    expect(helpers[0]!.carried.ironOre ?? 0).toBe(0)
    expect(world.piles[0]?.goods.stone).toBe(1)
  })
})

describe('where smelters and mints go', () => {
  it.each(['smelter', 'mint'] as const)('a %s goes off nodes and off Mountain', (kind) => {
    const world = createWorld(terrain)
    world.nodes.push({ id: 'n1', kind: 'ironOre', x: 7, y: 5 })
    expect(buildProblem(world, 2, 2, kind, terrain)).toBeUndefined()
    expect(buildProblem(world, 5, 5, kind, terrain)).toMatch(/Mountain/)
    expect(buildProblem(world, 7, 5, kind, terrain)).toMatch(/resource node/)
  })

  it('the invariant catches one on a node or on Mountain', () => {
    const world = createWorld(terrain)
    world.nodes.push({ id: 'n1', kind: 'ironOre', x: 7, y: 5 })
    world.buildings.push(
      { id: 'a', kind: 'smelter', cityId: null, x: 7, y: 5 },
      { id: 'b', kind: 'mint', cityId: null, x: 5, y: 5 },
      { id: 'c', kind: 'mint', cityId: null, x: 2, y: 2 },
    )
    expect(buildingsInPlace.check(world, terrain).map((v) => v.entityIds)).toEqual([['a'], ['b']])
  })
})
