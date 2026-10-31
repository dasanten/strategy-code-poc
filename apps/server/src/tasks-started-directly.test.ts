import {
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  TASKS,
  Terrain,
  type Building,
  type OrderRequest,
  type Task,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Tear down, Feed the stable and Breed horses started directly (`CONTEXT.md`: Default script,
 * Started directly; Breeding; Feeding the stable): their target is the param `building` or
 * `stable`; unset, the one on the resident's tile when it starts, never kept between starts. With
 * none there each ends with a reason.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's version of a task's default (`defaultScripts`). */
const script = (task: Task) => 7 * 100 + TASKS.indexOf(task) + 1

/**
 * Realm r1 (Player 7) with city c1: stable st1 at (6, 6) with fed horses h1 and h2 of r1 in it, a
 * storage s1 at (14, 6) with Food, a house hs at (6, 16); resident w1 standing in the stable, w2
 * on an empty tile (24, 24) and w3 on the house.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
  const st1: Building = { id: 'st1', kind: 'stable', cityId: 'c1', x: 6, y: 6, stock: {} }
  const s1: Building = {
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: 14,
    y: 6,
    stock: { food: 200 },
  }
  const hs: Building = { id: 'hs', kind: 'house', cityId: 'c1', x: 6, y: 16 }
  world.buildings.push(st1, s1, hs)
  const horse = (id: string, x: number, y: number) =>
    world.horses.push({
      id,
      realmId: 'r1',
      cityId: null,
      x,
      y,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      name: 'Rowan',
      stats: { speed: 10, strength: 10, endurance: 10 },
      bornAt: 0,
    })
  horse('h1', 6, 6)
  horse('h2', 7, 7)
  const resident = (id: string, x: number, y: number, seed: number) => {
    const r = newResident(mulberry32(seed), { id, owner: 'r1', x, y, tick: 0 })
    r.cityId = 'c1'
    r.stats.strength = { base: 10, trained: 0 }
    r.carried = { food: OWN_FOOD }
    return r
  }
  const w1 = resident('w1', 7, 7, 1)
  const w2 = resident('w2', 24, 24, 2)
  const w3 = resident('w3', 6, 16, 3)
  world.residents.push(w1, w2, w3)
  const scripts = defaultScripts(terrain, [me])
  const orders = new OrderQueue(scripts.kinds, terrain)
  const walking = new Walking(terrain)
  /** One tick as the game runs it: orders, scripts (with invariants), the world steps. */
  const tick = () => {
    for (const r of world.residents) r.hunger = 100
    orders.applyAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
  }
  const give = (order: OrderRequest, residentId = 'w1') => {
    const answer = orders.receive(world, me, 'q', { residentId, ...order })
    expect(answer).toMatchObject({ type: 'ack' })
  }
  const stopped = () => world.events.flatMap((e) => (e.kind === 'scriptStopped' ? [e.reason] : []))
  return { world, st1, w1, w2, w3, tick, give, stopped }
}

describe('Tear down started directly', () => {
  it('tears down the house the resident stands on with Run script; on an empty tile it ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('tearDown') }, 'w3')
    s.give({ kind: 'runScript', scriptId: script('tearDown') }, 'w2')
    s.tick()
    expect(s.w3.order).toMatchObject({ kind: 'tearDown', buildingId: 'hs' })
    expect(s.w2.script).toBeUndefined()
    expect(s.stopped()).toEqual(['no building on their tile'])
    for (let i = 0; i < 3000 && s.w3.script; i++) s.tick()
    expect(s.world.buildings.some((b) => b.id === 'hs')).toBe(false)
    expect(s.w3.script).toBeUndefined()
  })

  it('walks to the building picked before it starts and tears it down', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('tearDown'), params: { building: 'hs' } }, 'w2')
    for (let i = 0; i < 1000 && s.w2.order?.kind !== 'tearDown'; i++) s.tick()
    expect(s.w2.order).toMatchObject({ kind: 'tearDown', buildingId: 'hs' })
  })

  it('never keeps the building: given on the house, run again in the stable it tears that down', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'tearDown', buildingId: 'hs' }, 'w3')
    s.tick()
    expect(s.w3.scriptParams?.[script('tearDown')]).toEqual({ building: 'hs' })
    s.give({ kind: 'walkTo', x: 7, y: 7 }, 'w3')
    for (let i = 0; i < 100 && (s.w3.x !== 7 || s.w3.y !== 7); i++) s.tick()
    s.give({ kind: 'runScript', scriptId: script('tearDown') }, 'w3')
    s.tick()
    expect(s.w3.order).toMatchObject({ kind: 'tearDown', buildingId: 'st1' })
    expect(s.w3.scriptParams?.[script('tearDown')]).toBeUndefined()
  })
})

