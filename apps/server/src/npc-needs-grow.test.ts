import {
  BUILD_MATERIALS,
  MAX_WORKERS,
  NODE_TERRAINS,
  NPC_BUILDERS,
  NPC_RESIDENTS_PER_NEEDS_STEP,
  NPC_ROAD_CREW,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  NPC_TRADE,
  NPC_VILLAGE,
  canWork,
  cityResidents,
  isBigNpcCity,
  npcNeedsScale,
  npcReserve,
  npcSoldierTarget,
  tileIndex,
  type Building,
  type City,
  type CityPlan,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { bigCity } from './npc-big-city.fixture.js'
import { npcHome } from './npc-behaviour.js'
import { surplusWork } from './npc-chain.js'
import { foundNpcCity } from './npc-cities.js'
import { farmsOverflow, nextProject, npcBuilders } from './npc-growth.js'
import { plains } from './npc-growth.fixture.js'
import { farmersWanted, npcSurplusCapped, npcWorkplacesBounded, planCity } from './npc-plan.js'
import { npcRoadCrew, npcRoadCrewSized } from './npc-roads.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
import { createWorld } from './world.js'

/*
 * Needs grow with the city (`CONTEXT.md`: NPC reserve, Spare hands' work, NPC road, NPC city;
 * ADR 0029): the Wood and Stone it keeps, its surplus caps, builders and road crew; a big city's
 * second workplace; and farms built only for the farmers it wants.
 */

/** A big city, every good it wants at its reserve and the rest empty past that. */
function big() {
  const staged = bigCity()
  const { world, city, home } = staged
  home.stock = npcReserve(world, city)
  const camp = world.buildings.find((b) => b.kind === 'lumberCamp')!
  const quarry = world.buildings.find((b) => b.kind === 'quarry')!
  return { ...staged, camp, quarry }
}

/** A free node of `kind` the city knows of, near its home. */
function freeNode(
  world: WorldState,
  terrain: TerrainMap,
  home: Building,
  kind: ResourceKind,
  dx: number,
) {
  const at = { x: home.x + dx, y: home.y + 30 }
  world.nodes.push({ id: newId(world, 'n'), kind, ...at })
  terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = NODE_TERRAINS[kind][0]!
  return at
}

/** Arms as many as the city keeps as soldiers, so its reserve wants no Wood for their weapons. */
function armAll(world: WorldState, city: City): void {
  const adults = cityResidents(world, city).filter((r) => canWork(r, world.tick))
  for (const r of adults.slice(0, npcSoldierTarget(adults.length))) r.carried.spear = 1
}

/** A finished lumber camp of the city at a tile. */
function standingCamp(world: WorldState, city: City, at: { x: number; y: number }): Building {
  const camp: Building = { id: newId(world, 'b'), kind: 'lumberCamp', cityId: null, ...at }
  world.buildings.push(camp)
  ;(city.workplaceIds ??= []).push(camp.id)
  return camp
}

/** Fills a workplace's crew, by the Work default, from those not already at one. */
function fillCrew(world: WorldState, city: City, place: Building): void {
  const free = cityResidents(world, city).filter(
    (r) => canWork(r, world.tick) && r.script?.memory.workplaceId === undefined,
  )
  for (const r of free.slice(0, MAX_WORKERS[place.kind] ?? 0)) {
    r.script = { scriptId: 0, task: 'work', memory: { workplaceId: place.id } }
  }
}

describe('a village', () => {
  const village = () => {
    const terrain = plains(240)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, NPC_VILLAGE, 60, 60, mulberry32(3))
    armAll(world, city)
    return { world, terrain, city, home: npcHome(world, city)! }
  }

  it('keeps a village number of everything', () => {
    const { world, terrain, city, home } = village()
    const reserve = npcReserve(world, city)
    expect(npcNeedsScale(world, city)).toBe(1)
    expect(isBigNpcCity(world, city)).toBe(false)
    expect(reserve.wood).toBe(
      (BUILD_MATERIALS.house?.wood ?? 0) +
        (BUILD_MATERIALS.wall?.wood ?? 0) * NPC_TRADE.reserveWallStretches,
    )
    expect(reserve.stone).toBeUndefined()
    expect(npcBuilders(world, city)).toBe(NPC_BUILDERS)
    expect(npcRoadCrew(world, city)).toBe(NPC_ROAD_CREW)
    const camp = standingCamp(world, city, freeNode(world, terrain, home, 'forest', 20))
    home.stock = { ...reserve, wood: (reserve.wood ?? 0) + (NPC_SURPLUS_CAP.wood ?? 0) / 2 }
    expect(surplusWork(world, city, home)(camp)).toBeCloseTo(0.5)
  })

  it('and so does a town', () => {
    const terrain = plains(240)
    const world = createWorld(terrain)
    const city = foundNpcCity(world, terrain, NPC_TOWN, 60, 60, mulberry32(3))
    expect(npcNeedsScale(world, city)).toBe(1)
    expect(npcRoadCrew(world, city)).toBe(NPC_ROAD_CREW)
    expect(npcReserve(world, city).stone).toBeUndefined()
  })
})

