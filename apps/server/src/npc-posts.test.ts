import {
  NPC_SOLDIERS_ON_HALL,
  NPC_VILLAGE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  covers,
  isAt,
  townHallOf,
  wrapDelta,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { startAlarm } from './alarms.js'
import { checkInvariants } from './invariants.js'
import { stepNpcCities, npcHome } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { planCity } from './npc-plan.js'
import { freeSoldiers, npcSoldiersOnPosts, soldierPosts } from './npc-posts.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const SIZE = 128

/** A city alone on an open map, its residents free and on its storage, `armed` of them with spears. */
function staged(
  armed: number,
  residents = 40,
): { world: WorldState; terrain: TerrainMap; city: City; storage: Building; hall: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, { ...NPC_VILLAGE, residents }, 30, 30, mulberry32(7))
  const storage = npcHome(world, city)!
  const hall = townHallOf(world, city)!
  world.residents.forEach((r, i) => {
    Object.assign(r, { x: storage.x, y: storage.y, order: null, carried: { food: OWN_FOOD } })
    delete r.script
    delete r.weapon
    if (i < armed) r.carried.spear = 1
  })
  return { world, terrain, city, storage, hall }
}

/** The city's soldiers, in order of id. */
const soldiersOf = (world: WorldState) =>
  world.residents.filter((r) => r.carried.spear).sort((a, b) => (a.id < b.id ? -1 : 1))

/** Runs the city's pass and one tick of its behaviour. */
function pass(world: WorldState, city: City): void {
  planCity(world, city)
  stepNpcCities(world, SIZE)
}

/** Stands everyone with a walk where it ends. */
function arrive(world: WorldState): void {
  for (const r of world.residents) {
    if (r.order?.kind !== 'walkTo') continue
    r.x = r.order.target.x
    r.y = r.order.target.y
    r.order = null
  }
}

const removeWalls = (world: WorldState) => {
  world.buildings = world.buildings.filter((b) => b.kind !== 'wall' && b.kind !== 'gate')
}

const target = (r: Resident) => {
  if (r.order?.kind !== 'walkTo') throw new Error(`${r.id} is not walking`)
  return r.order.target
}

const tile = (t: { x: number; y: number }) => `${t.x},${t.y}`

/** Those of `soldiers` not set off on a round (`npc-patrols.test.ts`) by the city's pass. */
const notOnRound = (world: WorldState, city: City, soldiers: Resident[]) => {
  const out = world.cityPlans[city.id]?.patrols?.map((p) => p.residentId) ?? []
  return soldiers.filter((r) => !out.includes(r.id))
}

