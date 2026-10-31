import {
  BUILD_MATERIALS,
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  type Building,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, oneFetcherAtATime, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Fetching materials (`CONTEXT.md`: Fetching materials): the Build default builds a site, and
 * while it lacks materials one of its builders, picked at random, fetches a load of what is
 * missing from the nearest storage of the realm that holds it, one at a time.
 */

const SIZE = 32
const BUILD = 1
const AT = { x: 6, y: 6 }
const WOOD = BUILD_MATERIALS.house!.wood!

/** Mara's realm r1 with city c1 by (6, 6) and builders b1–b3 at (6, 6), given the Build task for a house. */
function houseWorld(): { world: WorldState; terrain: TerrainMap } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 8, y: 8 })
  for (const id of ['b1', 'b2', 'b3']) addBuilder(world, id)
  return { world, terrain }
}

function addBuilder(world: WorldState, id: string): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId: 'c1',
    ...AT,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food: OWN_FOOD }
  r.script = { scriptId: BUILD, memory: { building: 'house', at: { ...AT } } }
  world.residents.push(r)
  return r
}

function storage(world: WorldState, id: string, x: number, y: number, stock: Stock = {}) {
  const b: Building = { id, kind: 'storage', cityId: 'c1', x, y, stock }
  world.buildings.push(b)
  return b
}

const host: ScriptHost = {
  script: () => ({
    userId: 1,
    name: DEFAULT_SCRIPTS.build.name,
    version: 1,
    source: DEFAULT_SCRIPTS.build.source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
}

const fetchers = (world: WorldState) => world.residents.filter((r) => r.script?.memory.fetch)
const site = (world: WorldState) => world.buildings.find((b) => b.kind === 'house')

/** Runs scripts and steps the world until `done` or `ticks` run out, keeping everyone fed. */
function run(
  world: WorldState,
  terrain: TerrainMap,
  ticks: number,
  each: () => void = () => {},
  done: () => boolean = () => false,
) {
  const runner = new ScriptRunner(terrain, host)
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && !done(); t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    expect(runner.runAll(world, true)).toEqual([])
    each()
    stepWorld(world, terrain, walking)
  }
}

describe('fetching materials', () => {
  it('joins the site, then one builder fetches only what is missing from the nearest storage that holds it', () => {
    const { world, terrain } = houseWorld()
    // Nearest holds none of it; of those holding Wood, east is nearer than south.
    storage(world, 'stone', AT.x + 3, AT.y, { stone: 50 })
    storage(world, 'east', AT.x + 6, AT.y, { wood: 100 })
    storage(world, 'south', AT.x, AT.y + 12, { wood: 100 })
    // Laid out already, with some Wood delivered.
    world.buildings.push({
      id: 'site',
      kind: 'house',
      cityId: null,
      ...AT,
      site: { delivered: { wood: 5 }, work: 0 },
    })
    // They spread over the site's footprint as they join (`CONTEXT.md`: Spreading over the footprint).
    const joined = () => world.residents.every((r) => r.script?.memory.siteId === 'site')
    run(world, terrain, 60, undefined, () => joined() && fetchers(world).length > 0)
    expect(world.residents.map((r) => r.script!.memory.siteId)).toEqual(['site', 'site', 'site'])
    const [fetcher, ...more] = fetchers(world)
    expect(more).toEqual([])
    expect(fetcher!.script!.memory.fetch).toMatchObject({
      storageId: 'east',
      goods: { wood: WOOD - 5 },
    })
  })

  it('builds the site with materials from the storage, one fetcher at a time', () => {
    const { world, terrain } = houseWorld()
    const s = storage(world, 's1', AT.x + 6, AT.y, { wood: 100 })
    let fetched = false
    run(
      world,
      terrain,
      3000,
      () => {
        expect(fetchers(world).length).toBeLessThanOrEqual(1)
        fetched ||= fetchers(world).length > 0
      },
      () => site(world) !== undefined && !site(world)!.site,
    )
    expect(fetched).toBe(true)
    expect(site(world)).toBeDefined()
    expect(site(world)!.site).toBeUndefined()
    // Only what was missing left the storage; nobody kept any.
    expect(s.stock).toEqual({ wood: 100 - WOOD })
    run(world, terrain, 2)
    for (const r of world.residents) {
      expect(r.carried).toEqual({ food: OWN_FOOD })
      expect(r.script).toBeUndefined() // built: Build ended itself
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('just builds with no storage of the realm holding the materials', () => {
    const { world, terrain } = houseWorld()
    storage(world, 's1', AT.x + 6, AT.y, { stone: 50 })
    world.cities.push({ id: 'c2', name: 'Elsewhere', realmId: 'r2', townHallId: 'none' })
    world.buildings.push({
      id: 'theirs',
      kind: 'storage',
      cityId: 'c2',
      x: AT.x + 3,
      y: AT.y,
      stock: { wood: 100 },
    })
    run(world, terrain, 40, () => expect(fetchers(world)).toEqual([]))
    expect(site(world)!.site!.work).toBeGreaterThan(0)
    for (const r of world.residents) expect(r.order).toMatchObject({ kind: 'build' })
  })

  it('delivers materials a builder carries before anyone fetches', () => {
    const { world, terrain } = houseWorld()
    storage(world, 's1', AT.x + 6, AT.y, { wood: 100 })
    world.residents[1]!.carried.wood = 8
    run(world, terrain, 6)
    expect(site(world)!.site!.delivered.wood).toBe(8)
    expect(world.residents[1]!.carried.wood).toBeUndefined()
  })

  it('flags two residents of a site away fetching at once (ADR 0004)', () => {
    const { world } = houseWorld()
    const [b1, b2] = world.residents
    for (const r of [b1!, b2!]) r.script!.memory.siteId = 'site'
    b1!.script!.memory.fetch = { storageId: 's1', step: 'pickUp', walked: true }
    expect(oneFetcherAtATime(world, () => true)).toEqual([])
    b2!.script!.memory.fetch = { storageId: 's1', step: 'pickUp', walked: true }
    expect(oneFetcherAtATime(world, () => true)).toEqual([
      expect.objectContaining({
        invariant: 'one-fetcher-at-a-time',
        entityIds: ['site', 'b1', 'b2'],
      }),
    ])
  })
})