describe('a big city', () => {
  it('counts whole steps of its residents', () => {
    const { world, city } = big()
    const steps = Math.floor(cityResidents(world, city).length / NPC_RESIDENTS_PER_NEEDS_STEP)
    expect(steps).toBeGreaterThan(1)
    expect(npcNeedsScale(world, city)).toBe(steps)
    expect(isBigNpcCity(world, city)).toBe(true)
  })

  it('keeps more Wood and Stone, by the step', () => {
    const { world, city } = big()
    const steps = npcNeedsScale(world, city)
    const wood =
      (BUILD_MATERIALS.house?.wood ?? 0) +
      (BUILD_MATERIALS.wall?.wood ?? 0) * NPC_TRADE.reserveWallStretches
    const reserve = npcReserve(world, city)
    // Wood for the weapons it hasn't armed yet comes on top, and it has armed all it keeps.
    expect(reserve.wood).toBe(wood * steps)
    expect(reserve.stone).toBe(NPC_TRADE.reserveStonePerStep * (steps - 1))
  })

  it('has more builders and a bigger road crew, by the step', () => {
    const { world, city } = big()
    const steps = npcNeedsScale(world, city)
    expect(npcBuilders(world, city)).toBe(NPC_BUILDERS * steps)
    expect(npcRoadCrew(world, city)).toBe(NPC_ROAD_CREW * steps)
  })

  it('works for surplus up to a cap by the step', () => {
    const { world, city, home, camp } = big()
    const steps = npcNeedsScale(world, city)
    const cap = (NPC_SURPLUS_CAP.wood ?? 0) * steps
    const reserve = npcReserve(world, city).wood ?? 0
    home.stock = { ...home.stock, wood: reserve + cap / 2 }
    expect(surplusWork(world, city, home)(camp)).toBeCloseTo(0.5)
    home.stock = { ...home.stock, wood: reserve + cap }
    expect(surplusWork(world, city, home)(camp)).toBeUndefined()
  })
})

