import {
  WORK_SKILL_PER_DAY,
  FOOTPRINT,
  HOME_FOOD_LOW,
  WORK_OUTPUT_PER_DAY,
  WORKPLACE_MAX_WORKERS,
  WORK_SKILL_EFFECT,
  MAX_HEALTH,
  START_CARRIED_FOOD,
  START_HORSES,
  START_STABLE_FOOD,
  START_RESIDENTS,
  Terrain,
  TICKS_PER_GAME_DAY,
  holdersOf,
  pileAt,
  workOutput,
  ticksForAge,
  type BuildingKind,
  type Resident,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, refilledWhenLow, workOrdersOnWorkplaces } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity, cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with Forest at (3, 1) and Hills at (5, 1) and (7, 1) for the workplaces on nodes. */
const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
terrain.tiles[1 * 16 + 3] = Terrain.Forest
terrain.tiles[1 * 16 + 5] = Terrain.Hills
terrain.tiles[1 * 16 + 7] = Terrain.Hills
const FARM_MAX_WORKERS = WORKPLACE_MAX_WORKERS.farm!
const FARM_FOOD_PER_DAY = WORK_OUTPUT_PER_DAY.food!
const farmOutput = (r: Resident, tick: number) => workOutput(r, 'food', 'farming', tick)
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/** A world on plains: realm r1 (Player 7), its city c1 with a farm at (3, 3) outside the wall,
 * and resident w1 standing on the farm.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.buildings.push({ id: 'farm', kind: 'farm', cityId: 'c1', x: 3, y: 3 })
  addCity(world, { id: 'c1', realmId: 'r1', x: 8, y: 8 })
  const r = resident(world, 'w1', 3, 3)
  return { world, r, queue: new OrderQueue() }
}

/** A resident of a realm (r1 unless given) with Strength, Intellect and Endurance 10. */
function resident(world: WorldState, id: string, x: number, y: number, owner = 'r1') {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  r.stats.endurance = { base: 10, trained: 0 }
  world.residents.push(r)
  return r
}

/** Steps the world, keeping residents fed so their meals don't count against the harvest. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

/** Sends a work-at order, and if accepted applies it and runs the tick that starts it. */
function order(world: WorldState, queue: OrderQueue, residentId = 'w1', sender = me) {
  const answer = queue.receive(world, sender, 'q', { kind: 'workAt', residentId })
  queue.applyAll(world)
  run(world)
  return answer
}

