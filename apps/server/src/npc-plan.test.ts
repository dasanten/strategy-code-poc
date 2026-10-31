import {
  MAX_WORKERS,
  NPC_BUILDERS,
  NPC_PLAN_TICKS,
  NPC_VILLAGE,
  OWN_FOOD,
  Terrain,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { cityPlansSound, planCity, planDue } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'
import { FOREST, fillHouses, storageOf, village } from './npc-growth.fixture.js'

/**
 * The budget for the game-run cities' planning, in milliseconds per tick, averaged over a game
 * hour (ADR 0016; ADR 0004): a smoke check against a regression, not a hard gate. First pick 5 ms.
 */
const PLAN_BUDGET_MS = 5

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** `n` villages in a grid on a Plains map, each with its own town hall and farm. */
function villages(n: number): { world: WorldState; terrain: TerrainMap; cities: City[] } {
  const side = Math.ceil(Math.sqrt(n))
  const step = NPC_VILLAGE.size + 20
  const terrain = plains(side * step + 40)
  const world = createWorld(terrain)
  const rand = mulberry32(11)
  const cities: City[] = []
  for (let i = 0; i < n; i++) {
    const x = 20 + (i % side) * step
    const y = 20 + Math.floor(i / side) * step
    cities.push(foundNpcCity(world, terrain, NPC_VILLAGE, x, y, rand))
  }
  return { world, terrain, cities }
}

describe('planCity', () => {
  it('gives every adult a job: soldiers stand, the rest work the farm while it has room', () => {
    const { world, terrain, city, home } = village()
    for (const r of world.residents) Object.assign(r, { x: home.x, y: home.y, order: null })
    const soldier = world.residents[0]!
    soldier.carried.spear = 1
    const plan = planCity(world, city, terrain)
    expect(plan.plannedAt).toBe(world.tick)
    expect(world.cityPlans[city.id]).toBe(plan)
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    const jobs = world.residents.map((r) => plan.jobs[r.id])
    expect(jobs[0]).toEqual({ kind: 'soldier' })
    // The farm has room for everyone else; nobody builds, since nothing is wanted.
    expect(NPC_VILLAGE.residents - 1).toBeLessThanOrEqual(MAX_WORKERS.farm!)
    for (const job of jobs.slice(1)) expect(job).toEqual({ kind: 'farm', buildingId: farm.id })
    expect(plan.project).toBeUndefined()
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps a worker where they are, and sends at most two spare hands to build', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400 }
    const plan = planCity(world, city, terrain)
    // Everyone from the founding still works the farm; two newcomers build the lumber camp the
    // house wants Wood from, and the rest take the farm's places left, or wait for the next pass.
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    const kinds = Object.values(plan.jobs).map((j) => j.kind)
    expect(kinds.filter((k) => k === 'build')).toHaveLength(NPC_BUILDERS)
    expect(kinds.filter((k) => k === 'farm').length).toBeLessThanOrEqual(MAX_WORKERS.farm!)
    expect(kinds.every((k) => k === 'farm' || k === 'build' || k === 'idle')).toBe(true)
    expect(plan.project).toEqual({ kind: 'build', building: 'lumberCamp', ...FOREST })
    for (const r of world.residents.slice(0, NPC_VILLAGE.residents)) {
      expect(plan.jobs[r.id]).toEqual({ kind: 'farm', buildingId: farm.id })
    }
  })

  it('hands idle residents their planned job in the tick, and picks the next project once one is done', () => {
    const { world, terrain, city, home } = village()
    fillHouses(world, city, home)
    storageOf(world, city).stock = { food: 400, wood: 100 }
    // Carrying their own Food, so nobody fetches or stores Food first.
    for (const r of world.residents) r.carried.food = OWN_FOOD
    const plan = planCity(world, city, terrain)
    const house = plan.project as { kind: 'build'; building: 'house'; x: number; y: number }
    expect(house).toMatchObject({ kind: 'build', building: 'house' })
    expect(stepNpcCities(world, terrain.size, terrain)).toBeGreaterThanOrEqual(0)
    const builders = world.residents.filter(
      (r) => r.script?.scriptId === 0 && r.script.task === 'build',
    )
    expect(builders).toHaveLength(NPC_BUILDERS)
    // The house stands: the builders are free, and the city picks its next project without
    // waiting for the next pass.
    world.buildings.push({ id: 'built', kind: 'house', cityId: city.id, x: house.x, y: house.y })
    for (const r of builders) {
      r.order = null
      delete r.script
    }
    world.tick++
    expect(planDue(world, city)).toBe(false)
    stepNpcCities(world, terrain.size, terrain)
    expect(world.cityPlans[city.id]!.project).not.toEqual(house)
    expect(world.cityPlans[city.id]!.plannedAt).toBe(plan.plannedAt)
  })

  it('moves workers off the other workplaces to the farms while Food runs short', () => {
    const { world, terrain, city } = village()
    const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
    world.buildings.push({ id: 'camp', kind: 'lumberCamp', cityId: city.id, ...FOREST })
    const [a, b] = world.residents as [
      (typeof world.residents)[number],
      (typeof world.residents)[number],
    ]
    for (const r of [a, b]) {
      r.order = null
      r.script = { scriptId: 0, task: 'work', memory: { workplaceId: 'camp' } }
    }
    storageOf(world, city).stock = { food: 1000 }
    expect(planCity(world, city, terrain).jobs[a.id]).toEqual({ kind: 'work', buildingId: 'camp' })
    storageOf(world, city).stock = {}
    const plan = planCity(world, city, terrain)
    // The farm has room for two more: both move.
    expect(plan.jobs[a.id]).toEqual({ kind: 'farm', buildingId: farm.id })
    expect(plan.jobs[b.id]).toEqual({ kind: 'farm', buildingId: farm.id })
    // In the next tick they leave the camp for the farm.
    stepNpcCities(world, terrain.size, terrain)
    expect(a.script?.memory.workplaceId).toBe(farm.id)
    expect(b.script?.memory.workplaceId).toBe(farm.id)
  })
})

describe('cities plan once a game hour', () => {
  it('plans each city once a game hour, about one city per tick', () => {
    const { world, terrain, cities } = villages(60)
    const perTick: number[] = []
    for (let t = 0; t < NPC_PLAN_TICKS; t++) {
      const before = new Set(
        Object.entries(world.cityPlans)
          .filter(([, p]) => p.plannedAt === world.tick)
          .map(([id]) => id),
      )
      stepNpcCities(world, terrain.size, terrain)
      const now = Object.values(world.cityPlans).filter((p) => p.plannedAt === world.tick).length
      perTick.push(now - before.size)
      world.tick++
    }
    expect(perTick.reduce((a, b) => a + b, 0)).toBe(cities.length)
    expect(Math.max(...perTick)).toBeLessThanOrEqual(6)
    const first = cities.map((c) => world.cityPlans[c.id]!.plannedAt)
    for (let t = 0; t < NPC_PLAN_TICKS; t++) {
      stepNpcCities(world, terrain.size, terrain)
      world.tick++
    }
    expect(cities.map((c) => world.cityPlans[c.id]!.plannedAt)).toEqual(
      first.map((t) => t + NPC_PLAN_TICKS),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps a full map’s planning inside its budget', () => {
    const { world, terrain } = villages(60)
    const walking = new Walking(terrain)
    let ms = 0
    for (let t = 0; t < 2 * NPC_PLAN_TICKS; t++) ms += stepWorld(world, terrain, walking).npcPlanMs
    expect(ms / (2 * NPC_PLAN_TICKS)).toBeLessThan(PLAN_BUDGET_MS)
  }, 60_000)

  it('drops the plan of a city the game no longer runs', () => {
    const { world, terrain, city } = village()
    planCity(world, city, terrain)
    city.realmId = 'realm1'
    expect(checkInvariants(world, terrain)).toContainEqual(
      expect.objectContaining({ invariant: 'city-plans-sound' }),
    )
    stepNpcCities(world, terrain.size, terrain)
    expect(world.cityPlans).toEqual({})
  })

  it('catches a plan that works a site or a building that isn’t a workplace', () => {
    const { world, terrain, city, home } = village()
    const plan = planCity(world, city, terrain)
    const r = world.residents[0]!
    plan.jobs[r.id] = { kind: 'work', buildingId: home.id }
    expect(cityPlansSound.check(world, terrain)).toHaveLength(1)
    // A planned building that is gone is stale, not wrong.
    plan.jobs[r.id] = { kind: 'work', buildingId: 'gone' }
    expect(cityPlansSound.check(world, terrain)).toEqual([])
  })
})
