import {
  FARM_FOOD_PER_DAY,
  FARM_MAX_WORKERS,
  FARMING_SKILL_EFFECT,
  MAX_HEALTH,
  START_CARRIED_FOOD,
  START_RESIDENTS,
  Terrain,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  carryCapacity,
  farmOutput,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, workOrdersOnWorkplaces } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { cityTerrain, worldWithCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }

/** A world on plains: realm r1 (Player 7), its city c1 with a farm at (3, 3) outside the wall,
 * and resident w1 standing on the farm.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.cities.push({
    id: 'c1',
    name: 'Ashford',
    realmId: 'r1',
    x: 6,
    y: 6,
    size: 5,
    wall: 'wooden',
    gate: { x: 8, y: 10 },
  })
  world.buildings.push({ id: 'farm', kind: 'farm', cityId: 'c1', x: 3, y: 3 })
  const r = resident(world, 'w1', 3, 3)
  return { world, r, queue: new OrderQueue() }
}

/** A resident of realm r1 with Strength, Intellect and Endurance 10. */
function resident(world: WorldState, id: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
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
    r.bornAt = world.tick - 5 * TICKS_PER_GAME_YEAR
    reject('children can’t work')
    r.bornAt = world.tick - 30 * TICKS_PER_GAME_YEAR
    r.x = 5
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
    r.x = 4
    run(world)
    expect(r.order).toBeNull()
  })
})

describe('farm work', () => {
  it(`makes about ${FARM_FOOD_PER_DAY} food a game day into the worker’s hands, and teaches Farming`, () => {
    const { world, r, queue } = setup()
    order(world, queue)
    // Just short of a game day, so none of it spoils yet; the skill learned adds a little.
    run(world, TICKS_PER_GAME_DAY - 2)
    const o = r.order!
    expect(o.kind === 'workAt' && o.progress + r.carried.food!).toBeCloseTo(FARM_FOOD_PER_DAY, 0)
    expect(world.piles).toEqual([])
    expect(r.skills.farming).toBeCloseTo(1, 1)
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
    expect(farmOutput(r, 0)).toBeCloseTo(base * (1 + 10 * FARMING_SKILL_EFFECT))
  })

  it('hands each unit to the worker carrying the least food', () => {
    const { world, r, queue } = setup()
    const other = resident(world, 'w2', 3, 3)
    r.carried = { food: 5 }
    order(world, queue)
    order(world, queue, 'w2')
    run(world, 1700)
    // Two workers make 2 units in that time; the one who had none gets both.
    expect(r.carried.food).toBe(5)
    expect(other.carried.food).toBe(2)
  })

  it('leaves what the workers can’t carry in a pile on the farm’s tile', () => {
    const { world, r, queue } = setup()
    r.carried = { stone: carryCapacity(r, 0) - 1 }
    order(world, queue)
    run(world, 3000) // 2 units, short of a game day so none spoils
    expect(r.carried).toEqual({ stone: carryCapacity(r, 0) - 1, food: 1 })
    expect(world.piles).toEqual([expect.objectContaining({ x: 3, y: 3, goods: { food: 1 } })])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('catches a worker who is not on their farm, or a farm with too many workers', () => {
    const { world, r, queue } = setup()
    order(world, queue)
    r.x = 4
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
})
