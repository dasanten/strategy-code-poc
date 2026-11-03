import {
  AVERAGE_HORSE_STATS,
  HORSE_WAKE_HEALTH,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  isDown,
  type Carriage,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { HORSE_DOWN_TICKS, horsesDownLieStill } from './horses.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 32, tiles: new Uint8Array(32 * 32).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * A world with realm r1 (Player 7, Leader w1 at (2, 2), carrying Food) and its horse Rowan, h1,
 * on the same tile, and realm r2 (Player 8, Leader b1) next to them.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 2, y: 2, tick: 0 })
  w1.carried = { food: 5 }
  const b1 = newResident(mulberry32(2), { id: 'b1', owner: 'r2', x: 3, y: 2, tick: 0 })
  world.residents.push(w1, b1)
  const horse: Horse = {
    id: 'h1',
    realmId: 'r1',
    cityId: null,
    x: 2,
    y: 2,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    name: 'Rowan',
    stats: { ...AVERAGE_HORSE_STATS },
    bornAt: 0,
  }
  world.horses.push(horse)
  return { world, w1, b1, horse }
}

/** Starves a horse to its last bit of health, with nothing in reach. */
function starving(h: Horse) {
  h.hunger = 0
  h.health = 0.0001
}

/** Steps the world `ticks` times, residents kept fed, checking every invariant after each. */
function run(world: WorldState, ticks = 1, walking?: Walking) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    stepWorld(world, terrain, walking)
    expect(checkInvariants(world, terrain)).toEqual([])
  }
}

/** Sends an order of the Player's and applies it, as the next tick would; returns the reply. */
function order(world: WorldState, o: object) {
  const q = new OrderQueue(undefined, terrain)
  const reply = q.receive(world, me, 'q', o as { kind: string })
  q.applyAll(world)
  return reply
}