describe('work-at order', () => {
  it('sets a resident to work the farm they stand on, as plain data', () => {
    const { world, r, queue } = setup()
    expect(queue.receive(world, me, 'q1', { kind: 'workAt', residentId: 'w1' })).toEqual({
      type: 'ack',
      requestId: 'q1',
    })
    queue.applyAll(world)
    expect(r.order).toEqual({ kind: 'workAt', buildingId: 'farm', at: { x: 3, y: 3 }, progress: 0 })
    expect(JSON.parse(JSON.stringify(r.order))).toEqual(r.order)
    run(world)
    expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'farm' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('rejects what can’t be worked, and who can’t work', () => {
    const { world, r, queue } = setup()
    const reject = (reason: string, residentId = 'w1', sender = me) =>
      expect(queue.receive(world, sender, 'q', { kind: 'workAt', residentId })).toEqual({
        type: 'rejected',
        requestId: 'q',
        reason,
      })
    reject('not one of your residents', 'w1', stranger)
    reject('not one of your residents', 'nobody')
    r.bornAt = world.tick - ticksForAge(5)
    reject('children can’t work')
    r.bornAt = world.tick - ticksForAge(30)
    r.x = 8
    reject('there is no workplace to work here')
    r.x = 3
    world.buildings[0]!.site = { delivered: {}, work: 0 }
    reject('it is still a construction site')
    delete world.buildings[0]!.site
    order(world, queue)
    reject('already working here')
    expect(queue.size).toBe(0)
  })

  it(`takes at most ${FARM_MAX_WORKERS} workers on a farm`, () => {
    const { world, queue } = setup()
    for (let i = 2; i <= FARM_MAX_WORKERS; i++) resident(world, `w${i}`, 3, 3)
    for (const r of world.residents)
      queue.receive(world, me, 'q', { kind: 'workAt', residentId: r.id })
    queue.applyAll(world)
    run(world)
    const extra = resident(world, 'extra', 3, 3)
    expect(queue.receive(world, me, 'q', { kind: 'workAt', residentId: extra.id })).toMatchObject({
      type: 'rejected',
      reason: `it already has ${FARM_MAX_WORKERS} workers`,
    })
    // Orders accepted in the same tick can't push a farm over its cap: the extra one stops.
    world.residents[0]!.order = null
    const late = resident(world, 'late', 3, 3)
    queue.receive(world, me, 'q', { kind: 'workAt', residentId: extra.id })
    queue.receive(world, me, 'q', { kind: 'workAt', residentId: late.id })
    queue.applyAll(world)
    run(world)
    expect(world.residents.filter((r) => r.order?.kind === 'workAt')).toHaveLength(FARM_MAX_WORKERS)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stops when the resident leaves the farm', () => {
    const { world, r, queue } = setup()
    order(world, queue)
    r.x = 3 + FOOTPRINT.farm // just off its footprint
    run(world)
    expect(r.order).toBeNull()
  })
})

describe('farm work', () => {
  it(`makes about ${FARM_FOOD_PER_DAY} food a game day onto the farm’s pile, and teaches Farming`, () => {
    const { world, r, queue } = setup()
    r.carried = { food: HOME_FOOD_LOW }
    order(world, queue)
    // Just short of a game day, so none of it spoils yet; the skill learned adds a little.
    run(world, TICKS_PER_GAME_DAY - 2)
    const o = r.order!
    const piled = pileAt(world, 3, 3)?.goods.food ?? 0
    expect(o.kind === 'workAt' && o.progress + piled).toBeCloseTo(FARM_FOOD_PER_DAY, 0)
    expect(r.carried).toEqual({ food: HOME_FOOD_LOW })
    expect(r.skills.farming).toBeCloseTo(WORK_SKILL_PER_DAY, 2)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is worked from any tile of the farm, onto its one pile on the north-west tile', () => {
    const { world, r, queue } = setup()
    r.x = r.y = 3 + FOOTPRINT.farm - 1 // its south-east tile
    order(world, queue)
    expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'farm', at: { x: 6, y: 6 } })
    run(world, TICKS_PER_GAME_DAY - 2)
    expect(world.piles.map((p) => [p.x, p.y])).toEqual([[3, 3]])
    expect(pileAt(world, 6, 6)).toBe(pileAt(world, 3, 3))
    expect(pileAt(world, 3, 3)!.goods.food).toBeGreaterThan(0)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('makes more with Strength and Farming skill', () => {
    const { r } = setup()
    const base = farmOutput(r, 0)
    expect(base * TICKS_PER_GAME_DAY).toBeCloseTo(FARM_FOOD_PER_DAY)
    r.stats.strength = { base: 15, trained: 5 }
    expect(farmOutput(r, 0)).toBeCloseTo(base * 2)
    r.stats.strength = { base: 10, trained: 0 }
    r.skills.farming = 10
    expect(farmOutput(r, 0)).toBeCloseTo(base * (1 + 10 * WORK_SKILL_EFFECT))
  })

  it('lets a worker running low take meals from the farm’s pile, and nobody else', () => {
    const { world, r, queue } = setup()
    const other = resident(world, 'w2', 3, 3)
    const idle = resident(world, 'idle', 3, 3)
    r.carried = { food: 5 }
    order(world, queue)
    order(world, queue, 'w2')
    run(world, 1000)
    // Two workers make 4 units in that time: the one who had none takes meals from the pile
    // until no longer low, the rest stays there; a resident who doesn't work there gets none.
    expect(r.carried.food).toBe(5)
    expect(other.carried.food).toBe(HOME_FOOD_LOW)
    expect(idle.carried.food ?? 0).toBe(0)
    expect(pileAt(world, 3, 3)?.goods.food).toBe(4 - HOME_FOOD_LOW)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('catches a worker who runs low while their farm’s pile has Food', () => {
    const { world, r, queue } = setup()
    order(world, queue)
    r.carried = {}
    world.piles.push({ id: 'p', x: 3, y: 3, goods: { food: 4 } })
    expect(refilledWhenLow.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['w1'] }),
    ])
    run(world)
    expect(r.carried.food).toBe(HOME_FOOD_LOW)
    expect(refilledWhenLow.check(world, terrain)).toEqual([])
  })

  it('catches a worker who is not on their farm, or a farm with too many workers', () => {
    const { world, r, queue } = setup()
    order(world, queue)
    r.x = 3 + FOOTPRINT.farm // just off its footprint
    expect(workOrdersOnWorkplaces.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['w1', 'farm'] }),
    ])
    r.x = 3
    for (let i = 0; i < FARM_MAX_WORKERS; i++) {
      resident(world, `x${i}`, 3, 3).order = structuredClone(r.order)
    }
    expect(workOrdersOnWorkplaces.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['farm'] }),
    ])
  })
})

/**
 * Adds a finished workplace of `kind` on a node of `node` at (x, 1) and puts w1 on it, with an
 * order to work it.
 */
