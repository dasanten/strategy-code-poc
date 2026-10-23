import {
  MAX_HEALTH,
  STRIKE_TICKS,
  Terrain,
  WALL_DEFENCE,
  blowDamage,
  inContact,
  onOwnWall,
  tileIndex,
  wallMap,
  wallsKey,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attackOrder } from './combat.js'
import { checkInvariants, gatesSound } from './invariants.js'
import { OrderQueue } from './orders.js'
import { PathFinder, type PathOptions, type Point } from './pathfinding.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 512, tiles: new Uint8Array(512 * 512).fill(Terrain.Plains) }
const GATE = { x: 8, y: 11 }

/**
 * A world with realm r1 (Player 7) and r2 (Player 8), and r1's city: a ring of wall from (5, 5)
 * to (11, 11) with a gate in the middle of its south side, and its town hall in the middle.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 8, y: 8 })
  for (let i = 5; i <= 11; i++) {
    for (const [x, y] of [
      [i, 5],
      [i, 11],
      [5, i],
      [11, i],
    ] as const) {
      if (world.buildings.some((b) => b.x === x && b.y === y)) continue
      const kind = x === GATE.x && y === GATE.y ? 'gate' : 'wall'
      world.buildings.push({ id: `w${x}-${y}`, kind, cityId: 'c1', x, y })
    }
  }
  const gate = world.buildings.find((b) => b.kind === 'gate')!
  return { world, gate }
}

/** A resident at (x, y) with every stat 10 and no Agility, so they never dodge. */
function resident(world: WorldState, id: string, owner: string | null, x: number, y: number) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'intellect'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.stats.agility = { base: 0, trained: 0 }
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** The path from one tile to another for `realmId` on foot, or undefined when there is none. */
function path(world: WorldState, from: Point, to: Point, options: PathOptions = {}) {
  const finder = new PathFinder(terrain)
  finder.setWalls(wallMap(world, terrain))
  const result = finder.findPath(from, to, undefined, { onWalls: true, ...options })
  return result.status === 'found' ? result.path : undefined
}

const kindAt = (world: WorldState, [x, y]: Point) =>
  world.buildings.find((b) => b.x === x && b.y === y && b.kind !== 'townHall')?.kind

