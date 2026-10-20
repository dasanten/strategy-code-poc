import {
  MAX_WORKERS,
  NPC_ADULTS_PER_PAIR,
  NPC_VILLAGE,
  NPC_WALL_STEP,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  Terrain,
  buildProblem,
  cityAreaTiles,
  cityResidents,
  freeHousing,
  mayStep,
  tileIndex,
  wallMap,
  wallSide,
  wrapDelta,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { requestBuilding, resolveBuilding } from './building.js'
import { requestCarrying, resolveCarrying } from './carrying.js'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { newWall, nextProject, wallRings } from './npc-growth.js'
import { foundNpcCity } from './npc-cities.js'
import { mulberry32, newResident } from './residents.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/**
 * A village alone on a Plains map, its top-left wall tile at (20, 20) and its home (the storage)
 * at (23, 23), with a forest node east of it.
 */
function village(): { world: WorldState; terrain: TerrainMap; city: City; home: Building } {
  const terrain = plains(64)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  world.nodes.push({ id: 'forest', kind: 'forest', x: 36, y: 23 })
  terrain.tiles[tileIndex(terrain.size, 36, 23)] = Terrain.Forest
  return { world, terrain, city, home: npcHome(world, city)! }
}

/** Rock fills the rest of the inside of the village's wall, so it has no room left there. */
function fillInside(world: WorldState, terrain: TerrainMap, home: Building): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = home.x + dx
      const y = home.y + dy
      if (world.buildings.some((b) => b.x === x && b.y === y)) continue
      world.nodes.push({ id: `rock${x},${y}`, kind: 'stone', x, y })
      terrain.tiles[tileIndex(terrain.size, x, y)] = Terrain.Hills
    }
  }
}

/** Adds adults to the city until its houses are full. */
function fillHouses(world: WorldState, city: City, home: Building): void {
  const rand = mulberry32(3)
  while (freeHousing(world, city) > 0) {
    const r = newResident(rand, {
      id: newId(world, 'r'),
      owner: null,
      cityId: city.id,
      x: home.x,
      y: home.y,
      tick: world.tick,
    })
    world.residents.push(r)
  }
}

const storageOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!

/** The city's finished walls and gates `d` tiles out from its home. */
const ring = (world: WorldState, city: City, home: Building, size: number, d: number) =>
  world.buildings.filter(
    (b) =>
      b.cityId === city.id &&
      (b.kind === 'wall' || b.kind === 'gate') &&
      !b.site &&
      Math.max(Math.abs(wrapDelta(home.x, b.x, size)), Math.abs(wrapDelta(home.y, b.y, size))) ===
        d,
  )

/**
 * Runs the world for up to `ticks`, or until `done`, checking the invariants every game day and,
 * every tick until it happens, that the old wall (`oldIds`) stands whole while any tile of the new
 * wall is unfinished.
 */
function run(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  home: Building,
  oldIds: Set<string>,
  ticks: number,
  done: () => boolean = () => false,
): void {
  const walking = new Walking(terrain)
  let comingDown = false
  for (let t = 0; t < ticks && !done(); t++) {
    stepWorld(world, terrain, walking)
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (comingDown) continue
    const old = world.buildings.filter((b) => oldIds.has(b.id))
    if (old.length === oldIds.size && old.every((b) => !b.teardown)) continue
    // The first stretch of the old wall is coming down: the new one is finished.
    const rings = wallRings(world, city, home, terrain.size)!
    expect(rings.outer).toBe(rings.inner + NPC_WALL_STEP)
    expect(newWall(world, home, terrain, rings).every((w) => w.done)).toBe(true)
    comingDown = true
  }
}

