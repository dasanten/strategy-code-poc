import {
  AVERAGE_HORSE_STATS,
  HORSE_HUNGRY_SHARE,
  HUNGRY_HORSE_PACE,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  driveSpeed,
  rideSpeed,
  walkSpeed,
  type Carriage,
  type Horse,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { walkTime } from './script-bindings.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, f forest, ^ mountain. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    '^': Terrain.Mountain,
  }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const open = draw(Array.from({ length: 24 }, () => '.'.repeat(24)))
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world on `map` with realm r1 (Player 7, Leader w1) and, at (2, 2), w1 and horse h1 of r1. */
function setup(map: TerrainMap) {
  const world = createWorld(map)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 2, y: 2, tick: 0 })
  world.residents.push(w1)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(horse)
  return { world, w1, horse }
}

/** Sends an order of the Player's and applies it, as the next tick would; returns the reply. */
function order(world: WorldState, map: TerrainMap, o: object) {
  const q = new OrderQueue(undefined, map)
  const reply = q.receive(world, me, 'q', o as { kind: string })
  q.applyAll(world)
  return reply
}

function walkTo(r: Resident, x: number, y: number) {
  r.order = { kind: 'walkTo', target: { x, y }, path: null, progress: 0 }
}

/** Steps the world until the resident's order is done or `max` ticks pass; returns the ticks. */
function walkOut(world: WorldState, map: TerrainMap, r: Resident, max = 5000) {
  const walking = new Walking(map)
  let t = 0
  while (r.order && t < max) {
    stepWorld(world, map, walking)
    expect(checkInvariants(world, map)).toEqual([])
    t++
  }
  return t
}

describe('the mount and dismount orders', () => {
  it('mount a horse of the realm on the resident’s tile, and leave it there on dismounting', () => {
    const { world, w1, horse } = setup(open)
    expect(order(world, open, { kind: 'mount', residentId: 'w1', horseId: 'h1' })).toEqual({
      type: 'ack',
      requestId: 'q',
    })
    expect(w1.riding).toBe('h1')
    walkTo(w1, 8, 2)
    walkOut(world, open, w1)
    expect([w1.x, w1.y, horse.x, horse.y]).toEqual([8, 2, 8, 2])
    expect(order(world, open, { kind: 'dismount', residentId: 'w1' })).toMatchObject({
      type: 'ack',
    })
    expect(w1.riding).toBeUndefined()
    walkTo(w1, 10, 2)
    walkOut(world, open, w1)
    expect([w1.x, horse.x]).toEqual([10, 8])
  })

  it('turn down a horse elsewhere, of another realm, hitched, or ridden by someone else', () => {
    const { world, w1, horse } = setup(open)
    const mount = () => order(world, open, { kind: 'mount', residentId: 'w1', horseId: 'h1' })
    expect(order(world, open, { kind: 'dismount', residentId: 'w1' })).toMatchObject({
      reason: 'not riding',
    })
    expect(order(world, open, { kind: 'mount', residentId: 'w1', horseId: 'nope' })).toMatchObject({
      reason: 'no such horse',
    })
    horse.x = 3
    expect(mount()).toMatchObject({ reason: 'that horse is not on the resident’s tile' })
    horse.x = 2
    horse.realmId = 'r2'
    expect(mount()).toMatchObject({ reason: 'not a horse of your realm' })
    horse.realmId = 'r1'
    const cart: Carriage = {
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 2,
      y: 2,
      horseId: 'h1',
      load: {},
    }
    world.carriages.push(cart)
    expect(mount()).toMatchObject({ reason: 'that horse is hitched to a carriage' })
    world.carriages = []
    const w2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 2, y: 2, tick: 0 })
    world.residents.push(w2)
    w2.riding = 'h1'
    expect(mount()).toMatchObject({ reason: 'someone else rides that horse' })
    expect(w1.riding).toBeUndefined()
  })

  it('keep a ridden horse from being hitched, and a rider from driving', () => {
    const { world, w1 } = setup(open)
    const cart: Carriage = {
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 2,
      y: 2,
      horseId: null,
      load: {},
    }
    world.carriages.push(cart)
    order(world, open, { kind: 'mount', residentId: 'w1', horseId: 'h1' })
    expect(w1.riding).toBe('h1')
    expect(
      order(world, open, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 8, y: 2 }),
    ).toMatchObject({ reason: 'dismount first to drive' })
    const w2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 2, y: 2, tick: 0 })
    world.residents.push(w2)
    expect(
      order(world, open, { kind: 'drive', residentId: 'w2', carriageId: 'k1', x: 8, y: 2 }),
    ).toMatchObject({ reason: 'no horse here to pull that carriage' })
    expect(cart.horseId).toBeNull()
  })
})

