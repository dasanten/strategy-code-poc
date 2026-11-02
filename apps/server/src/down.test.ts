import {
  MAX_HEALTH,
  Terrain,
  TICKS_PER_GAME_DAY,
  DOWN_DAYS,
  isDown,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attackOrder, resolveStrikes } from './combat.js'
import { eventsFor } from './events.js'
import { checkInvariants, deadLeaveLoot } from './invariants.js'
import { leadersServeNoOne } from './leader.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { DOWN_TICKS, downDoNothing, goDown, stepSurvival } from './survival.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 256, tiles: new Uint8Array(256 * 256).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** The invariants about Down and the dead (`CONTEXT.md`: Down, Loot, Leader). */
const DOWN_INVARIANTS = [downDoNothing, deadLeaveLoot, leadersServeNoOne]

/**
 * A world with realm r1 (Player 7, Leader a1, and Ana, a2) and realm r2 (Player 8, Leader b1)
 * standing next to each other.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  const leader = resident(world, 'a1', 'r1', 10, 10)
  const ana = resident(world, 'a2', 'r1', 10, 11)
  ana.name = 'Ana'
  const b = resident(world, 'b1', 'r2', 11, 10)
  return { world, leader, ana, b, queue: new OrderQueue(undefined, terrain) }
}

/** A grown resident at (x, y) with every stat 10 and no Agility, so they never dodge. */
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

/** Starves a resident to their last bit of health, with nothing to eat. */
function starving(r: Resident) {
  Object.assign(r, { hunger: 0, health: 0.0001, carried: {} })
}

/** Steps the world, keeping everyone but those named fed, and checks the Down invariants. */
function run(world: WorldState, ticks = 1, hungry: Resident[] = [], walking?: Walking) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) if (!hungry.includes(r)) r.hunger = 100
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain, DOWN_INVARIANTS)).toEqual([])
  }
}

