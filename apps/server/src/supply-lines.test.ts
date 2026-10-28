import {
  AVERAGE_HORSE_STATS,
  FOOD_PER_DAY,
  HOME_FOOD_LOW,
  HUNGER_DAYS,
  STARVE_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  TICKS_PER_GAME_DAY,
  Terrain,
  wrapDistance,
  type Building,
  type Carriage,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { supplyLinesSound } from './armies.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { die, stepRefill } from './survival.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 48, tiles: new Uint8Array(48 * 48).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world with realm r1 (Player 7) whose city Ash stands at (5, 5), with a storage of plenty of
 * Food at (8, 5) where its Leader a1 stays fed. Carriage k1 of r1 and its horse h1 stand at the
 * storage with driver d1, who carries Food for a long trip. Soldiers s1 and s2 of r1 stand far
 * from home at (30, 30) and (30, 31) with nothing to eat, in army Foot.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', name: 'Ash', realmId: 'r1', x: 5, y: 5 })
  const storage: Building = {
    id: 'st',
    kind: 'storage',
    cityId: 'c1',
    x: 8,
    y: 5,
    stock: { food: 1000 },
  }
  world.buildings.push(storage)
  resident(world, 'a1', 8, 5)
  resident(world, 'd1', 8, 5).carried = { food: 30 }
  resident(world, 's1', 30, 30)
  resident(world, 's2', 30, 31)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 8,
    y: 5,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(horse)
  const carriage: Carriage = {
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x: 8,
    y: 5,
    horseId: null,
    load: {},
  }
  world.carriages.push(carriage)
  const queue = new OrderQueue(undefined, terrain)
  expect(order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['s1', 's2'] })).toBe(
    'ack',
  )
  const armyId = world.armies[0]!.id
  return { world, queue, walking: new Walking(terrain), carriage, storage, armyId }
}

/** A grown resident of r1 at (x, y) with every stat 10, carrying nothing. */
function resident(world: WorldState, id: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'intellect', 'agility'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  r.carried = {}
  world.residents.push(r)
  return r
}

