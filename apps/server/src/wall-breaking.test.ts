import {
  BROKEN_MATERIALS_RETURNED,
  BUILD_MATERIALS,
  CLIMB_TICKS,
  MAX_HEALTH,
  STRIKE_TICKS,
  Terrain,
  WALL_STRENGTH,
  attackPower,
  blowDamage,
  climbLanding,
  type Building,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attackOrder } from './combat.js'
import { tallyGoods, takeMade } from './goods-made.js'
import {
  checkInvariants,
  climbOrdersSound,
  goodsOnlyFromNothingAtTheFloor,
  wallDamageSound,
} from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 128, tiles: new Uint8Array(128 * 128).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const them = { userId: 8, account: { name: 'Tom', isAdmin: false } }

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
      const kind = x === 8 && y === 11 ? 'gate' : 'wall'
      world.buildings.push({ id: `w${x}-${y}`, kind, cityId: 'c1', x, y })
    }
  }
  const wall = world.buildings.find((b) => b.id === 'w8-5')!
  return { world, wall }
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

/** Sends an order from `sender` and applies it; 'ack' or the reason it was refused. */
function send(world: WorldState, sender: typeof me, order: object) {
  const queue = new OrderQueue(undefined, terrain)
  const answer = queue.receive(world, sender, 'q', order)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world `n` ticks with nobody hungry, checking the wall invariants after each. */
function run(world: WorldState, n: number, walking?: Walking) {
  for (let i = 0; i < n; i++) {
    for (const r of world.residents) r.hunger = 100
    const goods = tallyGoods(world)
    takeMade(world)
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain, [wallDamageSound, climbOrdersSound])).toEqual([])
    // What a broken wall leaves counts as made, not as from nothing.
    expect(goodsOnlyFromNothingAtTheFloor(goods, world, takeMade(world))).toEqual([])
  }
}

const standing = (world: WorldState, id: string) => world.buildings.some((b) => b.id === id)

describe('breaking a wall', () => {
  it('a broken wall falls and leaves part of its materials', () => {
    const { world, wall } = setup()
    resident(world, 'a1', 'r1', 8, 8)
    const b = resident(world, 'b1', 'r2', 8, 2)
    expect(send(world, them, { kind: 'attack', residentId: 'b1', targetId: wall.id })).toBe('ack')
    const walking = new Walking(terrain)
    // Walks up to the wall, then strikes it until it falls.
    const power = attackPower(b, world.tick)
    const blows = Math.ceil(WALL_STRENGTH.wall / power)
    run(world, 120, walking)
    expect(b).toMatchObject({ x: 8, y: 4 })
    expect(wall.damage).toBeGreaterThan(0)
    run(world, blows * STRIKE_TICKS, walking)
    expect(standing(world, wall.id)).toBe(false)
    expect(b.order).toBeNull()
    const wood = Math.floor(BUILD_MATERIALS.wall!.wood! * BROKEN_MATERIALS_RETURNED)
    expect(wood).toBeGreaterThan(0)
    expect(world.piles.find((p) => p.x === 8 && p.y === 5)?.goods).toEqual({ wood })
    // Breaking another realm's wall is a crime of tearing down.
    expect(world.crimes).toContainEqual(
      expect.objectContaining({ kind: 'tearDown', building: 'wall', victimOrg: 'r1' }),
    )
    // The way in is open now.
    b.order = { kind: 'walkTo', target: { x: 8, y: 8 }, path: null, progress: 0 }
    run(world, 200, walking)
    expect(b).toMatchObject({ x: 8, y: 8 })
  })

  it('each blow lands with the attacker’s power; a gate holds out longer', () => {
    const { world, wall } = setup()
    const gate = world.buildings.find((x) => x.kind === 'gate')!
    const b = resident(world, 'b1', 'r2', 8, 4)
    b.stats.agility = { base: 50, trained: 0 }
    b.order = attackOrder(wall.id)
    run(world, STRIKE_TICKS)
    expect(wall.damage).toBeCloseTo(attackPower(b, 0), 6)
    expect(WALL_STRENGTH.gate).toBeGreaterThan(WALL_STRENGTH.wall)
    b.y = 12
    b.order = attackOrder(gate.id)
    run(world, STRIKE_TICKS)
    expect(gate.damage).toBeGreaterThan(0)
  })

  it('nobody breaks their own realm’s walls, and only finished walls', () => {
    const { world, wall } = setup()
    resident(world, 'a1', 'r1', 8, 4)
    resident(world, 'b1', 'r2', 9, 4)
    expect(send(world, me, { kind: 'attack', residentId: 'a1', targetId: wall.id })).toBe(
      'that is one of your own walls',
    )
    expect(send(world, them, { kind: 'attack', residentId: 'b1', targetId: 'c1-hall' })).toBe(
      'no such wall or gate',
    )
    wall.site = { delivered: {}, work: 0 }
    expect(send(world, them, { kind: 'attack', residentId: 'b1', targetId: wall.id })).toBe(
      'that wall is not finished yet',
    )
  })

  it('the invariant catches damage on what is no wall, or more than a wall takes', () => {
    const { world, wall } = setup()
    const hall = world.buildings.find((b) => b.kind === 'townHall') as Building
    hall.damage = 1
    wall.damage = WALL_STRENGTH.wall
    expect(checkInvariants(world, terrain, [wallDamageSound])).toHaveLength(2)
  })
})

