import {
  CREW_FOOD,
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  pileAt,
  type Building,
  type Resident,
  type ScriptParamValues,
  type Stock,
  type Task,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Separate output and food storages (`CONTEXT.md`: Script parameter, Carrying the output, Getting
 * food, Crew food): the Work default keeps `storage` as its main storage, and `output` and `food`
 * each take its place for one use while picked; Build, Build line and Tear down get Food at
 * `food`, else their `source`. Unset, each falls back to the main one, then the nearest storage.
 */

const SIZE = 40
const SCRIPT = 1

/** Mara's realm r1 with city c1 at (30, 10) and a lumber camp of no city at (6, 10). */
function campWorld(): { world: WorldState; terrain: TerrainMap; camp: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 10 })
  const at = { x: 6, y: 10 }
  terrain.tiles[at.y * SIZE + at.x] = Terrain.Forest
  world.nodes.push({ id: 'n', kind: 'forest', ...at })
  const camp: Building = { id: 'camp', kind: 'lumberCamp', cityId: null, ...at }
  world.buildings.push(camp)
  return { world, terrain, camp }
}

function addWorker(
  world: WorldState,
  id: string,
  place: Building,
  food: number,
  params: ScriptParamValues[number] = {},
): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId: 'c1',
    x: place.x,
    y: place.y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food }
  r.order = { kind: 'workAt', buildingId: place.id, at: { x: place.x, y: place.y }, progress: 0 }
  r.script = { scriptId: SCRIPT, memory: { workplaceId: place.id } }
  r.scriptParams = { [SCRIPT]: params }
  world.residents.push(r)
  return r
}

function storage(world: WorldState, id: string, x: number, y: number, stock: Stock = {}) {
  // Outpost storages of r1 (`CONTEXT.md`: Outpost storage), out of the city's area.
  const b: Building = { id, kind: 'storage', cityId: null, realmId: 'r1', x, y, stock }
  world.buildings.push(b)
  return b
}

