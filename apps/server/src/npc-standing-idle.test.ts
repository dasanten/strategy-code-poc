import {
  NPC_VILLAGE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  Terrain,
  isAt,
  ticksForAge,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, npcIdleOffTheStorage, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { planCity } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const SIZE = 128

/** A village alone on an open map, its residents free and on its storage. */
function village(): { world: WorldState; terrain: TerrainMap; city: City; storage: Building } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  const storage = npcHome(world, city)!
  for (const r of world.residents) {
    Object.assign(r, { x: storage.x, y: storage.y, order: null, carried: { food: OWN_FOOD } })
    delete r.script
    delete r.weapon
  }
  return { world, terrain, city, storage }
}

/** The pass just ran and left all of the city's adults with nothing to do. */
function allIdle(world: WorldState, city: City): void {
  const plan = planCity(world, city)
  plan.jobs = Object.fromEntries(world.residents.map((r) => [r.id, { kind: 'idle' as const }]))
}

const housesOf = (world: WorldState, city: City) =>
  world.buildings.filter((b) => b.kind === 'house' && b.cityId === city.id)

const walkTarget = (r: Resident) =>
  r.order?.kind === 'walkTo' ? { x: r.order.target.x, y: r.order.target.y } : undefined

const stand = (r: Resident, at: { x: number; y: number }) => {
  r.x = at.x
  r.y = at.y
  r.order = null
}

