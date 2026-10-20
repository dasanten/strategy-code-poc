import { ARMY_SPREAD, Terrain, wrapDistance, type TerrainMap, type WorldState } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { armiesSound } from './armies.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world with realm r1 (Player 7, Leader a1) and realm r2 (Player 8, Leader b1). */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  resident(world, 'a1', 'r1', 10, 10)
  resident(world, 'b1', 'r2', 30, 30)
  return { world, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

/** A grown resident at (x, y) with every stat 10, or `agility` for Agility. */
function resident(
  world: WorldState,
  id: string,
  owner: string,
  x: number,
  y: number,
  agility = 10,
) {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  for (const s of ['strength', 'endurance', 'intellect'] as const)
    r.stats[s] = { base: 10, trained: 0 }
  r.stats.agility = { base: agility, trained: 0 }
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** Sends an order from Player 7, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, me, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world, keeping residents fed, and checks every invariant each tick. */
function run(world: WorldState, walking: Walking, ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

describe('armies', () => {
  it('forms an army of the realm’s own residents only', () => {
    const { world, queue } = setup()
    resident(world, 'a2', 'r1', 10, 11)
    expect(order(world, queue, { kind: 'formArmy', name: ' ', residentIds: ['a2'] })).toBe(
      'the army needs a name',
    )
    expect(order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['b1'] })).toBe(
      'not all of them are your residents',
    )
    expect(order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['a2'] })).toBe('ack')
    expect(world.armies).toEqual([
      { id: expect.any(String), name: 'Foot', realmId: 'r1', memberIds: ['a2'], order: null },
    ])
    // Joining a new army takes them out of the old one, which is gone with nobody left.
    expect(order(world, queue, { kind: 'formArmy', name: 'Horse', residentIds: ['a2'] })).toBe(
      'ack',
    )
    expect(world.armies.map((a) => a.name)).toEqual(['Horse'])
    expect(checkInvariants(world, terrain, [armiesSound])).toEqual([])
  })

  it('moves at the pace of its slowest and keeps together', () => {
    const { world, queue, walking } = setup()
    resident(world, 'fast', 'r1', 10, 12, 25)
    resident(world, 'slow', 'r1', 10, 12, 1)
    // On their own, the fast one gets there well before the slow one.
    const alone = structuredClone(world)
    order(alone, queue, { kind: 'walkTo', residentId: 'fast', x: 20, y: 12 })
    order(alone, queue, { kind: 'walkTo', residentId: 'slow', x: 20, y: 12 })
    const arrivals = (w: WorldState, walk: Walking) => {
      const got: Record<string, number> = {}
      for (let t = 1; t <= 1000 && Object.keys(got).length < 2; t++) {
        run(w, walk)
        for (const id of ['fast', 'slow']) {
          if (!got[id] && at(w, id).x === 20) got[id] = t
        }
        const gap = wrapDistance(terrain.size, at(w, 'fast'), at(w, 'slow'))
        if (w !== alone) expect(gap).toBeLessThanOrEqual(ARMY_SPREAD + 1)
      }
      return got
    }
    const apart = arrivals(alone, new Walking(terrain))
    expect(apart.slow! - apart.fast!).toBeGreaterThan(50)

    order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['fast', 'slow'] })
    expect(
      order(world, queue, { kind: 'armyWalkTo', armyId: world.armies[0]!.id, x: 20, y: 12 }),
    ).toBe('ack')
    const together = arrivals(world, walking)
    // The army arrives when its slowest does, and its fast member barely before.
    expect(together.slow).toBeLessThanOrEqual(apart.slow! + 5)
    expect(together.slow! - together.fast!).toBeLessThan(apart.slow! - apart.fast!)
    run(world, walking)
    expect(world.armies[0]!.order).toBeNull()
  })

  it('loses a resident who is given an order of their own', () => {
    const { world, queue, walking } = setup()
    resident(world, 'a2', 'r1', 10, 12)
    resident(world, 'a3', 'r1', 10, 13)
    order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['a2', 'a3'] })
    const army = world.armies[0]!
    order(world, queue, { kind: 'armyWalkTo', armyId: army.id, x: 20, y: 12 })
    run(world, walking, 3)
    expect(at(world, 'a2').order).toMatchObject({ kind: 'walkTo', army: army.id })
    order(world, queue, { kind: 'walkTo', residentId: 'a2', x: 5, y: 5 })
    expect(world.armies[0]!.memberIds).toEqual(['a3'])
    expect(at(world, 'a2').order).toMatchObject({ kind: 'walkTo', target: { x: 5, y: 5 } })
    expect(at(world, 'a2').order).not.toHaveProperty('army')
    run(world, walking)
    // The last member leaving ends the army.
    order(world, queue, { kind: 'stop', residentId: 'a3' })
    expect(world.armies).toEqual([])
  })

  it('attacks a resident in sight together, but not one of its own', () => {
    const { world, queue, walking } = setup()
    resident(world, 'a2', 'r1', 28, 28)
    resident(world, 'a3', 'r1', 28, 29)
    order(world, queue, { kind: 'formArmy', name: 'Foot', residentIds: ['a2', 'a3'] })
    const armyId = world.armies[0]!.id
    expect(order(world, queue, { kind: 'armyAttack', armyId, targetId: 'a1' })).toBe(
      'that is one of your own residents',
    )
    expect(order(world, queue, { kind: 'armyAttack', armyId, targetId: 'b1' })).toBe('ack')
    run(world, walking)
    for (const id of ['a2', 'a3'])
      expect(at(world, id).order).toMatchObject({ kind: 'attack', targetId: 'b1', army: armyId })
    run(world, walking, 400)
    expect(world.residents.some((r) => r.id === 'b1')).toBe(false)
    run(world, walking)
    expect(world.armies[0]!.order).toBeNull()
  })

  it('guards a tile: a member who wandered off and is idle walks back', () => {
    const { world, queue, walking } = setup()
    resident(world, 'a2', 'r1', 10, 12)
    resident(world, 'a3', 'r1', 11, 12)
    order(world, queue, { kind: 'formArmy', name: 'Watch', residentIds: ['a2', 'a3'] })
    const armyId = world.armies[0]!.id
    order(world, queue, { kind: 'armyGuard', armyId, x: 14, y: 12 })
    run(world, walking, 300)
    for (const id of ['a2', 'a3']) expect(at(world, id)).toMatchObject({ x: 14, y: 12 })
    at(world, 'a3').x = 12
    run(world, walking, 150)
    expect(at(world, 'a3')).toMatchObject({ x: 14, y: 12 })
    expect(world.armies[0]!.order).toMatchObject({ kind: 'guard' })
  })

  it('follows a resident wherever they go, and stops once they are gone', () => {
    const { world, queue, walking } = setup()
    resident(world, 'a2', 'r1', 10, 12)
    resident(world, 'a3', 'r1', 10, 13)
    order(world, queue, { kind: 'formArmy', name: 'Guard', residentIds: ['a2', 'a3'] })
    const armyId = world.armies[0]!.id
    expect(order(world, queue, { kind: 'armyFollow', armyId, targetId: 'a2' })).toBe(
      'that is one of the army',
    )
    expect(order(world, queue, { kind: 'armyFollow', armyId, targetId: 'a1' })).toBe('ack')
    order(world, queue, { kind: 'walkTo', residentId: 'a1', x: 16, y: 10 })
    run(world, walking, 400)
    for (const id of ['a2', 'a3'])
      expect(wrapDistance(terrain.size, at(world, id), at(world, 'a1'))).toBeLessThanOrEqual(1.5)
    world.residents = world.residents.filter((r) => r.id !== 'a1')
    world.realms[0]!.leaderId = 'a2'
    run(world, walking)
    expect(world.armies[0]!.order).toBeNull()
  })

  it('flags an army with a member of another realm', () => {
    const { world } = setup()
    world.armies.push({ id: 'army1', name: 'X', realmId: 'r1', memberIds: ['b1'], order: null })
    expect(checkInvariants(world, terrain, [armiesSound]).map((v) => v.message)).toEqual([
      'army army1 has member b1 of another realm',
    ])
  })
})
