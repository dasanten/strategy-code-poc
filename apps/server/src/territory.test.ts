import {
  TERRITORY_CITY_BASE,
  TERRITORY_MAX_REACH,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TERRITORY_WORKPLACE_BASE,
  TICKS_PER_GAME_HOUR,
  Terrain,
  computeTerritory,
  controlReach,
  controlSources,
  isArmed,
  territoryOwner,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, territorySound } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { TerritoryTracker } from './territory.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

/** All Plains, 120 tiles a side: room for territory to reach its farthest without wrapping. */
const terrain: TerrainMap = { size: 120, tiles: new Uint8Array(120 * 120).fill(Terrain.Plains) }
const size = terrain.size

/** An empty world on the plains with realms r1 and r2. */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'lead1' })
  world.realms.push({ id: 'r2', userId: 2, leaderId: 'lead2' })
  // The Leaders stand far off in no city, so they count for nothing.
  person(world, { id: 'lead1', owner: 'r1', x: 100, y: 100 })
  person(world, { id: 'lead2', owner: 'r2', x: 100, y: 102 })
  return world
}

let n = 0
/** Adds a resident; `armed` gives them a spear. */
function person(
  world: WorldState,
  p: { id?: string; owner: string | null; x: number; y: number; cityId?: string; armed?: boolean },
): Resident {
  const r = newResident(mulberry32(++n), {
    id: p.id ?? `p${n}`,
    owner: p.owner,
    x: p.x,
    y: p.y,
    tick: 0,
  })
  r.cityId = p.cityId ?? null
  if (p.armed) r.carried = { spear: 1 }
  world.residents.push(r)
  return r
}

/** Puts a finished smithy on the tile and sets `workers` to work it. */
function workplace(world: WorldState, x: number, y: number, workers: Resident[] = []): Building {
  const b: Building = { id: `smithy${x},${y}`, kind: 'smithy', cityId: null, x, y }
  world.buildings.push(b)
  for (const r of workers) {
    r.x = x
    r.y = y
    r.order = { kind: 'workAt', buildingId: b.id, at: { x, y }, progress: 0, makes: 'spear' }
  }
  return b
}

const owner = (world: WorldState, x: number, y: number) =>
  territoryOwner(computeTerritory(world, size), x, y)

function expectSound(world: WorldState) {
  expect(checkInvariants(world, terrain, [territorySound])).toEqual([])
}