describe('Down (`CONTEXT.md`: Down)', () => {
  it('lasts about one real day', () => {
    expect(DOWN_TICKS).toBe(DOWN_DAYS * TICKS_PER_GAME_DAY)
    // One tick is one real second.
    expect(DOWN_TICKS / 3600).toBeGreaterThan(20)
    expect(DOWN_TICKS / 3600).toBeLessThan(28)
  })

  it('puts a resident whose health hunger used up Down instead of killing them', () => {
    const { world, ana } = setup()
    starving(ana)
    ana.carried = { stone: 3 }
    const tick = world.tick
    run(world, 1, [ana])
    expect(world.residents).toContain(ana)
    expect(isDown(ana)).toBe(true)
    expect(ana.downUntil).toBe(tick + DOWN_TICKS)
    expect(ana.health).toBe(0)
    expect(ana.carried).toEqual({ stone: 3 })
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({
        kind: 'down',
        residentId: 'a2',
        name: 'Ana',
        until: ana.downUntil,
      }),
    )
    expect(eventsFor(world, 7).some((e) => e.kind === 'died')).toBe(false)
  })

  it('ends their order, script and queue, gets them off their horse and out of their army', () => {
    const { world, leader, ana } = setup()
    starving(ana)
    ana.order = { kind: 'walkTo', target: { x: 40, y: 11 }, path: null, progress: 0 }
    ana.script = { scriptId: 3, memory: {} }
    ana.queue = { realmId: 'r1', steps: [], current: 0, startedAt: null, repeat: false }
    ana.riding = 'h1'
    world.armies.push({
      id: 'army1',
      name: 'Guard',
      realmId: 'r1',
      memberIds: ['a1', 'a2'],
      order: null,
    })
    goDown(world, ana)
    expect(ana.order).toBeNull()
    expect(ana.script).toBeUndefined()
    expect(ana.queue).toBeUndefined()
    expect(ana.riding).toBeUndefined()
    expect(world.armies[0]!.memberIds).toEqual([leader.id])
    expect(checkInvariants(world, terrain, [downDoNothing])).toEqual([])
  })

  it('neither eats nor loses health while Down, and dies of hunger when the time is up', () => {
    const { world, ana } = setup()
    starving(ana)
    run(world, 1, [ana])
    // Food put in their hands isn't eaten while Down (Reviving is another rule).
    ana.carried = { food: 2 }
    run(world, 50, [ana])
    expect(ana.carried).toEqual({ food: 2 })
    expect(ana.hunger).toBe(0)
    expect(ana.health).toBe(0)
    world.tick = ana.downUntil! - 1
    run(world, 1, [ana])
    expect(world.residents).toContain(ana)
    run(world, 1, [ana])
    expect(world.residents).not.toContain(ana)
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'died', residentId: 'a2', cause: 'starved', leader: false }),
    )
    // What they held drops where they lay.
    expect(world.piles).toEqual([expect.objectContaining({ x: 10, y: 11, goods: { food: 2 } })])
  })

  it('refuses orders to a Down resident, in an army too', () => {
    const { world, ana, queue } = setup()
    goDown(world, ana)
    const walk = queue.receive(world, me, 'w', { kind: 'walkTo', residentId: 'a2', x: 20, y: 11 })
    expect(walk).toEqual({
      type: 'rejected',
      requestId: 'w',
      reason: 'Ana is Down and takes no orders',
    })
    const army = queue.receive(world, me, 'f', {
      kind: 'formArmy',
      name: 'Guard',
      residentIds: ['a1', 'a2'],
    })
    expect(army.type).toBe('rejected')
    queue.applyAll(world)
    expect(ana.order).toBeNull()
    expect(world.armies).toEqual([])
  })

  it('drops an order that came before they went Down', () => {
    const { world, ana, queue } = setup()
    const walk = queue.receive(world, me, 'w', { kind: 'walkTo', residentId: 'a2', x: 20, y: 11 })
    expect(walk.type).toBe('ack')
    goDown(world, ana)
    queue.applyAll(world)
    expect(ana.order).toBeNull()
  })

  it('keeps them lying still when the game gives them an order anyway', () => {
    const { world, ana } = setup()
    goDown(world, ana)
    // As a fight or an army would: an order set after they went Down.
    ana.order = { kind: 'walkTo', target: { x: 20, y: 11 }, path: null, progress: 0 }
    run(world, 5, [ana], new Walking(terrain))
    expect({ x: ana.x, y: ana.y }).toEqual({ x: 10, y: 11 })
    expect(ana.order).toBeNull()
  })

  it('keeps a Down Leader leading: the realm goes on until they die', () => {
    const { world, leader } = setup()
    starving(leader)
    run(world, 1, [leader])
    expect(isDown(leader)).toBe(true)
    expect(world.realms.map((r) => r.id)).toEqual(['r1', 'r2'])
    world.tick = leader.downUntil!
    const { ended } = stepSurvival(world, terrain)
    expect(ended.map((r) => r.id)).toEqual(['r1'])
  })

  it('still kills in a fight: wounds put nobody Down', () => {
    const { world, ana, b, queue } = setup()
    ana.health = 1
    queue.receive(world, { userId: 8, account: { name: 'Tobin', isAdmin: false } }, 'a', {
      kind: 'attack',
      residentId: b.id,
      targetId: ana.id,
    })
    queue.applyAll(world)
    for (let t = 0; t < 100 && world.residents.includes(ana); t++) run(world)
    expect(world.residents).not.toContain(ana)
    expect(world.residents.some((r) => isDown(r))).toBe(false)
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'died', residentId: 'a2', cause: 'killed' }),
    )
  })

  it('shows anyone in sight that they are Down, and when it ends only to those who see how they fare', () => {
    const { world, ana } = setup()
    goDown(world, ana)
    const theirs = entitiesInSight(world, terrain, 'r2').find((e) => e.id === 'a2')!
    expect(theirs).toMatchObject({ is: 'resident', down: true })
    expect(theirs).not.toHaveProperty('downUntil')
    const own = entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'a2')!
    expect(own).toMatchObject({ down: true, downUntil: ana.downUntil })
  })

  it('is caught by the invariant when someone Down does something or heals', () => {
    const { world, ana } = setup()
    goDown(world, ana)
    ana.order = { kind: 'walkTo', target: { x: 20, y: 11 }, path: null, progress: 0 }
    ana.health = MAX_HEALTH
    const found = checkInvariants(world, terrain, [downDoNothing]).map((v) => v.message)
    expect(found).toEqual([
      'resident a2 is Down but has a walkTo order',
      `resident a2 is Down but has health ${MAX_HEALTH}`,
    ])
  })
})