function onNode(kind: BuildingKind, node: ResourceKind, x: number) {
  const s = setup()
  s.world.nodes.push({ id: `n${x}`, kind: node, x, y: 1 })
  s.world.buildings.push({ id: kind, kind, cityId: null, x, y: 1 })
  s.r.x = x
  s.r.y = 1
  expect(order(s.world, s.queue)).toEqual({ type: 'ack', requestId: 'q' })
  return s
}

describe('workplaces on nodes', () => {
  it.each([
    ['lumberCamp', 'forest', 3, 'wood', 'woodcutting'],
    ['quarry', 'stone', 5, 'stone', 'mining'],
    ['mine', 'ironOre', 7, 'ironOre', 'mining'],
    ['mine', 'goldOre', 7, 'goldOre', 'mining'],
  ] as const)(
    'a %s on %s makes %s onto the pile on its tile and teaches %s',
    (kind, node, x, good, skill) => {
      const { world, r } = onNode(kind, node, x)
      run(world, TICKS_PER_GAME_DAY - 2)
      const o = r.order!
      expect(o).toMatchObject({ kind: 'workAt', buildingId: kind })
      expect(r.carried[good] ?? 0).toBe(0)
      const piled = pileAt(world, x, 1)?.goods[good] ?? 0
      const made = (o.kind === 'workAt' ? o.progress : 0) + piled
      expect(made).toBeCloseTo(WORK_OUTPUT_PER_DAY[good]!, 0)
      expect(r.skills[skill]).toBeCloseTo(WORK_SKILL_PER_DAY, 2)
      expect(r.skills.farming ?? 0).toBe(0)
      expect(checkInvariants(world, terrain)).toEqual([])
    },
  )

  it('makes more with Strength and the workplace’s skill', () => {
    const { r } = setup()
    const base = workOutput(r, 'ironOre', 'mining', 0)
    expect(base * TICKS_PER_GAME_DAY).toBeCloseTo(WORK_OUTPUT_PER_DAY.ironOre!)
    r.skills.farming = 10
    expect(workOutput(r, 'ironOre', 'mining', 0)).toBeCloseTo(base)
    r.skills.mining = 10
    expect(workOutput(r, 'ironOre', 'mining', 0)).toBeCloseTo(base * (1 + 10 * WORK_SKILL_EFFECT))
  })

  it.each(['lumberCamp', 'quarry', 'mine'] as const)(
    'takes at most its cap of workers on a %s',
    (kind) => {
      const max = WORKPLACE_MAX_WORKERS[kind]!
      const node = ({ lumberCamp: 'forest', quarry: 'stone', mine: 'ironOre' } as const)[kind]
      const { world, queue } = onNode(kind, node, 3)
      for (let i = 2; i <= max; i++) resident(world, `w${i}`, 3, 1)
      for (const r of world.residents.slice(1))
        queue.receive(world, me, 'q', { kind: 'workAt', residentId: r.id })
      queue.applyAll(world)
      run(world)
      const extra = resident(world, 'extra', 3, 1)
      expect(queue.receive(world, me, 'q', { kind: 'workAt', residentId: extra.id })).toMatchObject(
        {
          type: 'rejected',
          reason: `it already has ${max} workers`,
        },
      )
    },
  )

  it('lets a worker running low take meals from a carriage standing there, after the pile', () => {
    const { world, r } = onNode('mine', 'ironOre', 7)
    r.carried = {}
    world.carriages.push({
      id: 'k1',
      realmId: null,
      cityId: null,
      x: 7,
      y: 1,
      horseId: null,
      load: { food: 5 },
    })
    world.piles.push({ id: 'p', x: 7, y: 1, goods: { food: 1 } })
    run(world)
    // The pile's one meal first, then the carriage's.
    expect(r.carried.food).toBe(HOME_FOOD_LOW)
    expect(pileAt(world, 7, 1)).toBeUndefined()
    expect(world.carriages[0]!.load.food).toBe(5 - (HOME_FOOD_LOW - 1))
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stops when the workplace is torn down', () => {
    const { world, r } = onNode('quarry', 'stone', 5)
    world.buildings = world.buildings.filter((b) => b.kind !== 'quarry')
    run(world)
    expect(r.order).toBeNull()
  })

  it('catches a work order for a workplace without a node to work', () => {
    const { world } = onNode('mine', 'ironOre', 7)
    world.nodes = []
    expect(workOrdersOnWorkplaces.check(world, terrain)).toEqual([
      expect.objectContaining({ entityIds: ['w1', 'mine'] }),
    ])
  })
})