describe('a second workplace', () => {
  /** A big city with nothing short, its lumber camp's crew full and Wood below its cap. */
  const ready = () => {
    const t = big()
    const { world, city, terrain, home, camp, quarry } = t
    // A stable stands, or it wants one first once nothing is short.
    const stable = { x: home.x - 9, y: home.y - 9 }
    world.buildings.push({ id: newId(world, 'b'), kind: 'stable', cityId: city.id, ...stable })
    const reserve = npcReserve(world, city)
    home.stock = { ...reserve }
    // Stone at its cap, so only Wood wants a second workplace.
    home.stock.stone =
      (reserve.stone ?? 0) + (NPC_SURPLUS_CAP.stone ?? 0) * npcNeedsScale(world, city)
    fillCrew(world, city, camp)
    const at = freeNode(world, terrain, home, 'forest', 20)
    return { ...t, at, camp, quarry }
  }
  const project = (t: { world: WorldState; city: City; home: Building; terrain: TerrainMap }) =>
    nextProject(t.world, t.city, t.home, t.terrain)
  const opensCamp = (p: ReturnType<typeof project>) =>
    p?.kind === 'build' && p.building === 'lumberCamp'

  it('opens with the first crew full and its good below the cap', () => {
    const t = ready()
    expect(project(t)).toMatchObject({ kind: 'build', building: 'lumberCamp', ...t.at })
  })

  it('does not open with room in the first crew', () => {
    const t = ready()
    const worker = cityResidents(t.world, t.city).find(
      (r) => r.script?.memory.workplaceId === t.camp.id,
    )!
    delete worker.script
    expect(opensCamp(project(t))).toBe(false)
  })

  it('does not open with its good at the cap', () => {
    const t = ready()
    const reserve = npcReserve(t.world, t.city).wood ?? 0
    t.home.stock!.wood = reserve + (NPC_SURPLUS_CAP.wood ?? 0) * npcNeedsScale(t.world, t.city)
    expect(opensCamp(project(t))).toBe(false)
  })

  it('does not open with something short', () => {
    const t = ready()
    t.home.stock!.stone = 0
    expect(opensCamp(project(t))).toBe(false)
  })

  it('opens no third', () => {
    const t = ready()
    const second = standingCamp(t.world, t.city, t.at)
    fillCrew(t.world, t.city, second)
    freeNode(t.world, t.terrain, t.home, 'forest', 26)
    expect(opensCamp(project(t))).toBe(false)
  })

  it('does not open in a small city', () => {
    const t = ready()
    // Everyone but the camp's crew and a few moved out: it's back to a village's numbers.
    const crew = (r: { script?: { memory: Record<string, unknown> } }) =>
      r.script?.memory.workplaceId === t.camp.id
    const people = cityResidents(t.world, t.city)
    let left = people.length
    for (const r of people) {
      if (crew(r) || left < 2 * NPC_RESIDENTS_PER_NEEDS_STEP) continue
      r.cityId = null
      left--
    }
    expect(isBigNpcCity(t.world, t.city)).toBe(false)
    t.home.stock = {
      ...npcReserve(t.world, t.city),
      stone: 10_000,
    }
    expect(opensCamp(project(t))).toBe(false)
  })
})

describe('farms', () => {
  /** A big city with `farms` farms, the rest of its farms taken away. */
  const withFarms = (farms: number) => {
    const t = big()
    const own = t.world.buildings.filter((b) => b.kind === 'farm' && b.cityId === t.city.id)
    t.world.buildings = t.world.buildings.filter((b) => !own.slice(farms).includes(b))
    return { ...t, farms: own.slice(0, farms) }
  }
  const farmPlanned = (t: ReturnType<typeof withFarms>) => {
    const p = nextProject(t.world, t.city, t.home, t.terrain)
    return p?.kind === 'build' && p.building === 'farm'
  }

  it('stop growing past what its farmers need, however full spare hands keep them', () => {
    const per = MAX_WORKERS.farm ?? 0
    const whole = bigCity()
    const t = withFarms(Math.ceil(farmersWanted(whole.world, whole.city) / per))
    for (const farm of t.farms) fillCrew(t.world, t.city, farm)
    expect(farmPlanned(t)).toBe(false)
  })

  it('grow when the farmers it wants do not fit', () => {
    const t = withFarms(1)
    expect(farmersWanted(t.world, t.city)).toBeGreaterThan(MAX_WORKERS.farm ?? 0)
    expect(farmPlanned(t)).toBe(true)
  })
})

