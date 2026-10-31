import {
  OWN_FOOD,
  TASKS,
  Terrain,
  WORKPLACE_MAX_WORKERS,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { paramTarget } from './script-params.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Any known workplace (`CONTEXT.md`: Script parameter, Queue): a Work step, a `workplace` param
 * or an order may name a workplace or construction site the Player knows, in sight or last seen,
 * whoever built it. Any other building, and every storage param, stays the realm's own.
 */

const SIZE = 160
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's version of the Work default (`defaultScripts`). */
const WORK = 7 * 100 + TASKS.indexOf('work') + 1

/**
 * Mara's realm r1 with city c1 and resident w1 at (10, 12); far out of its sight, realm r2's city
 * c2 with farm f9 at (130, 130) and storage s9 beside it, which Mara remembers as last seen.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'x0' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 10, y: 10 })
  addCity(world, { id: 'c2', realmId: 'r2', x: 134, y: 126 })
  const f9: Building = { id: 'f9', kind: 'farm', cityId: 'c2', x: 130, y: 130 }
  const s9: Building = { id: 's9', kind: 'storage', cityId: 'c2', x: 136, y: 130, stock: {} }
  world.buildings.push(f9, s9)
  world.lastSeen[7] = [f9, s9].map((b) => ({ is: 'building' as const, ...b, seenAt: 0 }))
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 10, y: 12, tick: 0 })
  w1.cityId = 'c1'
  w1.stats.strength = { base: 10, trained: 0 }
  w1.carried = { food: OWN_FOOD }
  world.residents.push(w1)
  const scripts = defaultScripts(terrain, [me])
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => (id === 7 ? me : undefined) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  /** One tick as the game runs it: orders, queues, scripts (with invariants), the world steps. */
  const tick = () => {
    for (const r of world.residents) r.hunger = 100
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
  }
  const give = (order: OrderRequest) => {
    const answer = orders.receive(world, me, 'q', { residentId: 'w1', ...order })
    expect(answer).toMatchObject({ type: 'ack' })
  }
  const refused = (order: OrderRequest) =>
    orders.receive(world, me, 'q', { residentId: 'w1', ...order })
  const stopped = () => world.events.flatMap((e) => (e.kind === 'scriptStopped' ? [e.reason] : []))
  /** Ticks until w1 works the far farm, or ends their script, at most `n` ticks. */
  const until = (n: number) => {
    for (let i = 0; i < n && w1.order?.kind !== 'workAt' && (i === 0 || w1.script); i++) tick()
  }
  return { world, w1, f9, tick, give, refused, stopped, until }
}

/** Fills the farm with realm r2's workers, so it is held by someone else. */
function holdFarm(world: ReturnType<typeof setup>['world'], f9: Building) {
  for (let i = 0; i < WORKPLACE_MAX_WORKERS.farm!; i++) {
    const r = newResident(mulberry32(10 + i), {
      id: `x${i}`,
      owner: 'r2',
      x: f9.x,
      y: f9.y,
      tick: 0,
    })
    r.cityId = 'c2'
    r.order = { kind: 'workAt', buildingId: f9.id, at: { x: f9.x, y: f9.y }, progress: 0 }
    world.residents.push(r)
  }
}

describe('a param naming a known workplace', () => {
  it('names a last-seen workplace of another realm, never its storage or one never seen', () => {
    const { world } = setup()
    expect(paramTarget(world, 'r1', 'building', 'f9')).toMatchObject({ is: 'building' })
    expect(paramTarget(world, 'r1', 'building', 's9')).toBeUndefined()
    expect(paramTarget(world, 'r1', 'storage', 's9')).toBeUndefined()
    world.lastSeen[7] = []
    expect(paramTarget(world, 'r1', 'building', 'f9')).toBeUndefined()
  })

  it('is accepted with Run script; the resident walks to it as last seen and works it', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 'f9' } })
    s.until(600)
    expect(s.w1).toMatchObject({ x: 130, y: 130 })
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f9' })
    expect(s.stopped()).toEqual([])
  })

  it('takes a Work step at it in a queue, after a walk there', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [
        { order: { kind: 'walkTo', x: 130, y: 130 } },
        { order: { kind: 'task', task: 'work', workplaceId: 'f9' } },
      ],
    })
    for (let i = 0; i < 600 && s.w1.order?.kind !== 'workAt'; i++) s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f9' })
    expect(s.w1.queue).toMatchObject({ current: 1 })
    // The task fills the param, which the card shows.
    expect(s.w1.scriptParams?.[WORK]).toMatchObject({ workplace: 'f9' })
  })

  it('a storage of another realm stays refused', () => {
    const s = setup()
    expect(s.refused({ kind: 'runScript', scriptId: WORK, params: { storage: 's9' } })).toEqual(
      expect.objectContaining({
        reason: 'storage: must be a storage, a stable or a carriage of yours',
      }),
    )
  })
})

describe('the Work default at a known workplace', () => {
  it('ends with the reason when the workplace is gone on arrival', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 'f9' } })
    s.tick()
    // Torn down while they walk there: they still go where they last saw it.
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'f9')
    s.until(600)
    expect(s.w1.script).toBeUndefined()
    expect(s.w1).toMatchObject({ x: 130, y: 130 })
    expect(s.stopped()).toEqual(['the workplace is gone'])
  })

  it('ends with the reason when the workplace is held by someone else', () => {
    const s = setup()
    holdFarm(s.world, s.f9)
    s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 'f9' } })
    s.until(600)
    expect(s.w1.script).toBeUndefined()
    expect(s.w1).toMatchObject({ x: 130, y: 130 })
    expect(s.stopped()).toEqual(['the farm is held by someone else'])
  })
})