describe('holding a workplace', () => {
  /** Realm r2 of the stranger (Player 8), with resident s1 standing on (x, y). */
  function rival(world: WorldState, x: number, y: number) {
    world.realms.push({ id: 'r2', userId: 8, leaderId: 's1' })
    return resident(world, 's1', x, y, 'r2')
  }

  it('lets another realm’s workers take over an empty workplace, and its output', () => {
    const { world, r, queue } = setup()
    const farm = world.buildings[0]!
    expect(holdersOf(world, farm)).toEqual([])
    order(world, queue)
    expect(holdersOf(world, farm)).toEqual(['r1'])
    // r1's worker walks off: the farm (built for r1's city) is nobody's now.
    r.x = 3 + FOOTPRINT.farm // just off its footprint
    run(world)
    expect(holdersOf(world, farm)).toEqual([])
    const s = rival(world, 3, 3)
    expect(order(world, queue, 's1', stranger)).toEqual({ type: 'ack', requestId: 'q' })
    expect(holdersOf(world, farm)).toEqual(['r2'])
    const before = r.carried.food ?? 0
    run(world, TICKS_PER_GAME_DAY / 2)
    expect(s.carried.food ?? 0).toBeGreaterThan(0)
    expect(r.carried.food ?? 0).toBe(before)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('works the same on a workplace of no city', () => {
    const { world, r } = onNode('mine', 'ironOre', 7)
    const mine = world.buildings.find((b) => b.kind === 'mine')!
    r.x = 6
    run(world)
    const s = rival(world, 7, 1)
    expect(order(world, new OrderQueue(), 's1', stranger)).toEqual({ type: 'ack', requestId: 'q' })
    run(world, TICKS_PER_GAME_DAY / 2)
    expect(holdersOf(world, mine)).toEqual(['r2'])
    // The ore lies on the mine's tile, where r2's worker stands guard over it.
    expect(pileAt(world, 7, 1)?.goods.ironOre ?? 0).toBeGreaterThan(0)
    expect([s.x, s.y]).toEqual([7, 1])
    expect(r.carried.ironOre ?? 0).toBe(0)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('a starting city', () => {
  it('lives on from its farm: nobody starves and food piles up (`CONTEXT.md`: Eating)', () => {
    const { world } = worldWithCity()
    const terrain = cityTerrain()
    for (let t = 0; t < 6 * TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain)
    expect(world.residents).toHaveLength(8)
    expect(world.realms).toHaveLength(1)
    for (const r of world.residents) {
      expect(r.health).toBe(MAX_HEALTH)
      expect(r.order?.kind).toBe('workAt')
    }
    // More is made than eaten: there is more food on the farm than the workers brought.
    const carried = world.residents.reduce((n, r) => n + (r.carried.food ?? 0), 0)
    const piled = world.piles.reduce((n, p) => n + (p.goods.food ?? 0), 0)
    expect(carried + piled).toBeGreaterThan(START_RESIDENTS * START_CARRIED_FOOD)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('holds its Food over 10 game days with 2 of 8 on the farm, horses included', () => {
    const { world, terrain } = worldWithCity()
    const storage = world.buildings.find((b) => b.kind === 'storage')!
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    // The two strongest stay on the farm, as a Player would pick them; the other six are at home
    // by the storage, doing nothing.
    const byStrength = [...world.residents].sort(
      (a, b) => b.stats.strength.base - a.stats.strength.base,
    )
    for (const r of byStrength.slice(2)) {
      r.order = null
      r.x = storage.x
      r.y = storage.y
    }
    const food = () =>
      (storage.stock?.food ?? 0) +
      world.piles.reduce((n, p) => n + (p.goods.food ?? 0), 0) +
      world.residents.reduce((n, r) => n + (r.carried.food ?? 0), 0)
    const atStart = food()
    let fewest = atStart
    for (let day = 0; day < 10; day++) {
      for (let t = 0; t < TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain)
      fewest = Math.min(fewest, food())
    }
    expect(world.residents).toHaveLength(8)
    for (const r of world.residents) expect(r.health).toBe(MAX_HEALTH)
    // The horses eat from the stable's own ten game days of food; a foal may have come.
    expect(world.horses.length).toBeGreaterThanOrEqual(START_HORSES)
    for (const h of world.horses) expect(h.health).toBe(MAX_HEALTH)
    expect(stable.stock?.food ?? 0).toBeLessThan(START_STABLE_FOOD)
    // Only the residents' own food above `HOME_FOOD_LOW` is eaten down; the farm makes up the rest.
    const ownFoodEaten = START_RESIDENTS * (START_CARRIED_FOOD - HOME_FOOD_LOW)
    expect(fewest).toBeGreaterThanOrEqual(atStart - ownFoodEaten - 2)
    expect(food()).toBeGreaterThanOrEqual(atStart - ownFoodEaten)
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})
