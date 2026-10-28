import {
  AVERAGE_HORSE_STATS,
  CARRIAGE_CAPACITY,
  CARRIAGE_MAX_CAPACITY,
  HORSE_STAT_AVERAGE,
  HORSE_STAT_MAX,
  HORSE_STAT_MIN,
  carriageCapacity,
  horseSpeedFactor,
  unitsThatFitCarriage,
  CARRIAGE_SPEED,
  MAX_HEALTH,
  MAX_HUNGER,
  Terrain,
  WALK_TICKS_PER_TILE,
  driveSpeed,
  horseFood,
  terrainAt,
  ticksForAge,
  type Carriage,
  type Horse,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { stepHorses } from './horses.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/** A square map drawn as text (sides join): . plains, f forest, ^ mountain, ~ lake. */
function draw(rows: string[]): TerrainMap {
  const codes: Record<string, number> = {
    '.': Terrain.Plains,
    f: Terrain.Forest,
    '^': Terrain.Mountain,
    '~': Terrain.Lake,
  }
  return { size: rows.length, tiles: Uint8Array.from(rows.join('').split(''), (c) => codes[c]!) }
}

const open = draw(Array.from({ length: 16 }, () => '.'.repeat(16)))
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

function drive(r: Resident, carriageId: string, x: number, y: number) {
  r.order = { kind: 'drive', carriageId, target: { x, y }, path: null, progress: 0 }
}

/** Steps the world until the driver's order is done or `max` ticks pass; returns the ticks. */
function driveOut(world: WorldState, map: TerrainMap, r: Resident, max = 5000) {
  const walking = new Walking(map)
  let t = 0
  while (r.order && t < max) {
    stepWorld(world, map, walking)
    t++
  }
  return t
}

describe('the drive order', () => {
  it('needs an adult of the Player on their own carriage’s tile, with a horse there', () => {
    const { world, w1, carriage, horse } = setup(open)
    const q = new OrderQueue(undefined, open)
    const order = (o: object) =>
      q.receive(world, me, 'q', { kind: 'drive', residentId: 'w1', carriageId: 'k1', ...o })
    expect(order({ x: 8, y: 2 })).toEqual({ type: 'ack', requestId: 'q' })
    expect(order({ x: 8.5, y: 2 })).toMatchObject({ reason: 'the target must be a tile' })
    expect(order({ x: 8, y: 2, carriageId: 'nope' })).toMatchObject({
      reason: 'not one of your carriages',
    })
    expect(
      q.receive(world, { ...me, userId: 8 }, 'q', {
        kind: 'drive',
        residentId: 'w1',
        carriageId: 'k1',
        x: 8,
        y: 2,
      }),
    ).toMatchObject({ reason: 'not one of your residents' })

    horse.x = 3
    expect(order({ x: 8, y: 2 })).toMatchObject({ reason: 'no horse here to pull that carriage' })
    horse.x = 2
    carriage.x = 3
    expect(order({ x: 8, y: 2 })).toMatchObject({
      reason: 'that carriage is not on the resident’s tile',
    })
    carriage.x = 2
    w1.bornAt = world.tick - ticksForAge(5)
    expect(order({ x: 8, y: 2 })).toMatchObject({ reason: 'children can’t drive' })
  })

  it('refuses a target in the mountains, and a carriage someone else drives', () => {
    const map = draw(Array.from({ length: 16 }, (_, y) => (y === 8 ? '^' : '.').repeat(16)))
    const { world } = setup(map)
    const other = newResident(mulberry32(2), { id: 'w2', owner: 'r1', x: 2, y: 2, tick: 0 })
    world.residents.push(other)
    const q = new OrderQueue(undefined, map)
    const order = (residentId: string, y: number) =>
      q.receive(world, me, 'q', { kind: 'drive', residentId, carriageId: 'k1', x: 2, y })
    expect(order('w1', 8)).toMatchObject({ reason: 'a carriage can’t go there' })
    // Both are accepted in one tick, but only the first gets to drive.
    expect(order('w1', 5)).toMatchObject({ type: 'ack' })
    expect(order('w2', 5)).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    expect(world.residents.find((r) => r.id === 'w1')!.order?.kind).toBe('drive')
    expect(other.order).toBeNull()
    expect(order('w2', 5)).toMatchObject({ reason: 'someone else is driving that carriage' })
  })
})

describe('driving a carriage', () => {
  it('moves driver, carriage and horse together, hitching the horse, then stops', () => {
    const { world, w1, horse, carriage } = setup(open)
    drive(w1, 'k1', 6, 2)
    const walking = new Walking(open)
    while (w1.order) {
      stepWorld(world, open, walking)
      expect([carriage.x, carriage.y]).toEqual([w1.x, w1.y])
      expect([horse.x, horse.y]).toEqual([w1.x, w1.y])
      expect(checkInvariants(world, open)).toEqual([])
    }
    expect([w1.x, w1.y]).toEqual([6, 2])
    expect(carriage.horseId).toBe('h1')
  })

  it('is fast on plains, slower in forest, faster with Driving skill', () => {
    const forest = draw(Array.from({ length: 16 }, () => 'f'.repeat(16)))
    const ticks = (map: TerrainMap, skill = 0) => {
      const { world, w1 } = setup(map)
      w1.skills.driving = skill
      drive(w1, 'k1', 6, 2)
      return driveOut(world, map, w1) / 4
    }
    const plains = ticks(open)
    // Twice an unloaded walker's speed on plains: about 15 s a tile.
    expect(Math.abs(plains - WALK_TICKS_PER_TILE / CARRIAGE_SPEED[Terrain.Plains])).toBeLessThan(2)
    expect(ticks(forest)).toBeGreaterThan(plains * 2)
    expect(ticks(open, 20)).toBeLessThan(plains)
  })

  it('teaches Driving to the driver while they drive', () => {
    const { world, w1 } = setup(open)
    drive(w1, 'k1', 6, 2)
    driveOut(world, open, w1)
    expect(w1.skills.driving).toBeGreaterThan(0)
    const speed = driveSpeed(w1, world.horses[0]!, Terrain.Plains)
    expect(speed).toBeGreaterThan(CARRIAGE_SPEED[Terrain.Plains] / WALK_TICKS_PER_TILE)
  })

  it('goes round a mountain ridge through its pass, never into the mountains', () => {
    // A mountain ridge across the map with one pass through it far to the east.
    const rows = Array.from({ length: 24 }, (_, y) =>
      y === 6 ? '^'.repeat(20) + '....' : '.'.repeat(24),
    )
    const map = draw(rows)
    const { world, w1, carriage } = setup(map, 2, 2)
    drive(w1, 'k1', 2, 10)
    const walking = new Walking(map)
    let crossedAt: number | undefined
    for (let t = 0; t < 20000 && w1.order; t++) {
      stepWorld(world, map, walking)
      expect(terrainAt(map, carriage.x, carriage.y)).not.toBe(Terrain.Mountain)
      if (carriage.y === 6) crossedAt = carriage.x
    }
    expect([carriage.x, carriage.y]).toEqual([2, 10])
    // It went through the pass (east, or round the west across the join), not over the ridge.
    expect(crossedAt).toBeGreaterThanOrEqual(20)
    expect(checkInvariants(world, map)).toEqual([])
  })

  it('stops when the horse is gone, and a dead horse is unhitched', () => {
    const { world, w1, horse, carriage } = setup(open)
    carriage.horseId = 'h1'
    drive(w1, 'k1', 6, 2)
    horse.health = 0.0001
    horse.hunger = 0
    stepHorses(world, open)
    expect(world.horses).toEqual([])
    expect(carriage.horseId).toBeNull()
    driveOut(world, open, w1)
    expect([carriage.x, w1.x]).toEqual([2, 2])
    expect(w1.order).toBeNull()
  })
})

describe('horse stats on the road (`CONTEXT.md`: Horse stats)', () => {
  it('a faster horse pulls its carriage faster, a slower one slower', () => {
    const ticks = (speed: number) => {
      const { world, w1, horse } = setup(open)
      horse.stats.speed = speed
      drive(w1, 'k1', 10, 2)
      return driveOut(world, open, w1)
    }
    const average = ticks(HORSE_STAT_AVERAGE)
    const fast = ticks(HORSE_STAT_MAX)
    const slow = ticks(HORSE_STAT_MIN)
    expect(fast).toBeLessThan(average)
    expect(slow).toBeGreaterThan(average)
    // As fast as `horseSpeedFactor` says, give or take the last part step.
    const factor = horseSpeedFactor({ stats: { ...AVERAGE_HORSE_STATS, speed: HORSE_STAT_MAX } })
    expect(Math.abs(fast - average / factor)).toBeLessThan(WALK_TICKS_PER_TILE)
  })

  it('a stronger horse lets its carriage hold more, a weaker one less', () => {
    const { world, w1, horse, carriage } = setup(open)
    expect(carriageCapacity(world, carriage)).toBe(CARRIAGE_CAPACITY)
    horse.stats.strength = HORSE_STAT_MAX
    const strong = carriageCapacity(world, carriage)
    expect(strong).toBeGreaterThan(CARRIAGE_CAPACITY)
    expect(strong).toBeLessThanOrEqual(CARRIAGE_MAX_CAPACITY)
    // Loading goes up to what the stronger horse lets it hold.
    const q = new OrderQueue(undefined, open)
    const spot = { kind: 'carriage', carriageId: 'k1' }
    carriage.load = { stone: CARRIAGE_CAPACITY }
    w1.carried = { stone: 10 }
    q.receive(world, me, 'a', { kind: 'drop', residentId: 'w1', spot, goods: { stone: 10 } })
    q.applyAll(world)
    stepWorld(world, open)
    expect(carriage.load.stone).toBe(CARRIAGE_CAPACITY + 10)
    expect(checkInvariants(world, open)).toEqual([])
    // Behind a weak horse it holds less, and takes nothing more once past that.
    horse.stats.strength = HORSE_STAT_MIN
    expect(carriageCapacity(world, carriage)).toBeLessThan(CARRIAGE_CAPACITY)
    expect(unitsThatFitCarriage(world, carriage, 'stone')).toBe(0)
    // Without a horse a carriage holds the plain amount.
    expect(carriageCapacity({ horses: [], carriages: [] }, { ...carriage, horseId: null })).toBe(
      CARRIAGE_CAPACITY,
    )
  })
})

describe('loading a carriage', () => {
  it('takes goods on and off like a storage, up to its capacity', () => {
    const { world, w1, carriage } = setup(open)
    const q = new OrderQueue(undefined, open)
    const spot = { kind: 'carriage', carriageId: 'k1' }
    w1.carried = { stone: 10 }
    carriage.load = { stone: CARRIAGE_CAPACITY - 4 }
    expect(
      q.receive(world, me, 'a', { kind: 'drop', residentId: 'w1', spot, goods: { stone: 10 } }),
    ).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    stepWorld(world, open)
    // Only what fits goes on; the rest stays in hand.
    expect(carriage.load.stone).toBe(CARRIAGE_CAPACITY)
    expect(w1.carried.stone).toBe(6)
    expect(
      q.receive(world, me, 'b', { kind: 'pickUp', residentId: 'w1', spot, goods: { stone: 3 } }),
    ).toMatchObject({ type: 'ack' })
    q.applyAll(world)
    stepWorld(world, open)
    expect(carriage.load.stone).toBe(CARRIAGE_CAPACITY - 3)
    expect(w1.carried.stone).toBe(9)
    expect(checkInvariants(world, open)).toEqual([])

    carriage.x = 3
    expect(
      q.receive(world, me, 'c', { kind: 'pickUp', residentId: 'w1', spot, goods: { stone: 1 } }),
    ).toMatchObject({ reason: 'that carriage is not on the resident’s tile' })
  })

  it('feeds the horse pulling it from its load first', () => {
    const { world, horse, carriage } = setup(open)
    world.piles.push({ id: 'p1', x: 2, y: 2, goods: { food: 5 } })
    carriage.load = { food: 5 }
    // Not hitched: the horse eats from the ground, not from someone's cart.
    expect(horseFood(world, horse, open.size)).toEqual([world.piles[0]!.goods])
    carriage.horseId = 'h1'
    expect(horseFood(world, horse, open.size)[0]).toBe(carriage.load)
    horse.hunger = 0
    stepHorses(world, open)
    expect(carriage.load.food).toBe(4)
    expect(world.piles[0]!.goods.food).toBe(5)
  })
})

describe('carriage invariants', () => {
  it('catch carriages in the mountains, overloaded, apart from their horse or driver', () => {
    const map = draw(Array.from({ length: 8 }, (_, y) => (y === 0 ? '^' : '.').repeat(8)))
    const { world, w1, horse, carriage } = setup(map, 2, 2)
    carriage.horseId = 'h1'
    expect(checkInvariants(world, map)).toEqual([])
    carriage.load = { stone: CARRIAGE_MAX_CAPACITY + 1 }
    horse.x = 3
    drive(w1, 'k1', 5, 5)
    w1.x = 4
    world.carriages.push({ ...carriage, id: 'k2', x: 1, y: 0, load: {} })
    const found = checkInvariants(world, map).map((v) => `${v.invariant}: ${v.message}`)
    expect(found).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/carriages-in-place: carriage k1 holds/),
        expect.stringMatching(/carriages-in-place: carriage k1 is at .* but its horse/),
        expect.stringMatching(/carriages-in-place: carriage k2 stands where no carriage can go/),
        expect.stringMatching(/carriages-in-place: carriage k2 shares horse h1/),
        expect.stringMatching(/drivers-on-carriages: resident w1 drives k1 but isn't on its tile/),
      ]),
    )
  })
})
