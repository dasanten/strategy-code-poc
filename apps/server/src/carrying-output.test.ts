import {
  DEFAULT_SCRIPTS,
  MAX_HUNGER,
  OWN_FOOD,
  Terrain,
  WORK_FOOD_KEPT,
  pileAt,
  unitsThatFit,
  type Building,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, oneCarrierAtATime, type ScriptHost } from './script-runner.js'
import { addCity, worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Carrying the output (`CONTEXT.md`: Carrying the output, Own food): the Work default carries a
 * workplace's output to the nearest storage of the realm once its pile holds a full load, one
 * worker at a time, each keeping their own food.
 */

const SIZE = 32
const WORK = 1

/** Mara's realm r1 with city c1, a farm at (6, 6) and workers w1–w3 on it, running Work. */
function farmWorld(): { world: WorldState; terrain: TerrainMap; farm: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 6 })
  const farm: Building = { id: 'farm', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
  world.buildings.push(farm)
  for (const id of ['w1', 'w2', 'w3']) addWorker(world, id, farm)
  return { world, terrain, farm }
}

function addWorker(world: WorldState, id: string, place: Building): Resident {
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
  r.order = { kind: 'workAt', buildingId: place.id, at: { x: place.x, y: place.y }, progress: 0 }
  r.script = { scriptId: WORK, memory: { workplaceId: place.id } }
  world.residents.push(r)
  return r
}

function storage(world: WorldState, id: string, x: number, y: number, stock: Stock = {}) {
  const b: Building = { id, kind: 'storage', cityId: 'c1', x, y, stock }
  world.buildings.push(b)
  return b
}

