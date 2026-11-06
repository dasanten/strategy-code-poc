import {
  NPC_NODE_REACH,
  NPC_RESIDENTS_PER_SCOUT,
  NPC_SCOUT_LIMIT,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  SIGHT_RANGE,
  TICKS_PER_GAME_DAY,
  Terrain,
  canWork,
  cityResidents,
  inCityArea,
  isDown,
  npcReserve,
  tileIndex,
  wrapDistance,
  type Building,
  type BuildingKind,
  type City,
  type Good,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import {
  knowsNode,
  npcScoutsSound,
  scoutEdge,
  scoutEnded,
  scoutFarOut,
  scoutsWanted,
  sectorOf,
  sendScout,
  stepScouts,
} from './npc-scouts.js'
import { mulberry32 } from './residents.js'
import { entitiesInSight } from './sight.js'
import { runNpcScripts } from './script-runner.js'
import { newId } from './starting-city.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * An NPC city's scouts (`CONTEXT.md`: Scout): spare hands who run the Explore default a few at a
 * time and bring what they saw home, the only way the city learns it.
 */

const CAP = NPC_SURPLUS_CAP as Record<'food' | 'wood' | 'stone', number>

/** A finished workplace of `kind` of the city, on a node of `resource`. */
function workplace(
  world: WorldState,
  terrain: TerrainMap,
  city: City,
  kind: BuildingKind,
  resource: 'forest' | 'stone',
): Building {
  const home = npcHome(world, city)!
  const at = { x: home.x + 40 + world.nodes.length * 6, y: home.y + 40 }
  world.nodes.push({ id: newId(world, 'n'), kind: resource, ...at })
  const ground = resource === 'forest' ? Terrain.Forest : Terrain.Hills
  terrain.tiles[tileIndex(terrain.size, at.x, at.y)] = ground
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

/** A town alone on Plains, nothing short of its reserve, with a lumber camp and a quarry. */
function town(size = 1300) {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 300, 300, mulberry32(5))
  const camp = workplace(world, terrain, city, 'lumberCamp', 'forest')
  const quarry = workplace(world, terrain, city, 'quarry', 'stone')
  const storage = npcHome(world, city)!
  storage.stock = pastReserve(world, city, { food: CAP.food })
  const home = { x: storage.x, y: storage.y }
  const people = () => world.residents.filter((r) => r.cityId === city.id)
  return { world, terrain, city, camp, quarry, storage, home, people }
}

type Town = ReturnType<typeof town>

/** A node `distance` tiles east of home. */
function nodeAt(t: Town, distance: number) {
  const node = { id: newId(t.world, 'n'), kind: 'stone' as const, x: t.home.x + distance, y: t.home.y }
  t.world.nodes.push(node)
  return node
}

/** A scout of the town's, out `distance` tiles east of home, on their trip. */
function scoutOut(t: Town, distance: number): Resident {
  const plan = (t.world.cityPlans[t.city.id] ??= { plannedAt: t.world.tick, jobs: {} })
  const r = t.people().find((p) => canWork(p, t.world.tick) && !p.carried.spear)!
  r.order = null
  sendScout(plan, r)
  plan.jobs[r.id] = { kind: 'scout' }
  r.x = t.home.x + distance
  r.y = t.home.y
  return r
}

const plan = (t: Town) => t.world.cityPlans[t.city.id]!
const step = (t: Town) => stepScouts(t.world, t.city, plan(t), t.people(), t.terrain.size)
const scoutJobs = (t: Town) => Object.values(plan(t).jobs).filter((j) => j.kind === 'scout').length

describe('sending scouts', () => {
  it('goes by the size of the city, ahead of work for surplus', () => {
    const t = town()
    expect(cityResidents(t.world, t.city).length).toBeGreaterThan(NPC_RESIDENTS_PER_SCOUT)
    expect(scoutsWanted(t.world, t.city)).toBe(2)
    planCity(t.world, t.city)
    expect(scoutJobs(t)).toBe(2)
    expect(checkInvariants(t.world, t.terrain)).toEqual([])
  })

  it('keeps those already out, and sends no one more', () => {
    const t = town()
    const out = scoutOut(t, 200)
    planCity(t.world, t.city)
    expect(plan(t).jobs[out.id]?.kind).toBe('scout')
    expect(scoutJobs(t)).toBe(2)
    planCity(t.world, t.city)
    expect(plan(t).jobs[out.id]?.kind).toBe('scout')
    expect(scoutJobs(t)).toBe(2)
  })

  it('stops while Food runs short', () => {
    const t = town()
    t.storage.stock = { ...t.storage.stock, food: 0 }
    planCity(t.world, t.city)
    expect(scoutJobs(t)).toBe(0)
  })

  it('stops once it knows its limit', () => {
    const t = town()
    t.city.scouted = { sectors: [], done: true }
    planCity(t.world, t.city)
    expect(scoutJobs(t)).toBe(0)
    // Between passes too: the job an earlier pass gave sends nobody out.
    const [r] = t.people().filter((p) => canWork(p, t.world.tick) && !p.carried.spear)
    plan(t).jobs[r!.id] = { kind: 'scout' }
    r!.script = undefined
    r!.carried = { food: 10 }
    stepNpcCities(t.world, t.terrain.size)
    expect(r!.script?.task).not.toBe('explore')
  })

  it('never comes from the Trade Organization', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    planCity(world, city)
    const jobs = Object.values(world.cityPlans[city.id]!.jobs)
    expect(jobs.filter((j) => j.kind === 'scout')).toEqual([])
  })

  it('counts them as spare hands for a Full city', () => {
    const t = town()
    planCity(t.world, t.city)
    expect(scoutJobs(t)).toBeGreaterThan(0)
    expect(plan(t).fullSince).toBe(t.world.tick)
  })

  it('leaves a scout far out of a founding party, who could not fetch their load', () => {
    const t = town()
    const far = scoutOut(t, NPC_NODE_REACH + 10)
    expect(scoutFarOut(plan(t), far, t.home, t.terrain.size)).toBe(true)
    far.x = t.home.x
    expect(scoutFarOut(plan(t), far, t.home, t.terrain.size)).toBe(false)
  })
})

