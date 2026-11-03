import {
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  inputToFetch,
  pileAt,
  recipeFor,
  type Building,
  type Resident,
  type ScriptParamValues,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, oneInputFetcherAtATime, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Fetching inputs (`CONTEXT.md`: Fetching inputs, Smelter / Mint, Smithy): at a smelter, mint or
 * smithy whose pile and workers lack what it uses, one worker picked at random fetches a load from
 * the Work default's `input`, else its `storage`, else the nearest storage of the realm holding it,
 * puts it on the pile and goes back; one at a time, and not while someone carries the output.
 */

const SIZE = 32
const WORK = 1

/** Mara's realm r1 with city c1 and a smelter at (6, 6), its pile empty. */
function smelterWorld(kind: 'smelter' | 'smithy' = 'smelter') {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 24, y: 24 })
  const place: Building = { id: 'place', kind, cityId: null, x: 6, y: 6 }
  world.buildings.push(place)
  return { world, terrain, place }
}

function addWorker(
  world: WorldState,
  id: string,
  place: Building,
  params: ScriptParamValues[number] = {},
  makes?: string,
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
  r.carried = { food: OWN_FOOD }
  r.order = {
    kind: 'workAt',
    buildingId: place.id,
    at: { x: place.x, y: place.y },
    progress: 0,
    ...(makes ? { makes } : {}),
  }
  r.script = {
    scriptId: WORK,
    memory: { workplaceId: place.id, ...(makes ? { makes } : {}) },
  }
  r.scriptParams = { [WORK]: params }
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
    name: DEFAULT_SCRIPTS.work.name,
    version: 1,
    source: DEFAULT_SCRIPTS.work.source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
}

const fetchers = (world: WorldState) => world.residents.filter((r) => r.script?.memory.input)

/** The one worker sent to fetch inputs, after one run; fails unless exactly one went. */
function oneFetcher(world: WorldState, terrain: TerrainMap): Resident {
  expect(new ScriptRunner(terrain, host).runAll(world, true)).toEqual([])
  const sent = fetchers(world)
  expect(sent).toHaveLength(1)
  return sent[0]!
}