describe('territory (`CONTEXT.md`: Territory)', () => {
  it('a city controls the ground around it, as far as its reach', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    const reach = controlReach(TERRITORY_CITY_BASE)
    expect(reach).toBeGreaterThan(0)
    expect(owner(world, 30, 30)).toBe('r1')
    expect(owner(world, 30 + reach, 30)).toBe('r1')
    expect(owner(world, 30 + reach + 1, 30)).toBeUndefined()
    expect(owner(world, 30 + reach, 30 + reach)).toBeUndefined() // round, not square
    expectSound(world)
  })

  it('projects from every finished city building, not from sites', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    world.buildings.push({ id: 'h1', kind: 'house', cityId: 'c1', x: 32, y: 30 })
    world.buildings.push({
      id: 'h2',
      kind: 'house',
      cityId: 'c1',
      x: 34,
      y: 30,
      site: { delivered: {}, work: 0 },
    })
    const reach = controlReach(TERRITORY_CITY_BASE)
    expect(owner(world, 32 + reach, 30)).toBe('r1')
    expect(owner(world, 33 + reach, 30)).toBeUndefined()
  })

  it('reaches farther with more residents and more again with a garrison', () => {
    const world = setup()
    const city = addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    for (let i = 0; i < 20; i++) person(world, { owner: 'r1', x: 30, y: 31, cityId: city.id })
    const [s] = controlSources(world, size)
    expect(s!.strength).toBe(TERRITORY_CITY_BASE + 20 * TERRITORY_PER_RESIDENT)
    const reach = s!.reach
    expect(reach).toBeGreaterThan(controlReach(TERRITORY_CITY_BASE))
    expect(owner(world, 30 + reach, 30)).toBe('r1')

    // Armed residents of the city in its area are its garrison; one out in the fields is not.
    person(world, { owner: 'r1', x: 31, y: 30, cityId: city.id, armed: true })
    person(world, { owner: 'r1', x: 50, y: 50, cityId: city.id, armed: true })
    const [g] = controlSources(world, size)
    expect(g!.strength).toBe(
      TERRITORY_CITY_BASE + 22 * TERRITORY_PER_RESIDENT + TERRITORY_PER_ARMED,
    )
    expect(g!.reach).toBeGreaterThanOrEqual(reach)
    expectSound(world)
  })

  it('never reaches past the farthest reach, however strong', () => {
    expect(controlReach(1e6)).toBe(TERRITORY_MAX_REACH)
  })

  it('where two cities overlap, the stronger wins', () => {
    const world = setup()
    const weak = addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    const strong = addCity(world, { id: 'c2', realmId: 'r2', x: 40, y: 30 })
    for (let i = 0; i < 4; i++) person(world, { owner: 'r1', x: 30, y: 31, cityId: weak.id })
    for (let i = 0; i < 30; i++) person(world, { owner: 'r2', x: 40, y: 31, cityId: strong.id })
    // Halfway between them, and even nearer the weak city, the strong one wins.
    expect(owner(world, 35, 30)).toBe('r2')
    expect(owner(world, 34, 30)).toBe('r2')
    // Its own town hall the weak city keeps.
    expect(owner(world, 30, 30)).toBe('r1')
    expectSound(world)
  })

  it('a tie between equally strong Organizations leaves the tile to nobody', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    addCity(world, { id: 'c2', realmId: 'r2', x: 34, y: 30 })
    expect(owner(world, 32, 30)).toBeUndefined()
    expect(owner(world, 31, 30)).toBe('r1')
    expect(owner(world, 33, 30)).toBe('r2')
    expectSound(world)
  })

  it('cities of one realm never contest each other', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    addCity(world, { id: 'c2', realmId: 'r1', x: 34, y: 30 })
    expect(owner(world, 32, 30)).toBe('r1')
  })

  it('a city of no realm holds territory for itself', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: null, x: 30, y: 30 })
    expect(owner(world, 31, 31)).toBe('c1')
    expectSound(world)
  })

  it('a workplace projects control only while its holder guards it', () => {
    const world = setup()
    const worker = person(world, { owner: 'r1', x: 0, y: 0 })
    const b = workplace(world, 60, 60, [worker])
    expect(owner(world, 60, 60)).toBeUndefined()

    // An armed resident of another realm next to it guards nothing.
    const stranger = person(world, { owner: 'r2', x: 61, y: 60, armed: true })
    expect(owner(world, 60, 60)).toBeUndefined()

    // Two tiles off is too far to guard it.
    const guard = person(world, { owner: 'r1', x: 62, y: 60, armed: true })
    expect(owner(world, 60, 60)).toBeUndefined()

    guard.x = 61
    guard.y = 61
    const [s] = controlSources(world, size)
    expect(s).toMatchObject({ id: b.id, owner: 'r1' })
    expect(s!.strength).toBe(
      TERRITORY_WORKPLACE_BASE + TERRITORY_PER_RESIDENT + TERRITORY_PER_ARMED,
    )
    expect(owner(world, 60, 60)).toBe('r1')
    expect(owner(world, 60 + s!.reach, 60)).toBe('r1')
    expect(owner(world, 61 + s!.reach, 60)).toBeUndefined()
    expectSound(world)

    // An armed worker on it guards it too.
    guard.x = 0
    worker.carried = { sword: 1 }
    expect(isArmed(worker)).toBe(true)
    expect(owner(world, 60, 60)).toBe('r1')
    void stranger
  })

  it('a workplace nobody works projects nothing, however guarded', () => {
    const world = setup()
    workplace(world, 60, 60)
    person(world, { owner: 'r1', x: 60, y: 60, armed: true })
    expect(controlSources(world, size)).toEqual([])
  })

  it('a guarded workplace can win ground off a city nearby', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    workplace(world, 34, 30, [person(world, { owner: 'r2', x: 0, y: 0 })])
    person(world, { owner: 'r2', x: 35, y: 30, armed: true })
    expect(owner(world, 33, 30)).toBe('r2')
    expect(owner(world, 30, 30)).toBe('r1')
    expectSound(world)
  })

  it('the invariant catches territory of an Organization that does not exist', () => {
    const world = setup()
    addCity(world, { id: 'c1', realmId: 'r9', x: 30, y: 30 })
    const violations = checkInvariants(world, terrain, [territorySound])
    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]!.message).toContain('no Organization')
  })
})

describe('territory tracker', () => {
  it('recomputes once a game hour', () => {
    const world = setup()
    const tracker = new TerritoryTracker()
    expect(tracker.update(world, terrain)).toBe(true)
    expect(tracker.current!.owners.size).toBe(0)

    addCity(world, { id: 'c1', realmId: 'r1', x: 30, y: 30 })
    world.tick += TICKS_PER_GAME_HOUR - 1
    expect(tracker.update(world, terrain)).toBe(false)
    expect(territoryOwner(tracker.current!, 30, 30)).toBeUndefined()

    world.tick += 1
    expect(tracker.update(world, terrain)).toBe(true)
    expect(tracker.current!.tick).toBe(world.tick)
    expect(territoryOwner(tracker.current!, 30, 30)).toBe('r1')
  })
})
