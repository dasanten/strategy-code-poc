import {
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_REACH,
  NPC_FOUND_STANDING,
  NPC_TOWN,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  computeTerritory,
  tileIndex,
  townHallOf,
  wrapDistance,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { CITY_NAMES, foundCity, updateCityMembership } from './cities.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { findFoundingSite, foundingParty } from './npc-founding.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { mulberry32, newResident } from './residents.js'
import { foundStartingCity, newId } from './starting-city.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Full cities found daughters (`CONTEXT.md`: Full city, Founding): a city idle and short of
 * nothing for a game week sends a founding party to a free site, which builds a town hall there
 * and grows into a village of its own.
 */

/** Puts a node of `kind` on its tile, with the terrain it lies on. */
function node(world: WorldState, terrain: TerrainMap, kind: ResourceKind, x: number, y: number) {
  world.nodes.push({ id: `${kind}${x},${y}`, kind, x, y })
  const ground = kind === 'forest' ? Terrain.Forest : Terrain.Hills
  terrain.tiles[tileIndex(terrain.size, x, y)] = ground
}

/**
 * A town alone on a Plains map of `size` with its storage full of everything its reserve wants,
 * so it is short of nothing, and more hands than its farms take.
 */
function fullTown(size: number): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
  const home = npcHome(world, city)!
  home.stock = { food: 3000, wood: 800, stone: 800, iron: 200, spear: 20, coins: 1000 }
  return { world, terrain, city }
}

/** Runs the world for up to `ticks`, or until `done`, checking the invariants every game day. */
function run(world: WorldState, terrain: TerrainMap, ticks: number, done: () => boolean) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks && !done(); t++) {
    stepWorld(world, terrain, walking)
    if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
  }
}

describe('a full city', () => {
  it('is not full while it is short of something', () => {
    const { world, terrain, city } = fullTown(300)
    npcHome(world, city)!.stock = { food: 3000 }
    const plan = planCity(world, city, terrain)
    expect(plan.fullSince).toBeUndefined()
  })

  it('counts as full from the pass that finds spare hands with nowhere to go and nothing short', () => {
    const { world, terrain, city } = fullTown(300)
    const plan = planCity(world, city, terrain)
    expect(plan.fullSince).toBe(world.tick)
  })

  it('looks for its daughter on no realm territory, near a node of what it lacks', () => {
    const terrain = plains(1600)
    const world = createWorld(terrain)
    const realm = foundStartingCity(world, terrain, 7)
    const hall = world.buildings.find(
      (b) => b.kind === 'townHall' && world.cities.some((c) => c.realmId === realm.id),
    )!
    // The mother lies 700 tiles west of the realm, and lacks stone: the only stone lies in the
    // realm's territory, so its sites would go there if nothing stopped them.
    const mx = (hall.x - 700 + terrain.size) % terrain.size
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, mx, hall.y - 14, mulberry32(9))
    const home = npcHome(world, city)!
    node(world, terrain, 'forest', home.x + 30, home.y)
    node(world, terrain, 'stone', hall.x - 40, hall.y)
    const owners = computeTerritory(world, terrain.size).owners
    let found = 0
    for (let i = 0; i < 5; i++) {
      world.tick += 977
      const site = findFoundingSite(world, terrain, city, home)
      if (!site) continue
      found++
      const d = wrapDistance(terrain.size, home, site)
      expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size)
      expect(d).toBeLessThanOrEqual(NPC_FOUND_REACH + NPC_VILLAGE.size)
      for (let dy = -20; dy <= 20; dy++) {
        for (let dx = -20; dx <= 20; dx++) {
          const x = (site.x + dx + terrain.size) % terrain.size
          const y = (site.y + dy + terrain.size) % terrain.size
          expect(owners.get(`${x},${y}`)).not.toBe(realm.id)
        }
      }
    }
    expect(found).toBeGreaterThan(0)
  })

  it('gives a wiped-out party up after the give-up days, and may found again', () => {
    const { world, terrain, city } = fullTown(300)
    const plan = planCity(world, city, terrain)
    plan.jobs.gone1 = { kind: 'found' }
    plan.jobs.gone2 = { kind: 'found' }
    plan.foundingSite = { x: 250, y: 250 }
    plan.fullSince = world.tick
    world.tick += (NPC_FOUND_GIVE_UP_DAYS - 1) * TICKS_PER_GAME_DAY
    planCity(world, city, terrain)
    expect(foundingParty(plan)).toEqual(['gone1', 'gone2'])
    world.tick += 2 * TICKS_PER_GAME_DAY
    planCity(world, city, terrain)
    expect(foundingParty(plan)).toEqual([])
    expect(plan.foundingSite).toBeUndefined()
    // Not a party any more: idle and short of nothing, it is full again from now.
    planCity(world, city, terrain)
    expect(plan.fullSince).toBe(world.tick)
  })

  it(
    'founds a village 480+ tiles away within a few game weeks, which then feeds itself',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city } = fullTown(1300)
      const home = npcHome(world, city)!
      node(world, terrain, 'forest', home.x + 40, home.y)
      node(world, terrain, 'stone', home.x, home.y + 60)
      const daughter = () =>
        world.cities.find((c) => c.id !== city.id && c.realmId === null && !c.tradeOrg)
      // Until the town hall stands and the party has moved to the daughter, the tick after.
      const moved = () => world.residents.some((r) => r.cityId === daughter()?.id)
      run(world, terrain, 40 * TICKS_PER_GAME_DAY, moved)
      const village = daughter()
      expect(village).toBeDefined()
      expect(CITY_NAMES).toContain(village!.name)
      const hall = townHallOf(world, village!)!
      // The usual distance runs from a city's town hall to the new village's middle (`npcSiteFits`).
      const far = NPC_CITY_MIN_DISTANCE - NPC_VILLAGE.size / 2
      expect(wrapDistance(terrain.size, townHallOf(world, city)!, hall)).toBeGreaterThan(far)
      const people = world.residents.filter((r) => r.cityId === village!.id)
      expect(people.length).toBe(NPC_VILLAGE.residents)
      expect(people.some((r) => r.carried.spear || r.carried.sword)).toBe(true)
      const standing = (of: string, toward: string) =>
        world.standings.find((s) => s.of === of && s.toward === toward)?.value ?? 0
      expect(standing(city.id, village!.id)).toBeGreaterThan(NPC_FOUND_STANDING - 1)
      expect(standing(village!.id, city.id)).toBeGreaterThan(NPC_FOUND_STANDING - 1)
      expect(foundingParty(world.cityPlans[city.id])).toEqual([])

      // It builds its storage and a farm, and feeds itself from the farm.
      const has = (kind: string) =>
        world.buildings.some((b) => b.kind === kind && b.cityId === village!.id && !b.site)
      run(world, terrain, 20 * TICKS_PER_GAME_DAY, () => false)
      expect(has('storage')).toBe(true)
      expect(has('farm')).toBe(true)
      const alive = world.residents.filter((r) => r.cityId === village!.id && r.health > 0)
      expect(alive.length).toBeGreaterThanOrEqual(NPC_VILLAGE.residents)
      const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === village!.id)!
      expect(alive.some((r) => r.script?.memory.workplaceId === farm.id)).toBe(true)
      const storage = npcHome(world, village!)!
      expect(storage.stock?.food ?? 0).toBeGreaterThan(0)
    },
  )
})

