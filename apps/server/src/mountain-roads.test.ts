import {
  AVERAGE_HORSE_STATS,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  teardownWork,
  terrainAt,
  type Building,
  type Carriage,
  type Horse,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { dropGoods } from './survival.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Carriages and riders cross Mountain on a finished road (`CONTEXT.md`: Road, Step, Carriage,
 * Riding), and only there.
 */

/** A square map drawn as text (sides join): . plains, ^ mountain. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = { '.': Terrain.Plains, '^': Terrain.Mountain }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

/**
 * Ridges of Mountain right across the map at y = 6 and y = 13, with no pass: the sides join, so
 * between them lies a closed strip.
 */
const ridge = draw(
  Array.from({ length: 16 }, (_, y) => (y === 6 || y === 13 ? '^' : '.').repeat(16)),
)
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world on `map` with realm r1 (Player 7, Leader w1) and, at (x, y), w1, carriage k1 of r1 and
 * horse h1 of r1, not yet hitched.
 */
function setup(map: TerrainMap, x = 2, y = 2) {
  const world = createWorld(map)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x, y, tick: 0 })
  world.residents.push(w1)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x,
    y,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(horse)
  const carriage: Carriage = {
    id: 'k1',
    realmId: 'r1',
    cityId: null,
    x,
    y,
    horseId: null,
    load: {},
  }
  world.carriages.push(carriage)
  return { world, w1, horse, carriage }
}

/** A finished road on (x, y), or a road site with `site`. */
function road(world: WorldState, x: number, y: number, site = false): Building {
  const b: Building = { id: `road-${x}-${y}`, kind: 'road', cityId: null, x, y }
  if (site) b.site = { delivered: {}, work: 0 }
  world.buildings.push(b)
  return b
}

function order(world: WorldState, map: TerrainMap, o: object) {
  const q = new OrderQueue(undefined, map)
  return q.receive(world, me, 'q', o as { kind: string })
}

/**
 * Steps the world until `r`'s order is done or `max` ticks pass, checking the invariants every
 * tick; returns every tile `r` stood on.
 */
function run(world: WorldState, map: TerrainMap, r: Resident, max = 20000): [number, number][] {
  const walking = new Walking(map)
  const tiles: [number, number][] = [[r.x, r.y]]
  for (let t = 0; t < max && r.order; t++) {
    stepWorld(world, map, walking)
    expect(checkInvariants(world, map)).toEqual([])
    const last = tiles.at(-1)!
    if (last[0] !== r.x || last[1] !== r.y) tiles.push([r.x, r.y])
  }
  return tiles
}

describe('a carriage on a mountain road', () => {
  it('may be driven to a road over Mountain, not to bare Mountain or a road site there', () => {
    const { world } = setup(ridge)
    road(world, 2, 6)
    road(world, 5, 6, true)
    const drive = (x: number) =>
      order(world, ridge, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x, y: 6 })
    expect(drive(2)).toMatchObject({ type: 'ack' })
    expect(drive(3)).toMatchObject({ reason: 'a carriage can’t go there' })
    expect(drive(5)).toMatchObject({ reason: 'a carriage can’t go there' })
  })

  it('finds and drives a way over the road; without it there is no way', () => {
    const { world, w1, carriage } = setup(ridge)
    w1.order = { kind: 'drive', carriageId: 'k1', target: { x: 2, y: 10 }, path: null, progress: 0 }
    run(world, ridge, w1)
    expect([carriage.x, carriage.y]).toEqual([2, 2])

    const crossing = setup(ridge)
    road(crossing.world, 9, 6)
    const d = crossing.w1
    d.order = { kind: 'drive', carriageId: 'k1', target: { x: 2, y: 10 }, path: null, progress: 0 }
    const tiles = run(crossing.world, ridge, d)
    expect([crossing.carriage.x, crossing.carriage.y]).toEqual([2, 10])
    // Over the ridge only by the road.
    expect(tiles.filter(([, y]) => y === 6)).toEqual([[9, 6]])
  })

  it('goes round to a pass when that is the only way, never onto bare Mountain', () => {
    // A pass at x = 12 and a road at x = 9; drive with the road gone and it takes the pass.
    const map = draw(
      Array.from({ length: 16 }, (_, y) =>
        y === 6 ? '^'.repeat(12) + '.' + '^'.repeat(3) : (y === 13 ? '^' : '.').repeat(16),
      ),
    )
    const { world, w1, carriage } = setup(map, 9, 2)
    w1.order = { kind: 'drive', carriageId: 'k1', target: { x: 9, y: 10 }, path: null, progress: 0 }
    const tiles = run(world, map, w1)
    expect([carriage.x, carriage.y]).toEqual([9, 10])
    expect(tiles.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
  })

  it('hauls over the road (`CONTEXT.md`: Haul route)', () => {
    const { world, w1, carriage } = setup(ridge)
    road(world, 2, 6)
    dropGoods(world, 2, 2, { ironOre: 20 })
    const haul = (y: number, q = new OrderQueue(undefined, ridge)) =>
      q.receive(world, me, 'q', {
        kind: 'haul',
        residentId: 'w1',
        carriageId: 'k1',
        x: 2,
        y,
        goods: ['ironOre'],
        keepFood: 0,
      })
    expect(haul(13)).toMatchObject({ reason: 'a carriage can’t go there' })
    expect(haul(6)).toMatchObject({ type: 'ack' })
    const q = new OrderQueue(undefined, ridge)
    expect(haul(10, q)).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    expect(w1.order?.kind).toBe('haul')
    const walking = new Walking(ridge)
    for (let t = 0; t < 20000 && carriage.y !== 10; t++) {
      stepWorld(world, ridge, walking)
      expect(checkInvariants(world, ridge)).toEqual([])
      if (carriage.y === 6) expect(carriage.x).toBe(2)
    }
    expect([carriage.x, carriage.y]).toEqual([2, 10])
  })

  it('steps diagonally past a mountain road, but not past bare Mountain', () => {
    // From (2, 2) to (3, 3) with Mountain on (3, 2), plains on (2, 3).
    const rows = Array.from({ length: 16 }, () => '.'.repeat(16))
    rows[2] = '...^' + '.'.repeat(12)
    const map = draw(rows)
    const steps = (withRoad: boolean) => {
      const { world, w1 } = setup(map)
      if (withRoad) road(world, 3, 2)
      w1.order = {
        kind: 'drive',
        carriageId: 'k1',
        target: { x: 3, y: 3 },
        path: null,
        progress: 0,
      }
      return run(world, map, w1).slice(1)
    }
    expect(steps(true)).toEqual([[3, 3]])
    expect(steps(false)).toEqual([
      [2, 3],
      [3, 3],
    ])
  })

  it('finds a new way when the road under its path is gone', () => {
    const map = draw(
      Array.from({ length: 16 }, (_, y) =>
        y === 6 ? '^'.repeat(12) + '.' + '^'.repeat(3) : (y === 13 ? '^' : '.').repeat(16),
      ),
    )
    const { world, w1, carriage } = setup(map, 9, 2)
    const b = road(world, 9, 6)
    w1.order = { kind: 'drive', carriageId: 'k1', target: { x: 9, y: 10 }, path: null, progress: 0 }
    const walking = new Walking(map)
    while (carriage.y < 4) stepWorld(world, map, walking)
    world.buildings = world.buildings.filter((x) => x !== b)
    const tiles = run(world, map, w1)
    expect([carriage.x, carriage.y]).toEqual([9, 10])
    expect(tiles.some(([x, y]) => terrainAt(map, x, y) === Terrain.Mountain)).toBe(false)
  })
})