describe('walls and gates', () => {
  it('a ring of wall shuts in its inside', () => {
    const { world } = setup()
    const walls = wallMap(world, terrain)
    expect(walls.inside.size).toBe(25)
    expect(walls.inside.has(tileIndex(terrain.size, 8, 8))).toBe(true)
    expect(walls.inside.has(tileIndex(terrain.size, 8, 12))).toBe(false)
    expect(walls.tiles.get(tileIndex(terrain.size, GATE.x, GATE.y))?.realmId).toBe('r1')
  })

  it('paths go round walls and in only through an open gate', () => {
    const { world } = setup()
    const p = path(world, [8, 2], [8, 8], { realmId: 'r2' })!
    expect(p).toBeDefined()
    // In from the north, round the wall and through the gate in the south side.
    expect(p.map((t) => kindAt(world, t)).filter(Boolean)).toEqual(['gate'])
    expect(p).toContainEqual([GATE.x, GATE.y])
    expect(path(world, [8, 2], [5, 8], { realmId: 'r2' })).toBeUndefined()
  })

  it('a closed gate lets only its city’s realm through', () => {
    const { world, gate } = setup()
    gate.closed = true
    expect(path(world, [8, 14], [8, 8], { realmId: 'r2' })).toBeUndefined()
    expect(path(world, [8, 14], [8, 8], { realmId: null })).toBeUndefined()
    expect(path(world, [8, 14], [8, 8], { realmId: 'r1' })).toContainEqual([GATE.x, GATE.y])
  })

  it('the city’s realm goes up on its walls from inside, never over them', () => {
    const { world, gate } = setup()
    gate.closed = true
    // Onto the north wall from outside: in through the gate and up from inside.
    const up = path(world, [8, 2], [8, 5], { realmId: 'r1' })!
    expect(up).toContainEqual([GATE.x, GATE.y])
    expect(up.at(-2)).toEqual([8, 6])
    // From inside out to the north: down through the gate, never over the north wall.
    const out = path(world, [8, 7], [8, 2], { realmId: 'r1' })!
    expect(out).toContainEqual([GATE.x, GATE.y])
    expect(out.filter((t) => kindAt(world, t) === 'wall')).toEqual([])
    // Nobody else goes on them; nor does a carriage.
    expect(path(world, [8, 7], [8, 5], { realmId: 'r2' })).toBeUndefined()
    expect(path(world, [8, 7], [8, 5], { realmId: 'r1', onWalls: false })).toBeUndefined()
  })

  it('one stuck on a wall not theirs may climb down', () => {
    const { world } = setup()
    expect(path(world, [8, 5], [8, 2], { realmId: 'r2' })).toEqual([
      [8, 4],
      [8, 3],
      [8, 2],
    ])
  })

  it('an attacker comes into contact with a defender up on a wall', () => {
    const { world } = setup()
    const p = path(world, [8, 1], [8, 5], { realmId: 'r2', near: true })!
    expect(inContact(terrain.size, { x: p.at(-1)![0], y: p.at(-1)![1] }, { x: 8, y: 5 })).toBe(true)
    expect(p.at(-1)).toEqual([8, 4])
  })

  it('a walker finds a new way when a gate closes before them', () => {
    const { world, gate } = setup()
    const b = resident(world, 'b1', 'r2', 8, 14)
    const walking = new Walking(terrain)
    b.order = { kind: 'walkTo', target: { x: 8, y: 8 }, path: null, progress: 0 }
    walking.requestSteps(world)
    expect(b.order.path?.[0]).toEqual([8, 13])
    b.order.path = [
      [8, 12],
      [GATE.x, GATE.y],
    ]
    b.y = 12
    gate.closed = true
    walking.resolve(world, [{ kind: 'step', residentId: 'b1', to: { ...GATE } }])
    expect([b.x, b.y]).toEqual([8, 12])
    expect(b.order).toMatchObject({ kind: 'walkTo', path: null, progress: 0 })
    // With the gate shut there is no way in, so the order ends once the search has looked
    // everywhere, which on this map takes a few ticks.
    for (let i = 0; i < 20 && b.order; i++) walking.requestSteps(world)
    expect(b.order).toBeNull()
  })
})

describe('defending a wall', () => {
  it('a defender on their own wall takes only WALL_DEFENCE of a blow', () => {
    const { world } = setup()
    const a = resident(world, 'a1', 'r1', 8, 5)
    const b = resident(world, 'b1', 'r2', 8, 4)
    expect(onOwnWall(world, a)).toBe(true)
    expect(onOwnWall(world, b)).toBe(false)
    b.order = attackOrder('a1')
    const damage = blowDamage(b, a, world.tick)
    for (let i = 0; i < STRIKE_TICKS; i++) {
      for (const r of world.residents) r.hunger = 100
      stepWorld(world, terrain)
    }
    expect(a.health).toBeCloseTo(MAX_HEALTH - damage * WALL_DEFENCE, 0)
  })
})

