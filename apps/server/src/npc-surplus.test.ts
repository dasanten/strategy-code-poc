import {
  MAX_WORKERS,
  NPC_FULL_DAYS,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  NPC_VILLAGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  WAREHOUSE_FLOOR,
  canWork,
  npcReserve,
  recipeFor,
  tileIndex,
  type Building,
  type BuildingKind,
  type City,
  type CityPlan,
  type Good,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, putToWork, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { findFoundingSite, foundingMaterials, foundingParty } from './npc-founding.js'
import { plains } from './npc-growth.fixture.js'
import { farmersWanted, npcSurplusCapped, planCity } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * With nothing short, an NPC city's spare hands work for surplus (`CONTEXT.md`: Spare hands' work):
 * past its reserve up to a cap per good, then they are idle. What is short, its trader and a
 * founding party take them first; they count as spare for a Full city; the Trade Org doesn't do it.
 */

const CAP = NPC_SURPLUS_CAP as Record<'food' | 'wood' | 'stone', number>

/** A finished workplace of `kind` of the city, on a node of `resource` when it digs or cuts. */
function workplace(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  kind: BuildingKind,
  resource?: 'forest' | 'stone',
): Building {
  const home = npcHome(world, city)!
  const at = { x: home.x + 40 + world.nodes.length * 6, y: home.y + 40 }
  if (resource) {
    world.nodes.push({ id: newId(world, 'n'), kind: resource, ...at })
    const ground = resource === 'forest' ? Terrain.Forest : Terrain.Hills
    terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = ground
  }
  const place = { id: newId(world, 'b'), kind, ...at, cityId: null } as Building
  world.buildings.push(place)
  ;(city.workplaceIds ??= []).push(place.id)
  return place
}

/** A stock of the city's reserve and `past` of each good above it. */
function pastReserve(world: WorldState, city: City, past: Stock): Stock {
  const stock: Stock = npcReserve(world, city)
  for (const [good, n] of Object.entries(past) as [Good, number][]) {
    stock[good] = (stock[good] ?? 0) + n
  }
  return stock
}

/** A town alone on Plains with a lumber camp and a quarry, its Food at its cap, the rest at its reserve. */
function town(size = 400) {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(5))
  const camp = workplace(world, terrain, city, 'lumberCamp', 'forest')
  const quarry = workplace(world, terrain, city, 'quarry', 'stone')
  const storage = npcHome(world, city)!
  storage.stock = pastReserve(world, city, { food: CAP.food })
  // It knows its limit: scouts go ahead of surplus (`CONTEXT.md`: Scout), and these tests are the
  // surplus's.
  city.scouted = { sectors: [], done: true }
  return { world, terrain, city, camp, quarry, storage }
}

/** Those the plan puts at a building. */
const at = (plan: CityPlan, b: Building) =>
  Object.values(plan.jobs).filter((j) => j.buildingId === b.id).length

/** One resident at the workplace, every other at the farms as far as it keeps farmers, or armed. */
function oneFreeWorker(world: WorldState, city: City, place: Building) {
  const farms = world.buildings.filter((b) => b.kind === 'farm' && b.cityId === city.id)
  const adults = world.residents.filter((r) => r.cityId === city.id && canWork(r, world.tick))
  const [worker, ...others] = adults
  putToWork(worker!, place)
  const wanted = farmersWanted(world, city)
  others.forEach((r, i) => {
    if (i < wanted) putToWork(r, farms[i % farms.length]!)
    else r.carried.spear = 1
  })
  return worker!
}