describe('a rider on a mountain road', () => {
  it('crosses the ridge by the road, and may be sent onto it but not onto bare Mountain', () => {
    const { world, w1, horse } = setup(ridge)
    world.carriages = []
    w1.riding = 'h1'
    road(world, 7, 6)
    const walkTo = (x: number, y: number) =>
      order(world, ridge, { kind: 'walkTo', residentId: 'w1', x, y })
    expect(walkTo(7, 6)).toMatchObject({ type: 'ack' })
    expect(walkTo(2, 6)).toMatchObject({ reason: 'a horse can’t go there' })
    w1.order = { kind: 'walkTo', target: { x: 2, y: 10 }, path: null, progress: 0 }
    const tiles = run(world, ridge, w1)
    expect([w1.x, w1.y, horse.x, horse.y]).toEqual([2, 10, 2, 10])
    expect(w1.riding).toBe('h1')
    expect(tiles.filter(([, y]) => y === 6)).toEqual([[7, 6]])
  })
})

describe('tearing down a mountain road (`CONTEXT.md`: Tearing down)', () => {
  it('waits for the carriages and horses on it to leave', () => {
    const { world, w1, horse, carriage } = setup(ridge, 4, 6)
    const b = road(world, 4, 6)
    const tearDown = () =>
      order(world, ridge, { kind: 'tearDown', residentId: 'w1', buildingId: b.id })
    expect(tearDown()).toMatchObject({
      reason: 'a carriage or horse on this mountain road would be stranded',
    })
    carriage.x = 4
    carriage.y = 5
    expect(tearDown()).toMatchObject({
      reason: 'a carriage or horse on this mountain road would be stranded',
    })
    horse.y = 5
    expect(tearDown()).toMatchObject({ type: 'ack' })

    // Started with nobody there; a horse comes onto it before the work is done, and the work
    // waits for it to leave.
    w1.order = { kind: 'tearDown', buildingId: b.id, at: { x: 4, y: 6 } }
    const walking = new Walking(ridge)
    stepWorld(world, ridge, walking)
    const done = b.teardown!
    expect(done).toBeGreaterThan(0)
    horse.y = 6
    for (let t = 0; t < 100; t++) stepWorld(world, ridge, walking)
    expect(b.teardown).toBe(done)
    expect(world.buildings).toContain(b)
    expect(w1.order?.kind).toBe('tearDown')
    expect(checkInvariants(world, ridge)).toEqual([])
    horse.y = 5
    for (let t = 0; t < 20000 && w1.order; t++) stepWorld(world, ridge, walking)
    expect(world.buildings).not.toContain(b)
    expect(teardownWork(b)).toBeGreaterThan(done)

    // A road on plains comes down whoever stands on it.
    const plains = road(world, 4, 5)
    expect(
      order(world, ridge, { kind: 'tearDown', residentId: 'w1', buildingId: plains.id }),
    ).toMatchObject({ reason: 'the resident is not at that building' })
    w1.y = 5
    expect(
      order(world, ridge, { kind: 'tearDown', residentId: 'w1', buildingId: plains.id }),
    ).toMatchObject({ type: 'ack' })
  })
})

describe('the invariants (ADR 0004)', () => {
  it('flag a carriage or ridden horse on Mountain without a finished road', () => {
    const { world, w1 } = setup(ridge, 4, 6)
    world.carriages[0]!.horseId = null
    const names = () => checkInvariants(world, ridge).map((v) => v.invariant)
    expect(names()).toContain('carriages-in-place')
    road(world, 4, 6, true)
    expect(names()).toContain('carriages-in-place')
    world.buildings[0]!.site = undefined
    expect(names()).toEqual([])

    world.buildings = []
    world.carriages = []
    w1.riding = 'h1'
    expect(names()).toContain('riders-on-horses')
    road(world, 4, 6)
    expect(names()).toEqual([])
  })
})
