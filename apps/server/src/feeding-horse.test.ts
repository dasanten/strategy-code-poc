import {
  HORSE_WAKE_HEALTH,
  MAX_HUNGER,
  Terrain,
  isDown,
  type Horse,
  type OrderRequest,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { HORSE_DOWN_TICKS, newHorse } from './horses.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { QueueRunner } from './queues.js'
import { mulberry32, newResident } from './residents.js'
import type { RunnableScript } from './scripts.js'
import { defaultScripts } from './test-default-scripts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** Feeding a horse (`CONTEXT.md`): any grown resident next to a horse that isn't full can Feed it. */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const mara = { userId: 7, account: { name: 'Mara', isAdmin: false } }
const other = { userId: 8, account: { name: 'Olaf', isAdmin: false } }

/**
 * Realm r1 (Player 7) with Ben (a3), holding 6 Food, next to its horse Rowan (h1) at (10, 10);
 * realm r2 (Player 8) with its horse Star (h2) on Rowan's tile. `library` holds Player 7's scripts.
 */
function setup(library = new Map<number, RunnableScript>()) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  resident(world, 'a1', 'r1', 30, 30)
  resident(world, 'b1', 'r2', 40, 40)
  const ben = resident(world, 'a3', 'r1', 11, 10)
  ben.carried = { food: 6 }
  const rowan = horse(world, 'h1', 'r1')
  const star = horse(world, 'h2', 'r2')
  const scripts = defaultScripts(terrain, [mara, other], library)
  const orders = new OrderQueue(scripts.kinds, terrain)
  const queues = new QueueRunner(
    { sender: (id) => [mara, other].find((s) => s.userId === id) },
    scripts.kinds,
    terrain,
  )
  const walking = new Walking(terrain)
  /** One tick as the game runs it, the residents kept fed. */
  const tick = () => {
    orders.applyAll(world)
    queues.runAll(world)
    expect(scripts.runAll(world)).toEqual([])
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
  const give = (order: OrderRequest, sender = mara) => orders.receive(world, sender, 'q', order)
  return { world, ben, rowan, star, tick, give }
}

function resident(world: WorldState, id: string, owner: string, x: number, y: number): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner, x, y, tick: 0 })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

function horse(world: WorldState, id: string, realmId: string): Horse {
  const h = newHorse(mulberry32(world.horses.length + 1), {
    id,
    realmId,
    cityId: null,
    x: 10,
    y: 10,
    tick: 0,
  })
  world.horses.push(h)
  return h
}

/** Puts a horse Down, as hunger does. */
function lay(world: WorldState, h: Horse): void {
  Object.assign(h, { hunger: 0, health: 0, downUntil: world.tick + HORSE_DOWN_TICKS })
}

const feedRowan = (units = 3) => ({ kind: 'feed', residentId: 'a3', targetId: 'h1', units })