describe('NPC cities grow', () => {
  it('a village grows in residents and area over game years', () => {
    const { world, terrain, city, home } = village()
    const size = terrain.size
    fillInside(world, terrain, home)
    fillHouses(world, city, home)
    const people = cityResidents(world, city).length
    const area = cityAreaTiles(world, city, size).size
    const oldIds = new Set(ring(world, city, home, size, 3).map((b) => b.id))
    run(world, terrain, city, home, oldIds, 4 * TICKS_PER_GAME_YEAR)
    expect(cityResidents(world, city).length).toBeGreaterThan(people)
    expect(cityAreaTiles(world, city, size).size).toBeGreaterThan(area)
    // It built its own lumber camp for the wood, and moved its wall out.
    expect(world.buildings.some((b) => b.kind === 'lumberCamp' && !b.site)).toBe(true)
    expect(ring(world, city, home, size, 3)).toEqual([])
    expect(ring(world, city, home, size, 3 + NPC_WALL_STEP).length).toBeGreaterThan(30)
  }, 300_000)

  it('tears the old wall down only after the new one is finished', () => {
    const { world, terrain, city, home } = village()
    const size = terrain.size
    fillInside(world, terrain, home)
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 600 }
    const oldIds = new Set(ring(world, city, home, size, 3).map((b) => b.id))
    run(world, terrain, city, home, oldIds, TICKS_PER_GAME_YEAR, () =>
      world.buildings.every((b) => !oldIds.has(b.id)),
    )
    expect(world.buildings.filter((b) => oldIds.has(b.id))).toEqual([])
    // The gate stands in line with the old one, further out.
    const gate = world.buildings.find((b) => b.kind === 'gate' && b.cityId === city.id)!
    expect([gate.x - home.x, gate.y - home.y]).toEqual([0, 3 + NPC_WALL_STEP])
    // The houses inside are still the city's, with the one it built on its edge.
    expect(world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id)).toHaveLength(
      NPC_VILLAGE.houses + 1,
    )
  }, 120_000)

  it('pairs idle adults at home while it has a food surplus, and ends pairs when Food runs short', () => {
    const { world, terrain, city, home } = village()
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    storageOf(world, city).stock = { food: 400 }
    stepNpcCities(world, terrain.size, terrain)
    const paired = world.residents.filter((r) => r.order?.kind === 'pair')
    expect(paired).toHaveLength(2 * Math.floor(NPC_VILLAGE.residents / NPC_ADULTS_PER_PAIR))
    expect(paired[0]!.order).toEqual({ kind: 'pair', partnerId: paired[1]!.id, since: 0 })
    storageOf(world, city).stock = { food: 1 }
    stepNpcCities(world, terrain.size, terrain)
    expect(world.residents.filter((r) => r.order?.kind === 'pair')).toEqual([])
  })

  it('builds a house inside its wall when it has a food surplus and no free housing', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    const project = nextProject(world, city, home, terrain)
    expect(project).toMatchObject({ kind: 'build', building: 'house' })
    const p = project as { x: number; y: number }
    expect(Math.max(Math.abs(p.x - home.x), Math.abs(p.y - home.y))).toBeLessThan(3)
    // With room in its houses it builds none.
    world.residents.pop()
    expect(nextProject(world, city, home, terrain)).toBeUndefined()
  })

  it('with no room left inside, builds on its edge, then puts up a new wall from its gate', () => {
    const { world, terrain, city, home } = village()
    fillInside(world, terrain, home)
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    const edge = nextProject(world, city, home, terrain) as { x: number; y: number }
    expect(edge).toMatchObject({ kind: 'build', building: 'house' })
    expect(Math.max(Math.abs(edge.x - home.x), Math.abs(edge.y - home.y))).toBe(4)
    expect(wallRings(world, city, home, terrain.size)?.expanding).toBe(false)
    world.buildings.push({ id: 'h', kind: 'house', cityId: city.id, x: edge.x, y: edge.y })
    expect(wallRings(world, city, home, terrain.size)).toMatchObject({
      inner: 3,
      outer: 3 + NPC_WALL_STEP,
      expanding: true,
    })
    expect(nextProject(world, city, home, terrain)).toEqual({
      kind: 'build',
      building: 'gate',
      x: home.x,
      y: home.y + 3 + NPC_WALL_STEP,
    })
  })

  it('builds a lumber camp on the nearest forest when it needs wood and makes none', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400 }
    expect(nextProject(world, city, home, terrain)).toEqual({
      kind: 'build',
      building: 'lumberCamp',
      x: 36,
      y: 23,
    })
  })

  it('builds a farm beyond its next wall when every farm is full', () => {
    const { world, terrain, city, home } = village()
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    const rand = mulberry32(5)
    while (world.residents.length < MAX_WORKERS.farm!) {
      world.residents.push(
        newResident(rand, {
          id: newId(world, 'r'),
          owner: null,
          cityId: city.id,
          x: farm.x,
          y: farm.y,
          tick: 0,
        }),
      )
    }
    for (const r of world.residents) {
      r.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
    }
    const project = nextProject(world, city, home, terrain) as { x: number; y: number }
    expect(project).toMatchObject({ kind: 'build', building: 'farm' })
    const out = Math.max(Math.abs(project.x - home.x), Math.abs(project.y - home.y))
    expect(out).toBeGreaterThan(3 + NPC_WALL_STEP)
    // Out of the way of the gate.
    expect(project.x).not.toBe(home.x)
  })

  it('leaves the Trade Organization’s cities to grow their own way', () => {
    const { world, terrain, city, home } = village()
    city.tradeOrg = 'post'
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    storageOf(world, city).stock = { food: 400 }
    stepNpcCities(world, terrain.size, terrain)
    expect(world.residents.some((r) => r.order?.kind === 'pair')).toBe(false)
  })
})

