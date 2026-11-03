import {
  BUILD_MATERIALS,
  OWN_FOOD,
  TASKS,
  Terrain,
  type Building,
  type OrderRequest,
  type Stock,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner, queuesSound } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { seenScript } from './sight.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Working a site (`CONTEXT.md`: Working a site): Work given or queued on a construction site of a
 * workplace kind builds it first, as Build would, with materials from the nearest storage of the
 * realm holding them, then works it once it is finished, with no new order.
 */

const SIZE = 32
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's version of the Work default (`defaultScripts`). */
const WORK = 7 * 100 + TASKS.indexOf('work') + 1
const AT = { x: 6, y: 6 }

/**
 * Realm r1 (Player 7) with city c1 on Plains: site f1 of a `kind` workplace (a farm unless said)
 * at (6, 6), a quarry on a stone node on Hills, with nothing delivered; storage s1 at (14, 6) holding twice its materials
 * and some Food; and resident w1 standing on the site.
 */
function setup(kind: 'farm' | 'quarry' = 'farm') {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  if (kind === 'quarry') terrain.tiles[AT.y * SIZE + AT.x] = Terrain.Hills
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const f1: Building = {
    id: 'f1',
    kind,
    // A node's workplace belongs to no city (`CONTEXT.md`: Workplace).
    cityId: kind === 'farm' ? 'c1' : null,
    ...AT,
    site: { delivered: {}, work: 0 },
  }
  const stock: Stock = { food: 50 }
  if (kind === 'quarry') world.nodes.push({ id: 'n1', kind: 'stone', ...AT })
  for (const [good, units] of Object.entries(BUILD_MATERIALS[kind]!))
    stock[good as keyof Stock] = units! * 2
  const s1: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 14, y: 6, stock }
  world.buildings.push(f1, s1)
  const w1 = resident(world, 'w1', AT)
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
    expect(queuesSound.check(world, terrain)).toEqual([])
  }
  const give = (order: OrderRequest, residentId = 'w1') =>
    orders.receive(world, me, 'q', { residentId, ...order })
  const stopped = () => world.events.flatMap((e) => (e.kind === 'scriptStopped' ? [e.reason] : []))
  /** Ticks until `done`, at most `n` ticks. */
  const until = (n: number, done: () => boolean) => {
    for (let i = 0; i < n && !done(); i++) tick()
  }
  return { world, terrain, w1, f1, s1, tick, give, stopped, until }
}

function resident(world: ReturnType<typeof createWorld>, id: string, at: { x: number; y: number }) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    ...at,
    tick: 0,
  })
  r.cityId = 'c1'
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food: OWN_FOOD }
  world.residents.push(r)
  return r
}

const work = { kind: 'task', task: 'work', workplaceId: 'f1' } as const

describe('Work on a construction site of a workplace', () => {
  it('builds it with materials from the nearest storage, then works it without a new order', () => {
    const s = setup('quarry')
    expect(s.give(work)).toMatchObject({ type: 'ack' })
    s.until(20, () => s.w1.order?.kind === 'build')
    expect(s.w1.order).toMatchObject({ kind: 'build', siteId: 'f1' })
    expect(s.w1.script?.memory).toMatchObject({ workplaceId: 'f1', siteId: 'f1' })
    // The Doing line says they build it to work it.
    expect(seenScript(s.world, s.w1.script!, true)).toMatchObject({
      building: 'quarry',
      site: true,
    })
    let fetched = false
    s.until(6000, () => {
      fetched ||= s.w1.script?.memory.fetch != null
      return !s.f1.site
    })
    expect(fetched).toBe(true)
    expect(s.f1.site).toBeUndefined()
    // Only what was missing left the storage.
    for (const [good, units] of Object.entries(BUILD_MATERIALS.quarry!))
      expect(s.s1.stock![good as keyof Stock]).toBe(units! * 2 - units!)
    s.until(40, () => s.w1.order?.kind === 'workAt')
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    expect(s.w1.script?.memory.siteId).toBeNull()
    expect(seenScript(s.world, s.w1.script!, true)).not.toHaveProperty('site')
    expect(s.stopped()).toEqual([])
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('is a queue step: they walk there, build it with a Build builder, then work it', () => {
    const s = setup()
    // w1 is elsewhere and queues Work there; w2 builds it with the Build task.
    s.w1.x = 12
    s.w1.y = 12
    const w2 = resident(s.world, 'w2', AT)
    expect(s.give({ kind: 'task', task: 'build', building: 'farm' }, 'w2')).toMatchObject({
      type: 'ack',
    })
    expect(
      s.give({ kind: 'queue', steps: [{ order: { kind: 'walkTo', ...AT } }, { order: work }] }),
    ).toMatchObject({ type: 'ack' })
    s.until(200, () => s.w1.order?.kind === 'build')
    expect(s.w1.queue).toMatchObject({ current: 1 })
    expect(s.w1.order).toMatchObject({ kind: 'build', siteId: 'f1' })
    // One fetcher at a time between the two scripts: the invariant runs every tick.
    s.until(6000, () => !s.f1.site)
    expect(s.f1.site).toBeUndefined()
    s.until(40, () => s.w1.order?.kind === 'workAt')
    expect(s.w1.order).toMatchObject({ kind: 'workAt', buildingId: 'f1' })
    expect(w2.script).toBeUndefined() // Build ended once it was finished
    expect(s.stopped()).toEqual([])
  })

  it('ends with the reason when the site is torn down meanwhile', () => {
    const s = setup()
    s.w1.x = 12
    s.w1.y = 12
    expect(
      s.give({ kind: 'runScript', scriptId: WORK, params: { workplace: 'f1' } }),
    ).toMatchObject({ type: 'ack' })
    s.tick()
    s.tick()
    expect(s.w1.script?.memory.siteId).toBe('f1')
    s.world.buildings = s.world.buildings.filter((b) => b.id !== 'f1')
    s.until(200, () => !s.w1.script)
    expect(s.w1.script).toBeUndefined()
    expect(s.stopped()).toEqual(['the site is gone'])
  })

  it('is refused on a site of a building that is no workplace', () => {
    const s = setup()
    s.world.buildings.push({
      id: 'h1',
      kind: 'house',
      cityId: 'c1',
      x: 20,
      y: 20,
      site: { delivered: {}, work: 0 },
    })
    s.w1.x = 20
    s.w1.y = 20
    expect(s.give({ kind: 'task', task: 'work', workplaceId: 'h1' })).toMatchObject({
      reason: 'there is no workplace to work here',
    })
  })

  it('leaves Build of the same site as it was: it still ends once finished', () => {
    const s = setup()
    s.w1.script = undefined
    expect(s.give({ kind: 'task', task: 'build', building: 'farm' })).toMatchObject({ type: 'ack' })
    s.until(6000, () => !s.f1.site)
    s.until(5, () => !s.w1.script)
    expect(s.w1.script).toBeUndefined()
  })
})
