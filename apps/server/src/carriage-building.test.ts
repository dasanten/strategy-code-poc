import {
  AVERAGE_HORSE_STATS,
  BUILD_MATERIALS,
  BUILD_WORK,
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  buildProblem,
  carriageSiteAt,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { buildingsInPlace, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Building a carriage (`CONTEXT.md`: Carriage, Construction site): at a finished stable a resident
 * lays out a carriage site on its tiles or right by it, which takes materials and work like any
 * site and becomes a carriage of the realm of whoever finishes it.
 */

const SIZE = 32
/** Plains, with Mountain at (12, 4), right by the stable's east side. */
function map(): TerrainMap {
  const tiles = new Uint8Array(SIZE * SIZE).fill(Terrain.Plains)
  tiles[4 * SIZE + 12] = Terrain.Mountain
  return { size: SIZE, tiles }
}
const terrain = map()
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const them = { userId: 8, account: { name: 'Tobin', isAdmin: false } }
const MATERIALS = BUILD_MATERIALS.carriage!
const WORK = BUILD_WORK.carriage!

/**
 * Realm r1 (Player 7) with city c1 and a finished stable covering (9, 4)–(11, 6). Resident w1 of r1 stands on the stable's middle tile.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 4, y: 4 })
  const stable: Building = { id: 'st', kind: 'stable', cityId: 'c1', x: 9, y: 4, stock: {} }
  world.buildings.push(stable)
  const r = resident(world, 'w1', 'r1', 10, 5)
  return { world, r, stable, queue: new OrderQueue() }
}

function resident(world: WorldState, id: string, owner: string, x: number, y: number): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId: owner === 'r1' ? 'c1' : null,
    x,
    y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food: OWN_FOOD }
  world.residents.push(r)
  return r
}

/** Steps the world, keeping residents fed. */
function run(world: WorldState, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, terrain)
  }
}

/** Sends an order, and if accepted runs the tick that starts it. */
function order(world: WorldState, queue: OrderQueue, o: object, sender = me) {
  const answer = queue.receive(world, sender, 'q', o)
  queue.applyAll(world)
  run(world)
  return answer.type === 'rejected' ? answer.reason : 'ack'
}

const build = (residentId = 'w1') => ({ kind: 'build', residentId, building: 'carriage' })
const site = (world: WorldState) => world.buildings.find((b) => b.kind === 'carriage')