const host = (defaultScript?: ScriptHost['defaultScript']): ScriptHost => ({
  script: () => ({
    userId: 1,
    version: 1,
    source: DEFAULT_SCRIPTS.work.source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
  ...(defaultScript ? { defaultScript } : {}),
})

const carriers = (world: WorldState) => world.residents.filter((r) => r.script?.memory.carry)

/** A full load of Food for a worker: what fits in their hands beside their own food. */
const fullLoad = (world: WorldState) => unitsThatFit(world.residents[0]!, 'food', world.tick)

describe('carrying the output', () => {
  it('waits for a full load, then sends one worker with all but the Food the farm keeps', () => {
    const { world, terrain, farm } = farmWorld()
    storage(world, 's1', 12, 6)
    const runner = new ScriptRunner(terrain, host())
    const below = fullLoad(world) + WORK_FOOD_KEPT - 1
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: below } })
    expect(runner.runAll(world, true)).toEqual([])
    expect(carriers(world)).toEqual([])

    world.piles[0]!.goods.food = below + 1
    expect(runner.runAll(world, true)).toEqual([])
    const [carrier, ...more] = carriers(world)
    expect(more).toEqual([])
    expect(carrier!.order).toEqual({
      kind: 'pickUp',
      from: { kind: 'ground' },
      goods: { food: below + 1 - WORK_FOOD_KEPT },
    })
    stepWorld(world, terrain)
    expect(pileAt(world, farm.x, farm.y)?.goods.food).toBe(WORK_FOOD_KEPT)
    expect(carrier!.carried.food).toBe(OWN_FOOD + below + 1 - WORK_FOOD_KEPT)
  })

  it('goes to the nearest storage of the realm by walking time, not by tiles', () => {
    const { world, terrain, farm } = farmWorld()
    // Six tiles east through forest, or seven south over Plains.
    for (let x = farm.x + 1; x <= farm.x + 6; x++) terrain.tiles[farm.y * SIZE + x] = Terrain.Forest
    storage(world, 'east', farm.x + 6, farm.y)
    storage(world, 'south', farm.x, farm.y + 7)
    // Another realm's storage, nearer still, is not theirs to fill.
    world.cities.push({ id: 'c2', name: 'Elsewhere', realmId: 'r2', townHallId: 'none' })
    world.buildings.push({ id: 'theirs', kind: 'storage', cityId: 'c2', x: farm.x + 4, y: farm.y })
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    new ScriptRunner(terrain, host()).runAll(world)
    expect(carriers(world).map((r) => r.script!.memory.carry)).toEqual([
      expect.objectContaining({ storageId: 'south' }),
    ])
  })

  it('stores the load, keeps their own food and goes back to work, one carrier at a time', () => {
    const { world, terrain, farm } = farmWorld()
    const s = storage(world, 's1', 12, 6)
    // Several loads already lie there, more than one carrier could take.
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    const load = fullLoad(world)
    const runner = new ScriptRunner(terrain, host())
    const walking = new Walking(terrain)
    let trips = 0
    let stored = 0
    for (let t = 0; t < 3000; t++) {
      for (const r of world.residents) r.hunger = MAX_HUNGER
      expect(runner.runAll(world, true)).toEqual([])
      expect(carriers(world).length).toBeLessThanOrEqual(1)
      const before = s.stock?.food ?? 0
      stepWorld(world, terrain, walking)
      if ((s.stock?.food ?? 0) > before) {
        trips++
        stored += (s.stock?.food ?? 0) - before
        // The carrier put away only the load, their own food still in hand.
        const [carrier] = carriers(world)
        expect(carrier!.carried.food).toBe(OWN_FOOD)
      }
    }
    expect(trips).toBeGreaterThan(1)
    expect(stored).toBeGreaterThan(load)
    // Back at work.
    for (const r of world.residents) {
      if (r.script?.memory.carry) continue
      expect(r.order).toMatchObject({ kind: 'workAt', buildingId: farm.id })
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('refills from the storage when low on food', () => {
    const { world, terrain } = farmWorld()
    // A woodcutter with no food on them: no Food to keep from the load.
    const at = { x: 6, y: 10 }
    terrain.tiles[at.y * SIZE + at.x] = Terrain.Forest
    world.nodes.push({ id: 'n', kind: 'forest', ...at })
    const camp: Building = { id: 'camp', kind: 'lumberCamp', cityId: 'c1', ...at }
    world.buildings.push(camp)
    world.residents = []
    const w = addWorker(world, 'w1', camp)
    w.carried = {}
    const s = storage(world, 's1', at.x + 1, at.y, { food: 50 })
    world.piles.push({ id: 'p', ...at, goods: { wood: 100 } })
    const load = unitsThatFit(w, 'wood', world.tick)
    const runner = new ScriptRunner(terrain, host())
    const walking = new Walking(terrain)
    let went = false
    for (let t = 0; t < 200 && !(went && !w.script?.memory.carry); t++) {
      w.hunger = MAX_HUNGER
      runner.runAll(world)
      went ||= Boolean(w.script?.memory.carry)
      stepWorld(world, terrain, walking)
    }
    expect(went).toBe(true)
    expect(w.script?.memory.carry).toBeFalsy()
    expect(w.carried).toEqual({ food: OWN_FOOD })
    expect(s.stock).toEqual({ food: 50 - OWN_FOOD, wood: load })
  })

  it('leaves the pile to grow with no finished storage of the realm', () => {
    const { world, terrain, farm } = farmWorld()
    // Only another realm's storage, and a site of theirs not yet finished.
    world.cities.push({ id: 'c2', name: 'Elsewhere', realmId: 'r2', townHallId: 'none' })
    world.buildings.push({ id: 'theirs', kind: 'storage', cityId: 'c2', x: farm.x + 4, y: farm.y })
    world.buildings.push({
      id: 'site',
      kind: 'storage',
      cityId: 'c1',
      x: farm.x + 6,
      y: farm.y,
      site: { work: 0, delivered: {} },
    })
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    new ScriptRunner(terrain, host()).runAll(world)
    expect(carriers(world)).toEqual([])
    expect(world.residents.every((r) => r.order?.kind === 'workAt')).toBe(true)
  })

  it('carries only the output from a smelter', () => {
    const { world, terrain } = farmWorld()
    world.residents = []
    world.nodes.push({ id: 'n', kind: 'iron', x: 3, y: 12 })
    const smelter: Building = { id: 'smelter', kind: 'smelter', cityId: 'c1', x: 3, y: 12 }
    world.buildings.push(smelter)
    addWorker(world, 'w1', smelter)
    storage(world, 's1', 6, 12)
    world.piles.push({ id: 'p', x: 3, y: 12, goods: { ironOre: 40, iron: 40 } })
    new ScriptRunner(terrain, host()).runAll(world)
    expect(world.residents[0]!.order).toEqual({
      kind: 'pickUp',
      from: { kind: 'ground' },
      goods: { iron: 40 },
    })
  })

  it('has a starting city’s farmers work by their Player’s Work (default)', () => {
    const { world, terrain } = worldWithCity()
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    for (const r of world.residents) {
      expect(r.script).toEqual({ scriptId: 0, task: 'work', memory: { workplaceId: farm.id } })
    }
    const runner = new ScriptRunner(
      terrain,
      host(() => 7),
    )
    expect(runner.runAll(world, true)).toEqual([])
    for (const r of world.residents) {
      expect(r.script?.scriptId).toBe(7)
      expect(r.order).toMatchObject({ kind: 'workAt', buildingId: farm.id })
    }
  })

  it('flags two residents of a workplace away carrying at once (ADR 0004)', () => {
    const { world } = farmWorld()
    const [w1, w2] = world.residents
    w1!.script!.memory.carry = { storageId: 's1', step: 'store', walked: true }
    expect(oneCarrierAtATime(world, () => true)).toEqual([])
    w2!.script!.memory.carry = { storageId: 's1', step: 'store', walked: true }
    expect(oneCarrierAtATime(world, () => true)).toEqual([
      expect.objectContaining({
        invariant: 'one-carrier-at-a-time',
        entityIds: ['farm', 'w1', 'w2'],
      }),
    ])
    // NPC cities' residents are checked with the world; a Player's where their scripts run.
    expect(checkInvariants(world, { size: SIZE, tiles: new Uint8Array(SIZE * SIZE) })).toEqual([])
  })
})