/** Sends an order from Player 7, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, me, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world for `days` game days, checking every invariant now and then. */
function run(world: WorldState, walking: Walking, days: number) {
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    stepWorld(world, terrain, walking)
    if (t % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

const find = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)
const soldiers = (world: WorldState) => ['s1', 's2'].map((id) => find(world, id))

describe('refilling from a carriage', () => {
  it('feeds army members from a carriage of their realm on or next to their tile', () => {
    const { world, carriage } = setup()
    carriage.x = 31
    carriage.y = 31
    carriage.load = { food: 10 }
    stepRefill(world, terrain.size)
    for (const s of soldiers(world)) expect(s!.carried.food).toBe(HOME_FOOD_LOW)
    expect(carriage.load.food).toBe(10 - 2 * HOME_FOOD_LOW)
  })

  it('feeds nobody outside an army, nor from a carriage further off or of another realm', () => {
    const { world, carriage } = setup()
    resident(world, 'x1', 31, 32)
    carriage.x = 32
    carriage.y = 32
    carriage.load = { food: 10 }
    stepRefill(world, terrain.size)
    // x1 is beside it but in no army; s2 is two tiles off.
    expect(find(world, 'x1')!.carried.food).toBeUndefined()
    expect(find(world, 's2')!.carried.food).toBeUndefined()
    carriage.x = 30
    carriage.realmId = 'r2'
    stepRefill(world, terrain.size)
    expect(find(world, 's1')!.carried.food).toBeUndefined()
  })

  it('leaves the Food a haul route keeps on board for the horse', () => {
    const { world, queue, carriage, armyId } = setup()
    carriage.load = { food: 5 }
    const haul = { kind: 'haul', residentId: 'd1', carriageId: 'k1', armyId, goods: ['food'] }
    expect(order(world, queue, { ...haul, keepFood: 4 })).toBe('ack')
    carriage.x = 30
    carriage.y = 32
    stepRefill(world, terrain.size)
    expect(find(world, 's2')!.carried.food).toBe(1)
    expect(find(world, 's1')!.carried.food).toBeUndefined()
    expect(carriage.load.food).toBe(4)
  })
})

describe('supply lines', () => {
  it('take only the Player’s own army as a stop, bringing nothing back', () => {
    const { world, queue, armyId } = setup()
    const haul = {
      kind: 'haul',
      residentId: 'd1',
      carriageId: 'k1',
      goods: ['food'],
      keepFood: 0,
    }
    expect(order(world, queue, { ...haul, armyId: 'nope' })).toBe('not one of your armies')
    expect(order(world, queue, { ...haul, armyId, returnGoods: ['wood'] })).toBe(
      'nothing comes back from an army',
    )
    const drive = { kind: 'drive', residentId: 'd1', carriageId: 'k1' }
    expect(order(world, queue, { ...drive, armyId: 'nope' })).toBe('not one of your armies')
    expect(order(world, queue, { ...drive, armyId })).toBe('ack')
    expect(find(world, 'd1')!.order).toMatchObject({ kind: 'drive', army: armyId })
  })

  it('a supply wagon follows its army and feeds it far from home', () => {
    const { world, queue, walking, carriage, armyId } = setup()
    carriage.load = { food: 60 }
    expect(order(world, queue, { kind: 'drive', residentId: 'd1', carriageId: 'k1', armyId })).toBe(
      'ack',
    )
    expect(order(world, queue, { kind: 'armyWalkTo', armyId, x: 40, y: 20 })).toBe('ack')
    run(world, walking, 4)
    for (const s of soldiers(world)) {
      expect(s).toMatchObject({ x: 40, y: 20 })
      expect(s!.hunger).toBeGreaterThan(0)
    }
    // Right next to the army, diagonals included.
    expect(wrapDistance(terrain.size, carriage, { x: 40, y: 20 })).toBeLessThan(1.5)
    expect(carriage.load.food).toBeLessThan(60)
    // Disbanding the army ends its supply wagon's drive.
    expect(order(world, queue, { kind: 'disbandArmy', armyId })).toBe('ack')
    run(world, walking, 0.01)
    expect(find(world, 'd1')!.order).toBeNull()
  })

  it('a haul route keeps a moving army fed; cutting it starves the army', () => {
    const fed = setup()
    const route = { kind: 'haul', residentId: 'd1', carriageId: 'k1', goods: ['food'] }
    const start = (s: ReturnType<typeof setup>) => {
      expect(order(s.world, s.queue, { ...route, armyId: s.armyId, keepFood: 6 })).toBe('ack')
      const walk = { kind: 'armyWalkTo', armyId: s.armyId, x: 40, y: 40 }
      expect(order(s.world, s.queue, walk)).toBe('ack')
    }
    start(fed)
    run(fed.world, fed.walking, 2)
    // The army moves on; the route goes after it.
    const on = { kind: 'armyWalkTo', armyId: fed.armyId, x: 20, y: 40 }
    expect(order(fed.world, fed.queue, on)).toBe('ack')
    run(fed.world, fed.walking, 3)
    for (const s of soldiers(fed.world)) {
      expect(s).toMatchObject({ x: 20, y: 40 })
      expect(s!.health).toBe(MAX_HEALTH)
    }
    expect(fed.storage.stock!.food).toBeLessThan(1000)

    const cut = setup()
    start(cut)
    // The driver is killed on the way: nothing comes any more.
    run(cut.world, cut.walking, 0.05)
    die(cut.world, find(cut.world, 'd1')!)
    // What they carried, then a full meter, then starving.
    run(cut.world, cut.walking, HOME_FOOD_LOW / FOOD_PER_DAY + HUNGER_DAYS + STARVE_DAYS + 0.5)
    expect(soldiers(cut.world)).toEqual([undefined, undefined])
  })

  it('breaks the invariant when a supply line goes to no army of the realm', () => {
    const { world, queue, armyId } = setup()
    expect(order(world, queue, { kind: 'drive', residentId: 'd1', carriageId: 'k1', armyId })).toBe(
      'ack',
    )
    world.armies = []
    expect(checkInvariants(world, terrain, [supplyLinesSound]).map((v) => v.message)).toEqual([
      `resident d1 supplies army ${armyId}, not one of their realm's`,
    ])
  })
})