describe('climbing a wall', () => {
  it('climbing takes time, and the climber comes down on the far side', () => {
    const { world, wall } = setup()
    const b = resident(world, 'b1', 'r2', 8, 4)
    expect(send(world, them, { kind: 'climb', residentId: 'b1', wallId: wall.id })).toBe('ack')
    run(world, CLIMB_TICKS - 1)
    expect(b).toMatchObject({ x: 8, y: 4, order: { kind: 'climb' } })
    run(world, 1)
    expect(b).toMatchObject({ x: 8, y: 6, order: null })
  })

  it('a climber can’t defend themselves', () => {
    const { world, wall } = setup()
    const a = resident(world, 'a1', 'r1', 9, 5)
    a.carried.sword = 1
    const b = resident(world, 'b1', 'r2', 8, 4)
    // However agile and well armed, a climber neither dodges nor strikes back.
    b.stats.agility = { base: 100, trained: 0 }
    b.carried.sword = 1
    b.order = { kind: 'climb', wallId: wall.id, at: { x: 8, y: 4 }, progress: 0 }
    a.order = attackOrder('b1')
    const blows = 5
    const damage = blowDamage(a, b, 0)
    run(world, blows * STRIKE_TICKS)
    expect(b.health).toBeCloseTo(MAX_HEALTH - blows * damage, 0)
    expect(b.order).toMatchObject({ kind: 'climb' })
    expect(a.health).toBe(MAX_HEALTH)
  })

  it('only next to a wall of another realm', () => {
    const { world, wall } = setup()
    resident(world, 'a1', 'r1', 8, 4)
    resident(world, 'b1', 'r2', 8, 3)
    expect(send(world, me, { kind: 'climb', residentId: 'a1', wallId: wall.id })).toBe(
      'that is one of your own walls',
    )
    expect(send(world, them, { kind: 'climb', residentId: 'b1', wallId: wall.id })).toBe(
      'stand next to the wall to climb it',
    )
    expect(send(world, them, { kind: 'climb', residentId: 'b1', wallId: 'c1-hall' })).toBe(
      'no such wall or gate',
    )
  })

  it('a climber who leaves their tile or loses their wall stops', () => {
    const { world, wall } = setup()
    const b = resident(world, 'b1', 'r2', 8, 4)
    b.order = { kind: 'climb', wallId: wall.id, at: { x: 8, y: 4 }, progress: 0.5 }
    world.buildings = world.buildings.filter((x) => x !== wall)
    run(world, 1)
    expect(b).toMatchObject({ x: 8, y: 4, order: null })
  })

  it('with no room beyond, the climber ends up on the wall', () => {
    const { world, wall } = setup()
    world.buildings.push({ id: 'w8-6', kind: 'wall', cityId: 'c1', x: 8, y: 6 })
    expect(climbLanding(world, terrain, { x: 8, y: 4 }, wall)).toEqual({ x: 8, y: 5 })
    expect(climbLanding(world, terrain, { x: 7, y: 4 }, { x: 7, y: 5 })).toEqual({ x: 7, y: 6 })
  })

  it('the invariant catches a climber away from their tile', () => {
    const { world, wall } = setup()
    const b = resident(world, 'b1', 'r2', 8, 3)
    b.order = { kind: 'climb', wallId: wall.id, at: { x: 8, y: 4 }, progress: 0 }
    expect(checkInvariants(world, terrain, [climbOrdersSound])).toHaveLength(1)
  })
})