const hostOf = (task: Task): ScriptHost => ({
  script: () => ({
    userId: 1,
    name: DEFAULT_SCRIPTS[task].name,
    version: 1,
    source: DEFAULT_SCRIPTS[task].source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
})

/** Runs the scripts of `task` and the world with nobody hungry until `done` or out of ticks. */
function run(world: WorldState, terrain: TerrainMap, done: () => boolean, task: Task = 'work') {
  const runner = new ScriptRunner(terrain, hostOf(task))
  const walking = new Walking(terrain)
  for (let t = 0; t < 800 && !done(); t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    expect(runner.runAll(world, true)).toEqual([])
    stepWorld(world, terrain, walking)
  }
}

/** One run of the scripts of `task`, without the world stepping. */
const runOnce = (world: WorldState, terrain: TerrainMap, task: Task = 'work') =>
  new ScriptRunner(terrain, hostOf(task)).runAll(world)

const stock = (world: WorldState, id: string) => world.buildings.find((b) => b.id === id)!.stock!

describe('output and food in the Work default', () => {
  it('stores the output at output while the crew’s Food comes from food', () => {
    const { world, terrain, camp } = campWorld()
    // The main storage is the nearest, and holds Food: neither is used while both are picked.
    storage(world, 'main', camp.x + 3, camp.y, { food: 50 })
    storage(world, 'out', camp.x + 8, camp.y)
    storage(world, 'pantry', camp.x, camp.y + 8, { food: 50 })
    const params = { storage: 'main', output: 'out', food: 'pantry' }
    for (const id of ['w1', 'w2', 'w3']) addWorker(world, id, camp, OWN_FOOD, params)
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    run(world, terrain, () => (pileAt(world, camp.x, camp.y)?.goods.food ?? 0) > 0)
    expect(pileAt(world, camp.x, camp.y)?.goods.food).toBeGreaterThan(0)
    expect(stock(world, 'out').wood).toBeGreaterThan(0)
    expect(stock(world, 'pantry').food).toBeLessThanOrEqual(50 - CREW_FOOD)
    expect(stock(world, 'main')).toEqual({ food: 50 })
    const carrier = world.residents.find((r) => (r.scriptLog ?? []).length > 0)!
    expect((carrier.scriptLog ?? []).map((l) => l.text)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pile full: carrying .* to the storage at 14,10$/),
        `fetching ${CREW_FOOD} Food for the crew at the storage at 6,18`,
      ]),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('carries the output to output, else storage, else the nearest storage', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 'near', camp.x + 2, camp.y)
    storage(world, 'main', camp.x + 5, camp.y)
    storage(world, 'out', camp.x + 8, camp.y)
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    const w = addWorker(world, 'w1', camp, OWN_FOOD, { storage: 'main', output: 'out' })
    const carriesTo = (params: ScriptParamValues[number]) => {
      w.scriptParams = { [SCRIPT]: params }
      w.script!.memory = { workplaceId: camp.id }
      w.order = { kind: 'workAt', buildingId: camp.id, at: { x: camp.x, y: camp.y }, progress: 0 }
      world.piles = [{ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } }]
      runOnce(world, terrain)
      return (w.script!.memory.carry as { storageId: string }).storageId
    }
    expect(carriesTo({ storage: 'main', output: 'out' })).toBe('out')
    expect(carriesTo({ storage: 'main' })).toBe('main')
    expect(carriesTo({})).toBe('near')
  })

  it('gets Food at food, else storage, else the nearest storage with Food', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 'near', camp.x + 2, camp.y, { food: 50 })
    storage(world, 'main', camp.x + 5, camp.y, { food: 50 })
    storage(world, 'pantry', camp.x + 8, camp.y, { food: 50 })
    const w = addWorker(world, 'w1', camp, 1)
    const fetchesAt = (params: ScriptParamValues[number]) => {
      w.scriptParams = { [SCRIPT]: { foodAt: 4, foodTake: 12, ...params } }
      w.script!.memory = { workplaceId: camp.id }
      w.order = { kind: 'workAt', buildingId: camp.id, at: { x: camp.x, y: camp.y }, progress: 0 }
      runOnce(world, terrain)
      expect(w.order).toMatchObject({ kind: 'fetch', goods: { food: 11 } })
      return (w.order as { from: { storageId: string } }).from.storageId
    }
    expect(fetchesAt({ storage: 'main', food: 'pantry' })).toBe('pantry')
    expect(fetchesAt({ storage: 'main', output: 'pantry' })).toBe('main')
    expect(fetchesAt({})).toBe('near')
    // A picked food storage without Food: the nearest with Food, not the main storage.
    stock(world, 'pantry').food = 0
    expect(fetchesAt({ storage: 'main', food: 'pantry' })).toBe('near')
  })

  it('brings the crew’s Food from storage while food is unset, though output is elsewhere', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 'main', camp.x, camp.y + 6, { food: 50 })
    storage(world, 'out', camp.x + 8, camp.y)
    const params = { storage: 'main', output: 'out' }
    for (const id of ['w1', 'w2']) addWorker(world, id, camp, OWN_FOOD, params)
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    run(world, terrain, () => (pileAt(world, camp.x, camp.y)?.goods.food ?? 0) > 0)
    expect(stock(world, 'out').wood).toBeGreaterThan(0)
    expect(stock(world, 'main').food).toBeLessThanOrEqual(50 - CREW_FOOD)
  })
})

/** Where the house site goes: plains by the city. */
const HOUSE_AT = { x: 20, y: 12 }

/** A builder on a house site at `HOUSE_AT` that lacks all its materials. */
function addBuilder(world: WorldState, food: number, params: ScriptParamValues[number]): Resident {
  world.buildings = world.buildings.filter((b) => b.kind !== 'lumberCamp')
  const site: Building = {
    id: 'site',
    kind: 'house',
    cityId: null,
    ...HOUSE_AT,
    site: { delivered: {}, work: 0 },
  }
  world.buildings.push(site)
  const r = addWorker(world, 'b1', site, food, params)
  r.order = { kind: 'build', building: 'house', at: { ...HOUSE_AT }, siteId: 'site' }
  r.script = {
    scriptId: SCRIPT,
    memory: { building: 'house', at: { ...HOUSE_AT }, siteId: 'site' },
  }
  return r
}

