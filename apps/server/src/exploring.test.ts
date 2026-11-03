import {
  AVERAGE_HORSE_STATS,
  MAX_HEALTH,
  MAX_HUNGER,
  SIGHT_RANGE,
  Terrain,
  WAYPOINTS_MAX,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { ExploredTerrain } from './explored.js'
import { exploredEdge } from './explored-edge.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { defaultScripts } from './test-default-scripts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Explore (`CONTEXT.md`: Explore): a resident given the task sets out with as much Food as they
 * can carry, walks to the edge of their Player's explored terrain the way asked, turns back while
 * the Food on them still covers the way home plus a margin, refills and goes back out to where
 * they turned. With nothing unexplored in reach they end.
 */

const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

function plains(size: number): TerrainMap {
  return { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
}

/**
 * Realm r1 (Player 7) with city c1 and a storage s1 holding 100 Food at `home`; resident w1 on
 * it with no Food and `stone` units of stone, so only so much Food fits in their hands. What
 * they see they explore, as the game's sight does.
 */
function setup(terrain: TerrainMap, home: { x: number; y: number }, stone: number) {
  const explored = new ExploredTerrain(terrain)
  const tasks = defaultScripts(terrain, [me], new Map(), (userId, x, y) =>
    explored.isExplored({ id: userId }, x, y),
  )
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: home.x + 4, y: home.y + 4 })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', ...home, stock: { food: 100 } })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', cityId: 'c1', ...home, tick: 0 })
  w1.stats.strength = { base: 10, trained: 0 }
  w1.stats.endurance = { base: 10, trained: 0 }
  w1.stats.agility = { base: 10, trained: 0 }
  w1.carried = { stone }
  world.residents.push(w1)
  return { world, w1, explored, tasks, queue: new OrderQueue(tasks.kinds) }
}

type Setup = ReturnType<typeof setup>

function give(s: Setup, params: Record<string, string> = {}) {
  const answer = s.queue.receive(s.world, me, 'q', {
    kind: 'task',
    task: 'explore',
    residentId: 'w1',
    params,
  })
  s.queue.applyAll(s.world)
  return answer
}

/**
 * Runs scripts and steps the world, w1 exploring as they see, for `ticks`, or with `until` until
 * it holds, which it must within them.
 */
function run(s: Setup, terrain: TerrainMap, ticks: number, until?: () => boolean) {
  const walking = new Walking(terrain)
  for (let t = 0; t < ticks; t++) {
    for (const r of s.world.residents) s.explored.explore(7, r.x, r.y, SIGHT_RANGE)
    expect(s.tasks.runAll(s.world)).toEqual([])
    stepWorld(s.world, terrain, walking)
    // Never starving: alive, with health left.
    expect(s.world.residents).toContain(s.w1)
    expect(s.w1.health).toBeGreaterThan(0)
    if (until?.()) break
  }
  if (until) expect(until()).toBe(true)
  expect(checkInvariants(s.world, terrain)).toEqual([])
}

const logged = (r: Resident) => (r.scriptLog ?? []).map((l) => l.text)
const memory = (r: Resident) => r.script?.memory ?? {}

/** A horse of r1's on w1's tile, which w1 gets on. */
function mounted(world: WorldState, w1: Resident) {
  world.horses.push({
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: w1.x,
    y: w1.y,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  })
  w1.riding = 'h1'
}

describe('the edge of explored terrain', () => {
  const terrain = plains(64)
  const disc = new ExploredTerrain(terrain)
  disc.explore(7, 32, 32, 10)
  const search = {
    size: 64,
    explored: (x: number, y: number) => disc.isExplored({ id: 7 }, x, y),
    canEnter: () => true,
    from: { x: 32, y: 32 },
  }

  /** How far a tile lies from the middle of the explored disc, and at what angle off north. */
  const where = (t: { x: number; y: number }) => ({
    away: Math.round(Math.hypot(t.x - 32, t.y - 32)),
    degrees: (Math.atan2(t.x - 32, 32 - t.y) * 180) / Math.PI,
  })

  it('is the nearest explored tile beside an unexplored one, the way asked', () => {
    // The disc's rim lies 9 to 10 tiles out; the nearest of it that way comes first.
    const north = exploredEdge({ ...search, toward: 'north' })!
    expect(where(north).away).toBe(9)
    expect(Math.abs(where(north).degrees)).toBeLessThan(10)
    const east = exploredEdge({ ...search, toward: 'east' })!
    expect(Math.abs(where(east).degrees - 90)).toBeLessThan(10)
    const southwest = where(exploredEdge({ ...search, toward: 'southwest' })!)
    expect(southwest.degrees).toBeGreaterThanOrEqual(-180)
    expect(southwest.degrees).toBeLessThanOrEqual(-90)
    // Explored all round, a tile out on the rim: never one inside.
    expect(where(exploredEdge(search)!).away).toBe(9)
  })

  it('leaves out tiles near those to skip, and tiles they can’t go onto', () => {
    const north = exploredEdge({ ...search, toward: 'north' })!
    const skipped = exploredEdge({ ...search, skip: [north] })!
    expect(Math.hypot(skipped.x - north.x, skipped.y - north.y)).toBeGreaterThan(8)
    expect(exploredEdge({ ...search, canEnter: (x) => x < 32, toward: 'east' })).toBeUndefined()
  })

  it('is none once all is explored', () => {
    const all = { ...search, explored: () => true }
    expect(exploredEdge(all)).toBeUndefined()
  })
})