describe('houses, farms and NPC walls', () => {
  it('a house goes only in a city’s area, a farm only on Plains', () => {
    const { world, terrain, home } = village()
    expect(buildProblem(world, home.x + 4, home.y, 'house', terrain)).toBeUndefined()
    expect(buildProblem(world, home.x + 6, home.y, 'house', terrain)).toBe(
      'a house goes in a city’s area',
    )
    expect(buildProblem(world, home.x + 8, home.y, 'farm', terrain)).toBeUndefined()
    terrain.tiles[tileIndex(terrain.size, home.x + 8, home.y)] = Terrain.Forest
    expect(buildProblem(world, home.x + 8, home.y, 'farm', terrain)).toBe(
      'a farm goes on Plains, off any resource node',
    )
  })

  it('a farm is laid out for its builder’s city, an NPC city’s lumber camp is one of its own', () => {
    const { world, terrain, city } = village()
    const [farmer, woodcutter] = world.residents as [Resident, Resident]
    Object.assign(farmer, { x: 40, y: 40 })
    farmer.order = { kind: 'build', building: 'farm', at: { x: 40, y: 40 }, siteId: null }
    Object.assign(woodcutter, { x: 36, y: 23 })
    woodcutter.order = { kind: 'build', building: 'lumberCamp', at: { x: 36, y: 23 }, siteId: null }
    resolveBuilding(world, requestBuilding(world), terrain)
    const farm = world.buildings.find((b) => b.x === 40 && b.y === 40)!
    const camp = world.buildings.find((b) => b.x === 36 && b.y === 23)!
    expect(farm).toMatchObject({ kind: 'farm', cityId: city.id })
    expect(camp).toMatchObject({ kind: 'lumberCamp', cityId: null })
    expect(city.workplaceIds).toEqual([camp.id])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('the last materials carried to a site with all its work finish it', () => {
    const { world, terrain, city, home } = village()
    const r = world.residents[0]!
    Object.assign(r, { x: home.x + 4, y: home.y, carried: { wood: 25 } })
    const site: Building = {
      id: 'h',
      kind: 'house',
      cityId: null,
      x: home.x + 4,
      y: home.y,
      site: { delivered: {}, work: TICKS_PER_GAME_DAY },
    }
    world.buildings.push(site)
    r.order = { kind: 'drop', to: { kind: 'site', siteId: 'h' }, goods: { wood: 25 } }
    resolveCarrying(world, requestCarrying(world), terrain.size)
    expect(site.site).toBeUndefined()
    expect(site.cityId).toBe(city.id)
    expect(r.carried.wood).toBe(5)
  })

  it('catches a city working one of its farms as its own workplace', () => {
    const { world, terrain, city } = village()
    const farm = world.buildings.find((b) => b.kind === 'farm')!
    city.workplaceIds = [farm.id]
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'city-workplaces-sound' }),
    )
  })

  it('an NPC city’s residents stand on its walls, others don’t', () => {
    const { world, terrain, city, home } = village()
    const walls = wallMap(world, terrain)
    const size = terrain.size
    const inside = tileIndex(size, home.x, home.y - 2)
    const wall = tileIndex(size, home.x, home.y - 3)
    const own = world.residents[0]!
    expect(wallSide(own)).toBe(city.id)
    expect(mayStep(walls, wallSide(own), inside, wall, true)).toBe(true)
    expect(mayStep(walls, null, inside, wall, true)).toBe(false)
    expect(mayStep(walls, 'realm1', inside, wall, true)).toBe(false)
  })
})