describe('allies at walls and gates', () => {
  /** The setup world with r1 and r2 in one alliance. */
  function allied() {
    const s = setup()
    s.world.alliances.push({
      id: 'alliance-1',
      name: 'North',
      leaderId: 'r1',
      members: ['r1', 'r2'].map((realmId) => ({ realmId, joinedAt: 0, leaving: null })),
      invites: [],
      army: [],
    })
    return s
  }

  it('a member passes an ally’s closed gate', () => {
    const { world, gate } = allied()
    gate.closed = true
    expect(path(world, [8, 14], [8, 8], { realmId: 'r2' })).toContainEqual([GATE.x, GATE.y])
    expect(path(world, [8, 14], [8, 8], { realmId: null })).toBeUndefined()
  })

  it('a member goes up on an ally’s walls from inside, never over them', () => {
    const { world } = allied()
    const up = path(world, [8, 7], [8, 5], { realmId: 'r2' })!
    expect(up.at(-1)).toEqual([8, 5])
    expect(path(world, [8, 2], [8, 8], { realmId: 'r2' })).toContainEqual([GATE.x, GATE.y])
    expect(path(world, [8, 7], [8, 5], { realmId: 'r3' })).toBeUndefined()
  })

  it('a member on an ally’s wall defends as well as its own realm', () => {
    const { world } = allied()
    world.realms.push({ id: 'r3', userId: 9, leaderId: 'c1' })
    const b = resident(world, 'b1', 'r2', 8, 5)
    const c = resident(world, 'c1', 'r3', 8, 4)
    expect(onOwnWall(world, b)).toBe(true)
    c.order = attackOrder('b1')
    const damage = blowDamage(c, b, world.tick)
    for (let i = 0; i < STRIKE_TICKS; i++) {
      for (const r of world.residents) r.hunger = 100
      stepWorld(world, terrain)
    }
    expect(b.health).toBeCloseTo(MAX_HEALTH - damage * WALL_DEFENCE, 0)
  })

  it('the way changes when the alliance does', () => {
    const { world, gate } = allied()
    gate.closed = true
    const before = wallsKey(world)
    world.alliances[0]!.members.pop()
    expect(wallsKey(world)).not.toBe(before)
    expect(path(world, [8, 14], [8, 8], { realmId: 'r2' })).toBeUndefined()
  })

  it('only the city’s own realm opens and closes its gates', () => {
    const { world, gate } = allied()
    const queue = new OrderQueue(undefined, terrain)
    const ally = { userId: 8, account: { name: 'Tom', isAdmin: false } }
    const answer = queue.receive(world, ally, 'q', {
      kind: 'setGate',
      gateId: gate.id,
      open: false,
    })
    expect(answer).toMatchObject({ reason: 'not a gate of your cities' })
  })
})

describe('the gate order', () => {
  const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
  const them = { userId: 8, account: { name: 'Tom', isAdmin: false } }

  function send(world: WorldState, sender: typeof me, order: object) {
    const queue = new OrderQueue(undefined, terrain)
    const answer = queue.receive(world, sender, 'q', { kind: 'setGate', ...order })
    queue.applyAll(world)
    return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
  }

  it('the city’s realm opens and closes its gates', () => {
    const { world, gate } = setup()
    expect(send(world, me, { gateId: gate.id, open: false })).toBe('ack')
    expect(gate.closed).toBe(true)
    expect(checkInvariants(world, terrain, [gatesSound])).toEqual([])
    expect(send(world, me, { gateId: gate.id, open: true })).toBe('ack')
    expect(gate.closed).toBeUndefined()
  })

  it('only for a finished gate of one of your cities', () => {
    const { world, gate } = setup()
    expect(send(world, them, { gateId: gate.id, open: false })).toBe('not a gate of your cities')
    expect(send(world, me, { gateId: 'w5-5', open: false })).toBe('no such gate')
    expect(send(world, me, { gateId: gate.id })).toBe('say whether the gate should be open')
    gate.site = { delivered: {}, work: 0 }
    expect(send(world, me, { gateId: gate.id, open: false })).toBe('that gate is not finished yet')
    expect(gate.closed).toBeUndefined()
  })

  it('the invariant catches a closed building that is no finished gate', () => {
    const { world } = setup()
    const wall = world.buildings.find((b) => b.kind === 'wall') as Building
    wall.closed = true
    expect(checkInvariants(world, terrain, [gatesSound])).toHaveLength(1)
  })
})
