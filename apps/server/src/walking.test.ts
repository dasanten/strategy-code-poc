import {
  DIAGONAL_STEP,
  Terrain,
  WALK_TICKS_PER_TILE,
  isPassableTerrain,
  terrainAt,
  walkSpeed,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants, pathsAreSteps } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, f forest, ~ lake. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    '~': Terrain.Lake,
  }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const open = draw(Array.from({ length: 16 }, () => '.'.repeat(16)))

/** A world on `map` with one resident at (x, y) of the given Agility, owned by realm r1. */
function oneWalker(map: TerrainMap, x: number, y: number, agility = 10) {
  const world = createWorld(map)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x, y, tick: 0 })
  r.stats.agility = { base: agility, trained: 0 }
  world.residents.push(r)
  return { world, r }
}

function walkTo(r: Resident, x: number, y: number) {
  r.order = { kind: 'walkTo', target: { x, y }, path: null, progress: 0 }
}

/** Ticks until the resident stands on (x, y) or `max` runs out. */
function ticksUntil(
  world: WorldState,
  map: TerrainMap,
  r: Resident,
  x: number,
  y: number,
  max = 2000,
) {
  const walking = new Walking(map)
  for (let t = 1; t <= max; t++) {
    stepWorld(world, map, walking)
    if (r.x === x && r.y === y) return t
  }
  return Infinity
}

describe('walking', () => {
  it('takes about 30 s to walk a plains tile, unloaded, at average Agility', () => {
    const { world, r } = oneWalker(open, 2, 2)
    walkTo(r, 3, 2)
    const t = ticksUntil(world, open, r, 3, 2)
    expect(Math.abs(t - WALK_TICKS_PER_TILE)).toBeLessThanOrEqual(2)
    expect(r.order).toBeNull()
  })

  it('walks the whole path to the target, on passable tiles only, then stops', () => {
    const map = draw([
      '..........',
      '....~.....',
      '....~.....',
      '....~.....',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
    ])
    const { world, r } = oneWalker(map, 2, 2)
    walkTo(r, 6, 2)
    const walking = new Walking(map)
    const visited: string[] = []
    for (let t = 0; t < 400 && r.order; t++) {
      stepWorld(world, map, walking)
      expect(isPassableTerrain(terrainAt(map, r.x, r.y))).toBe(true)
      visited.push(`${r.x},${r.y}`)
    }
    expect([r.x, r.y]).toEqual([6, 2])
    expect(r.order).toBeNull()
    expect(new Set(visited).size).toBeGreaterThan(4)
  })

  it('is slower in forest and faster with high Agility', () => {
    const forest = draw(Array.from({ length: 16 }, () => 'f'.repeat(16)))
    const plains = ticksUntil(...walker(open, 10), 3, 2)
    const woods = ticksUntil(...walker(forest, 10), 3, 2)
    const nimble = ticksUntil(...walker(open, 20), 3, 2)
    expect(woods).toBeGreaterThan(plains * 1.3)
    expect(nimble).toBeLessThan(plains)
    // Agility softens the terrain's slowdown too.
    const r = oneWalker(forest, 0, 0, 20).r
    const s = oneWalker(forest, 0, 0, 10).r
    expect(walkSpeed(r, Terrain.Forest, 0) / walkSpeed(r, Terrain.Plains, 0)).toBeGreaterThan(
      walkSpeed(s, Terrain.Forest, 0) / walkSpeed(s, Terrain.Plains, 0),
    )
  })

  it('takes √2 times as long for a diagonal step as for a straight one', () => {
    const straight = ticksUntil(...walker(open, 10), 3, 2)
    const { world, r } = oneWalker(open, 2, 2)
    walkTo(r, 3, 3)
    const diagonal = ticksUntil(world, open, r, 3, 3)
    expect(Math.abs(diagonal - straight * DIAGONAL_STEP)).toBeLessThanOrEqual(2)
    expect(r.order).toBeNull()
  })

  it('takes a diagonal step only between two steppable tiles, using up √2 of progress', () => {
    const map = draw(['......', '......', '...~..', '......', '......', '......'])
    const { world, r } = oneWalker(map, 2, 2)
    const walking = new Walking(map)
    const step = (x: number, y: number, path: [number, number][]) => {
      r.order = { kind: 'walkTo', target: { x, y }, path, progress: 2 }
      return walking.resolve(world, [{ kind: 'step', residentId: r.id, to: { x, y } }])
    }
    // Past the lake's corner at (3, 2): refused, and a new path is found.
    expect(step(3, 3, [[3, 3]])).toBe(0)
    expect(r).toMatchObject({ x: 2, y: 2, order: { path: null, progress: 0 } })
    // The other way round is open.
    expect(
      step(1, 3, [
        [1, 3],
        [0, 3],
      ]),
    ).toBe(1)
    expect(r).toMatchObject({ x: 1, y: 3 })
    expect(r.order?.kind === 'walkTo' && r.order.progress).toBeCloseTo(2 - DIAGONAL_STEP)
    // Two tiles off is no step at all.
    expect(step(3, 5, [[3, 5]])).toBe(0)
    expect(r.order).toBeNull()
  })

  it('has an invariant that every step on a path is one to take', () => {
    const map = draw(['......', '......', '...~..', '......', '......', '......'])
    const { world, r } = oneWalker(map, 2, 2)
    const broken = (path: [number, number][]) => {
      r.order = { kind: 'walkTo', target: { x: 0, y: 0 }, path, progress: 0 }
      return pathsAreSteps.check(world, map).length > 0
    }
    expect(
      broken([
        [1, 1],
        [0, 0],
      ]),
    ).toBe(false)
    expect(broken([[3, 3]])).toBe(true) // past the lake's corner
    expect(
      broken([
        [2, 3],
        [2, 5],
      ]),
    ).toBe(true) // a leap
    expect(broken([[3, 2]])).toBe(true) // into the lake
    // A walk across open plains keeps it all the way.
    walkTo(r, 5, 5)
    const walking = new Walking(map)
    for (let t = 0; t < 600 && r.order; t++) {
      stepWorld(world, map, walking)
      expect(pathsAreSteps.check(world, map)).toEqual([])
    }
    expect([r.x, r.y]).toEqual([5, 5])
  })

  it('walks across a join of the map', () => {
    const { world, r } = oneWalker(open, 0, 5)
    walkTo(r, 15, 5)
    expect(ticksUntil(world, open, r, 15, 5)).toBeLessThan(WALK_TICKS_PER_TILE + 3)
  })

  it('drops an order whose target cannot be reached', () => {
    const map = draw(['....', '.~~.', '.~~.', '....'])
    const { world, r } = oneWalker(map, 0, 0)
    walkTo(r, 1, 1)
    stepWorld(world, map, new Walking(map))
    expect(r.order).toBeNull()
  })

  it('keeps a found path in the order, so walking goes on after a restart', () => {
    const { world, r } = oneWalker(open, 2, 2)
    walkTo(r, 8, 2)
    stepWorld(world, open, new Walking(open))
    expect(r.order?.path).toHaveLength(6)
    const saved = structuredClone(world)
    const again = saved.residents[0]!
    expect(ticksUntil(saved, open, again, 8, 2)).toBeLessThan(6 * WALK_TICKS_PER_TILE + 5)
  })
})