describe('exploring', { timeout: 60_000 }, () => {
  const terrain = plains(1000)
  const home = { x: 500, y: 960 }

  it('sets out with Food, walks north and turns back in time', () => {
    const s = setup(terrain, home, 26)
    expect(give(s, { toward: 'north' })).toEqual({ type: 'ack', requestId: 'q' })
    run(s, terrain, 1)
    // As much Food as fits: 4 units beside 26 stone, from the storage they stand on.
    expect(logged(s.w1)).toEqual(['setting out: fetching 4 Food at the storage at 500,960'])
    expect(s.w1.carried.food).toBe(4)
    // Out north until the Food on them only just covers the way home.
    run(s, terrain, 20_000, () => memory(s.w1).turnedAt !== undefined)
    const turnedAt = memory(s.w1).turnedAt as { x: number; y: number }
    expect(turnedAt.y).toBeLessThan(home.y - 4 * SIGHT_RANGE)
    expect(Math.abs(turnedAt.x - home.x)).toBeLessThan((home.y - turnedAt.y) / 4)
    expect(s.w1.order).toMatchObject({ kind: 'fetch', from: { storageId: 's1' } })
    expect(logged(s.w1).at(-1)).toMatch(/^turning back with 4 Food to the storage at 500,960$/)
    // Home, refilled, and out north again. Back to where they turned is as far as a full load
    // takes them and back, so they take the nearest edge north of home instead.
    run(s, terrain, 20_000, () => !memory(s.w1).fetching && s.w1.order?.kind === 'walkTo')
    expect(s.w1.carried.food).toBe(4)
    const target = (s.w1.order as { target: { x: number; y: number } }).target
    expect(home.y - target.y).toBeGreaterThanOrEqual(Math.abs(target.x - home.x))
    expect(s.w1.script).toBeDefined()
  })

  it('goes back out to where they turned once refilled', () => {
    // Room for 6 Food, but only 4 in the storage they stand on: they set out with that and turn
    // back early, to s2 nearby, which holds more.
    const s = setup(terrain, home, 24)
    s.world.buildings.find((b) => b.id === 's1')!.stock = { food: 4 }
    const s2 = { id: 's2', kind: 'storage' as const, cityId: 'c1', x: home.x + 10, y: home.y }
    s.world.buildings.push({ ...s2, stock: { food: 100 } })
    give(s, { toward: 'north' })
    run(s, terrain, 20_000, () => memory(s.w1).turnedAt !== undefined)
    expect(s.w1.order).toMatchObject({ kind: 'fetch', from: { storageId: 's2' } })
    const turnedAt = memory(s.w1).turnedAt as { x: number; y: number }
    run(s, terrain, 20_000, () => !memory(s.w1).fetching && s.w1.order?.kind === 'walkTo')
    expect(logged(s.w1).at(-1)).toBe(`going back out to ${turnedAt.x},${turnedAt.y}`)
    expect(s.w1.order).toMatchObject({ target: turnedAt })
    run(s, terrain, 20_000, () => s.w1.x === turnedAt.x && s.w1.y === turnedAt.y)
    // And on from there.
    run(s, terrain, 2, () => s.w1.order?.kind === 'walkTo')
    expect(s.w1.script).toBeDefined()
  })

  it('riding, counts the horse’s Food too and turns back in time', () => {
    const s = setup(terrain, home, 22)
    mounted(s.world, s.w1)
    give(s, { toward: 'north' })
    run(s, terrain, 20_000, () => memory(s.w1).turnedAt !== undefined)
    expect(s.w1.riding).toBe('h1')
    const turnedAt = memory(s.w1).turnedAt as { x: number; y: number }
    expect(turnedAt.y).toBeLessThan(home.y - 4 * SIGHT_RANGE)
    // Home, with the horse fed from their Food all the way.
    run(s, terrain, 20_000, () => !memory(s.w1).fetching)
    expect(s.w1.riding).toBe('h1')
    const horse = s.world.horses[0]!
    expect(horse.hunger).toBeGreaterThan(0)
    expect(horse.health).toBe(MAX_HEALTH)
  })

  it('ends saying so with nothing unexplored left in reach', () => {
    const small = plains(120)
    const s = setup(small, { x: 60, y: 60 }, 20)
    give(s)
    run(s, small, 20_000, () => s.w1.script === undefined)
    // Back at the storage first, never out in the wild.
    expect(logged(s.w1).slice(-2)).toEqual([
      'done: walking back to the storage at 60,60',
      'nothing unexplored in reach',
    ])
    expect([s.w1.x, s.w1.y]).toEqual([60, 60])
  })

  it('ends when the edge is beyond the Food they can carry', () => {
    const s = setup(terrain, home, 27)
    // Everything near home explored: the edge lies further than 3 Food takes them and back.
    s.explored.explore(7, home.x, home.y, 190)
    give(s, { toward: 'north' })
    run(s, terrain, 5_000, () => s.w1.script === undefined)
    expect(logged(s.w1).at(-1)).toBe('nothing unexplored in reach of the Food I can carry')
  })

  it('leaves out the edge across a lake they found no way to, and goes on', () => {
    // Lakes right across the map north and south of home, the map joining round: they see the
    // land beyond, but can't get there.
    const lake = plains(200)
    for (const [from, to] of [
      [0, 20],
      [100, 140],
    ]) {
      for (let y = from; y < to; y++) lake.tiles.fill(Terrain.Lake, y * 200, (y + 1) * 200)
    }
    const s = setup(lake, { x: 100, y: 180 }, 26)
    give(s, { toward: 'north' })
    run(s, lake, 8_000, () => logged(s.w1).some((l) => l.startsWith('no way to')))
    const skipped = (memory(s.w1).skip as { x: number; y: number }[])[0]!
    expect(skipped.y).toBeLessThan(100)
    // On along the near shore, never across.
    run(s, lake, 600, () => s.w1.order?.kind === 'walkTo')
    expect((s.w1.order as { target: { y: number } }).target.y).toBeGreaterThanOrEqual(140)
  })

  describe('with find', () => {
    const gold = { id: 'n1', kind: 'goldOre', x: 500, y: 820 } as const
    const events = (s: Setup) => s.world.events.map((e) => e.kind)
    // Gold ore lies in hills: a hill on each tile a node is put on.
    const hilly = plains(1000)
    for (const y of [820, 900]) hilly.tiles[y * 1000 + 500] = Terrain.Hills

    /** Explores north for gold ore till they end, noting the northmost tile they reached. */
    function explore(s: Setup) {
      give(s, { find: 'goldOre', toward: 'north' })
      let northmost = home.y
      run(s, hilly, 20_000, () => {
        northmost = Math.min(northmost, s.w1.y)
        return s.w1.script === undefined
      })
      return northmost
    }

    it('marks a gold ore node once in sight, then walks home and ends', () => {
      const s = setup(hilly, home, 26)
      s.world.nodes.push({ ...gold })
      const northmost = explore(s)
      // Seen on the way out, so they turned for home there, without going on to the edge.
      expect(northmost).toBeGreaterThanOrEqual(gold.y - SIGHT_RANGE - 2)
      expect(s.world.waypoints[7]).toEqual([
        { id: expect.any(String), name: 'Gold ore node', x: 500, y: 820 },
      ])
      expect([s.w1.x, s.w1.y]).toEqual([home.x, home.y])
      expect(logged(s.w1).slice(-3)).toEqual([
        'found a Gold ore node at 500,820',
        'done: walking back to the storage at 500,960',
        'found a Gold ore node at 500,820',
      ])
      // The realm log says so when they find it, and again as they end.
      expect(events(s)).toEqual(['waypointAdded', 'scriptStopped'])
      expect(s.world.events[0]).toMatchObject({ name: s.w1.name, waypoint: 'Gold ore node' })
    })

    it('passes a node one of their waypoints already marks', () => {
      const s = setup(hilly, home, 26)
      s.world.waypoints[7] = [{ id: 'mark', name: 'Gold', x: 500, y: 900 }]
      s.world.nodes.push({ ...gold, id: 'n0', y: 900 }, { ...gold })
      expect(explore(s)).toBeLessThan(900)
      expect(s.world.waypoints[7]!.map((w) => [w.name, w.y])).toEqual([
        ['Gold', 900],
        ['Gold ore node', 820],
      ])
    })

    it('at the waypoint cap, still ends at home saying what they found', () => {
      const s = setup(hilly, home, 26)
      const full = Array.from({ length: WAYPOINTS_MAX }, (_, i) => ({
        id: `mark${i}`,
        name: `Mark ${i}`,
        x: i,
        y: 0,
      }))
      s.world.waypoints[7] = full
      s.world.nodes.push({ ...gold })
      explore(s)
      expect(s.world.waypoints[7]).toEqual(full)
      expect([s.w1.x, s.w1.y]).toEqual([home.x, home.y])
      expect(logged(s.w1)).toContain(
        `no waypoint: you hold ${WAYPOINTS_MAX} waypoints already, the most`,
      )
      expect(logged(s.w1).at(-1)).toBe('found a Gold ore node at 500,820, no waypoint added')
      expect(events(s)).toEqual(['scriptStopped'])
    })
  })

  it('is for grown residents', () => {
    const s = setup(terrain, home, 0)
    s.w1.bornAt = s.world.tick
    expect(give(s)).toMatchObject({ type: 'rejected', reason: 'children can’t explore' })
  })
})
