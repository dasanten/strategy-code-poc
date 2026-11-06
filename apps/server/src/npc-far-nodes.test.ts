import {
  BUILD_MATERIALS,
  CREW_FOOD,
  NPC_NODE_REACH,
  NPC_SCOUT_LIMIT,
  NPC_SURPLUS_CAP,
  NPC_TOWN,
  TICKS_PER_GAME_DAY,
  Terrain,
  buildingPile,
  canWork,
  npcReserve,
  roadAt,
  tileIndex,
  wrapDistance,
  type Building,
  type Good,
  type Resident,
  type ResourceKind,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { farOut, lackedGood } from './npc-founding.js'
import { chainProject } from './npc-growth.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { npcScoutsSound, sectorOf, sendScout, stepScouts } from './npc-scouts.js'
import { hasNodeFor } from './npc-trader.js'
import { mulberry32 } from './residents.js'
import { newId } from './starting-city.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * An NPC city builds on the nodes its scouts found (`CONTEXT.md`: NPC city, Scout; ADR 0026): what it
 * knows of, not what lies in its set reach, is what it builds on, what its trader buys and what it
 * founds a daughter for.
 */

/** A node past the set reach and inside the limit. */
const FAR = 300

const GROUND: Record<ResourceKind, Terrain> = {
  forest: Terrain.Forest,
  stone: Terrain.Hills,
  ironOre: Terrain.Hills,
  goldOre: Terrain.Hills,
}

/** A town alone on Plains with no node of anything near it, and its reserve in store. */
function town() {
  const terrain = plains(1300)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_TOWN, 300, 300, mulberry32(5))
  world.nodes = []
  const storage = npcHome(world, city)!
  storage.stock = npcReserve(world, city)
  const home = { x: storage.x, y: storage.y }
  const people = () => world.residents.filter((r) => r.cityId === city.id)
  return { world, terrain, city, storage, home, people, size: terrain.size }
}

type Town = ReturnType<typeof town>

/** A node of `kind`, `distance` tiles east of home. */
function nodeAt(t: Town, kind: ResourceKind, distance: number) {
  const at = { x: t.home.x + distance, y: t.home.y }
  t.terrain.tiles[tileIndex(t.size, at.x, at.y)] = GROUND[kind]
  const node = { id: newId(t.world, 'n'), kind, ...at }
  t.world.nodes.push(node)
  return node
}

/** The city has heard of the sector the node lies in. */
function scouted(t: Town, n: { x: number; y: number }) {
  t.city.scouted = { sectors: [sectorOf(t.size, n.x, n.y)] }
}

const homeOf = (t: Town) => npcHome(t.world, t.city)!
const project = (t: Town, good: Good) =>
  chainProject(t.world, t.city, homeOf(t), t.terrain, undefined, good)

/** Whether the city's next workplace for `good` goes on the node. */
function buildsOn(t: Town, good: Good, node: { x: number; y: number }): boolean {
  const next = project(t, good)
  return next !== undefined && wrapDistance(t.size, next, node) <= 2
}

/** One of its residents who can work and bears no arms, at nothing. */
function worker(t: Town): Resident {
  const r = t.people().find((p) => canWork(p, t.world.tick) && !p.carried.spear)!
  r.order = null
  delete r.script
  return r
}

describe('building on what it knows', () => {
  it('builds on a far node only once the scout who saw it is home', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    expect(project(t, 'stone')).toBeUndefined()

    const plan = (t.world.cityPlans[t.city.id] ??= { plannedAt: t.world.tick, jobs: {} })
    const r = worker(t)
    sendScout(plan, r)
    r.x = node.x
    r.y = node.y
    stepScouts(t.world, t.city, plan, t.people(), t.size)
    // They saw it. It isn't the city's until they are back.
    expect(project(t, 'stone')).toBeUndefined()

    r.x = t.home.x
    r.y = t.home.y
    stepScouts(t.world, t.city, plan, t.people(), t.size)
    expect(buildsOn(t, 'stone', node)).toBe(true)
  })

  it('still goes by what is nearest', () => {
    const t = town()
    const far = nodeAt(t, 'stone', FAR)
    const near = nodeAt(t, 'stone', NPC_NODE_REACH - 10)
    scouted(t, far)
    expect(buildsOn(t, 'stone', near)).toBe(true)
  })

  it('builds on nothing past its limit, whatever a scout saw', () => {
    const t = town()
    scouted(t, nodeAt(t, 'stone', NPC_SCOUT_LIMIT + 40))
    expect(project(t, 'stone')).toBeUndefined()
  })

  it('counts on no node in a sector a scout found no way to', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    const sector = sectorOf(t.size, node.x, node.y)
    t.city.scouted = { sectors: [sector], noWay: [sector] }
    expect(project(t, 'stone')).toBeUndefined()
    expect(hasNodeFor(t.world, t.city, homeOf(t), 'stone', t.size)).toBe(false)
  })

  it('makes it the project of a pass that finds the good short', () => {
    const t = town()
    const node = nodeAt(t, 'forest', FAR)
    scouted(t, node)
    t.storage.stock = { ...t.storage.stock, wood: 0 }
    const plan = planCity(t.world, t.city, t.terrain)
    expect(plan.project).toMatchObject({ kind: 'build', building: 'lumberCamp' })
    const at = plan.project as { x: number; y: number }
    expect(wrapDistance(t.size, at, node)).toBeLessThanOrEqual(2)
  })
})