describe('invariants', () => {
  const crewPlan = (world: WorldState, city: City, n: number): CityPlan => {
    const people = cityResidents(world, city).slice(0, n)
    return {
      plannedAt: world.tick,
      jobs: Object.fromEntries(people.map((r) => [r.id, { kind: 'road' as const }])),
    }
  }

  it('let a big city have a bigger road crew, up to its size', () => {
    const { world, terrain, city } = big()
    const most = npcRoadCrew(world, city)
    expect(most).toBeGreaterThan(NPC_ROAD_CREW)
    world.cityPlans[city.id] = crewPlan(world, city, most)
    expect(npcRoadCrewSized.check(world, terrain)).toEqual([])
    world.cityPlans[city.id] = crewPlan(world, city, most + 1)
    expect(npcRoadCrewSized.check(world, terrain)).toHaveLength(1)
  })

  it('hold a big city to its bigger surplus cap', () => {
    const { world, terrain, city, home, camp } = big()
    const cap = (NPC_SURPLUS_CAP.wood ?? 0) * npcNeedsScale(world, city)
    const reserve = npcReserve(world, city).wood ?? 0
    const r = cityResidents(world, city)[0]!
    world.cityPlans[city.id] = {
      plannedAt: world.tick,
      jobs: { [r.id]: { kind: 'work', buildingId: camp.id } },
    }
    home.stock = { ...home.stock, wood: reserve + 2 * cap - 1 }
    expect(npcSurplusCapped.check(world, terrain)).toEqual([])
    home.stock = { ...home.stock, wood: reserve + 2 * cap }
    expect(npcSurplusCapped.check(world, terrain)).toHaveLength(1)
  })

  describe('of workplaces', () => {
    const planned = (world: WorldState, city: City, at: { x: number; y: number }) => {
      world.cityPlans[city.id] = {
        plannedAt: world.tick,
        jobs: {},
        project: { kind: 'build', building: 'lumberCamp', ...at },
      }
    }

    it('let a big city plan its second', () => {
      const { world, terrain, city, home } = big()
      const at = freeNode(world, terrain, home, 'forest', 20)
      planned(world, city, at)
      expect(npcWorkplacesBounded.check(world, terrain)).toEqual([])
    })

    it('find a big city planning a third, with its good not short', () => {
      const { world, terrain, city, home } = big()
      const standing = freeNode(world, terrain, home, 'forest', 20)
      standingCamp(world, city, standing)
      planned(world, city, freeNode(world, terrain, home, 'forest', 26))
      home.stock = { ...home.stock, wood: 5000 }
      expect(npcWorkplacesBounded.check(world, terrain)).toHaveLength(1)
      // Short of it, a third is what idle hands call for.
      home.stock = { ...home.stock, wood: 0 }
      expect(npcWorkplacesBounded.check(world, terrain)).toEqual([])
    })

    it('find a farm planned with its farmers fitting and Food not short', () => {
      const { world, terrain, city, home } = big()
      world.cityPlans[city.id] = {
        plannedAt: world.tick,
        jobs: {},
        project: { kind: 'build', building: 'farm', x: home.x + 50, y: home.y + 50 },
      }
      home.stock = { ...home.stock, food: 5000 }
      expect(npcWorkplacesBounded.check(world, terrain)).toHaveLength(1)
      home.stock = { ...home.stock, food: 0 }
      expect(npcWorkplacesBounded.check(world, terrain)).toEqual([])
    })

    it('find a village planning a second', () => {
      const terrain = plains(240)
      const world = createWorld(terrain)
      const city = foundNpcCity(world, terrain, NPC_VILLAGE, 60, 60, mulberry32(3))
      const home = npcHome(world, city)!
      const first = freeNode(world, terrain, home, 'forest', 20)
      standingCamp(world, city, first)
      planned(world, city, freeNode(world, terrain, home, 'forest', 26))
      home.stock = { ...home.stock, wood: 5000 }
      expect(npcWorkplacesBounded.check(world, terrain)).toHaveLength(1)
    })
  })
})

