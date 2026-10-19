import {
  NPC_FETCH_UNITS,
  NPC_FOOD_LEFT_AT_WORK,
  NPC_OWN_FOOD,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  Terrain,
  pileAt,
  storedFood,
  workersOf,
  type Building,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { mulberry32 } from './residents.js'
import { endRealm } from './survival.js'
import { worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** A village alone on a small Plains map, its top-left wall tile at (20, 20). */
function village(): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(64)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  return { world, terrain, city }
}

const storageOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!

const farmOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'farm')!

/** Runs the world for `ticks`, checking the invariants every game day. */
function run(world: WorldState, terrain: TerrainMap, walking: Walking, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    stepWorld(world, terrain, walking)
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
}

describe('NPC cities work and eat', () => {
  it('a village left alone survives several game years', () => {
    const { world, terrain, city } = village()
    const walking = new Walking(terrain)
    // Everyone starts idle at home, so the city has to send them out to work.
    const storage = storageOf(world, city)
    for (const r of world.residents) Object.assign(r, { x: storage.x, y: storage.y, order: null })
    const people = world.residents.map((r) => r.id)
    run(world, terrain, walking, 3 * TICKS_PER_GAME_YEAR)
    // Starting ages and lifespans leave nobody to die of old age in three years.
    expect(world.residents.map((r) => r.id)).toEqual(expect.arrayContaining(people))
    // Left in the storage, the starting food would have mostly spoiled by now.
    expect(storedFood(world, city)).toBeGreaterThan(NPC_VILLAGE.food)
  }, 120_000)

  it('carries the farm’s output to the storage', () => {
    const { world, terrain, city } = village()
    const walking = new Walking(terrain)
    storageOf(world, city).stock = {}
    run(world, terrain, walking, 2 * TICKS_PER_GAME_DAY)
    expect(storedFood(world, city)).toBeGreaterThan(0)
    expect(
      pileAt(world, farmOf(world, city).x, farmOf(world, city).y)?.goods.food ?? 0,
    ).toBeLessThan(NPC_FETCH_UNITS)
  })

  it('sends one worker to pick up a full pile, leaving food for the others', () => {
    const { world, city } = village()
    const farm = farmOf(world, city)
    world.piles.push({ id: 'pile1', x: farm.x, y: farm.y, goods: { food: NPC_FETCH_UNITS } })
    stepNpcCities(world, 64)
    const picking = world.residents.filter((r) => r.order?.kind === 'pickUp')
    expect(picking).toHaveLength(1)
    expect(picking[0]!.order).toEqual({
      kind: 'pickUp',
      from: { kind: 'ground' },
      goods: { food: NPC_FETCH_UNITS - NPC_FOOD_LEFT_AT_WORK },
    })
  })

  it('takes what a carrier brings home into the storage, keeping a little to eat', () => {
    const { world, city } = village()
    const storage = storageOf(world, city)
    const r = world.residents[0]!
    Object.assign(r, { x: storage.x, y: storage.y, order: null, carried: { food: 12 } })
    stepNpcCities(world, 64)
    expect(r.order).toEqual({
      kind: 'drop',
      to: { kind: 'storage', storageId: storage.id },
      goods: { food: 12 - NPC_OWN_FOOD },
    })
  })

  it('puts idle adults to work on the farm and leaves children alone', () => {
    const { world, terrain, city } = village()
    const farm = farmOf(world, city)
    const storage = storageOf(world, city)
    const [adult, child] = world.residents
    for (const r of [adult!, child!]) Object.assign(r, { x: storage.x, y: storage.y, order: null })
    child!.bornAt = world.tick - TICKS_PER_GAME_YEAR
    stepNpcCities(world, terrain.size)
    expect(adult!.order).toMatchObject({ kind: 'walkTo', target: { x: farm.x, y: farm.y } })
    expect(child!.order).toBeNull()
  })

  it('puts residents on the farms first when Food runs short', () => {
    const { world, terrain, city } = village()
    const farm = farmOf(world, city)
    // A lumber camp of the village's on a forest node next to the farm, worked by one resident.
    const at = { x: farm.x + 1, y: farm.y }
    terrain.tiles[at.y * terrain.size + at.x] = Terrain.Forest
    world.nodes.push({ id: 'n1', kind: 'forest', ...at })
    const camp: Building = { id: 'camp', kind: 'lumberCamp', cityId: city.id, ...at }
    world.buildings.push(camp)
    const r = world.residents[0]!
    Object.assign(r, { ...at, order: { kind: 'workAt', buildingId: camp.id, at, progress: 0 } })

    storageOf(world, city).stock = { food: 1000 }
    stepNpcCities(world, terrain.size)
    expect(workersOf(world, camp)).toEqual([r])

    storageOf(world, city).stock = {}
    stepNpcCities(world, terrain.size)
    expect(r.order).toMatchObject({ kind: 'walkTo', target: { x: farm.x, y: farm.y } })
  })

  it('a Player’s city whose Leader died runs on its own, Player-only orders ended', () => {
    const { world, terrain } = worldWithCity()
    const realm = world.realms[0]!
    const [driver, worker] = world.residents
    driver!.order = { kind: 'tearDown', buildingId: world.buildings[0]!.id, at: { x: 0, y: 0 } }
    const work = worker!.order
    endRealm(world, realm)
    expect(driver!.order).toBeNull()
    expect(worker!.order).toEqual(work)
    stepNpcCities(world, terrain.size)
    expect(checkInvariants(world, terrain).map((v) => v.invariant)).not.toContain(
      'npc-orders-allowed',
    )
  })
})