describe('Standing idle (CONTEXT.md)', () => {
  it('idle adults walk to a house, spread over the houses, and stay there', () => {
    const { world, city } = village()
    const houses = housesOf(world, city)
    expect(houses.length).toBeGreaterThan(1)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    const targets = world.residents.map(walkTarget)
    for (const t of targets) expect(houses.some((h) => isAt(t!, h, SIZE))).toBe(true)
    expect(new Set(targets.map((t) => `${t!.x},${t!.y}`)).size).toBeGreaterThan(1)

    // There, the next passes leave them be: one walk, then nothing.
    for (const r of world.residents) stand(r, walkTarget(r)!)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(world.residents.map((r) => r.order)).toEqual(world.residents.map(() => null))
  })

  it('takes those carrying a child and children there too', () => {
    const { world, city } = village()
    const houses = housesOf(world, city)
    const [carrier, child] = world.residents as [Resident, Resident]
    carrier.carrying = { partnerId: 'nobody', since: world.tick - 2 }
    child.bornAt = world.tick - ticksForAge(1)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    for (const r of [carrier, child]) {
      expect(houses.some((h) => isAt(walkTarget(r)!, h, SIZE))).toBe(true)
    }
  })

  it('a new house moves nobody', () => {
    const { world, city } = village()
    const [house] = housesOf(world, city)
    for (const r of world.residents) stand(r, house!)
    world.buildings.push({ ...house!, id: 'new-house', x: house!.x + 4, y: house!.y + 4 })
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(world.residents.every((r) => r.order === null)).toBe(true)
  })

  it('sets off when the pass runs, but at once from outside the city', () => {
    const { world, city } = village()
    const [inside, outside] = world.residents as [Resident, Resident]
    allIdle(world, city)
    world.tick += 1
    stand(outside, { x: 110, y: 110 })
    stepNpcCities(world, SIZE)
    expect(inside.order).toBeNull()
    expect(housesOf(world, city).some((h) => isAt(walkTarget(outside)!, h, SIZE))).toBe(true)
  })

  it('doesn’t walk back to the storage for Food once it has eaten', () => {
    const { world, city } = village()
    const r = world.residents[0]!
    r.carried.food = OWN_FOOD - 1
    stand(r, housesOf(world, city)[0]!)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(r.order).toBeNull()
  })

  it('stands at a house for days, eating, and leaves when given a job', () => {
    const { world, terrain, city, storage } = village()
    const walking = new Walking(terrain)
    storage.stock = { ...storage.stock, food: 5000 }
    const [r] = world.residents as [Resident]
    const house = housesOf(world, city)[0]!
    stand(r, house)
    // Keeping them idle by hand, as the planner would find them work in a village this small.
    const hold = () => {
      const plan = world.cityPlans[city.id]
      if (plan) plan.jobs[r.id] = { kind: 'idle' }
    }
    const before = r.carried.food ?? 0
    expect(before).toBeGreaterThan(0)
    for (let t = 0; t < 2 * TICKS_PER_GAME_DAY; t++) {
      hold()
      stepWorld(world, terrain, walking)
      if (r.order?.kind === 'walkTo') r.order = null
      expect(isAt(r, house, SIZE)).toBe(true)
    }
    expect(r.health).toBeGreaterThan(0)
    expect(r.carried.food ?? 0).toBeGreaterThan(0)

    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    const plan = planCity(world, city)
    plan.jobs[r.id] = { kind: 'farm', buildingId: farm.id }
    r.order = null
    delete r.script
    r.carried.food = OWN_FOOD
    stepNpcCities(world, SIZE)
    // Fetching what they lack to set out with comes first; either way they are off.
    expect(r.script?.task === 'work' || r.order !== null).toBe(true)
  })

  it('calls off the walk to a house when the pass finds them a job', () => {
    const { world, city, storage } = village()
    const r = world.residents[0]!
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(walkTarget(r)).toBeDefined()
    world.tick += 1
    const plan = planCity(world, city)
    plan.jobs = { [r.id]: { kind: 'farm', buildingId: farm.id } }
    stepNpcCities(world, SIZE)
    expect(r.script).toMatchObject({ task: 'work', memory: { workplaceId: farm.id } })
    expect(isAt(r, storage, SIZE)).toBe(true)
  })

  it('leaves soldiers to come home as before', () => {
    const { world, city, storage } = village()
    const r = world.residents[0]!
    r.weapon = 'spear'
    r.carried.food = OWN_FOOD - 1
    stand(r, housesOf(world, city)[0]!)
    allIdle(world, city)
    world.cityPlans[city.id]!.jobs[r.id] = { kind: 'soldier' }
    stepNpcCities(world, SIZE)
    // Their Food from the storage, and no house after: they stay where the food fetch left them.
    expect(walkTarget(r)).toEqual({ x: storage.x, y: storage.y })
    stand(r, storage)
    r.carried.food = OWN_FOOD
    stepNpcCities(world, SIZE)
    expect(r.order).toBeNull()
  })

  it('a city with no house stands at its home as before', () => {
    const { world, city, storage } = village()
    world.buildings = world.buildings.filter((b) => b.kind !== 'house')
    const [idle, away, child] = world.residents as [Resident, Resident, Resident]
    stand(away, { x: 110, y: 110 })
    child.bornAt = world.tick - ticksForAge(1)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(idle.order).toBeNull()
    expect(walkTarget(away)).toEqual({ x: storage.x, y: storage.y })
    expect(child.order).toBeNull()
  })

  it('leaves a Trade Org city as it was', () => {
    const { world, city } = village()
    city.tradeOrg = 'post'
    const [idle, child] = world.residents as [Resident, Resident]
    child.bornAt = world.tick - ticksForAge(1)
    allIdle(world, city)
    stepNpcCities(world, SIZE)
    expect(idle.order).toBeNull()
    expect(child.order).toBeNull()
  })

  it('has an invariant against a crowd of idle on the storage', () => {
    const { world, terrain, city, storage } = village()
    allIdle(world, city)
    for (let i = 0; world.residents.length < 14; i++) {
      world.residents.push({ ...world.residents[0]!, id: `extra${i}`, carried: {} })
    }
    allIdle(world, city)
    expect(npcIdleOffTheStorage.check(world, terrain)).toHaveLength(1)
    expect(checkInvariants(world, terrain).map((v) => v.invariant)).toContain(
      npcIdleOffTheStorage.name,
    )
    // Sent on their way, they aren't one.
    stepNpcCities(world, SIZE)
    expect(npcIdleOffTheStorage.check(world, terrain)).toEqual([])
    // Nor is a city with no house.
    for (const r of world.residents) stand(r, storage)
    world.buildings = world.buildings.filter((b) => b.kind !== 'house')
    expect(npcIdleOffTheStorage.check(world, terrain)).toEqual([])
  })
})