describe('Soldier posts (CONTEXT.md)', () => {
  it('sends soldiers off the storage to posts, spread out, and leaves them there', () => {
    const { world, city, storage } = staged(10)
    pass(world, city)
    const soldiers = soldiersOf(world)
    const targets = soldiers.map(target)
    for (const t of targets) expect(isAt(t, storage, SIZE)).toBe(false)
    expect(new Set(targets.map(tile)).size).toBeGreaterThanOrEqual(7)

    // The next passes leave them be: one walk, then nothing.
    arrive(world)
    const where = soldiers.map((r) => tile(r))
    for (const r of soldiers) expect(r.order).toBeNull()
    pass(world, city)
    for (const r of notOnRound(world, city, soldiers)) expect(r.order).toBeNull()
    expect(soldiers.map((r) => tile(r))).toEqual(where)
  })

  it('posts them on the hall first, then at the gates, then along the wall', () => {
    const { world, city, hall } = staged(10)
    const gate = world.buildings.find((b) => b.kind === 'gate')!
    pass(world, city)
    const [a, b, c, ...rest] = soldiersOf(world).map(target)
    expect(isAt(a!, hall, SIZE)).toBe(true)
    expect(isAt(b!, hall, SIZE)).toBe(true)
    expect(tile(c!)).toBe(tile(gate))
    const walls = world.buildings.filter((w) => w.kind === 'wall')
    for (const t of rest) expect(walls.some((w) => tile(w) === tile(t))).toBe(true)
  })

  it('with few soldiers holds the hall before anything else', () => {
    const { world, city, hall } = staged(1, 6)
    pass(world, city)
    expect(isAt(target(soldiersOf(world)[0]!), hall, SIZE)).toBe(true)
  })

  it('in a city with no wall, uses the hall and the ground around it, not other buildings', () => {
    const { world, city, hall } = staged(10)
    removeWalls(world)
    pass(world, city)
    const targets = soldiersOf(world).map(target)
    for (const t of targets.slice(0, NPC_SOLDIERS_ON_HALL)) expect(isAt(t, hall, SIZE)).toBe(true)
    for (const t of targets.slice(NPC_SOLDIERS_ON_HALL)) {
      expect(covers(hall, t.x, t.y, SIZE)).toBe(false)
      const dx = Math.abs(wrapDelta(hall.x + 1, t.x, SIZE))
      const dy = Math.abs(wrapDelta(hall.y + 1, t.y, SIZE))
      expect(Math.max(dx, dy)).toBeLessThanOrEqual(3)
      const on = world.buildings.filter((b) => b.kind !== 'road' && covers(b, t.x, t.y, SIZE))
      expect(on).toEqual([])
    }
    expect(new Set(targets.map(tile)).size).toBeGreaterThanOrEqual(6)
  })

  it('leaves a wall still going up, with no gate to get onto it from, alone', () => {
    const { world, city } = staged(10)
    world.buildings = world.buildings.filter((b) => b.kind !== 'gate')
    const walls = new Set(world.buildings.filter((b) => b.kind === 'wall').map(tile))
    pass(world, city)
    for (const t of soldiersOf(world).map(target)) expect(walls.has(tile(t))).toBe(false)
  })

  it('adds the ground around the hall while its wall has too few tiles for them', () => {
    const { world, city, hall } = staged(10)
    removeWalls(world)
    const at = { x: hall.x + 12, y: hall.y }
    world.buildings.push({ id: 'g', kind: 'gate', cityId: city.id, ...at })
    world.buildings.push({ id: 'w', kind: 'wall', cityId: city.id, x: at.x, y: at.y + 1 })
    pass(world, city)
    const near = soldiersOf(world)
      .map(target)
      .filter((t) => Math.abs(wrapDelta(hall.x, t.x, SIZE)) <= 5)
    expect(near.length).toBeGreaterThanOrEqual(6)
  })

  it('moves nobody on the wall when another stretch of it goes up', () => {
    const { world, city } = staged(10)
    pass(world, city)
    arrive(world)
    const rest = soldiersOf(world).slice(NPC_SOLDIERS_ON_HALL + 1)
    const where = rest.map((r) => tile(r))
    const east = world.buildings
      .filter((b) => b.kind === 'wall')
      .reduce((a, b) => (b.x > a.x ? b : a))
    for (let i = 1; i <= 6; i++) {
      const at = { x: east.x + i, y: east.y }
      world.buildings.push({ id: `new${i}`, kind: 'wall', cityId: city.id, ...at })
    }
    pass(world, city)
    for (const r of notOnRound(world, city, rest)) expect(r.order).toBeNull()
    expect(rest.map((r) => tile(r))).toEqual(where)
  })

  it('keeps one on the hall when those on it are called away', () => {
    const { world, city, hall } = staged(10)
    pass(world, city)
    arrive(world)
    const onHall = soldiersOf(world).filter((r) => isAt(r, hall, SIZE))
    expect(onHall).toHaveLength(NPC_SOLDIERS_ON_HALL)
    for (const r of onHall) {
      startAlarm(world, r, {
        kind: 'outsider',
        cityId: city.id,
        about: 'x',
        realmId: null,
        x: 0,
        y: 0,
        tick: world.tick,
      })
    }
    // The hall goes to the next by id: whoever was at the gate goes up to it.
    pass(world, city)
    const going = soldiersOf(world).filter(
      (r) => r.order?.kind === 'walkTo' && isAt(r.order.target, hall, SIZE),
    )
    expect(going).toHaveLength(NPC_SOLDIERS_ON_HALL)
    world.tick++
    expect(npcSoldiersOnPosts.check(world, stagedTerrain())).toEqual([])
  })

  it('turns one on the way to their old post round when the hall needs them', () => {
    const { world, city, hall } = staged(10)
    pass(world, city)
    // All still walking; the first two die, so the next two are for the hall.
    const [a, b, c, d] = soldiersOf(world)
    expect(isAt(target(c!), hall, SIZE)).toBe(false)
    world.residents = world.residents.filter((r) => r !== a && r !== b)
    pass(world, city)
    expect(isAt(target(c!), hall, SIZE)).toBe(true)
    expect(isAt(target(d!), hall, SIZE)).toBe(true)
  })

  it('takes a load to the storage before going to a post', () => {
    const { world, city, storage } = staged(4)
    removeWalls(world)
    const r = soldiersOf(world)[0]!
    r.carried.wood = 5
    pass(world, city)
    expect(r.order).toMatchObject({ kind: 'drop', to: { storageId: storage.id } })
  })

  it('does not send a soldier on a post back to the storage for Food', () => {
    const { world, city, hall } = staged(4)
    removeWalls(world)
    pass(world, city)
    arrive(world)
    const r = soldiersOf(world).find((s) => isAt(s, hall, SIZE))!
    r.carried.food = 1.5
    pass(world, city)
    expect(r.order).toBeNull()
    stepNpcCities(world, SIZE)
    expect(r.order).toBeNull()
  })

  it('leaves a Trade Org city to its own rules', () => {
    const { world, city, hall } = staged(4)
    city.tradeOrg = 'post'
    expect(soldierPosts(world, city, soldiersOf(world), SIZE).size).toBe(0)
    pass(world, city)
    for (const r of soldiersOf(world)) {
      const walksToHall = r.order?.kind === 'walkTo' && isAt(r.order.target, hall, SIZE)
      expect(walksToHall).toBe(false)
    }
  })

  it('stands none while its hall is a site, and those at a script keep it', () => {
    const { world, city, hall } = staged(4)
    hall.site = { materials: {}, delivered: {}, work: 0 } as unknown as Building['site']
    expect(soldierPosts(world, city, soldiersOf(world), SIZE).size).toBe(0)
    delete hall.site
    const r = soldiersOf(world)[0]!
    r.script = { scriptId: 0, task: 'build', memory: {} }
    expect(freeSoldiers(world, city, world.residents).map((s) => s.id)).not.toContain(r.id)
  })
})