describe('feeding a horse', () => {
  it('wakes a Down horse at low health, with something in its hunger meter', () => {
    const s = setup()
    lay(s.world, s.rowan)
    expect(s.give(feedRowan(1))).toMatchObject({ type: 'ack' })
    s.tick()
    expect(isDown(s.rowan)).toBe(false)
    expect(s.rowan.health).toBeLessThanOrEqual(HORSE_WAKE_HEALTH + 1)
    expect(s.rowan.health).toBeGreaterThan(0)
    expect(s.rowan.hunger).toBeGreaterThan(0)
    expect(s.ben.carried).toEqual({ food: 5 })
    expect(s.ben.order).toBeNull()
  })

  it('eats a hungry horse full and leaves the rest with the feeder', () => {
    const s = setup()
    s.rowan.hunger = 10
    s.give(feedRowan(50))
    s.tick()
    // 90 of the meter to fill at about 44 a unit: three units, the last not all of it needed.
    expect(s.ben.carried).toEqual({ food: 3 })
    expect(s.rowan.hunger).toBeGreaterThan(MAX_HUNGER - 1)
    expect(s.rowan.hunger).toBeLessThanOrEqual(MAX_HUNGER)
  })

  it('eats only the units asked for', () => {
    const s = setup()
    s.rowan.hunger = 0
    s.give(feedRowan(1))
    s.tick()
    expect(s.ben.carried).toEqual({ food: 5 })
    expect(s.rowan.hunger).toBeLessThan(MAX_HUNGER / 2)
  })

  it('eats no more than the Food in their hands', () => {
    const s = setup()
    s.rowan.hunger = 0
    s.ben.carried = { food: 1, stone: 2 }
    s.give(feedRowan(3))
    s.tick()
    expect(s.ben.carried).toEqual({ stone: 2 })
  })

  it('refuses a full horse, from too far, a child, or without Food', () => {
    const s = setup()
    s.rowan.hunger = MAX_HUNGER
    expect(s.give(feedRowan())).toMatchObject({ type: 'rejected', reason: 'that horse is full' })
    s.rowan.hunger = 10
    s.ben.x = 13
    expect(s.give(feedRowan())).toMatchObject({
      type: 'rejected',
      reason: 'stand on or next to its tile to feed it',
    })
    s.ben.x = 11
    s.ben.bornAt = s.world.tick
    expect(s.give(feedRowan())).toMatchObject({
      type: 'rejected',
      reason: 'children can’t feed others',
    })
    s.ben.bornAt = -20 * 24 * 3600
    s.ben.carried = { wood: 3 }
    expect(s.give(feedRowan())).toMatchObject({ type: 'rejected', reason: 'no Food in hand' })
  })

  it('does nothing once the Food is gone or another filled the horse first', () => {
    const s = setup()
    s.rowan.hunger = 10
    s.give(feedRowan())
    s.ben.carried = {}
    const hunger = s.rowan.hunger
    s.tick()
    expect(s.rowan.hunger).toBeLessThanOrEqual(hunger)
    expect(s.ben.order).toBeNull()

    const t = setup()
    const cid = resident(t.world, 'a4', 'r1', 10, 10)
    cid.carried = { food: 6 }
    t.rowan.hunger = 10
    t.give(feedRowan(50))
    t.give({ kind: 'feed', residentId: 'a4', targetId: 'h1', units: 50 })
    t.tick()
    // Whoever goes first fills it; the other keeps all their Food.
    expect(t.ben.carried.food! + cid.carried.food!).toBe(9)
  })

  it('can feed another realm’s horse, and that is no crime', () => {
    const s = setup()
    lay(s.world, s.star)
    expect(s.give({ ...feedRowan(1), targetId: 'h2' })).toMatchObject({ type: 'ack' })
    s.tick()
    expect(isDown(s.star)).toBe(false)
    expect(s.star.realmId).toBe('r2')
    expect(s.ben.carried).toEqual({ food: 5 })
    expect(s.world.crimes).toEqual([])
  })

  it('can be a queue step', () => {
    const s = setup()
    s.ben.x = 14
    lay(s.world, s.rowan)
    const steps = [
      { order: { kind: 'walkTo', x: 11, y: 11 } },
      { order: { kind: 'feed', targetId: 'h1', units: 2 } },
    ]
    expect(s.give({ kind: 'queue', residentId: 'a3', steps })).toMatchObject({ type: 'ack' })
    for (let i = 0; i < 200 && isDown(s.rowan); i++) s.tick()
    expect(isDown(s.rowan)).toBe(false)
    expect(s.ben.carried.food).toBe(4)
  })

  it('is the script action `feed(targetId, units)`', () => {
    const feeder: RunnableScript = {
      userId: 7,
      name: 'Feeder',
      version: 1,
      followsDefault: false,
      source: 'feed("h1", 1)',
    }
    const s = setup(new Map([[750, feeder]]))
    lay(s.world, s.rowan)
    expect(s.give({ kind: 'runScript', residentId: 'a3', scriptId: 750 })).toMatchObject({
      type: 'ack',
    })
    s.tick()
    s.tick()
    expect(isDown(s.rowan)).toBe(false)
    expect(s.ben.carried.food).toBeLessThan(6)
  })
})