describe('what it has no node for', () => {
  it('its trader buys a good only while it knows no node of it', () => {
    const t = town()
    const node = nodeAt(t, 'ironOre', FAR)
    expect(hasNodeFor(t.world, t.city, homeOf(t), 'ironOre', t.size)).toBe(false)
    expect(hasNodeFor(t.world, t.city, homeOf(t), 'iron', t.size)).toBe(false)
    scouted(t, node)
    expect(hasNodeFor(t.world, t.city, homeOf(t), 'ironOre', t.size)).toBe(true)
    expect(hasNodeFor(t.world, t.city, homeOf(t), 'iron', t.size)).toBe(true)
  })

  it('a founding goes for a good only while it knows no node of it', () => {
    const t = town()
    nodeAt(t, 'forest', 40)
    nodeAt(t, 'stone', 60)
    nodeAt(t, 'ironOre', 80)
    const gold = nodeAt(t, 'goldOre', FAR)
    expect(lackedGood(t.world, t.city, homeOf(t), t.size)).toBe('goldOre')
    scouted(t, gold)
    expect(lackedGood(t.world, t.city, homeOf(t), t.size)).toBeUndefined()
  })
})

describe('a far workplace', () => {
  it('a worker there is too far to fetch a founding party’s load', () => {
    const t = town()
    expect(farOut({ x: t.home.x + FAR, y: t.home.y }, t.home, t.size)).toBe(true)
    expect(farOut(t.home, t.home, t.size)).toBe(false)
  })

  it('a builder with no way to a site on it gives the sector up', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    scouted(t, node)
    const r = worker(t)
    const memory = { building: 'quarry', at: { x: node.x, y: node.y } }
    // Still on their way: nothing is given up.
    r.script = { scriptId: 0, task: 'build', memory }
    r.order = { kind: 'walkTo', target: { ...memory.at }, path: null, progress: 0 }
    stepNpcCities(t.world, t.size, t.terrain)
    expect(t.city.scouted?.noWay).toBeUndefined()
    // Their walk ended short of it.
    r.order = null
    stepNpcCities(t.world, t.size, t.terrain)
    expect(t.city.scouted?.noWay).toContain(sectorOf(t.size, node.x, node.y))
    expect(project(t, 'stone')).toBeUndefined()
  })

  it('a builder with no way to a site in its set reach gives nothing up', () => {
    const t = town()
    const node = nodeAt(t, 'stone', NPC_NODE_REACH - 10)
    const r = worker(t)
    const memory = { building: 'quarry', at: { x: node.x, y: node.y } }
    r.script = { scriptId: 0, task: 'build', memory }
    stepNpcCities(t.world, t.size, t.terrain)
    expect(t.city.scouted).toBeUndefined()
    expect(r.script?.task).toBe('build')
  })
})

describe('a road crew past the set reach', () => {
  it('gives no sector up when they find no way to a tile of road', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    scouted(t, node)
    const r = worker(t)
    const memory = { building: 'road', at: { x: node.x - 5, y: node.y } }
    r.script = { scriptId: 0, task: 'build', memory }
    stepNpcCities(t.world, t.size, t.terrain)
    expect(t.city.scouted?.noWay).toBeUndefined()
    expect(buildsOn(t, 'stone', node)).toBe(true)
  })
})

describe('the npc-scouts-sound invariant on what it builds on', () => {
  /** The plan of this tick has the city's next workplace on the node. */
  function planOn(t: Town, node: { x: number; y: number }) {
    t.world.cityPlans[t.city.id] = {
      plannedAt: t.world.tick,
      jobs: {},
      project: { kind: 'build', building: 'quarry', x: node.x, y: node.y },
    }
  }

  it('finds a workplace planned on a node it has not heard of', () => {
    const t = town()
    planOn(t, nodeAt(t, 'stone', FAR))
    expect(npcScoutsSound.check(t.world, t.terrain)).toHaveLength(1)
  })

  it('lets one on a node it knows of be, or in a sector it just gave up', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    planOn(t, node)
    scouted(t, node)
    expect(npcScoutsSound.check(t.world, t.terrain)).toEqual([])
    t.city.scouted!.noWay = [sectorOf(t.size, node.x, node.y)]
    expect(npcScoutsSound.check(t.world, t.terrain)).toEqual([])
  })

  it('lets one begun, or a plan from before, be', () => {
    const t = town()
    const node = nodeAt(t, 'stone', FAR)
    planOn(t, node)
    t.world.cityPlans[t.city.id]!.plannedAt = t.world.tick - 1
    expect(npcScoutsSound.check(t.world, t.terrain)).toEqual([])
    planOn(t, node)
    t.world.buildings.push({
      id: newId(t.world, 'b'),
      kind: 'quarry',
      x: node.x,
      y: node.y,
      cityId: t.city.id,
      site: {},
    } as unknown as Building)
    expect(npcScoutsSound.check(t.world, t.terrain)).toEqual([])
  })
})