describe('what a scout saw', () => {
  it('is the city’s only once they step back into its area', () => {
    const t = town()
    const node = nodeAt(t, 250)
    const r = scoutOut(t, 250)
    step(t)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(false)
    expect(t.city.scouted).toBeUndefined()
    expect(plan(t).scouts?.[r.id]?.saw).toContain(sectorOf(t.terrain.size, node.x, node.y))

    r.x = t.home.x
    r.y = t.home.y
    step(t)
    expect(inCityArea(t.world, t.city, r.x, r.y, t.terrain.size)).toBe(true)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(true)
    // Still scouting, they start on a new trip with nothing to bring.
    expect(plan(t).scouts?.[r.id]?.saw).toEqual(
      expect.not.arrayContaining([sectorOf(t.terrain.size, node.x, node.y)]),
    )
  })

  it('brings nothing past the limit', () => {
    const t = town()
    const node = nodeAt(t, NPC_SCOUT_LIMIT + 20)
    const r = scoutOut(t, NPC_SCOUT_LIMIT + 20)
    step(t)
    r.x = t.home.x
    step(t)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(false)
  })

  it('does not take in what they never had in sight', () => {
    const t = town()
    const node = nodeAt(t, 250 + 2 * SIGHT_RANGE)
    const r = scoutOut(t, 250)
    step(t)
    r.x = t.home.x
    step(t)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(false)
  })

  it('lets a city go on knowing every node in its set reach, scouted or not', () => {
    const t = town()
    expect(knowsNode(t.city, t.home, nodeAt(t, NPC_NODE_REACH), t.terrain.size)).toBe(true)
  })

  it('dies with a scout killed on the way', () => {
    const t = town()
    const node = nodeAt(t, 250)
    const r = scoutOut(t, 250)
    step(t)
    t.world.residents = t.world.residents.filter((p) => p !== r)
    step(t)
    expect(plan(t).scouts?.[r.id]).toBeUndefined()
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(false)
  })

  it('stays with a scout gone Down, who sees no more, frees their place and carries it home awake', () => {
    const t = town()
    const node = nodeAt(t, 250)
    const seenLater = nodeAt(t, 250 + 3 * SIGHT_RANGE)
    const r = scoutOut(t, 250)
    step(t)
    r.downUntil = t.world.tick + 100
    delete r.script // as going Down ends it
    expect(isDown(r)).toBe(true)
    r.x = t.home.x + 250 + 3 * SIGHT_RANGE
    step(t)
    expect(plan(t).scouts?.[r.id]?.saw).not.toContain(
      sectorOf(t.terrain.size, seenLater.x, seenLater.y),
    )

    planCity(t.world, t.city)
    expect(plan(t).jobs[r.id]?.kind).not.toBe('scout')
    expect(scoutJobs(t)).toBe(2)

    delete r.downUntil
    r.x = t.home.x
    r.y = t.home.y
    step(t)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(true)
    expect(plan(t).scouts?.[r.id]).toBeUndefined()
  })

  it('stays hidden from anyone who sees the city', () => {
    const t = town()
    t.city.scouted = { sectors: [1, 2] }
    const cities = entitiesInSight(t.world, t.terrain, t.city.id).filter((e) => e.is === 'city')
    expect(cities.length).toBeGreaterThan(0)
    expect(cities.some((c) => 'scouted' in c)).toBe(false)
  })
})