// Planned without the terrain, a city picks no project to send spare hands to first.
describe('spare hands with nothing short', () => {
  it('go to its workplaces past the reserve, the good furthest below its cap first', () => {
    const { world, terrain, city, camp, quarry, storage } = town()
    storage.stock = pastReserve(world, city, { food: CAP.food, wood: CAP.wood / 2 })
    const plan = planCity(world, city)
    expect(at(plan, quarry)).toBe(MAX_WORKERS.quarry)
    expect(at(plan, camp)).toBeGreaterThan(0)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stay at their workplace below the cap, and are idle once it is reached', () => {
    const { world, city, camp, storage } = town()
    const worker = oneFreeWorker(world, city, camp)
    storage.stock = pastReserve(world, city, {
      food: CAP.food,
      wood: CAP.wood - 1,
      stone: CAP.stone,
    })
    expect(planCity(world, city).jobs[worker.id]?.buildingId).toBe(camp.id)

    storage.stock = pastReserve(world, city, { food: CAP.food, wood: CAP.wood, stone: CAP.stone })
    const plan = planCity(world, city)
    expect(plan.jobs[worker.id]?.kind).toBe('idle')
    expect(at(plan, camp)).toBe(0)
  })

  it('walk off the job in the tick of the pass that reaches the cap', () => {
    const { world, terrain, city, camp, storage } = town()
    const worker = oneFreeWorker(world, city, camp)
    storage.stock = pastReserve(world, city, { food: CAP.food, wood: CAP.wood, stone: CAP.stone })
    planCity(world, city)
    stepNpcCities(world, terrain.size)
    expect(worker.script?.memory.workplaceId).toBeUndefined()
  })

  it('move at once to what is short', () => {
    const { world, terrain, city, camp, quarry, storage } = town()
    const worker = oneFreeWorker(world, city, quarry)
    storage.stock = { ...pastReserve(world, city, { food: CAP.food }), wood: 0 }
    expect(planCity(world, city).jobs[worker.id]?.buildingId).toBe(camp.id)
    stepNpcCities(world, terrain.size)
    expect(worker.script?.memory.workplaceId).not.toBe(quarry.id)
  })

  it('go on with surplus while something it has no way to make stays short', () => {
    const { world, city, camp, storage } = town()
    // Spears and their Iron short with no mine, as for a city with no ore in reach.
    expect(npcReserve(world, city).spear).toBeGreaterThan(0)
    storage.stock = { ...pastReserve(world, city, { food: CAP.food }), spear: 0, iron: 0 }
    expect(at(planCity(world, city), camp)).toBeGreaterThan(0)
  })

  it('leave a workplace that processes goods alone while its input is only the reserve', () => {
    const { world, terrain, city, storage } = town()
    const smelter = workplace(world, terrain, city, 'smelter')
    const past = { food: CAP.food, wood: CAP.wood, stone: CAP.stone }
    storage.stock = pastReserve(world, city, past)
    expect(at(planCity(world, city), smelter)).toBe(0)
    // With a batch of ore above it, a spare hand smelts for surplus.
    storage.stock = pastReserve(world, city, { ...past, ...recipeFor('smelter')!.input })
    expect(at(planCity(world, city), smelter)).toBeGreaterThan(0)
  })

  it('have a cap high enough for a Full city to found on what they make', () => {
    for (const [good, n] of Object.entries(foundingMaterials()) as [Good, number][]) {
      expect(NPC_SURPLUS_CAP[good]).toBeGreaterThan(n)
    }
  })

  it('count as spare hands for a Full city, which founds a daughter with them', () => {
    const { world, terrain, city, camp, quarry, storage } = town(1300)
    world.tick = NPC_FULL_DAYS * TICKS_PER_GAME_DAY
    // Above what a founding wants, and below the caps: everyone has work.
    storage.stock = pastReserve(world, city, { food: 2 * CAP.food, ...foundingMaterials() })
    const plan = planCity(world, city, terrain)
    expect(at(plan, camp) + at(plan, quarry)).toBeGreaterThan(0)
    expect(plan.fullSince).toBe(world.tick)
    expect(foundingParty(plan)).toEqual([])

    plan.fullSince = 0
    plan.foundingSite = findFoundingSite(world, terrain, city, npcHome(world, city)!)
    expect(plan.foundingSite).toBeDefined()
    expect(foundingParty(planCity(world, city, terrain))).toHaveLength(NPC_VILLAGE.residents)
  })

  it(
    'keep a big city working, within its caps, on the map',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city, camp, quarry } = town()
      const walking = new Walking(terrain)
      let working = 0
      for (let t = 0; t < 5 * TICKS_PER_GAME_DAY; t++) {
        stepWorld(world, terrain, walking)
        if (t % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
        const plan = world.cityPlans[city.id]
        if (plan) working = Math.max(working, at(plan, camp) + at(plan, quarry))
      }
      expect(working).toBeGreaterThan(0)
    },
  )
})

describe('the Trade Organization', () => {
  /** A trading post with a lumber camp, far past any cap of Wood. */
  function post() {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    const camp = workplace(world, terrain, city, 'lumberCamp', 'forest')
    const warehouse = world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === city.id)!
    warehouse.stock = { ...WAREHOUSE_FLOOR, wood: 5000, stone: 5000 }
    return { world, terrain, city, camp, warehouse }
  }

  it('sends no free hand to work for surplus', () => {
    const { world, city, camp } = post()
    expect(at(planCity(world, city), camp)).toBe(0)
  })

  it('leaves a worker where they are, cap or no cap', () => {
    const { world, terrain, city, camp } = post()
    const worker = world.residents.find((r) => r.cityId === city.id && !r.carried.spear)!
    putToWork(worker, camp)
    expect(planCity(world, city).jobs[worker.id]?.buildingId).toBe(camp.id)
    expect(npcSurplusCapped.check(world, terrain)).toEqual([])
  })
})

describe('the npc-surplus-capped invariant', () => {
  /** A plan made now that puts a worker at the lumber camp, with Wood `past` over the reserve. */
  function planned(past: number) {
    const { world, terrain, city, camp, storage } = town()
    storage.stock = pastReserve(world, city, { food: CAP.food, wood: past })
    const worker = world.residents.find((r) => r.cityId === city.id)!
    world.cityPlans[city.id] = {
      plannedAt: world.tick,
      jobs: { [worker.id]: { kind: 'work', buildingId: camp.id } },
    }
    return { world, terrain }
  }

  it('leaves what came in since the pass alone', () => {
    const { world, terrain } = planned(CAP.wood + 20)
    expect(npcSurplusCapped.check(world, terrain)).toEqual([])
  })

  it('finds a city working a good far past its cap', () => {
    const { world, terrain } = planned(CAP.wood * 2)
    expect(npcSurplusCapped.check(world, terrain)).toHaveLength(1)
  })

  it('leaves a plan of an earlier tick alone', () => {
    const { world, terrain } = planned(CAP.wood * 2)
    world.tick++
    expect(npcSurplusCapped.check(world, terrain)).toEqual([])
  })
})