describe('a short good with its workplaces full (CONTEXT.md: NPC city)', () => {
  /** The big city with just `farms` farms, all full, Food a little short of its reserve. */
  const fullFarms = (farms: number) => {
    const t = big()
    const own = t.world.buildings.filter((b) => b.kind === 'farm' && b.cityId === t.city.id)
    t.world.buildings = t.world.buildings.filter((b) => !own.slice(farms).includes(b))
    t.home.stock = { ...t.home.stock, food: (t.home.stock?.food ?? 0) - 1 }
    for (const farm of own.slice(0, farms)) fillCrew(t.world, t.city, farm)
    return { ...t, farms: own.slice(0, farms) }
  }
  /** One free to work the last pass left idle. */
  const idle = (world: WorldState, city: City) => {
    const r = cityResidents(world, city).find((x) => canWork(x, world.tick) && !x.script)!
    world.cityPlans[city.id] = { plannedAt: world.tick, jobs: { [r.id]: { kind: 'idle' } } }
    return r
  }
  const planned = ({ world, city, home, terrain }: ReturnType<typeof big>) => {
    const p = nextProject(world, city, home, terrain)
    return p?.kind === 'build' ? p.building : undefined
  }

  it('opens another farm for those it has idle', () => {
    const t = fullFarms(3)
    idle(t.world, t.city)
    expect(planned(t)).toBe('farm')
  })

  it('counts a carrier home between trips as holding their place', () => {
    const t = fullFarms(3)
    const r = idle(t.world, t.city)
    const farm = t.farms[0]!
    const crew = cityResidents(t.world, t.city).filter(
      (x) => x.script?.memory.workplaceId === farm.id,
    )
    const jobs = t.world.cityPlans[t.city.id]!.jobs
    for (const x of crew) jobs[x.id] = { kind: 'farm', buildingId: farm.id }
    delete crew[0]!.script
    expect(jobs[r.id]?.kind).toBe('idle')
    expect(planned(t)).toBe('farm')
  })

  it('opens none with nobody idle, or only one carrying a child', () => {
    const t = fullFarms(3)
    expect(planned(t)).not.toBe('farm')
    idle(t.world, t.city).carrying = { partnerId: 'nobody', since: t.world.tick }
    expect(planned(t)).not.toBe('farm')
  })

  it('opens none while a farm has room, or with Food not short', () => {
    const room = fullFarms(3)
    idle(room.world, room.city)
    const place = room.farms[0]!
    cityResidents(room.world, room.city).find(
      (r) => r.script?.memory.workplaceId === place.id,
    )!.script = undefined
    expect(planned(room)).not.toBe('farm')

    const fed = fullFarms(3)
    idle(fed.world, fed.city)
    fed.home.stock = { ...fed.home.stock, food: 5000 }
    expect(planned(fed)).not.toBe('farm')
  })

  it('opens a farm even as Food runs short, but nothing else, and none with nobody idle', () => {
    const t = fullFarms(3)
    t.home.stock = { ...t.home.stock, food: 1 }
    expect(planCity(t.world, t.city, t.terrain).project).toBeUndefined()
    idle(t.world, t.city)
    expect(farmsOverflow(t.world, t.city)).toBe(true)
    expect(planCity(t.world, t.city, t.terrain).project).toMatchObject({ building: 'farm' })
  })

  it('opens a third lumber camp with two full and Wood short', () => {
    const t = big()
    t.home.stock = { ...t.home.stock, wood: 1 }
    const second = standingCamp(t.world, t.city, freeNode(t.world, t.terrain, t.home, 'forest', 20))
    freeNode(t.world, t.terrain, t.home, 'forest', 26)
    fillCrew(t.world, t.city, t.camp)
    fillCrew(t.world, t.city, second)
    expect(planned(t)).not.toBe('lumberCamp')
    idle(t.world, t.city)
    expect(planned(t)).toBe('lumberCamp')
    expect(npcWorkplacesBounded.check(t.world, t.terrain)).toEqual([])
  })

  it('opens another of what makes the input it lacks, or of what processes one it holds', () => {
    const t = big()
    const mine = t.world.buildings.find((b) => b.kind === 'mine')!
    const smelter = t.world.buildings.find((b) => b.kind === 'smelter')!
    const armed = cityResidents(t.world, t.city).filter((r) => r.carried.spear)
    for (const r of armed.slice(0, 4)) delete r.carried.spear
    t.home.stock = { ...npcReserve(t.world, t.city), iron: 0, ironOre: 0, spear: 0 }
    fillCrew(t.world, t.city, mine)
    idle(t.world, t.city)
    expect(planned(t)).toBe('mine')

    t.home.stock = { ...t.home.stock, ironOre: 500 }
    fillCrew(t.world, t.city, smelter)
    idle(t.world, t.city)
    expect(planned(t)).toBe('smelter')
  })

  it('leaves a Trade Org city out of it', () => {
    const t = fullFarms(3)
    idle(t.world, t.city)
    t.city.tradeOrg = 'post'
    expect(farmsOverflow(t.world, t.city)).toBe(false)
  })
})