describe('calling a scout home', () => {
  /** A scout out while the city's Wood runs short, with room at its lumber camp. */
  function called() {
    const t = town()
    planCity(t.world, t.city)
    const r = scoutOut(t, 250)
    const node = nodeAt(t, 250)
    step(t)
    const others = t.people().filter((p) => p !== r && canWork(p, t.world.tick) && !p.carried.spear)
    for (const p of others) p.carried.spear = 1
    t.storage.stock = { ...t.storage.stock, wood: 0 }
    planCity(t.world, t.city)
    return { ...t, t, r, node }
  }

  it('takes them for what is short', () => {
    const { t, r } = called()
    expect(plan(t).jobs[r.id]?.kind).not.toBe('scout')
    expect(plan(t).jobs[r.id]?.buildingId).toBeDefined()
  })

  it('has them walk home first, and the news comes with them', () => {
    const { t, r, node } = called()
    stepNpcCities(t.world, t.terrain.size)
    expect(r.script).toBeUndefined()
    const order = r.order
    expect(order?.kind).toBe('walkTo')
    if (order?.kind === 'walkTo') {
      expect(wrapDistance(t.terrain.size, order.target, t.home)).toBe(0)
    }
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(false)

    r.order = null
    r.x = t.home.x
    r.y = t.home.y
    step(t)
    expect(knowsNode(t.city, t.home, node, t.terrain.size)).toBe(true)
    expect(plan(t).scouts?.[r.id]).toBeUndefined()
  })
})

describe('where a scout goes', () => {
  const edge = (t: Town, r: Resident, skip: { x: number; y: number }[] = []) =>
    scoutEdge(t.world, t.city, plan(t), r, t.terrain.size, { canEnter: () => true, skip })

  it('is out past its set reach, within its limit', () => {
    const t = town()
    const r = scoutOut(t, 0)
    const to = edge(t, r)!
    const d = wrapDistance(t.terrain.size, t.home, to)
    expect(d).toBeGreaterThan(NPC_NODE_REACH - 64)
    expect(d).toBeLessThanOrEqual(NPC_SCOUT_LIMIT + 32)
  })

  it('leaves out what the city knows, and what they have seen on the way', () => {
    const t = town()
    const r = scoutOut(t, 0)
    const first = edge(t, r)!
    const sector = sectorOf(t.terrain.size, first.x, first.y)
    t.city.scouted = { sectors: [sector] }
    const second = edge(t, r)!
    expect(sectorOf(t.terrain.size, second.x, second.y)).not.toBe(sector)
    delete t.city.scouted
    plan(t).scouts![r.id] = { saw: [sector] }
    const third = edge(t, r)!
    expect(sectorOf(t.terrain.size, third.x, third.y)).not.toBe(sector)
  })

  it('leaves out a tile they found no way to, and the city gives its sector up', () => {
    const t = town()
    const r = scoutOut(t, 0)
    const first = edge(t, r)!
    const sector = sectorOf(t.terrain.size, first.x, first.y)
    const second = edge(t, r, [first])!
    expect(sectorOf(t.terrain.size, second.x, second.y)).not.toBe(sector)

    const far = { x: t.home.x + 250, y: t.home.y }
    const farSector = sectorOf(t.terrain.size, far.x, far.y)
    r.script!.memory.skip = [far]
    r.x = t.home.x
    r.y = t.home.y
    step(t)
    expect(t.city.scouted?.noWay).toContain(farSector)
    expect(t.city.scouted?.sectors).not.toContain(farSector)
    expect(knowsNode(t.city, t.home, far, t.terrain.size)).toBe(false)
  })

  it('is none in the middle of a lake', () => {
    const t = town()
    const r = scoutOut(t, 0)
    expect(
      scoutEdge(t.world, t.city, plan(t), r, t.terrain.size, {
        canEnter: () => false,
        skip: [],
      }),
    ).toBeUndefined()
  })

  it('spreads scouts out with a way of their own', () => {
    const t = town()
    const adults = t.people().filter((p) => canWork(p, t.world.tick))
    const tiles = adults.map((r) => {
      r.x = t.home.x
      r.y = t.home.y
      const to = scoutEdge(t.world, t.city, plan2(t), r, t.terrain.size, {
        canEnter: () => true,
        skip: [],
      })!
      return `${to.x},${to.y}`
    })
    expect(new Set(tiles).size).toBeGreaterThan(1)
  })
})

