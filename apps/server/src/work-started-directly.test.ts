import {
  DEFAULT_SCRIPTS,
  OWN_FOOD,
  TASKS,
  Terrain,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { defaultsHaveATarget } from './script-runner.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Work started directly (`CONTEXT.md`: Default script, Started directly; ADR 0014): its
 * workplace is the param `workplace`; unset, the one on the resident's tile when it starts,
 * never kept between starts. With none there it ends with a reason.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's version of the Work default (`defaultScripts`). */
const WORK = 7 * 100 + TASKS.indexOf('work') + 1

/**
 * Realm r1 (Player 7) with city c1: resident w1 standing on farm f1 at (6, 6), a second farm f2
 * at (6, 14), a storage s1 at (12, 6) with Food, and resident w2 on an empty tile (20, 20).
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const f1: Building = { id: 'f1', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  const f2: Building = { id: 'f2', kind: 'farm', cityId: 'c1', x: 6, y: 14 }
  const s1: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 6, stock: { food: 50 } }
  world.buildings.push(f1, f2, s1)
  const resident = (id: string, x: number, y: number, seed: number) => {
    const r = newResident(mulberry32(seed), { id, owner: 'r1', x, y, tick: 0 })
    r.cityId = 'c1'
    r.stats.strength = { base: 10, trained: 0 }
    r.carried = { food: OWN_FOOD }
    return r
  }
  const w1 = resident('w1', 6, 6, 1)
  const w2 = resident('w2', 20, 20, 2)
  world.residents.push(w1, w2)
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
  const give = (order: OrderRequest, residentId = 'w1') => {
    const answer = orders.receive(world, me, 'q', { residentId, ...order })
    expect(answer).toMatchObject({ type: 'ack' })
  }
  const stopped = () => world.events.flatMap((e) => (e.kind === 'scriptStopped' ? [e.reason] : []))
  return { world, w1, w2, tick, give, stopped }
}

describe('Work started directly', () => {
  it('works the farm the resident stands on with Run script; on an empty tile it ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: WORK })
    s.give({ kind: 'runScript', scriptId: WORK }, 'w2')
    s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    expect(s.w1.script?.memory).toMatchObject({ workplaceId: 'f1' })
    // Nothing to work on w2's tile: the script ends, and the realm log says why.
    expect(s.w2.script).toBeUndefined()
    expect(s.w2.order).toBeNull()
    expect(s.stopped()).toEqual(['no workplace on their tile'])
    for (let i = 0; i < 50; i++) s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
  })

  it('as a queue step works the workplace the resident stands on when the step starts', () => {
    const s = setup()
    s.give({
      kind: 'queue',
      steps: [
        { order: { kind: 'walkTo', x: 6, y: 14 } },
        { order: { kind: 'runScript', scriptId: WORK } },
      ],
    })
    for (let i = 0; i < 100 && s.w1.order?.kind !== 'workAt'; i++) s.tick()
    expect(s.w1).toMatchObject({ x: 6, y: 14 })
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f2' })
    expect(s.w1.queue).toMatchObject({ current: 1 })
    expect(s.stopped()).toEqual([])
  })

  it('never keeps the workplace: given at one farm, run again on the other it works that one', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1', params: { foodTake: 4 } })
    s.tick()
    // Giving the task fills the param, which the card shows.
    expect(s.w1.scriptParams?.[WORK]).toEqual({ workplace: 'f1', foodTake: 4 })
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    s.give({ kind: 'walkTo', x: 6, y: 14 })
    for (let i = 0; i < 100 && (s.w1.x !== 6 || s.w1.y !== 14); i++) s.tick()
    s.give({ kind: 'runScript', scriptId: WORK })
    s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f2' })
    // The other params are kept as usual.
    expect(s.w1.scriptParams?.[WORK]).toEqual({ foodTake: 4 })
  })

  it('works the workplace picked before it starts, wherever the resident stands', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 'f2' } })
    for (let i = 0; i < 100 && s.w1.order?.kind !== 'workAt'; i++) s.tick()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f2' })
  })

  it('ends once its workplace is gone, or when the one picked is no workplace', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'work', workplaceId: 'f1' })
    s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 's1' } }, 'w2')
    s.tick()
    expect(s.w2.script).toBeUndefined()
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'f1')
    for (let i = 0; i < 5 && s.w1.script; i++) s.tick()
    expect(s.w1.script).toBeUndefined()
    expect(s.stopped()).toEqual(['the storage is no workplace', 'the workplace is gone'])
  })
})

describe('workers-have-a-workplace invariant', () => {
  it('flags a resident running Work that knows no workplace', () => {
    const { world } = setup()
    const [w1, w2] = world.residents
    w1!.script = { scriptId: WORK, memory: { workplaceId: 'f1' } }
    w2!.script = { scriptId: WORK, memory: {} }
    expect(defaultsHaveATarget(world, () => 'work')).toEqual([
      expect.objectContaining({ invariant: 'workers-have-a-workplace', entityIds: ['w2'] }),
    ])
    expect(defaultsHaveATarget(world, (r) => (r.id === 'w1' ? 'work' : undefined))).toEqual([])
  })

  it('is checked where a Player’s scripts run, once the Work default has run', () => {
    const { world } = setup()
    const work = DEFAULT_SCRIPTS.work as { source: string }
    const shipped = work.source
    // A game default that forgets its workplace, as a bug would.
    work.source = 'param workplace: building\n'
    try {
      const scripts = defaultScripts(terrain, [me])
      world.residents[0]!.script = { scriptId: WORK, memory: {} }
      expect(scripts.runAll(world)).toEqual([
        expect.objectContaining({ invariant: 'workers-have-a-workplace', entityIds: ['w1'] }),
      ])
    } finally {
      work.source = shipped
    }
  })
})