describe('riding', () => {
  it('crosses plains faster than walking, at the horse’s carriage pace', () => {
    const walker = setup(open)
    walkTo(walker.w1, 14, 2)
    const onFoot = walkOut(walker.world, open, walker.w1)

    const rider = setup(open)
    rider.w1.riding = 'h1'
    walkTo(rider.w1, 14, 2)
    const riding = walkOut(rider.world, open, rider.w1)
    expect([rider.w1.x, rider.horse.x]).toEqual([14, 14])
    expect(riding).toBeLessThan(onFoot * 0.6)
    expect(rideSpeed(rider.w1, rider.horse, Terrain.Plains)).toBeCloseTo(
      driveSpeed(rider.w1, rider.horse, Terrain.Plains),
    )
    expect(rideSpeed(rider.w1, rider.horse, Terrain.Plains)).toBeGreaterThan(
      walkSpeed(rider.w1, Terrain.Plains, 0),
    )
  })

  it('goes slower on a hungry horse', () => {
    const { w1, horse } = setup(open)
    const fed = rideSpeed(w1, horse, Terrain.Plains)
    horse.hunger = HORSE_HUNGRY_SHARE * MAX_HUNGER - 1
    expect(rideSpeed(w1, horse, Terrain.Plains)).toBeCloseTo(fed * HUNGRY_HORSE_PACE)
  })

  it('never enters the mountains, going round them instead', () => {
    // A ridge of mountains across the map with one gap at x = 20; the sides of the map join, so
    // the way round goes through the gap or over the top edge.
    const rows = Array.from({ length: 24 }, (_, y) =>
      y === 8
        ? '.'
            .repeat(24)
            .split('')
            .map((_, x) => (x === 20 ? '.' : '^'))
            .join('')
        : '.'.repeat(24),
    )
    const map = draw(rows)
    const { world, w1, horse } = setup(map)
    w1.riding = 'h1'
    expect(order(world, map, { kind: 'walkTo', residentId: 'w1', x: 2, y: 8 })).toMatchObject({
      reason: 'a horse can’t go there',
    })
    walkTo(w1, 2, 14)
    const seen = new Set<number>()
    const walking = new Walking(map)
    for (let t = 0; t < 5000 && w1.order; t++) {
      stepWorld(world, map, walking)
      seen.add(map.tiles[w1.y * map.size + w1.x]!)
    }
    expect([w1.x, w1.y, horse.x, horse.y]).toEqual([2, 14, 2, 14])
    expect(seen.has(Terrain.Mountain)).toBe(false)
    expect(w1.riding).toBe('h1')
  })

  it('trains Driving', () => {
    const { world, w1 } = setup(open)
    w1.riding = 'h1'
    walkTo(w1, 20, 2)
    walkOut(world, open, w1)
    expect(w1.skills.driving ?? 0).toBeGreaterThan(0)
  })

  it('reckons a rider’s walk time at the horse’s pace', () => {
    const { world, w1 } = setup(open)
    const a = { x: 2, y: 2 }
    const b = { x: 14, y: 2 }
    const onFoot = walkTime(world, open, () => true, w1, a, b)
    w1.riding = 'h1'
    expect(walkTime(world, open, () => true, w1, a, b)).toBeLessThan(onFoot)
  })

  it('ends when the rider leaves their horse behind or it is gone', () => {
    const { world, w1, horse } = setup(open)
    w1.riding = 'h1'
    w1.x = 5
    stepWorld(world, open)
    expect(w1.riding).toBeUndefined()
    expect([horse.x, horse.y]).toEqual([2, 2])
    w1.x = 2
    w1.riding = 'h1'
    world.horses = []
    stepWorld(world, open)
    expect(w1.riding).toBeUndefined()
    expect(checkInvariants(world, open)).toEqual([])
  })
})

describe('the riders-on-horses invariant', () => {
  it('catches a horse with two riders, a ridden horse hitched, and a rider apart from their horse', () => {
    const { world, w1 } = setup(open)
    const w2 = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 2, y: 2, tick: 0 })
    world.residents.push(w2)
    w1.riding = 'h1'
    w2.riding = 'h1'
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 2,
      y: 2,
      horseId: 'h1',
      load: {},
    })
    w2.x = 3
    const names = checkInvariants(world, open)
      .filter((v) => v.invariant === 'riders-on-horses')
      .map((v) => v.message)
    expect(names).toEqual([
      'horse h1 is ridden and hitched to k1',
      'resident w2 at (3, 2) rides horse h1 at (2, 2)',
      'horse h1 is ridden and hitched to k1',
      'horse h1 has two riders, w1 and w2',
    ])
  })
})