function stagedTerrain(): TerrainMap {
  return { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
}

/** Far from the city, out of its sight and its area. */
const AWAY = { x: 100, y: 100 }

/** An armed grown resident of realm r1 at `at`, their Leader far away. */
function armedOutsider(world: WorldState, at: { x: number; y: number }): Resident {
  const make = (id: string, x: number, y: number) => {
    const r = newResident(mulberry32(world.residents.length + 1), {
      id,
      owner: 'r1',
      cityId: null,
      x,
      y,
      tick: world.tick,
    })
    r.bornAt = world.tick - 20 * 24 * 3600
    r.lifespan = 60
    world.residents.push(r)
    return r
  }
  make('leader', AWAY.x, AWAY.y)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'leader' })
  const r = make('p1', at.x, at.y)
  r.carried.sword = 1
  return r
}

describe('Soldier posts, in the running world', { timeout: 120_000 }, () => {
  it('an alarm takes them off their posts to the hall, and they go back', () => {
    const { world, terrain, hall } = staged(10)
    const walking = new Walking(terrain)
    const walls = world.buildings.filter((b) => b.kind === 'wall')
    const soldiers = soldiersOf(world)
    const onWall = (r: Resident) => walls.some((w) => isAt(r, w, SIZE))
    const until = (done: () => boolean, ticks = TICKS_PER_GAME_DAY) => {
      for (let t = 0; t < ticks && !done(); t++) {
        stepWorld(world, terrain, walking)
        expect(checkInvariants(world, terrain).map((v) => v.message)).toEqual([])
      }
      expect(done()).toBe(true)
    }

    // They walk there on their own, and the hall is held all along.
    until(() => soldiers.filter(onWall).length >= soldiers.length - NPC_SOLDIERS_ON_HALL - 1)
    expect(soldiers.filter((r) => isAt(r, hall, SIZE))).toHaveLength(NPC_SOLDIERS_ON_HALL)
    const posted = soldiers.find(onWall)!

    // An armed outsider comes into the area: those who see them leave their posts for the hall.
    const p = armedOutsider(world, { x: posted.x - 3, y: posted.y })
    until(() => posted.script?.task === 'alarm')
    until(() => isAt(posted, hall, SIZE))
    expect(onWall(posted)).toBe(false)

    // Gone again, they stand down and go back to the wall.
    Object.assign(p, AWAY)
    until(() => posted.script?.task !== 'alarm')
    until(() => onWall(posted))
    expect(posted.script).toBeUndefined()
  })

  it('a soldier on the hall blocks an occupation without any alarm', () => {
    const { world, terrain, city, hall } = staged(4)
    removeWalls(world)
    const walking = new Walking(terrain)
    const soldiers = soldiersOf(world)
    for (let t = 0; t < TICKS_PER_GAME_DAY / 4; t++) stepWorld(world, terrain, walking)
    expect(soldiers.filter((r) => isAt(r, hall, SIZE)).length).toBeGreaterThanOrEqual(1)
    armedOutsider(world, { x: hall.x + 1, y: hall.y + 1 })
    stepWorld(world, terrain, walking)
    expect(city.occupation ?? null).toBeNull()
  })

  it('those on posts along a wall stay fed from the storage', () => {
    const { world, terrain } = staged(6)
    const walking = new Walking(terrain)
    const soldiers = soldiersOf(world)
    for (const r of soldiers) r.carried.food = 2
    for (let t = 0; t < 3 * TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain, walking)
    for (const r of soldiers) {
      expect(r.health).toBeGreaterThan(0)
      expect(r.carried.food ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('npcSoldiersOnPosts', () => {
  it('holds once a pass has sent them', () => {
    const { world, terrain, city } = staged(10)
    pass(world, city)
    world.tick++
    expect(npcSoldiersOnPosts.check(world, terrain)).toEqual([])
  })

  it('catches a crowd of soldiers on the storage, and a hall nobody goes to', () => {
    const { world, terrain, city, storage } = staged(10)
    planCity(world, city)
    world.tick++
    for (const r of soldiersOf(world)) Object.assign(r, { x: storage.x, y: storage.y, order: null })
    const found = npcSoldiersOnPosts.check(world, terrain)
    expect(found.map((v) => v.message)).toEqual([
      `10 soldiers of ${city.id} stand on its storage`,
      `nobody holds or is going to the town hall of ${city.id}`,
    ])
  })

  it('does not look before a pass is over or between passes', () => {
    const { world, terrain, city, storage } = staged(10)
    planCity(world, city)
    expect(npcSoldiersOnPosts.check(world, terrain)).toEqual([])
    world.tick += 30
    for (const r of soldiersOf(world)) Object.assign(r, { x: storage.x, y: storage.y, order: null })
    expect(npcSoldiersOnPosts.check(world, terrain)).toEqual([])
  })

  it('leaves a Trade Org city out', () => {
    const { world, terrain, city } = staged(10)
    planCity(world, city)
    world.tick++
    city.tradeOrg = 'post'
    expect(npcSoldiersOnPosts.check(world, terrain)).toEqual([])
  })
})

