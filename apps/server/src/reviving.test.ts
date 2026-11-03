import {
  MAX_HUNGER,
  Terrain,
  WAKE_HEALTH,
  feedProblem,
  isDown,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { awakeAlive, downDoNothing, goDown } from './survival.js'
import { defaultScripts } from './test-default-scripts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** Reviving (`CONTEXT.md`: Reviving): Feeding a Down resident wakes them. */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const other = { userId: 8, account: { name: 'Olaf', isAdmin: false } }

const INVARIANTS = [downDoNothing, awakeAlive]

/**
 * Realm r1 (Player 7) with Ana (a2), Down at (10, 10), and Ben (a3) next to her with Food; realm
 * r2 (Player 8) with Cid (b2) on Ana's tile. `library` holds Player 7's own scripts.
 */
function setup(library = new Map<number, RunnableScript>()) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  resident(world, 'a1', 'r1', 30, 30)
  resident(world, 'b1', 'r2', 40, 40)
  const ana = resident(world, 'a2', 'r1', 10, 10, 'Ana')
  const ben = resident(world, 'a3', 'r1', 11, 10, 'Ben')
  const cid = resident(world, 'b2', 'r2', 10, 10, 'Cid')
  ben.carried = { food: 6 }
  cid.carried = { food: 2 }
  Object.assign(ana, { hunger: 0, carried: { stone: 2 } })
  goDown(world, ana)
  const scripts = defaultScripts(terrain, [mara, other], library)
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => [mara, other].find((s) => s.userId === id) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  /** One tick as the game runs it, everyone but Ana kept fed. */
  const tick = () => {
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    for (const r of world.residents) if (r !== ana) r.hunger = MAX_HUNGER
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain, INVARIANTS)).toEqual([])
  }
  const give = (order: OrderRequest, sender = mara) => orders.receive(world, sender, 'q', order)
  return { world, ana, ben, cid, tick, give }
}

function resident(
  world: WorldState,
  id: string,
  owner: string,
  x: number,
  y: number,
  name = id,
): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.name = name
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

const feedAna = (units = 3) => ({ kind: 'feed', residentId: 'a3', targetId: 'a2', units })

