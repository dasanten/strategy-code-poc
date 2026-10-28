import {
  AVERAGE_HORSE_STATS,
  BUILD_MATERIALS,
  BUILD_WORK,
  CITY_BUILDING_REACH,
  DEFAULT_SCRIPTS,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  buildingRealm,
  teardownWork,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { updateCityMembership } from './cities.js'
import { buildingOrganization } from './crimes.js'
import { checkInvariants, outpostStorageRealms } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { dropGoods } from './survival.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Outpost storage (`CONTEXT.md`: Outpost storage): a storage of no city belongs to the realm whose
 * residents finished it and counts as a storage of that realm everywhere; a city that grows over
 * it takes it in.
 */

const SIZE = 160
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with city c1 at (40, 40) and a storage `home` in it; realm r2 (Player 8)
 * with Leader b1 at (0, 0). w1 of r1 stands far off at (10, 10).
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push(
    { id: 'r1', userId: 7, leaderId: 'w1' },
    { id: 'r2', userId: 8, leaderId: 'b1' },
  )
  addCity(world, { id: 'c1', realmId: 'r1', x: 40, y: 40 })
  const home: Building = { id: 'home', kind: 'storage', cityId: 'c1', x: 44, y: 40, stock: {} }
  world.buildings.push(home)
  const w1 = resident(world, 'w1', 'r1', 10, 10)
  resident(world, 'b1', 'r2', 0, 0)
  return { world, w1, home }
}

function resident(world: WorldState, id: string, owner: string, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food: OWN_FOOD }
  world.residents.push(r)
  return r
}

/** An outpost storage of `realmId` at (x, y). */
function outpost(world: WorldState, x: number, y: number, realmId = 'r1', id = 'out'): Building {
  const b: Building = { id, kind: 'storage', cityId: null, realmId, x, y, stock: {} }
  world.buildings.push(b)
  return b
}