describe('fetching inputs', () => {
  it('fetches a load of ore at the storage picked as input', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 'near', 8, 6, { ironOre: 500 })
    storage(world, 'main', 10, 6, { ironOre: 500 })
    storage(world, 'inp', 14, 6, { ironOre: 500 })
    for (const id of ['w1', 'w2', 'w3']) {
      addWorker(world, id, place, { storage: 'main', input: 'inp' })
    }
    const fetcher = oneFetcher(world, terrain)
    const load = inputToFetch(world, place, recipeFor('smelter')!, fetcher)
    expect(load.ironOre).toBeGreaterThan(2)
    expect(fetcher.order).toMatchObject({
      kind: 'fetch',
      goods: load,
      from: { kind: 'storage', storageId: 'inp' },
    })
    expect(fetcher.scriptLog?.at(-1)?.text).toBe(
      `fetching ${load.ironOre} ironOre from the storage at 14,6`,
    )
  })

  it('fetches at the main storage without an input, or with one holding none', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 'near', 8, 6, { ironOre: 500 })
    storage(world, 'main', 10, 6, { ironOre: 500 })
    storage(world, 'inp', 14, 6, { wood: 50 })
    addWorker(world, 'w1', place, { storage: 'main', input: 'inp' })
    addWorker(world, 'w2', place, { storage: 'main' })
    const fetcher = oneFetcher(world, terrain)
    expect(fetcher.order).toMatchObject({ from: { kind: 'storage', storageId: 'main' } })
  })

  it('fetches at the nearest storage holding ore with none picked', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 'near', 8, 6, { wood: 50 })
    storage(world, 'holding', 12, 6, { ironOre: 500 })
    storage(world, 'far', 20, 6, { ironOre: 500 })
    for (const id of ['w1', 'w2']) addWorker(world, id, place)
    const fetcher = oneFetcher(world, terrain)
    expect(fetcher.order).toMatchObject({ from: { kind: 'storage', storageId: 'holding' } })
  })

  it('stands idle with no ore anywhere', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 's1', 8, 6, { wood: 50, food: 50 })
    for (const id of ['w1', 'w2']) addWorker(world, id, place)
    const runner = new ScriptRunner(terrain, host)
    for (let t = 0; t < 20; t++) {
      expect(runner.runAll(world, true)).toEqual([])
      stepWorld(world, terrain)
    }
    expect(fetchers(world)).toEqual([])
    for (const r of world.residents) {
      expect(r.order).toMatchObject({ kind: 'workAt', buildingId: place.id })
    }
  })

  it('fetches nothing while the pile holds a batch, or a worker carries one', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 's1', 8, 6, { ironOre: 500 })
    const [w1] = [addWorker(world, 'w1', place), addWorker(world, 'w2', place)]
    w1!.carried.ironOre = 2
    const runner = new ScriptRunner(terrain, host)
    expect(runner.runAll(world, true)).toEqual([])
    expect(fetchers(world)).toEqual([])
    w1!.carried.ironOre = 1
    world.piles.push({ id: 'p', x: place.x, y: place.y, goods: { ironOre: 1 } })
    expect(runner.runAll(world, true)).toEqual([])
    expect(fetchers(world)).toEqual([])
  })

  it('fetches nothing while one of them carries the output', () => {
    const { world, terrain, place } = smelterWorld()
    storage(world, 's1', 8, 6, { ironOre: 500 })
    const [w1] = ['w1', 'w2', 'w3'].map((id) => addWorker(world, id, place))
    w1!.order = null
    w1!.x = 8
    w1!.script!.memory.carry = { storageId: 's1', goods: ['iron'], stored: true, walked: false }
    expect(new ScriptRunner(terrain, host).runAll(world, true)).toEqual([])
    expect(fetchers(world)).toEqual([])
  })

  it('brings the ore to the pile and goes back to work, one fetcher at a time', () => {
    const { world, terrain, place } = smelterWorld()
    const s = storage(world, 's1', 12, 6, { ironOre: 300, food: 200 })
    for (const id of ['w1', 'w2', 'w3']) addWorker(world, id, place)
    const runner = new ScriptRunner(terrain, host)
    const walking = new Walking(terrain)
    let trips = 0
    let smelted = false
    // Two loads take a few game days to smelt.
    for (let t = 0; t < 12000 && trips < 2; t++) {
      for (const r of world.residents) r.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      expect(fetchers(world).length).toBeLessThanOrEqual(1)
      const before = pileAt(world, place.x, place.y)?.goods.ironOre ?? 0
      stepWorld(world, terrain, walking)
      if ((pileAt(world, place.x, place.y)?.goods.ironOre ?? 0) > before) trips++
      smelted ||= (pileAt(world, place.x, place.y)?.goods.iron ?? 0) > 0
    }
    expect(trips).toBeGreaterThan(1)
    expect(smelted).toBe(true)
    expect(s.stock!.ironOre).toBeLessThan(300)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('fetches Iron and Wood for a smithy worker’s recipe, in its proportions', () => {
    const { world, terrain, place } = smelterWorld('smithy')
    storage(world, 's1', 10, 6, { iron: 200, wood: 200 })
    addWorker(world, 'w1', place, {}, 'spear')
    const fetcher = oneFetcher(world, terrain)
    const load = inputToFetch(world, place, recipeFor('smithy', 'spear')!, fetcher)
    expect(load.wood).toBe(2 * load.iron!)
    expect(load.iron).toBeGreaterThan(1)
    expect(fetcher.order).toMatchObject({ kind: 'fetch', goods: load })
  })

  it('fetches only the Iron a smithy lacks with Wood enough on its pile, and none from Wood alone', () => {
    const { world, terrain, place } = smelterWorld('smithy')
    const s = storage(world, 's1', 10, 6, { wood: 200 })
    world.piles.push({ id: 'p', x: place.x, y: place.y, goods: { wood: 5 } })
    addWorker(world, 'w1', place, {}, 'spear')
    expect(new ScriptRunner(terrain, host).runAll(world, true)).toEqual([])
    expect(fetchers(world)).toEqual([])
    s.stock!.iron = 50
    const fetcher = oneFetcher(world, terrain)
    expect(Object.keys((fetcher.order as { goods: Stock }).goods)).toEqual(['iron'])
  })

  it('flags two residents of a workplace away fetching its inputs at once (ADR 0004)', () => {
    const { world, place } = smelterWorld()
    const [w1, w2] = ['w1', 'w2'].map((id) => addWorker(world, id, place))
    w1!.script!.memory.input = { missing: [{ good: 'ironOre', units: 20 }] }
    expect(oneInputFetcherAtATime(world, () => true)).toEqual([])
    w2!.script!.memory.input = { missing: [{ good: 'ironOre', units: 20 }] }
    expect(oneInputFetcherAtATime(world, () => true)).toEqual([
      expect.objectContaining({
        invariant: 'one-input-fetcher-at-a-time',
        entityIds: ['place', 'w1', 'w2'],
      }),
    ])
  })
})