const plan2 = (t: Town) => (t.world.cityPlans[t.city.id] ??= { plannedAt: 0, jobs: {} })

describe('knowing its limit', () => {
  it('comes when a scout’s Explore default finds nothing left, not when it just runs out of Food', () => {
    const t = town()
    scoutEnded(t.city, 'no Food to explore with')
    expect(t.city.scouted?.done).toBeUndefined()
    scoutEnded(t.city, 'nothing unexplored in reach')
    expect(t.city.scouted?.done).toBe(true)
    const other = town()
    scoutEnded(other.city, 'nothing unexplored in reach of the Food I can carry')
    expect(other.city.scouted?.done).toBe(true)
  })

  it('stops a city whose scout finds nothing left on the map', () => {
    const t = town()
    const across = Math.ceil(t.terrain.size / 32)
    t.city.scouted = { sectors: Array.from({ length: across * across }, (_, i) => i) }
    const r = scoutOut(t, 0)
    runNpcScripts(t.world, t.terrain)
    expect(r.script).toBeUndefined()
    expect(t.city.scouted.done).toBe(true)
    planCity(t.world, t.city)
    expect(scoutJobs(t)).toBe(0)
  })
})

describe('the npc-scouts-sound invariant', () => {
  it('finds a city planning too many scouts', () => {
    const t = town()
    const adults = t.people().filter((p) => canWork(p, t.world.tick))
    t.world.cityPlans[t.city.id] = {
      plannedAt: t.world.tick,
      jobs: Object.fromEntries(adults.map((r) => [r.id, { kind: 'scout' as const }])),
    }
    expect(npcScoutsSound.check(t.world, t.terrain)).toHaveLength(1)
    plan(t).plannedAt = t.world.tick - 1
    expect(npcScoutsSound.check(t.world, t.terrain)).toEqual([])
  })

  it('finds a sector off the map', () => {
    const t = town()
    t.city.scouted = { sectors: [-1] }
    expect(npcScoutsSound.check(t.world, t.terrain)).toHaveLength(1)
  })

  it('finds a Trade Org city with scouts', () => {
    const terrain = plains(400)
    const world = createWorld(terrain)
    const city = foundTradingPost(world, terrain, 60, 60, undefined, mulberry32(3))
    world.cityPlans[city.id] = { plannedAt: world.tick, jobs: { x: { kind: 'scout' } } }
    expect(npcScoutsSound.check(world, terrain)).toHaveLength(1)
  })
})

describe('on the map', () => {
  it(
    'a scout walks out past the set reach and brings what they saw home',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const t = town()
      const walking = new Walking(t.terrain)
      let furthest = 0
      let days = 0
      for (let i = 0; i < 40 * TICKS_PER_GAME_DAY; i++) {
        stepWorld(t.world, t.terrain, walking)
        if (i % TICKS_PER_GAME_DAY === 0) {
          days++
          expect(checkInvariants(t.world, t.terrain)).toEqual([])
        }
        for (const id of Object.keys(t.world.cityPlans[t.city.id]?.scouts ?? {})) {
          const r = t.world.residents.find((p) => p.id === id)
          if (r) furthest = Math.max(furthest, wrapDistance(t.terrain.size, t.home, r))
        }
        if (furthest > NPC_NODE_REACH && (t.city.scouted?.sectors.length ?? 0) > 20) break
      }
      expect(days).toBeGreaterThan(0)
      expect(furthest).toBeGreaterThan(NPC_NODE_REACH)
      expect(furthest).toBeLessThanOrEqual(NPC_SCOUT_LIMIT + 64)
      expect(t.city.scouted?.sectors.length ?? 0).toBeGreaterThan(20)
    },
  )
})