describe('a daughter', () => {
  it(
    'builds its storage, a farm and a house in that order, then walls itself',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const terrain = plains(240)
      const world = createWorld(terrain)
      const rand = mulberry32(11)
      const hall = {
        id: newId(world, 'b'),
        kind: 'townHall' as const,
        cityId: null,
        x: 120,
        y: 120,
      }
      world.buildings.push(hall)
      const city = foundCity(world, hall, null)
      updateCityMembership(world, terrain.size)
      node(world, terrain, 'forest', 160, 120)
      for (let i = 0; i < NPC_VILLAGE.residents; i++) {
        const r = newResident(rand, {
          id: newId(world, 'r'),
          owner: null,
          cityId: city.id,
          x: 118 + i,
          y: 124,
          tick: world.tick,
        })
        r.carried = { food: 15, wood: 5, stone: 2 }
        world.residents.push(r)
      }
      const order: string[] = []
      const ofCity = (kind: string) =>
        world.buildings.find(
          (b) => b.kind === kind && (b.cityId === city.id || b.site) && b.id !== hall.id,
        )
      const walls = () =>
        world.buildings.filter((b) => (b.kind === 'wall' || b.kind === 'gate') && !b.site)
      const walking = new Walking(terrain)
      let toppedUp = false
      for (let t = 0; t < 40 * TICKS_PER_GAME_DAY; t++) {
        stepWorld(world, terrain, walking)
        for (const kind of ['storage', 'farm', 'house']) {
          if (!order.includes(kind) && ofCity(kind)) order.push(kind)
        }
        const storage = world.buildings.find(
          (b) => b.kind === 'storage' && b.cityId === city.id && !b.site,
        )
        // Its lumber camp and farm would fill the storage in time; here it gets the Wood and
        // Food at once.
        if (storage && order.includes('house') && !toppedUp) {
          storage.stock = { ...storage.stock, wood: 600, food: 300 }
          toppedUp = true
        }
        if (world.tick % TICKS_PER_GAME_DAY === 0) {
          expect(checkInvariants(world, terrain)).toEqual([])
        }
        if (walls().some((b) => b.kind === 'gate')) break
      }
      expect(order).toEqual(['storage', 'farm', 'house'])
      const home = npcHome(world, city)!
      const ring = walls()
      expect(ring.some((b) => b.kind === 'gate')).toBe(true)
      const d = Math.floor(NPC_VILLAGE.size / 2)
      for (const b of ring) {
        expect(Math.max(Math.abs(b.x - home.x), Math.abs(b.y - home.y))).toBe(d)
      }
      expect(ring.length).toBeGreaterThan(8 * d - 8)
      expect(ring.every((b) => b.cityId === city.id)).toBe(true)
    },
  )
})