describe('an outpost storage', () => {
  it('finished outside any city belongs to the builder’s realm', () => {
    const { world, w1 } = setup()
    const q = new OrderQueue(undefined, terrain)
    const order = { kind: 'build', residentId: w1.id, building: 'storage' }
    expect(q.receive(world, me, 'q', order)).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    stepWorld(world, terrain)
    const site = world.buildings.find((b) => b.kind === 'storage' && b.site)!
    expect(site).toMatchObject({ x: 10, y: 10, cityId: null })
    expect(site.realmId).toBeUndefined()
    // The last of the work finishes it.
    site.site = { delivered: { ...BUILD_MATERIALS.storage }, work: (BUILD_WORK.storage ?? 1) - 1 }
    stepWorld(world, terrain)
    expect(site.site).toBeUndefined()
    expect(site).toMatchObject({ cityId: null, realmId: 'r1' })
    expect(buildingRealm(world, site)).toBe('r1')
    expect(buildingOrganization(world, site)).toBe('r1')
    // It founds no city.
    expect(world.cities.map((c) => c.id)).toEqual(['c1'])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is the nearest storage for a workplace next to it, where its workers carry the output', () => {
    const { world, home } = setup()
    const farm: Building = { id: 'farm', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
    world.buildings.push(farm)
    const out = outpost(world, 11, 6)
    // Another realm's outpost storage, nearer still, is not theirs to fill.
    outpost(world, 6, 10, 'r2', 'theirs')
    world.residents = world.residents.filter((r) => r.id === 'b1')
    for (const id of ['w1', 'w2']) {
      const r = resident(world, id, 'r1', farm.x, farm.y)
      r.cityId = 'c1'
      r.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
      r.script = { scriptId: 1, memory: { workplaceId: farm.id } }
    }
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    const host: ScriptHost = {
      script: () => ({ userId: 7, source: DEFAULT_SCRIPTS.work.source, followsDefault: true }),
      sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
      explored: () => true,
    }
    const runner = new ScriptRunner(terrain, host)
    const walking = new Walking(terrain)
    for (let t = 0; t < 600 && !(out.stock!.food ?? 0); t++) {
      for (const r of world.residents) r.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain, walking)
    }
    expect(out.stock!.food).toBeGreaterThan(0)
    expect(home.stock).toEqual({})
    expect(world.buildings.find((b) => b.id === 'theirs')!.stock).toEqual({})
    expect(world.crimes).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is a stop a carriage route loads and unloads at', () => {
    const { world, w1 } = setup()
    const out = outpost(world, 20, 10)
    out.stock = { food: 30 }
    w1.carried = { food: 2 }
    world.horses.push({
      id: 'h1',
      realmId: 'r1',
      cityId: null,
      x: 10,
      y: 10,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    })
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 10,
      y: 10,
      horseId: null,
      load: {},
    })
    dropGoods(world, 10, 10, { ironOre: 20 })
    const q = new OrderQueue(undefined, terrain)
    const haul = {
      kind: 'haul',
      residentId: 'w1',
      carriageId: 'k1',
      x: 20,
      y: 10,
      goods: ['ironOre'],
      returnGoods: ['food'],
      keepFood: 0,
    }
    expect(q.receive(world, me, 'q', haul)).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    const walking = new Walking(terrain)
    const back = () => world.piles.some((p) => p.x === 10 && p.y === 10 && p.goods.food)
    for (let t = 0; t < 2000 && !back(); t++) {
      w1.hunger = MAX_HUNGER
      stepWorld(world, terrain, walking)
      expect(checkInvariants(world, terrain)).toEqual([])
    }
    // The ore went into it, and its Food came back to the first stop.
    expect(out.stock!.ironOre).toBe(20)
    expect(back()).toBe(true)
    expect(out.stock!.food ?? 0).toBeLessThan(30)
    expect(world.crimes).toEqual([])
  })

  it('is taken in by a city that grows over it, and stays its realm’s when cut off again', () => {
    const { world } = setup()
    // Out of reach of the city's town hall, whose footprint runs to (42, 42).
    const out = outpost(world, 44 + 2 * CITY_BUILDING_REACH, 46)
    updateCityMembership(world, SIZE)
    expect(out).toMatchObject({ cityId: null, realmId: 'r1' })

    // A house between them chains it into the city.
    const house: Building = {
      id: 'house',
      kind: 'house',
      cityId: null,
      x: 43 + CITY_BUILDING_REACH,
      y: 46,
    }
    world.buildings.push(house)
    updateCityMembership(world, SIZE)
    expect(house.cityId).toBe('c1')
    expect(out.cityId).toBe('c1')
    expect(out.realmId).toBeUndefined()
    expect(checkInvariants(world, terrain)).toEqual([])

    world.buildings = world.buildings.filter((b) => b !== house)
    updateCityMembership(world, SIZE)
    expect(out).toMatchObject({ cityId: null, realmId: 'r1' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stays its realm’s when another realm’s city takes it in and lets it go', () => {
    const { world } = setup()
    addCity(world, { id: 'c2', realmId: 'r2', x: 10, y: 40 })
    const out = outpost(world, 14, 40)
    updateCityMembership(world, SIZE)
    // Inside c2 it is c2's storage, so r2's.
    expect(out.cityId).toBe('c2')
    expect(buildingRealm(world, out)).toBe('r2')
    // Cut off from c2, it is the realm's of the city it last belonged to.
    out.y = 60
    updateCityMembership(world, SIZE)
    expect(out).toMatchObject({ cityId: null, realmId: 'r2' })
  })

  it('is what a city’s storages become when its town hall is torn down', () => {
    const { world, home } = setup()
    const hall = world.buildings.find((b) => b.id === 'c1-hall')!
    const w1 = world.residents.find((r) => r.id === 'w1')!
    Object.assign(w1, { x: hall.x, y: hall.y })
    hall.teardown = teardownWork(hall)
    w1.order = { kind: 'tearDown', buildingId: hall.id, at: { x: hall.x, y: hall.y } }
    stepWorld(world, terrain)
    expect(world.cities).toEqual([])
    expect(home).toMatchObject({ cityId: null, realmId: 'r1' })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('breaks the invariants with a realm it can’t have', () => {
    const { world, home } = setup()
    home.realmId = 'r1'
    const gone = outpost(world, 10, 20, 'r9', 'gone')
    expect(outpostStorageRealms.check(world, terrain).map((v) => v.entityIds)).toEqual([
      [home.id],
      [gone.id],
    ])
  })
})
