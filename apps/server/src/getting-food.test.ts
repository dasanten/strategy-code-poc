import {
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
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
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Getting food (`CONTEXT.md`: Getting food, Own food): a resident running the Work default with
 * `foodAt` set goes to get Food below that many units on them, up to `foodTake`, and comes back
 * to work; with `foodTake` set, storing a load tops their own food up to it too.
 */

const SIZE = 32
const WORK = 1

/** Mara's realm r1 with city c1 at (14, 10) and a lumber camp of no city at (6, 10). */
function campWorld(): { world: WorldState; terrain: TerrainMap; camp: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 14, y: 10 })
  const at = { x: 6, y: 10 }
  terrain.tiles[at.y * SIZE + at.x] = Terrain.Forest
  world.nodes.push({ id: 'n', kind: 'forest', ...at })
  const camp: Building = { id: 'camp', kind: 'lumberCamp', cityId: null, ...at }
  world.buildings.push(camp)
  return { world, terrain, camp }
}

function addWorker(
  world: WorldState,
  place: Building,
  food: number,
  params: ScriptParamValues[number] = {},
): Resident {
  const r = newResident(mulberry32(1), {
    id: 'w1',
    owner: 'r1',
    cityId: 'c1',
    x: place.x,
    y: place.y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food }
  r.order = { kind: 'workAt', buildingId: place.id, at: { x: place.x, y: place.y }, progress: 0 }
  r.script = { scriptId: WORK, memory: { workplaceId: place.id } }
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
  script: () => ({ userId: 1, source: DEFAULT_SCRIPTS.work.source, followsDefault: true }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
}

/**
 * Runs the world with the worker never hungry, so the Food on them stays countable, until `done`
 * or the ticks run out; returns whether they left their workplace on the way.
 */
function run(
  world: WorldState,
  terrain: TerrainMap,
  w: Resident,
  done: () => boolean,
  ticks = 400,
) {
  const home = { x: w.x, y: w.y }
  const runner = new ScriptRunner(terrain, host)
  const walking = new Walking(terrain)
  let left = false
  for (let t = 0; t < ticks && !done(); t++) {
    w.hunger = MAX_HUNGER
    expect(runner.runAll(world, true)).toEqual([])
    stepWorld(world, terrain, walking)
    left ||= w.x !== home.x || w.y !== home.y
  }
  return left
}

const working = (w: Resident, camp: Building) =>
  w.x === camp.x && w.y === camp.y && w.order?.kind === 'workAt' && !w.script?.memory.food

describe('getting food in the Work default', () => {
  it('walks to the storage below foodAt, comes back with foodTake and works on', () => {
    const { world, terrain, camp } = campWorld()
    const s = storage(world, 's1', camp.x + 6, camp.y, { food: 50 })
    const w = addWorker(world, camp, 3, { foodAt: 4, foodTake: 12 })
    let fetched = false
    const left = run(world, terrain, w, () => {
      fetched ||= (w.carried.food ?? 0) >= 12
      return fetched && working(w, camp)
    })
    expect(left).toBe(true)
    expect(working(w, camp)).toBe(true)
    expect(w.carried.food).toBe(12)
    expect(s.stock?.food).toBe(50 - 9)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes their usual own food while foodTake is unset', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 6, camp.y, { food: 50 })
    // Above the one unit below which a resident refills on their own at a storage.
    const w = addWorker(world, camp, 1, { foodAt: OWN_FOOD })
    let fetched = false
    run(world, terrain, w, () => {
      fetched ||= (w.carried.food ?? 0) >= OWN_FOOD
      return fetched && working(w, camp)
    })
    expect(working(w, camp)).toBe(true)
    expect(w.carried.food).toBe(OWN_FOOD)
  })

  it('goes to the picked storage while it holds Food, else the nearest with Food', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 'near', camp.x + 2, camp.y, {})
    storage(world, 'far', camp.x + 8, camp.y, { food: 50 })
    const w = addWorker(world, camp, 1, { foodAt: 4, foodTake: 12, storage: 'near' })
    new ScriptRunner(terrain, host).runAll(world)
    expect(w.order).toMatchObject({ kind: 'fetch', from: { storageId: 'far' } })

    world.buildings.find((b) => b.id === 'near')!.stock = { food: 5 }
    w.order = { kind: 'workAt', buildingId: camp.id, at: { x: camp.x, y: camp.y }, progress: 0 }
    w.script!.memory = { workplaceId: camp.id }
    new ScriptRunner(terrain, host).runAll(world)
    expect(w.order).toMatchObject({
      kind: 'fetch',
      from: { storageId: 'near' },
      goods: { food: 11 },
    })
  })

  it('keeps working with no Food anywhere', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 6, camp.y, { wood: 10 })
    const w = addWorker(world, camp, 1, { foodAt: 4, foodTake: 12 })
    const left = run(world, terrain, w, () => false, 20)
    expect(left).toBe(false)
    expect(w.order).toMatchObject({ kind: 'workAt' })
    expect(w.script?.memory.food).toBeFalsy()
  })

  it('stays at work unset, however little Food they carry', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 6, camp.y, { food: 50 })
    const w = addWorker(world, camp, 0)
    const left = run(world, terrain, w, () => false, 20)
    expect(left).toBe(false)
    expect(w.order).toMatchObject({ kind: 'workAt' })
  })

  it('carrying the output with foodTake set tops their food up to it', () => {
    const { world, terrain, camp } = campWorld()
    const s = storage(world, 's1', camp.x + 6, camp.y, { food: 50 })
    const w = addWorker(world, camp, OWN_FOOD, { foodTake: 12 })
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    let went = false
    run(world, terrain, w, () => {
      went ||= Boolean(w.script?.memory.carry)
      return went && !w.script?.memory.carry
    })
    expect(went).toBe(true)
    expect(w.carried.food).toBe(12)
    expect(s.stock?.food).toBe(50 - (12 - OWN_FOOD))
    expect(s.stock?.wood).toBeGreaterThan(0)
  })
})