describe('Feed the stable started directly', () => {
  it('feeds the stable the resident stands in with Run script; on an empty tile it ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('feedStable') })
    s.give({ kind: 'runScript', scriptId: script('feedStable') }, 'w2')
    s.tick()
    expect(s.w2.script).toBeUndefined()
    expect(s.stopped()).toEqual(['no stable here'])
    expect(s.w1.script?.memory).toMatchObject({ stableId: 'st1' })
    for (let i = 0; i < 300 && !(s.st1.stock?.food ?? 0); i++) s.tick()
    expect(s.st1.stock?.food).toBeGreaterThan(0)
  })

  it('ends once the stable is gone, or when the one picked is no stable', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('feedStable') })
    s.give({ kind: 'runScript', scriptId: script('feedStable'), params: { stable: 's1' } }, 'w2')
    s.tick()
    expect(s.w2.script).toBeUndefined()
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'st1')
    for (let i = 0; i < 300 && s.w1.script; i++) s.tick()
    expect(s.w1.script).toBeUndefined()
    expect(s.stopped()).toEqual(['the one picked is no stable', 'the stable is gone'])
  })

  it('given in the stable fills the param, which the next start clears', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'feedStable', stableId: 'st1', params: { source: 's1' } })
    s.tick()
    expect(s.w1.scriptParams?.[script('feedStable')]).toEqual({ stable: 'st1', source: 's1' })
    s.give({ kind: 'runScript', scriptId: script('feedStable') }, 'w1')
    s.tick()
    expect(s.w1.scriptParams?.[script('feedStable')]).toEqual({ source: 's1' })
    expect(s.w1.script?.memory).toMatchObject({ stableId: 'st1' })
  })
})

describe('Breed horses started directly', () => {
  it('breeds two fed horses in the stable the resident stands in; elsewhere it ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('breed') })
    s.give({ kind: 'runScript', scriptId: script('breed') }, 'w2')
    for (let i = 0; i < 20 && s.w1.order?.kind !== 'breed'; i++) s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'breed', stableId: 'st1', horseIds: ['h1', 'h2'] })
    expect(s.w2.script).toBeUndefined()
    expect(s.stopped()).toEqual(['no stable here'])
  })

  it('ends with no two fed horses in the stable', () => {
    const s = setup()
    s.world.horses = s.world.horses.filter((h) => h.id !== 'h2')
    s.give({ kind: 'runScript', scriptId: script('breed') })
    s.tick()
    expect(s.w1.script).toBeUndefined()
    expect(s.stopped()).toEqual(['no two fed horses here'])
  })

  it('carries on with a paused pair in the stable first', () => {
    const s = setup()
    for (const [id, x] of [
      ['h3', 8],
      ['h4', 8],
    ] as const) {
      s.world.horses.push({ ...s.world.horses[0]!, id, x, y: 8 })
    }
    s.st1.breedings = [{ horseIds: ['h3', 'h4'], progress: 25 }]
    s.give({ kind: 'runScript', scriptId: script('breed') })
    for (let i = 0; i < 20 && s.w1.order?.kind !== 'breed'; i++) s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'breed', horseIds: ['h3', 'h4'] })
    expect((s.w1.order as { progress: number }).progress).toBeGreaterThanOrEqual(25)
  })

  it('walks to the stable picked before it starts and breeds there', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: script('breed'), params: { stable: 'st1' } }, 'w2')
    for (let i = 0; i < 1000 && s.w2.order?.kind !== 'breed'; i++) s.tick()
    expect(s.w2.order).toMatchObject({ kind: 'breed', stableId: 'st1', horseIds: ['h1', 'h2'] })
  })
})