describe('food in the Build, Build line and Tear down defaults', () => {
  it('Build gets Food at food while the materials come from source', () => {
    const { world, terrain } = campWorld()
    storage(world, 'src', HOUSE_AT.x + 4, HOUSE_AT.y, { food: 50, wood: 100, stone: 100 })
    storage(world, 'pantry', HOUSE_AT.x - 4, HOUSE_AT.y, { food: 50 })
    const b = addBuilder(world, 1, { source: 'src', food: 'pantry', foodAt: 4, foodTake: 12 })
    runOnce(world, terrain, 'build')
    expect(b.order).toMatchObject({ kind: 'fetch', from: { storageId: 'pantry' } })

    // Fed, they fetch the materials at source.
    run(world, terrain, () => Boolean(b.script?.memory.fetch), 'build')
    expect(b.order).toMatchObject({ kind: 'fetch', from: { storageId: 'src' } })
    expect((b.order as { goods: Stock }).goods.wood).toBeGreaterThan(0)
    expect(stock(world, 'pantry').food).toBe(50 - 11)
  })

  it('Build gets Food at source while food is unset', () => {
    const { world, terrain } = campWorld()
    storage(world, 'near', HOUSE_AT.x + 1, HOUSE_AT.y, { food: 50 })
    storage(world, 'src', HOUSE_AT.x + 4, HOUSE_AT.y, { food: 50 })
    const b = addBuilder(world, 1, { source: 'src', foodAt: 4, foodTake: 12 })
    runOnce(world, terrain, 'build')
    expect(b.order).toMatchObject({ kind: 'fetch', from: { storageId: 'src' } })
  })

  it('Tear down gets Food at food, else source, else the nearest with Food', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 'near', camp.x + 2, camp.y, { food: 50 })
    storage(world, 'src', camp.x + 5, camp.y, { food: 50 })
    storage(world, 'pantry', camp.x + 8, camp.y, { food: 50 })
    const r = addWorker(world, 'w1', camp, 1)
    const fetchesAt = (params: ScriptParamValues[number]) => {
      r.scriptParams = { [SCRIPT]: { foodAt: 4, foodTake: 12, ...params } }
      r.script = { scriptId: SCRIPT, memory: { buildingId: camp.id } }
      r.order = null
      runOnce(world, terrain, 'tearDown')
      return (r.order as { from: { storageId: string } }).from.storageId
    }
    expect(fetchesAt({ source: 'src', food: 'pantry' })).toBe('pantry')
    expect(fetchesAt({ source: 'src' })).toBe('src')
    expect(fetchesAt({})).toBe('near')
  })

  it('Build line gets Food at food', () => {
    const { world, terrain } = campWorld()
    storage(world, 'src', HOUSE_AT.x + 4, HOUSE_AT.y, { food: 50 })
    storage(world, 'pantry', HOUSE_AT.x - 4, HOUSE_AT.y, { food: 50 })
    const r = addWorker(world, 'w1', { id: 'x', kind: 'storage', cityId: 'c1', ...HOUSE_AT }, 1, {
      source: 'src',
      food: 'pantry',
      foodAt: 4,
      foodTake: 12,
    })
    r.order = null
    const line = {
      building: 'road',
      from: { ...HOUSE_AT },
      to: { x: HOUSE_AT.x + 2, y: HOUSE_AT.y },
    }
    r.script = { scriptId: SCRIPT, memory: { line } }
    runOnce(world, terrain, 'buildLine')
    expect(r.order).toMatchObject({ kind: 'fetch', from: { storageId: 'pantry' } })
  })
})