describe('building a carriage', () => {
  it('lays out a carriage site on the resident’s tile of a finished stable, of no city', () => {
    const { world, queue } = setup()
    expect(order(world, queue, build())).toBe('ack')
    expect(site(world)).toMatchObject({
      kind: 'carriage',
      cityId: null,
      x: 10,
      y: 5,
      site: { delivered: {}, work: expect.any(Number) },
    })
    // The stable stands on: the site shares its tile.
    expect(world.buildings.find((b) => b.id === 'st')).toBeDefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('also lays one out right next to the stable, but not further off', () => {
    const { world, r, queue } = setup()
    r.x = 8
    r.y = 3
    expect(order(world, queue, build())).toBe('ack')
    expect(carriageSiteAt(world, 8, 3)).toBeDefined()
    r.order = null
    r.x = 7
    expect(order(world, queue, build())).toBe('a carriage is built at a finished stable')
  })

  it('is turned down at an unfinished stable, on another building, or where no carriage can go', () => {
    const { world, r, stable, queue } = setup()
    stable.site = { delivered: {}, work: 0 }
    expect(order(world, queue, build())).toBe('a carriage is built at a finished stable')
    delete stable.site
    world.buildings.push({ id: 'h', kind: 'house', cityId: 'c1', x: 7, y: 7 })
    r.x = 8
    r.y = 7
    expect(order(world, queue, build())).toBe('there is already a building there')
    // The order checks terrain with the server's map; here the rule itself.
    expect(buildProblem(world, 12, 4, 'carriage', terrain)).toBe(
      'a carriage can’t stand on this land',
    )
    world.nodes.push({ id: 'n1', kind: 'stone', x: 12, y: 5 })
    expect(buildProblem(world, 12, 5, 'carriage', terrain)).toBe(
      'a carriage goes off any resource node',
    )
  })

  it('joins the carriage site already on the tile rather than laying out a second', () => {
    const { world, queue } = setup()
    order(world, queue, build())
    resident(world, 'w2', 'r1', 10, 5)
    expect(order(world, queue, build('w2'))).toBe('ack')
    expect(world.buildings.filter((b) => b.kind === 'carriage')).toHaveLength(1)
    expect(world.residents.map((x) => x.order)).toEqual([
      expect.objectContaining({ siteId: site(world)!.id }),
      expect.objectContaining({ siteId: site(world)!.id }),
    ])
  })

  it('takes its materials and work, and becomes an empty, unhitched carriage of the finisher’s realm', () => {
    const { world, r, queue } = setup()
    // The stable's horses stand there; the new carriage isn't hitched until it is driven.
    world.horses.push({
      id: 'h1',
      realmId: 'r1',
      cityId: null,
      x: 10,
      y: 5,
      hunger: MAX_HUNGER,
      health: 100,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: world.tick,
    })
    order(world, queue, build())
    const s = site(world)!
    // Laid out by r1, finished unattended by a resident of r2 (`CONTEXT.md`: Construction site).
    r.order = null
    world.realms.push({ id: 'r2', userId: 8, leaderId: 't1' })
    const t = resident(world, 't1', 'r2', 10, 5)
    t.carried = { ...t.carried, ...MATERIALS }
    order(
      world,
      queue,
      { kind: 'drop', residentId: 't1', spot: { kind: 'site', siteId: s.id }, goods: MATERIALS },
      them,
    )
    expect(s.site!.delivered).toEqual(MATERIALS)
    expect(order(world, queue, build('t1'), them)).toBe('ack')
    run(world, Math.ceil(WORK))
    expect(site(world)).toBeUndefined()
    expect(world.carriages).toEqual([
      {
        id: expect.any(String),
        realmId: 'r2',
        cityId: null,
        x: 10,
        y: 5,
        horseId: null,
        load: {},
      },
    ])
    expect(t.order).toBeNull()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves all its delivered materials when torn down', () => {
    const { world, r, queue } = setup()
    order(world, queue, build())
    const s = site(world)!
    r.carried = { ...r.carried, wood: 10 }
    order(world, queue, {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'site', siteId: s.id },
      goods: { wood: 10 },
    })
    expect(order(world, queue, { kind: 'tearDown', residentId: 'w1', buildingId: s.id })).toBe(
      'ack',
    )
    run(world, Math.ceil(WORK))
    expect(site(world)).toBeUndefined()
    expect(world.carriages).toEqual([])
    // Goods on the stable's footprint are its one pile (`CONTEXT.md`: A building's pile).
    expect(world.piles).toEqual([expect.objectContaining({ x: 9, y: 4, goods: { wood: 10 } })])
    expect(world.buildings.find((b) => b.id === 'st')).toBeDefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is built by the Build default, fetching its wood and iron from the realm’s storage', () => {
    const { world, r } = setup()
    const store: Building = {
      id: 's1',
      kind: 'storage',
      cityId: 'c1',
      x: 4,
      y: 8,
      stock: { wood: 100, iron: 20 },
    }
    world.buildings.push(store)
    const builders = [r, resident(world, 'w2', 'r1', 10, 5)]
    for (const b of builders) {
      b.script = { scriptId: 1, memory: { building: 'carriage', at: { x: 10, y: 5 } } }
    }
    const host: ScriptHost = {
      script: () => ({
        userId: 7,
        name: DEFAULT_SCRIPTS.build.name,
        source: DEFAULT_SCRIPTS.build.source,
        followsDefault: true,
      }),
      sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
      explored: () => true,
    }
    const runner = new ScriptRunner(terrain, host)
    const walking = new Walking(terrain)
    for (let t = 0; t < 5000 && world.carriages.length === 0; t++) {
      for (const x of world.residents) x.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain, walking)
    }
    expect(world.carriages).toEqual([expect.objectContaining({ realmId: 'r1', x: 10, y: 5 })])
    expect(store.stock).toEqual({ wood: 100 - MATERIALS.wood!, iron: 20 - MATERIALS.iron! })
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('carriage site invariants', () => {
  it('flags a finished carriage site and one on a building other than a stable', () => {
    const { world } = setup()
    world.buildings.push({ id: 'k1', kind: 'carriage', cityId: null, x: 10, y: 4 })
    world.buildings.push({ id: 'h', kind: 'house', cityId: 'c1', x: 1, y: 1 })
    world.buildings.push({
      id: 'k2',
      kind: 'carriage',
      cityId: null,
      x: 1,
      y: 1,
      site: { delivered: {}, work: 0 },
    })
    expect(buildingsInPlace.check(world, terrain).map((v) => v.message)).toEqual([
      'k1 is a finished carriage site',
      'k2 is a carriage site on a house',
    ])
  })
})