describe('on the map', () => {
  it('a road follows out to a far workplace', { tags: ['slow'], timeout: 1_200_000 }, () => {
    const t = town()
    const node = nodeAt(t, 'forest', FAR)
    scouted(t, node)
    const place = {
      id: newId(t.world, 'b'),
      kind: 'lumberCamp',
      x: node.x,
      y: node.y,
      cityId: null,
    } as Building
    t.world.buildings.push(place)
    ;(t.city.workplaceIds ??= []).push(place.id)
    // Nothing short, and Stone for the whole way.
    const reserve = npcReserve(t.world, t.city)
    t.storage.stock = {
      ...reserve,
      food: (reserve.food ?? 0) + 2 * (NPC_SURPLUS_CAP.food ?? 0),
      wood: (reserve.wood ?? 0) + (NPC_SURPLUS_CAP.wood ?? 0),
      stone: (reserve.stone ?? 0) + 2 * FAR * (BUILD_MATERIALS.road?.stone ?? 0),
    }
    const way = () => t.world.cityPlans[t.city.id]?.roads?.find((r) => r.to === place.id)?.tiles
    const laid = () =>
      (way() ?? []).filter(([x, y]) => {
        const road = roadAt(t.world, x, y)
        return road && !road.site
      }).length
    const built = () => (way()?.length ?? 0) > 0 && laid() === way()!.length
    const walking = new Walking(t.terrain)
    for (let i = 0; i < 150 * TICKS_PER_GAME_DAY && !built(); i++) {
      stepWorld(t.world, t.terrain, walking)
      if (i % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(t.world, t.terrain)).toEqual([])
    }
    expect(way()?.at(-1)).toEqual([place.x, place.y])
    expect(way()!.length).toBeGreaterThan(NPC_NODE_REACH)
    expect(laid()).toBe(way()!.length)
    expect(t.city.scouted?.noWay).toBeUndefined()
  })

  it(
    'a city short of a good builds on a far node, and its crew stays fed there',
    { tags: ['slow'], timeout: 1_200_000 },
    () => {
      const t = town()
      const node = nodeAt(t, 'forest', FAR)
      scouted(t, node)
      const reserve = npcReserve(t.world, t.city)
      t.storage.stock = {
        ...reserve,
        wood: 0,
        food: (reserve.food ?? 0) + 600,
      }
      const walking = new Walking(t.terrain)
      const camp = () =>
        t.world.buildings.find((b) => b.kind === 'lumberCamp' && wrapDistance(t.size, b, node) <= 2)
      for (let i = 0; i < 60 * TICKS_PER_GAME_DAY && (!camp() || camp()!.site); i++) {
        stepWorld(t.world, t.terrain, walking)
        if (i % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(t.world, t.terrain)).toEqual([])
      }
      const place = camp()!
      expect(place).toBeDefined()
      expect(place.site).toBeUndefined()
      expect(t.city.workplaceIds).toContain(place.id)
      expect(wrapDistance(t.size, t.home, place)).toBeGreaterThan(NPC_NODE_REACH)

      // Thirty days at it, on the Food the carrier brings. What they bring keeps going out of the
      // store, so Wood stays short and the crew stays.
      const everyone = t.people().length
      const crew = () => t.people().filter((r) => r.script?.memory.workplaceId === place.id)
      let lastPile = buildingPile(t.world, place)?.goods.food ?? 0
      let brought = 0
      let hungry = 0
      for (let i = 0; i < 30 * TICKS_PER_GAME_DAY; i++) {
        t.storage.stock!.wood = 0
        stepWorld(t.world, t.terrain, walking)
        for (const r of crew()) if (r.hunger !== undefined && r.hunger <= 0) hungry++
        const pile = buildingPile(t.world, place)?.goods.food ?? 0
        if (pile > lastPile) brought++
        lastPile = pile
        if (i % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(t.world, t.terrain)).toEqual([])
      }
      expect(crew().length).toBeGreaterThan(0)
      expect(brought).toBeGreaterThan(0)
      expect(lastPile).toBeLessThanOrEqual(CREW_FOOD)
      expect(hungry).toBe(0)
      expect(t.people().filter((r) => r.downUntil !== undefined)).toEqual([])
      expect(t.people().length).toBeGreaterThanOrEqual(everyone)
    },
  )
})
