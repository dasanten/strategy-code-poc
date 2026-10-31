import {
  AVERAGE_HORSE_STATS,
  BUILD_MATERIALS,
  BUILD_WORK,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  TASKS,
  Terrain,
  type Building,
  type OrderRequest,
  type TerrainMap,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { finishSite } from './building.js'
import { outpostStorageRealms } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import { startParamsProblem } from './script-params.js'
import { defaultsHaveATarget } from './script-runner.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Build and Haul started directly (`CONTEXT.md`: Default script, Started directly; ADR 0014):
 * Build's site is the param `site`; unset, the construction site on the resident's tile when it
 * starts, which they join. Haul's carriage is the param `carriage`, but its route comes only
 * from the Haul order: started without one it ends. Neither target is kept between starts.
 */

const SIZE = 32
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** Player 7's versions of the Build and Haul defaults (`defaultScripts`). */
const BUILD = 7 * 100 + TASKS.indexOf('build') + 1
const HAUL = 7 * 100 + TASKS.indexOf('haul') + 1

/**
 * Realm r1 (Player 7) with city c1 and its storage s1 at (12, 6): resident w1 standing on house
 * site hs (6, 6), whose footprint runs to (7, 7); farm site fs of c1 at (14, 12); resident w2 on
 * an empty tile (20, 20) with carriage k1 and horse h1 of the realm.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 9, y: 3 })
  const site = () => ({ delivered: {}, work: 0 })
  const hs: Building = { id: 'hs', kind: 'house', cityId: null, x: 6, y: 6, site: site() }
  const fs: Building = { id: 'fs', kind: 'farm', cityId: 'c1', x: 14, y: 12, site: site() }
  const s1: Building = { id: 's1', kind: 'storage', cityId: 'c1', x: 12, y: 6, stock: { food: 50 } }
  world.buildings.push(hs, fs, s1)
  const resident = (id: string, x: number, y: number, seed: number) => {
    const r = newResident(mulberry32(seed), { id, owner: 'r1', x, y, tick: 0 })
    r.cityId = 'c1'
    r.stats.strength = { base: 10, trained: 0 }
    r.carried = { food: OWN_FOOD }
    return r
  }
  const w1 = resident('w1', 7, 7, 1)
  const w2 = resident('w2', 20, 20, 2)
  world.residents.push(w1, w2)
  world.horses.push({
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 20,
    y: 20,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  })
  world.carriages.push({
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x: 20,
    y: 20,
    horseId: null,
    load: {},
  })
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
  const building = (r: typeof w1) => (r.order?.kind === 'build' ? r.order.siteId : undefined)
  return { world, w1, w2, tick, give, stopped, building }
}

describe('Build started directly', () => {
  it('joins the site the resident stands on with Run script; on an empty tile it ends', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: BUILD })
    s.give({ kind: 'runScript', scriptId: BUILD }, 'w2')
    s.tick()
    // w1 stands on the site's footprint with nobody else of the crew: they stay on their tile
    // (`CONTEXT.md`: Spreading over the footprint).
    expect(s.w1.script?.memory).toMatchObject({
      building: 'house',
      at: { x: 7, y: 7 },
      siteId: 'hs',
    })
    // Nothing to build on w2's tile: the script ends, and the realm log says why.
    expect(s.w2.script).toBeUndefined()
    expect(s.w2.order).toBeNull()
    expect(s.stopped()).toEqual(['no construction site on their tile'])
    for (let i = 0; i < 20 && s.building(s.w1) !== 'hs'; i++) s.tick()
    expect(s.building(s.w1)).toBe('hs')
    // Joined, not laid out anew.
    expect(s.world.buildings.filter((b) => b.site)).toHaveLength(2)
    for (let i = 0; i < 20; i++) s.tick()
    expect(s.world.buildings.find((b) => b.id === 'hs')!.site!.work).toBeGreaterThan(0)
  })

  it('as a queue step joins the site the resident stands on when the step starts', () => {
    const s = setup()
    s.give(
      {
        kind: 'queue',
        steps: [
          { order: { kind: 'walkTo', x: 15, y: 13 } },
          { order: { kind: 'runScript', scriptId: BUILD } },
        ],
      },
      'w2',
    )
    for (let i = 0; i < 100 && s.building(s.w2) !== 'fs'; i++) s.tick()
    expect(s.building(s.w2)).toBe('fs')
    expect(s.w2.queue).toMatchObject({ current: 1 })
    expect(s.stopped()).toEqual([])
  })

  it('joins the site picked before it starts, wherever the resident stands', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: BUILD, params: { site: 'fs' } }, 'w2')
    for (let i = 0; i < 100 && s.building(s.w2) !== 'fs'; i++) s.tick()
    expect(s.building(s.w2)).toBe('fs')
  })

  it('never keeps the site: given Build there, run again on an empty tile it ends', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'build', building: 'farm', at: { x: 14, y: 12 } }, 'w2')
    s.tick()
    // Giving the task to join a site of the realm's fills the param, which the card shows.
    expect(s.w2.scriptParams?.[BUILD]).toEqual({ site: 'fs' })
    s.give({ kind: 'runScript', scriptId: BUILD }, 'w2')
    s.tick()
    expect(s.w2.scriptParams?.[BUILD]).toBeUndefined()
    expect(s.stopped()).toEqual(['no construction site on their tile'])
  })

  it('still lays out a new site as the Build order, with no site to fill', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'build', building: 'storage' }, 'w2')
    for (let i = 0; i < 5 && !s.building(s.w2); i++) s.tick()
    const laid = s.world.buildings.find((b) => b.site && b.x === 20 && b.y === 20)
    expect(laid).toMatchObject({ kind: 'storage' })
    expect(s.building(s.w2)).toBe(laid!.id)
    expect(s.w2.scriptParams?.[BUILD]).toBeUndefined()
  })

  it('ends when the one picked is no construction site', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: BUILD, params: { site: 's1' } })
    s.tick()
    expect(s.w1.script).toBeUndefined()
    expect(s.stopped()).toEqual(['the storage is no construction site'])
  })
})

describe('a construction site is the realm’s that laid it out', () => {
  const asBuilding = [{ name: 'target', type: 'building' as const }]

  it('laid out by the realm’s resident, can be picked as site and as any building param', () => {
    const s = setup()
    s.give({ kind: 'task', task: 'build', building: 'house', at: { x: 9, y: 7 } }, 'w2')
    for (let i = 0; i < 1000 && !s.building(s.w2); i++) s.tick()
    const laid = s.world.buildings.find((b) => b.site && b.x === 9 && b.y === 7)!
    // Of no city until finished, yet the realm's: its resident laid it out.
    expect(laid).toMatchObject({ kind: 'house', cityId: null, realmId: 'r1' })
    expect(startParamsProblem(s.world, 'r1', asBuilding, { target: laid.id })).toBeUndefined()
    // Picked as Build's site, w1 walks over and joins it.
    s.give({ kind: 'runScript', scriptId: BUILD, params: { site: laid.id } })
    for (let i = 0; i < 100 && s.building(s.w1) !== laid.id; i++) s.tick()
    expect(s.building(s.w1)).toBe(laid.id)
  })

  it('another realm’s site, or nobody’s, can’t be picked', () => {
    const s = setup()
    s.world.realms.push({ id: 'r2', userId: 8, leaderId: 'w2' })
    const theirs: Building = {
      id: 'ts',
      kind: 'townHall',
      cityId: null,
      realmId: 'r2',
      x: 24,
      y: 2,
      site: { delivered: {}, work: 0 },
    }
    s.world.buildings.push(theirs)
    expect(startParamsProblem(s.world, 'r2', asBuilding, { target: 'ts' })).toBeUndefined()
    for (const id of ['ts', 'hs'])
      expect(startParamsProblem(s.world, 'r1', asBuilding, { target: id })).toBe(
        'target: must be a building of yours, or a workplace or construction site you know',
      )
  })

  it('giving Build on a house site of the realm’s fills site', () => {
    const s = setup()
    s.world.buildings.find((b) => b.id === 'hs')!.realmId = 'r1'
    s.give({ kind: 'task', task: 'build', building: 'house', at: { x: 6, y: 6 } })
    s.tick()
    expect(s.w1.scriptParams?.[BUILD]).toEqual({ site: 'hs' })
  })

  it('finished, belongs where its kind does; a realm gone leaves none', () => {
    const s = setup()
    const done = (b: Building) => {
      b.realmId = 'r1'
      b.site = { delivered: { ...BUILD_MATERIALS[b.kind] }, work: BUILD_WORK[b.kind]! }
      expect(finishSite(s.world, b, s.w2)).toBe(true)
      return b
    }
    const hs = s.world.buildings.find((b) => b.id === 'hs')!
    expect(done(hs).realmId).toBeUndefined()
    // A storage out of every city is the builder's realm's outpost storage, as before.
    const os: Building = { id: 'os', kind: 'storage', cityId: null, x: 26, y: 26 }
    s.world.buildings.push(os)
    expect(done(os).realmId).toBe('r1')
    s.world.buildings.push({ id: 'gs', kind: 'house', cityId: null, realmId: 'r9', x: 2, y: 26 })
    s.world.buildings.at(-1)!.site = { delivered: {}, work: 0 }
    expect(outpostStorageRealms.check(s.world, terrain).map((v) => v.entityIds)).toEqual([['gs']])
  })
})

describe('Haul started directly', () => {
  it('ends with Run script: its route comes only from the Haul order', () => {
    const s = setup()
    s.give({ kind: 'runScript', scriptId: HAUL }, 'w2')
    s.tick()
    expect(s.w2.script).toBeUndefined()
    expect(s.w2.order).toBeNull()
    expect(s.stopped()).toEqual(['no route given'])
  })

  it('as the Haul order fills the carriage and drives the route', () => {
    const s = setup()
    const route = { x: 26, y: 20, goods: ['food'], keepFood: 0 }
    s.give({ kind: 'task', task: 'haul', carriageId: 'k1', ...route }, 'w2')
    s.tick()
    expect(s.w2.scriptParams?.[HAUL]).toEqual({ carriage: 'k1' })
    expect(s.w2.order).toMatchObject({ kind: 'haul', carriageId: 'k1', to: { x: 26, y: 20 } })
    expect(s.stopped()).toEqual([])
  })
})

describe('builders-have-a-site and haulers-have-a-route invariants', () => {
  it('flag a resident running Build or Haul that knows no target', () => {
    const { world } = setup()
    const [w1, w2] = world.residents
    w1!.script = { scriptId: BUILD, memory: { building: 'house', at: { x: 6, y: 6 } } }
    w2!.script = { scriptId: BUILD, memory: {} }
    expect(defaultsHaveATarget(world, () => 'build')).toEqual([
      expect.objectContaining({ invariant: 'builders-have-a-site', entityIds: ['w2'] }),
    ])
    w2!.script = { scriptId: HAUL, memory: { carriageId: 'k1' } }
    expect(defaultsHaveATarget(world, (r) => (r.id === 'w2' ? 'haul' : 'build'))).toEqual([
      expect.objectContaining({ invariant: 'haulers-have-a-route', entityIds: ['w2'] }),
    ])
  })
})
