import {
  BUILDABLE,
  BUILD_MATERIALS,
  BUILD_WORK,
  FOOTPRINT,
  OFF_NODES,
  RECIPES,
  Terrain,
  WORKPLACE_MAX_WORKERS,
  buildMenu,
  pileAt,
  teardownReturns,
  teardownWork,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with Mountain at (12, 12). */
function map(): TerrainMap {
  const tiles = new Uint8Array(16 * 16).fill(Terrain.Plains)
  tiles[12 * 16 + 12] = Terrain.Mountain
  return { size: 16, tiles }
}
const terrain = map()
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world with realm r1 (Player 7) and resident w1 standing on (x, y), Strength 10. */
function setup(x = 3, y = 3) {
  const world = createWorld({ size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) })
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x, y, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.stats.intellect = { base: 10, trained: 0 }
  world.residents.push(r)
  return { world, r, queue: new OrderQueue(undefined, terrain) }
}

/** Sends an order and, if accepted, applies it; answers 'ack' or why it was rejected. */
function order(world: WorldState, queue: OrderQueue, o: object) {
  const answer = queue.receive(world, me, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping residents fed. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain)
  }
}

const build = { kind: 'build', residentId: 'w1', building: 'trainingGround' }

describe('the training ground (`CONTEXT.md`: Training ground)', () => {
  it('is a 3×3 building anyone can build off nodes and Mountain, from wood and stone', () => {
    expect(FOOTPRINT.trainingGround).toBe(3)
    expect(BUILDABLE).toContain('trainingGround')
    expect(OFF_NODES).toContain('trainingGround')
    expect(buildMenu(undefined)).toContain('trainingGround')
    expect(BUILD_MATERIALS.trainingGround).toEqual({ wood: expect.any(Number), stone: expect.any(Number) })
    expect(BUILD_MATERIALS.trainingGround!.wood!).toBeGreaterThan(BUILD_MATERIALS.trainingGround!.stone!)
    expect(BUILD_WORK.trainingGround).toBeGreaterThan(0)
  })

  it('is no workplace: no workers, no recipe, and nobody can work it', () => {
    expect(WORKPLACE_MAX_WORKERS.trainingGround).toBeUndefined()
    expect(RECIPES.trainingGround).toBeUndefined()
    const { world, queue } = setup()
    world.buildings.push({ id: 'g1', kind: 'trainingGround', cityId: null, x: 3, y: 3 })
    expect(order(world, queue, { kind: 'workAt', residentId: 'w1' })).toBe(
      'there is no workplace to work here',
    )
  })

  it('is laid out, built from its delivered materials and finished like any building, of no city', () => {
    const { world, r, queue } = setup()
    expect(order(world, queue, build)).toBe('ack')
    run(world)
    const site = world.buildings.find((b) => b.site)!
    expect(site).toMatchObject({ kind: 'trainingGround', cityId: null, realmId: 'r1', x: 3, y: 3 })
    expect(checkInvariants(world, terrain)).toEqual([])
    // With its materials there and nearly all the work in, one more tick finishes it.
    site.site!.delivered = { ...BUILD_MATERIALS.trainingGround }
    site.site!.work = BUILD_WORK.trainingGround! - 0.5
    run(world)
    expect(site.site).toBeUndefined()
    expect(site.realmId).toBeUndefined()
    expect(world.buildings).toEqual([{ id: site.id, kind: 'trainingGround', cityId: null, x: 3, y: 3 }])
    expect(r.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('refuses Mountain under any tile of its footprint', () => {
    // From (10, 10) the footprint reaches (12, 12), the Mountain; from (9, 9) it stops short.
    const { world, queue } = setup(10, 10)
    expect(order(world, queue, build)).toBe(
      'a trainingGround goes off any resource node, and not on Mountain',
    )
    expect(world.buildings).toEqual([])
    const ok = setup(9, 9)
    expect(order(ok.world, ok.queue, build)).toBe('ack')
  })

  it('is torn down like any building, leaving part of its materials on the tile', () => {
    const { world, r, queue } = setup()
    const ground = { id: 'g1', kind: 'trainingGround' as const, cityId: null, x: 3, y: 3 }
    world.buildings.push(ground)
    expect(order(world, queue, { kind: 'tearDown', residentId: 'w1', buildingId: 'g1' })).toBe('ack')
    const left = teardownReturns(ground)
    expect(left.wood).toBeGreaterThan(0)
    // Almost torn down already: one tick of work finishes it.
    ground.teardown = teardownWork(ground) - 0.5
    run(world)
    expect(world.buildings).toEqual([])
    expect(pileAt(world, 3, 3)?.goods).toEqual(left)
    expect(r.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})