describe('walk-to order', () => {
  it('accepts an order for your own resident and applies it next tick', () => {
    const world = createWorld(open)
    // A starting city needs more room; this realm is made by hand.
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
    const r = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 1, y: 1, tick: 0 })
    world.residents.push(r)
    const queue = new OrderQueue()
    const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }
    const order = { kind: 'walkTo', residentId: 'w1', x: 4, y: 1 }
    expect(queue.receive(world, sender, 'q1', order)).toEqual({ type: 'ack', requestId: 'q1' })
    expect(r.order).toBeNull()
    queue.applyAll(world)
    expect(r.order).toEqual({ kind: 'walkTo', target: { x: 4, y: 1 }, path: null, progress: 0 })
  })

  it("rejects someone else's resident and targets that aren't tiles", () => {
    const map = open
    const world = createWorld(map)
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
    world.residents.push(newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 1, y: 1, tick: 0 }))
    const queue = new OrderQueue()
    const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
    const stranger = { userId: 8, account: { name: 'Tobin', isAdmin: false } }
    expect(
      queue.receive(world, stranger, 'a', { kind: 'walkTo', residentId: 'w1', x: 2, y: 2 }),
    ).toMatchObject({ type: 'rejected', reason: 'not one of your residents' })
    expect(
      queue.receive(world, me, 'b', { kind: 'walkTo', residentId: 'w1', x: 2.5, y: 2 }),
    ).toMatchObject({ type: 'rejected', reason: 'the target must be a tile' })
    expect(
      queue.receive(world, me, 'c', { kind: 'walkTo', residentId: 'nobody', x: 2, y: 2 }),
    ).toMatchObject({ type: 'rejected' })
  })

  it('keeps every invariant while walking', () => {
    const { world, r } = oneWalker(open, 3, 3)
    walkTo(r, 9, 9)
    const walking = new Walking(open)
    while (r.order) {
      stepWorld(world, open, walking)
      expect(checkInvariants(world, open)).toEqual([])
    }
    expect([r.x, r.y]).toEqual([9, 9])
  })
})

function walker(map: TerrainMap, agility: number): [WorldState, TerrainMap, Resident] {
  const { world, r } = oneWalker(map, 2, 2, agility)
  walkTo(r, 3, 2)
  return [world, map, r]
}