describe('feed order', () => {
  it('wakes a Down resident at low health, idle, with a hunger meter that isn’t empty', () => {
    const s = setup()
    expect(s.give(feedAna())).toMatchObject({ type: 'ack' })
    s.tick()
    expect(isDown(s.ana)).toBe(false)
    expect(s.ana.health).toBeGreaterThan(0)
    expect(s.ana.health).toBeLessThanOrEqual(WAKE_HEALTH)
    expect(s.ana.hunger).toBeGreaterThan(0)
    expect(s.ana.order).toBeNull()
    // One unit eaten at once, the other two in her hands; Ben keeps the rest.
    expect(s.ana.carried).toEqual({ stone: 2, food: 2 })
    expect(s.ben.carried).toEqual({ food: 3 })
    expect(s.ben.order).toBeNull()
    expect(eventsFor(s.world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'woke', residentId: 'a2', name: 'Ana', by: 'Ben' }),
    )
    // Awake, she takes orders again.
    expect(s.give({ kind: 'walkTo', residentId: 'a2', x: 12, y: 12 })).toMatchObject({
      type: 'ack',
    })
  })

  it('gives no more than the Food in their hands', () => {
    const s = setup()
    s.give(feedAna(50))
    s.tick()
    expect(s.ben.carried.food).toBeUndefined()
    expect(s.ana.carried.food).toBe(5)
  })

  it('is refused from too far, by a child, without Food, or for someone not Down', () => {
    const s = setup()
    s.ben.x = 13
    expect(s.give(feedAna())).toMatchObject({
      type: 'rejected',
      reason: 'stand on or next to their tile to feed them',
    })
    s.ben.x = 11
    s.ben.bornAt = s.world.tick
    expect(s.give(feedAna())).toMatchObject({
      type: 'rejected',
      reason: 'children can’t feed others',
    })
    s.ben.bornAt = -20 * 24 * 3600
    s.ben.carried = { wood: 3 }
    expect(s.give(feedAna())).toMatchObject({ type: 'rejected', reason: 'no Food in hand' })
    s.ben.carried = { food: 3 }
    expect(s.give({ ...feedAna(), targetId: 'b2' })).toMatchObject({
      type: 'rejected',
      reason: 'nobody Down there to feed',
    })
    expect(s.give(feedAna(0))).toMatchObject({ type: 'rejected' })
    expect(s.give(feedAna(1.5))).toMatchObject({ type: 'rejected' })
    // Someone Down feeds nobody: they take no orders.
    expect(s.give({ kind: 'feed', residentId: 'a2', targetId: 'a2', units: 1 })).toMatchObject({
      type: 'rejected',
    })
  })

  it('does nothing once the feeder has walked away or the Food is gone', () => {
    const s = setup()
    s.give(feedAna())
    s.ben.carried = {}
    s.tick()
    expect(isDown(s.ana)).toBe(true)
    expect(s.ben.order).toBeNull()
  })

  it('lets another realm’s resident feed them', () => {
    const s = setup()
    expect(
      s.give({ kind: 'feed', residentId: 'b2', targetId: 'a2', units: 1 }, other),
    ).toMatchObject({ type: 'ack' })
    s.tick()
    expect(isDown(s.ana)).toBe(false)
    expect(s.cid.carried).toEqual({ food: 1 })
    // Ana's Player hears of it, by the feeder's name.
    expect(eventsFor(s.world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'woke', name: 'Ana', by: 'Cid' }),
    )
  })

  it('wakes them only once when two feed them in one tick', () => {
    const s = setup()
    s.give(feedAna(1))
    s.give({ kind: 'feed', residentId: 'b2', targetId: 'a2', units: 1 }, other)
    s.tick()
    expect(isDown(s.ana)).toBe(false)
    expect(eventsFor(s.world, 7).filter((e) => e.kind === 'woke')).toHaveLength(1)
    // The second found her awake and kept their Food.
    expect(s.ben.carried.food! + s.cid.carried.food!).toBe(7)
  })

  it('can be a queue step', () => {
    const s = setup()
    s.ben.x = 14
    const steps = [
      { order: { kind: 'walkTo', x: 11, y: 11 } },
      { order: { kind: 'feed', targetId: 'a2', units: 2 } },
    ]
    expect(s.give({ kind: 'queue', residentId: 'a3', steps })).toMatchObject({ type: 'ack' })
    for (let i = 0; i < 200 && isDown(s.ana); i++) s.tick()
    expect(isDown(s.ana)).toBe(false)
    expect(s.ben.carried.food).toBe(4)
  })

  it('is the script action `feed(residentId, units)`', () => {
    const feeder: RunnableScript = {
      userId: 7,
      name: 'Feeder',
      version: 1,
      followsDefault: false,
      source: 'feed("a2", 1)',
    }
    const s = setup(new Map([[750, feeder]]))
    expect(s.give({ kind: 'runScript', residentId: 'a3', scriptId: 750 })).toMatchObject({
      type: 'ack',
    })
    s.tick()
    s.tick()
    expect(isDown(s.ana)).toBe(false)
    expect(s.ben.carried.food).toBe(5)
  })
})

describe('the awake-alive invariant', () => {
  it('catches someone woken this tick without health, without food, or still Down', () => {
    const s = setup()
    s.give(feedAna())
    s.tick()
    expect(checkInvariants(s.world, terrain, [awakeAlive])).toEqual([])
    s.ana.hunger = 0
    s.ana.health = 0
    expect(checkInvariants(s.world, terrain, [awakeAlive]).map((v) => v.message)).toEqual([
      'resident a2 woke with health 0',
      'resident a2 woke with an empty hunger meter',
    ])
  })
})

describe('feedProblem', () => {
  it('reaches the tiles next to the Down resident, wrapping round the map', () => {
    const down = { x: 0, y: 0, down: true as const }
    const at = (x: number, y: number) => ({ bornAt: -20 * 24 * 3600, x, y, carried: { food: 1 } })
    expect(feedProblem(at(63, 63), down, 0, 64)).toBeUndefined()
    expect(feedProblem(at(0, 0), down, 0, 64)).toBeUndefined()
    expect(feedProblem(at(2, 0), down, 0, 64)).toBeDefined()
  })
})
