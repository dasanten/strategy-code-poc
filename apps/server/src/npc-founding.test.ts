import {
  BUILD_MATERIALS,
  FOOD_PER_DAY,
  FOOD_SURPLUS_DAYS,
  GOOD_WEIGHT,
  NPC_CITY_MIN_DISTANCE,
  NPC_FOUND_GIVE_UP_DAYS,
  NPC_FOUND_PARTY_MOST,
  NPC_FOUND_REACH,
  NPC_FOUND_STANDING,
  NPC_FOUND_VILLAGE_RESIDENTS,
  NPC_FULL_DAYS,
  NPC_FULL_DAYS_LEAST,
  NPC_FULL_DIP_DAYS,
  NPC_TOWN,
  NPC_TRADE,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  WALK_TICKS_PER_TILE,
  carryCapacity,
  computeTerritory,
  npcFoundingPartySize,
  npcFullDays,
  npcReserve,
  npcSoldierTarget,
  ticksForAge,
  tileIndex,
  townHallOf,
  wrapDistance,
  type City,
  type CityPlan,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { CITY_NAMES, foundCity, updateCityMembership } from './cities.js'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { farStableSpot } from './npc-growth.js'
import {
  findFoundingSite,
  foundDaughter,
  foundingFood,
  foundingMaterials,
  foundingPartiesSound,
  foundingParty,
  fullWaitSound,
} from './npc-founding.js'
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
 * so it is short of nothing, and more hands than its farms take. It has its stable already, as
 * one this far along does (`CONTEXT.md`: NPC horses), with nothing left to build but a daughter.
 */
function fullTown(size: number): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
  const home = npcHome(world, city)!
  home.stock = { food: 3000, wood: 800, stone: 800, iron: 200, spear: 20, coins: 1000 }
  const stable = farStableSpot(world, city, home, terrain)!
  world.buildings.push({ id: 'stable0', kind: 'stable', cityId: city.id, ...stable })
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

  describe('by its size', () => {
    /** A full town staged at `residents`, with a site ready and full since `days` ago. */
    function fullFor(residents: number, days: number) {
      const staged = fullTown(1300)
      const { world, terrain, city } = staged
      const rand = mulberry32(13)
      const home = npcHome(world, city)!
      while (world.residents.filter((r) => r.cityId === city.id).length < residents) {
        const id = newId(world, 'r')
        const r = newResident(rand, {
          id,
          owner: null,
          cityId: city.id,
          x: home.x,
          y: home.y,
          tick: world.tick,
        })
        world.residents.push(r)
      }
      // Time for those just added to be grown, whatever the map's clock says.
      world.tick = 4000 * TICKS_PER_GAME_DAY
      for (const r of world.residents) r.bornAt = world.tick - ticksForAge(30)
      // Its soldiers armed, and well past what so many want, so nothing is short.
      const people = world.residents.filter((r) => r.cityId === city.id)
      for (const r of people.slice(0, npcSoldierTarget(people.length))) r.carried.spear = 1
      const reserve = npcReserve(world, city)
      home.stock = { ...home.stock, coins: (reserve.coins ?? 0) + 1000 }
      planCity(world, city, terrain)
      const plan = world.cityPlans[city.id]!
      plan.fullSince = world.tick - days * TICKS_PER_GAME_DAY
      plan.foundingSite = findFoundingSite(world, terrain, city, home)
      expect(plan.fullSince).toBeDefined()
      expect(plan.foundingSite).toBeDefined()
      return { ...staged, plan, home }
    }

    it('waits less and sends more the bigger it is, down to a floor and up to a most', () => {
      expect(npcFullDays(NPC_TOWN.residents)).toBe(NPC_FULL_DAYS)
      expect(npcFullDays(NPC_FOUND_VILLAGE_RESIDENTS)).toBe(NPC_FULL_DAYS)
      expect(npcFullDays(110)).toBeLessThan(NPC_FULL_DAYS)
      expect(npcFullDays(100_000)).toBe(NPC_FULL_DAYS_LEAST)
      expect(npcFoundingPartySize(NPC_TOWN.residents)).toBe(NPC_VILLAGE.residents)
      expect(npcFoundingPartySize(NPC_FOUND_VILLAGE_RESIDENTS)).toBe(NPC_VILLAGE.residents)
      expect(npcFoundingPartySize(110)).toBeGreaterThan(NPC_VILLAGE.residents)
      expect(npcFoundingPartySize(100_000)).toBe(NPC_FOUND_PARTY_MOST)
    })

    it('a big city founds sooner than a week and sends more, with more materials', () => {
      const days = npcFullDays(110)
      const { world, terrain, city, plan } = fullFor(110, days - 0.5)
      planCity(world, city, terrain)
      expect(foundingParty(plan)).toEqual([])

      plan.fullSince = world.tick - days * TICKS_PER_GAME_DAY
      planCity(world, city, terrain)
      expect(days).toBeLessThan(NPC_FULL_DAYS)
      expect(foundingParty(plan)).toHaveLength(npcFoundingPartySize(110))
      expect(foundingParty(plan).length).toBeGreaterThan(NPC_VILLAGE.residents)
      const armed = foundingParty(plan).filter((id) =>
        world.residents.some((r) => r.id === id && (r.carried.spear || r.carried.sword)),
      )
      expect(armed).toHaveLength(1)
      const more = foundingMaterials(npcFoundingPartySize(110))
      expect(more.wood).toBeGreaterThan(foundingMaterials().wood!)
    })

    it('a city of a village’s size still waits a week and sends a village’s worth', () => {
      const { world, terrain, city, plan } = fullFor(NPC_TOWN.residents, NPC_FULL_DAYS - 0.5)
      planCity(world, city, terrain)
      expect(foundingParty(plan)).toEqual([])

      plan.fullSince = world.tick - NPC_FULL_DAYS * TICKS_PER_GAME_DAY
      planCity(world, city, terrain)
      expect(foundingParty(plan)).toHaveLength(NPC_VILLAGE.residents)
      expect(foundingMaterials(NPC_VILLAGE.residents)).toEqual({ wood: 90, stone: 50 })
    })

    it('a big city that isn’t full of what its bigger party takes stays home', () => {
      const days = npcFullDays(110)
      const { world, terrain, city, plan, home } = fullFor(110, days)
      const reserve = npcReserve(world, city)
      // A village's materials above its reserve, but not the houses of its bigger party.
      const village = foundingMaterials()
      home.stock = {
        ...home.stock,
        wood: (reserve.wood ?? 0) + village.wood!,
        stone: (reserve.stone ?? 0) + village.stone!,
      }
      planCity(world, city, terrain)
      expect(foundingParty(plan)).toEqual([])
    })

    it('the mother keeps enough to feed itself, at any size past a village’s', () => {
      // It founds only with nothing short, so at worst it holds just its reserve of Food. The party
      // takes the most it can, for the furthest walk, and those who stay still have a surplus.
      const furthest = foundingFood(NPC_FOUND_REACH * WALK_TICKS_PER_TILE)
      for (let n = NPC_FOUND_VILLAGE_RESIDENTS; n <= 1000; n++) {
        const members = npcFoundingPartySize(n)
        const left =
          n * FOOD_PER_DAY * NPC_TRADE.reserveFoodDays - members * (furthest.walk + furthest.stay)
        expect(left).toBeGreaterThan((n - members) * FOOD_PER_DAY * FOOD_SURPLUS_DAYS)
      }
    })
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
      // A founding party takes no horses (`CONTEXT.md`: NPC horses).
      expect(world.horses.filter((h) => h.cityId === village!.id)).toEqual([])
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

describe('a dip below the reserve', () => {
  /** A town full for `days` game days, with its site found, its Food under the reserve now. */
  function dipping(days: number) {
    const { world, terrain, city } = fullTown(1300)
    const home = npcHome(world, city)!
    const full = home.stock!.food!
    const plan = planCity(world, city, terrain)
    world.tick = 100 * TICKS_PER_GAME_DAY
    plan.fullSince = world.tick - days * TICKS_PER_GAME_DAY
    plan.foundingSite = findFoundingSite(world, terrain, city, home)
    home.stock!.food = 1
    return { world, terrain, city, plan, home, full }
  }

  it('keeps the wait while it lasts up to a game day, and sends nobody meanwhile', () => {
    const { world, terrain, city, plan } = dipping(NPC_FULL_DAYS + 1)
    const since = plan.fullSince
    planCity(world, city, terrain)
    expect(plan.shortSince).toBe(world.tick)
    expect(plan.fullSince).toBe(since)
    expect(plan.foundingSite).toBeDefined()
    expect(foundingParty(plan)).toEqual([])

    world.tick += NPC_FULL_DIP_DAYS * TICKS_PER_GAME_DAY
    planCity(world, city, terrain)
    expect(plan.fullSince).toBe(since)
    expect(foundingParty(plan)).toEqual([])
  })

  it('restarts the wait once it lasts longer than a game day', () => {
    const { world, terrain, city, plan } = dipping(NPC_FULL_DAYS + 1)
    planCity(world, city, terrain)
    world.tick += NPC_FULL_DIP_DAYS * TICKS_PER_GAME_DAY + 1
    planCity(world, city, terrain)
    expect(plan.fullSince).toBeUndefined()
    expect(plan.shortSince).toBeUndefined()
    expect(plan.foundingSite).toBeUndefined()
  })

  it('is over when nothing is short, so the next dip gets its own game day', () => {
    const { world, terrain, city, plan, home, full } = dipping(1)
    const since = plan.fullSince
    planCity(world, city, terrain)
    world.tick += NPC_FULL_DIP_DAYS * TICKS_PER_GAME_DAY
    home.stock!.food = full
    planCity(world, city, terrain)
    expect(plan.shortSince).toBeUndefined()
    expect(plan.fullSince).toBe(since)

    world.tick += 60
    home.stock!.food = 1
    planCity(world, city, terrain)
    expect(plan.shortSince).toBe(world.tick)
    expect(plan.fullSince).toBe(since)
  })

  it('starts nothing in a city with no wait under way', () => {
    const { world, terrain, city, plan } = dipping(1)
    delete plan.fullSince
    planCity(world, city, terrain)
    expect(plan.shortSince).toBeUndefined()
  })

  it('still sets a party out once nothing is short, its wait kept', () => {
    const { world, terrain, city, plan, home, full } = dipping(NPC_FULL_DAYS + 1)
    planCity(world, city, terrain)
    home.stock!.food = full
    world.tick += 60
    planCity(world, city, terrain)
    expect(foundingParty(plan)).toHaveLength(NPC_VILLAGE.residents)
    expect(plan.shortSince).toBeUndefined()
  })
})

describe('the full-wait-sound invariant', () => {
  const planWith = (over: Partial<CityPlan>) => {
    const { world, terrain, city } = fullTown(300)
    world.tick = 100
    world.cityPlans[city.id] = { plannedAt: 0, jobs: {}, ...over }
    return { world, terrain }
  }

  it('holds for a dip in a wait under way', () => {
    const { world, terrain } = planWith({ fullSince: 10, shortSince: 50 })
    expect(fullWaitSound.check(world, terrain)).toEqual([])
  })

  it('finds a dip with no wait under way, or with a party out, or to come', () => {
    for (const over of [
      { shortSince: 50 },
      { fullSince: 10, shortSince: 50, jobs: { gone: { kind: 'found' as const } } },
      { fullSince: 10, shortSince: 101 },
    ]) {
      const { world, terrain } = planWith(over)
      expect(fullWaitSound.check(world, terrain)).toHaveLength(1)
    }
  })
})

describe('the founding-parties-sound invariant', () => {
  /** A town with a plan of `members` in its founding party. */
  function withParty(members: number) {
    const { world, terrain, city } = fullTown(300)
    const jobs: Record<string, { kind: 'found' }> = {}
    for (const i of Array(members).keys()) jobs[`gone${i}`] = { kind: 'found' }
    world.cityPlans[city.id] = { plannedAt: 0, jobs, foundingSite: { x: 250, y: 250 } }
    return { world, terrain }
  }

  it('holds for the largest party', () => {
    const { world, terrain } = withParty(NPC_FOUND_PARTY_MOST)
    expect(foundingPartiesSound.check(world, terrain)).toEqual([])
  })

  it('finds a party past the largest', () => {
    const { world, terrain } = withParty(NPC_FOUND_PARTY_MOST + 1)
    expect(foundingPartiesSound.check(world, terrain)).toHaveLength(1)
  })
})

describe('a daughter', () => {
  it(
    'has its armed founder bring what they carry to its first storage, then stand as a soldier',
    { timeout: 120_000 },
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
      const people = Array.from({ length: NPC_VILLAGE.residents }, (_, i) => {
        const r = newResident(rand, {
          id: newId(world, 'r'),
          owner: null,
          cityId: city.id,
          x: 118 + i,
          y: 124,
          tick: world.tick,
        })
        r.bornAt = world.tick - ticksForAge(30)
        r.carried = { food: 15 }
        world.residents.push(r)
        return r
      })
      // Wood the storage needs is on the one who is armed, as much as they can carry: nobody else
      // can finish it. The rest is on the others.
      const need = BUILD_MATERIALS.storage!
      const room = (r: (typeof people)[number]) => carryCapacity(r, world.tick) - 1
      const [armed, ...rest] = [...people].sort((a, b) => room(b) - room(a)) as [
        (typeof people)[number],
        ...typeof people,
      ]
      const onArmed = Math.min(need.wood!, Math.floor(room(armed) - GOOD_WEIGHT.spear))
      expect(onArmed).toBeGreaterThan(0)
      armed.carried = { food: 1, spear: 1, wood: onArmed }
      let wood = need.wood! - onArmed
      let stone = need.stone!
      for (const r of rest) {
        const w = Math.min(wood, Math.floor(room(r)))
        const s = Math.min(stone, Math.floor(room(r)) - w)
        r.carried = { food: 1, wood: w, stone: s }
        wood -= w
        stone -= s
      }
      const storage = () =>
        world.buildings.find((b) => b.kind === 'storage' && b.cityId === city.id && !b.site)
      run(world, terrain, 8 * TICKS_PER_GAME_DAY, () => storage() !== undefined)
      expect(storage()).toBeDefined()
      expect(armed.carried.wood ?? 0).toBe(0)
      expect(armed.carried.stone ?? 0).toBe(0)
      expect(armed.carried.spear).toBe(1)
      run(world, terrain, TICKS_PER_GAME_DAY, () => false)
      expect(armed.script?.task).not.toBe('build')
      expect(world.cityPlans[city.id]?.jobs[armed.id]?.kind).toBe('soldier')
    },
  )

  it('has a founder gone back for materials come to it instead once the town hall stands', () => {
    const { world, terrain, city } = fullTown(1300)
    const storage = npcHome(world, city)!
    const hall = { id: newId(world, 'b'), kind: 'townHall' as const, cityId: null, x: 700, y: 60 }
    world.buildings.push(hall)
    const daughter = foundCity(world, hall, null)
    const [back, there] = world.residents.filter((r) => r.cityId === city.id && !r.carrying)
    const fetch = { storageId: storage.id, goods: { wood: 28 } }
    back!.script = {
      scriptId: 0,
      task: 'build',
      memory: { building: 'townHall', at: { x: 700, y: 60 }, fetch },
    }
    back!.order = {
      kind: 'walkTo',
      target: { x: storage.x, y: storage.y },
      path: null,
      progress: 0,
    }
    there!.script = {
      scriptId: 0,
      task: 'build',
      memory: { building: 'townHall', at: { x: 700, y: 60 } },
    }
    const plan = planCity(world, city, terrain)
    plan.foundingSite = { x: hall.x, y: hall.y }
    plan.jobs[back!.id] = { kind: 'found' }
    plan.jobs[there!.id] = { kind: 'found' }

    expect(foundDaughter(world, city, plan)).toBe(daughter)

    expect(back!.cityId).toBe(daughter.id)
    expect(back!.script).toBeUndefined()
    expect(back!.order).toBeNull()
    expect(there!.cityId).toBe(daughter.id)
    expect(there!.script?.task).toBe('build')
  })

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