describe('horses going Down (`CONTEXT.md`: Down, Reviving, Horses have no inventory)', () => {
  it('puts a starving horse Down instead of killing it, and logs it', () => {
    const { world, horse } = setup()
    starving(horse)
    run(world)
    expect(world.horses).toContain(horse)
    expect(isDown(horse)).toBe(true)
    expect(horse.health).toBe(0)
    expect(horse.downUntil).toBe(world.tick - 1 + HORSE_DOWN_TICKS)
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'horseDown', horseId: 'h1', name: 'Rowan' }),
    )
    // Down, it loses nothing more while it waits.
    run(world, 100)
    expect([horse.hunger, horse.health]).toEqual([0, 0])
  })

  it('wakes at low health once Food is put down by it', () => {
    const { world, w1, horse } = setup()
    starving(horse)
    run(world, 10)
    expect(isDown(horse)).toBe(true)
    // Food in the rider's hands is out of reach (`CONTEXT.md`: Horses have no inventory).
    expect(w1.carried.food).toBe(5)
    const reply = order(world, {
      kind: 'drop',
      residentId: 'w1',
      spot: { kind: 'ground' },
      goods: { food: 2 },
    })
    expect(reply).toMatchObject({ type: 'ack' })
    // Put down in one tick, eaten in the next.
    run(world, 2)
    expect(isDown(horse)).toBe(false)
    expect(horse.health).toBe(HORSE_WAKE_HEALTH)
    expect(horse.hunger).toBeGreaterThan(0)
    expect(w1.carried.food).toBe(3)
    // It eats what it needs of the rest and heals from there.
    run(world, 100)
    expect(horse.health).toBeGreaterThan(HORSE_WAKE_HEALTH)
  })

  it('wakes from Food on a tile next to it, too', () => {
    const { world, horse } = setup()
    starving(horse)
    run(world)
    world.piles.push({ id: 'p1', x: 3, y: 3, goods: { food: 1 } })
    run(world)
    expect(isDown(horse)).toBe(false)
    expect(world.piles).toEqual([])
  })

  it('dies of hunger when its time is up and nobody fed it', () => {
    const { world, horse } = setup()
    starving(horse)
    run(world)
    world.tick = horse.downUntil! - 1
    run(world)
    expect(world.horses).toContain(horse)
    run(world)
    expect(world.horses).toEqual([])
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'horseDied', horseId: 'h1', name: 'Rowan' }),
    )
  })

  it('puts its rider on foot, and can’t be mounted', () => {
    const { world, w1, horse } = setup()
    expect(order(world, { kind: 'mount', residentId: 'w1', horseId: 'h1' })).toMatchObject({
      type: 'ack',
    })
    expect(w1.riding).toBe('h1')
    // The rider carries no Food to spare for it (`OWN_FOOD`).
    w1.carried = {}
    starving(horse)
    run(world)
    expect(isDown(horse)).toBe(true)
    expect(w1.riding).toBeUndefined()
    expect(order(world, { kind: 'mount', residentId: 'w1', horseId: 'h1' })).toMatchObject({
      reason: 'that horse is Down',
    })
    // The rider walks on alone; the horse stays where it lies.
    w1.order = { kind: 'walkTo', target: { x: 8, y: 2 }, path: null, progress: 0 }
    run(world, 600, new Walking(terrain))
    expect([w1.x, horse.x]).toEqual([8, 2])
  })

  it('leaves its carriage standing, and the carriage can’t be driven', () => {
    const { world, w1, horse } = setup()
    const carriage: Carriage = {
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 2,
      y: 2,
      horseId: 'h1',
      load: {},
    }
    world.carriages.push(carriage)
    const walking = new Walking(terrain)
    expect(
      order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 20, y: 2 }),
    ).toMatchObject({ type: 'ack' })
    run(world, 30, walking)
    expect(carriage.x).toBeGreaterThan(2)
    const at = carriage.x
    starving(horse)
    run(world, 1, walking)
    expect(isDown(horse)).toBe(true)
    expect(w1.order).toBeNull()
    expect(carriage.horseId).toBe('h1')
    run(world, 100, walking)
    expect([carriage.x, horse.x]).toEqual([at, at])
    expect(
      order(world, { kind: 'drive', residentId: 'w1', carriageId: 'k1', x: 20, y: 2 }),
    ).toMatchObject({ reason: 'its horse is Down' })
    // A drive the game gives anyway goes nowhere.
    w1.order = { kind: 'drive', carriageId: 'k1', target: { x: 20, y: 2 }, path: null, progress: 0 }
    run(world, 30, walking)
    expect([carriage.x, w1.order]).toEqual([at, null])
  })

  it('is seen Down by anyone in sight, how long it has left only by its own realm', () => {
    const { world, horse } = setup()
    starving(horse)
    run(world)
    const own = entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'h1')!
    expect(own).toMatchObject({ down: true, downUntil: horse.downUntil })
    const theirs = entitiesInSight(world, terrain, 'r2').find((e) => e.id === 'h1')!
    expect(theirs).toMatchObject({ down: true })
    expect(theirs).not.toHaveProperty('downUntil')
    expect(theirs).not.toHaveProperty('health')
  })

  it('has an invariant: a Down horse is neither ridden nor pulling a driven carriage', () => {
    const { world, w1, horse } = setup()
    starving(horse)
    run(world)
    expect(horsesDownLieStill.check(world, terrain)).toEqual([])
    w1.riding = 'h1'
    expect(horsesDownLieStill.check(world, terrain)).toEqual([
      expect.objectContaining({ message: 'horse h1 is Down but is ridden' }),
    ])
    delete w1.riding
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: 2,
      y: 2,
      horseId: 'h1',
      load: {},
    })
    w1.order = { kind: 'drive', carriageId: 'k1', target: { x: 9, y: 2 }, path: null, progress: 0 }
    expect(horsesDownLieStill.check(world, terrain)).toEqual([
      expect.objectContaining({
        message: 'horse h1 is Down but pulls carriage k1, which is driven',
      }),
    ])
  })
})