describe('Down is not safe (`CONTEXT.md`: Down, Crime)', () => {
  const tobin = { userId: 8, account: { name: 'Tobin', isAdmin: false } }
  const fromAna = { kind: 'resident', residentId: 'a2' } as const

  it('lets one of the same realm on the tile take what they carry, as from a pile', () => {
    const { world, leader, ana, queue } = setup()
    ana.carried = { stone: 3, food: 2 }
    goDown(world, ana)
    Object.assign(leader, { x: ana.x, y: ana.y })
    const order = { kind: 'pickUp', residentId: 'a1', spot: fromAna, goods: { stone: 2 } }
    expect(queue.receive(world, me, 'p', order).type).toBe('ack')
    queue.applyAll(world)
    run(world, 1, [ana])
    expect(leader.carried).toMatchObject({ stone: 2 })
    expect(ana.carried).toEqual({ stone: 1, food: 2 })
    expect(world.crimes).toEqual([])
  })

  it('makes taking from another realm’s Down resident theft', () => {
    const { world, ana, b, queue } = setup()
    ana.carried = { stone: 3 }
    goDown(world, ana)
    Object.assign(b, { x: ana.x, y: ana.y })
    const order = { kind: 'pickUp', residentId: 'b1', spot: fromAna, goods: { stone: 5 } }
    expect(queue.receive(world, tobin, 'p', order).type).toBe('ack')
    queue.applyAll(world)
    run(world, 1, [ana])
    expect(b.carried).toMatchObject({ stone: 3 })
    expect(ana.carried).toEqual({})
    expect(world.crimes).toEqual([
      expect.objectContaining({
        kind: 'theft',
        victimOrg: 'r1',
        victim: { residentId: 'a2', name: 'Ana' },
        goods: { stone: 3 },
        culprit: expect.objectContaining({ residentId: 'b1', org: 'r2' }),
      }),
    ])
    // Lying unconscious, Ana saw nothing; the Leader next to her did.
    expect(world.crimes[0]!.witnesses).toEqual(['a1'])
  })

  it('refuses taking from someone not Down or not on the tile, and putting goods on them', () => {
    const { world, leader, ana, b, queue } = setup()
    ana.carried = { stone: 3 }
    leader.carried = { wood: 1 }
    const take = (residentId: string, sender = me) =>
      queue.receive(world, sender, 't', {
        kind: 'pickUp',
        residentId,
        spot: fromAna,
        goods: { stone: 1 },
      })
    Object.assign(leader, { x: ana.x, y: ana.y })
    expect(take('a1')).toMatchObject({
      type: 'rejected',
      reason: 'nobody of that id lies Down on the resident’s tile',
    })
    goDown(world, ana)
    // b1 stands next to Ana, not on her tile.
    expect(take('b1', tobin)).toMatchObject({ type: 'rejected' })
    const put = queue.receive(world, me, 'd', {
      kind: 'drop',
      residentId: 'a1',
      spot: fromAna,
      goods: { wood: 1 },
    })
    expect(put).toMatchObject({ type: 'rejected', reason: 'goods can’t be put down on a resident' })
    expect(b.carried).toEqual({})
  })

  it('kills them with the first blow: lying Down, they can’t dodge', () => {
    const { world, ana, b } = setup()
    goDown(world, ana)
    // However nimble, someone Down doesn't dodge.
    ana.stats.agility = { base: 100, trained: 0 }
    Object.assign(b, { x: ana.x, y: ana.y, order: attackOrder(ana.id) })
    const { died } = resolveStrikes(world, [{ attackerId: b.id, targetId: ana.id }], terrain.size)
    expect(died).toEqual([ana])
    expect(world.residents).not.toContain(ana)
  })

  it('dies like anyone when attacked: killed, a crime, leaving what they carried', () => {
    const { world, ana, b, queue } = setup()
    ana.carried = { stone: 3 }
    goDown(world, ana)
    queue.receive(world, tobin, 'a', { kind: 'attack', residentId: b.id, targetId: ana.id })
    queue.applyAll(world)
    for (let t = 0; t < 100 && world.residents.includes(ana); t++) run(world, 1, [ana])
    expect(world.residents).not.toContain(ana)
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'died', residentId: 'a2', cause: 'killed', by: b.name }),
    )
    expect(world.crimes.map((c) => c.kind)).toEqual(['attack', 'killing'])
    expect(world.piles).toEqual([expect.objectContaining({ x: 10, y: 11, goods: { stone: 3 } })])
    expect(b.order).toBeNull()
  })
})
