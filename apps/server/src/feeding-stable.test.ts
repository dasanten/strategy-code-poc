import {
  AVERAGE_HORSE_STATS,
  HORSE_FOOD_PER_DAY,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  STABLE_FEED_DAYS,
  TICKS_PER_GAME_DAY,
  Terrain,
  ticksForAge,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { defaultScripts } from './test-default-scripts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Feeding the stable (`CONTEXT.md`: Feeding the stable): a resident given the task keeps Food for
 * `STABLE_FEED_DAYS` game days for the horses in the stable, fetching what is missing from the
 * nearest storage with Food or the one picked, and waits there while it has enough.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const tasks = defaultScripts(terrain, [me])
/** Two horses' Food for `STABLE_FEED_DAYS`. */
const KEEP = 2 * STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY

/**
 * Realm r1 (Player 7) with city c1 at (10, 14); a stable s1 at (10, 10) holding `food` with horses h1 and
 * h2 in it, a storage near at (14, 10) with 100 Food and one far at (10, 18) with 100; resident
 * w1 standing in the stable.
 */
function setup(food: number) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 14 })
  const stable: Building = { id: 's1', kind: 'stable', cityId: 'c1', x: 10, y: 10, stock: { food } }
  world.buildings.push(
    stable,
    { id: 'near', kind: 'storage', cityId: 'c1', x: 14, y: 10, stock: { food: 100 } },
    { id: 'far', kind: 'storage', cityId: 'c1', x: 10, y: 18, stock: { food: 100 } },
  )
  for (const [id, x] of [
    ['h1', 10],
    ['h2', 12],
  ] as const) {
    world.horses.push({
      id,
      realmId: 'r1',
      cityId: null,
      x,
      y: 11,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
  }
  const w1 = newResident(mulberry32(1), {
    id: 'w1',
    owner: 'r1',
    cityId: 'c1',
    x: 11,
    y: 11,
    tick: 0,
  })
  w1.stats.strength = { base: 10, trained: 0 }
  w1.carried = { food: OWN_FOOD }
  world.residents.push(w1)
  return { world, stable, w1, queue: new OrderQueue(tasks.kinds) }
}

/** Runs scripts and steps the world, keeping the resident fed; `each` sees every tick. */
function run(world: WorldState, ticks: number, each: () => void = () => {}) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks; t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    expect(tasks.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
    each()
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

function give(world: WorldState, queue: OrderQueue, stableId = 's1') {
  const answer = queue.receive(world, me, 'q', {
    kind: 'task',
    task: 'feedStable',
    residentId: 'w1',
    stableId,
  })
  queue.applyAll(world)
  return answer
}

describe('feeding the stable', () => {
  it('fetches what is missing from the nearest storage with Food and stores it in the stable', () => {
    const { world, stable, w1, queue } = setup(3)
    expect(give(world, queue)).toEqual({ type: 'ack', requestId: 'q' })
    expect(w1.script!.memory).toEqual({ stableId: 's1' })
    run(world, 1)
    expect(w1.order).toMatchObject({ kind: 'fetch', goods: { food: Math.ceil(KEEP - 3) } })
    expect(w1.order).toMatchObject({ from: { kind: 'storage', storageId: 'near' } })
    run(world, 200)
    expect(stable.stock!.food).toBeGreaterThanOrEqual(KEEP - 0.1)
    // What they fetched went in; their own food stayed theirs.
    expect(w1.carried.food).toBeGreaterThanOrEqual(OWN_FOOD - 1)
  })

  it('keeps it at the amount while the source has Food, and waits in the stable', () => {
    const { world, stable, w1, queue } = setup(KEEP + 1)
    give(world, queue)
    run(world, 5)
    // Enough: they wait there.
    expect(w1.order).toBeNull()
    expect(stable.stock!.food).toBeGreaterThan(KEEP)
    let lowest = Infinity
    let trips = 0
    let fetching = false
    run(world, 2 * TICKS_PER_GAME_DAY, () => {
      lowest = Math.min(lowest, stable.stock!.food ?? 0)
      if (w1.order?.kind === 'fetch' && !fetching) trips++
      fetching = w1.order?.kind === 'fetch'
    })
    // The horses ate it down; each time it fell below, they brought more at once.
    expect(trips).toBeGreaterThan(0)
    expect(lowest).toBeGreaterThanOrEqual(KEEP - 1) // horses eat whole units
    expect(world.horses.every((h) => h.hunger > 0)).toBe(true)
  })

  it('fetches from the storage picked as source, and feeds the stable picked as stable', () => {
    const { world, stable, w1, queue } = setup(0)
    const other: Building = { id: 's2', kind: 'stable', cityId: 'c1', x: 6, y: 14, stock: {} }
    world.buildings.push(other)
    world.horses.push({
      id: 'h3',
      realmId: 'r1',
      cityId: null,
      x: 7,
      y: 15,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
    give(world, queue)
    w1.scriptParams = { [w1.script!.scriptId]: { source: 'far', stable: 's2' } }
    run(world, 1)
    expect(w1.order).toMatchObject({ kind: 'fetch', from: { kind: 'storage', storageId: 'far' } })
    run(world, 300)
    // One horse's Food at s2; s1 got none.
    expect(other.stock!.food).toBeGreaterThanOrEqual(STABLE_FEED_DAYS * HORSE_FOOD_PER_DAY - 0.1)
    expect(stable.stock!.food ?? 0).toBe(0)
  })

  it('waits in the stable while no storage of the realm has Food', () => {
    const { world, w1, queue } = setup(0)
    for (const b of world.buildings) if (b.kind === 'storage') b.stock = {}
    w1.x = 4
    w1.y = 11
    give(world, queue) // not standing in it
    expect(w1.script).toBeUndefined()
    w1.x = 10
    give(world, queue)
    run(world, 5)
    expect(w1.order).toBeNull()
    expect(w1.script!.memory.fetched).toBeUndefined()
  })

  it('is turned down outside the stable and for a child', () => {
    const { world, w1, queue } = setup(0)
    w1.x = 4
    expect(give(world, queue)).toMatchObject({ reason: 'not standing in that stable' })
    w1.x = 11
    w1.bornAt = world.tick - ticksForAge(5)
    expect(give(world, queue)).toMatchObject({ reason: 'children can’t store or fetch goods' })
  })
})
