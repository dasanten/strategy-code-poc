import {
  BUILD_MATERIALS,
  BUILD_WORK,
  HORSE_FOOD_PER_DAY,
  HUNGER_DAYS,
  MAX_HEALTH,
  MAX_HUNGER,
  STABLE_BREED_TICKS,
  STABLE_CAPACITY,
  STARVE_DAYS,
  TICKS_PER_GAME_DAY,
  Terrain,
  buildProblem,
  storageAt,
  type Building,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { eventsFor } from './events.js'
import { stepHorses } from './horses.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { worldWithCity } from './test-terrain.js'
import { createWorld, stepWorld } from './world.js'

/** Plains, with forest at (3, 3). */
function map(): TerrainMap {
  const tiles = new Uint8Array(16 * 16).fill(Terrain.Plains)
  tiles[3 * 16 + 3] = Terrain.Forest
  return { size: 16, tiles }
}
const terrain = map()
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** A world with realm r1 (Player 7, Leader w1 at (0, 0)) and a finished stable at (8, 8). */
function setup(food = 0) {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), { id: 'w1', owner: 'r1', x: 0, y: 0, tick: 0 })
  w1.carried = { food: 5 }
  world.residents.push(w1)
  const stable: Building = {
    id: 's1',
    kind: 'stable',
    cityId: null,
    x: 8,
    y: 8,
    stock: food > 0 ? { food } : {},
  }
  world.buildings.push(stable)
  return { world, stable, w1 }
}

function horse(world: WorldState, id: string, x: number, y: number, realmId: string | null = 'r1') {
  const h: Horse = { id, realmId, x, y, hunger: MAX_HUNGER, health: MAX_HEALTH }
  world.horses.push(h)
  return h
}

/** Runs the horses' part of `days` game days. */
function run(world: WorldState, days: number) {
  const died: Horse[] = []
  for (let t = 0; t < days * TICKS_PER_GAME_DAY; t++) {
    died.push(...stepHorses(world, terrain))
    world.tick++
  }
  return died
}

describe('horse hunger', () => {
  it('feeds a horse in a stable from the stable’s storage, HORSE_FOOD_PER_DAY a game day', () => {
    const { world, stable } = setup(100)
    const h = horse(world, 'h1', 8, 8)
    run(world, 10)
    const eaten = 100 - stable.stock!.food!
    expect(eaten).toBeGreaterThanOrEqual(10 * HORSE_FOOD_PER_DAY - 1)
    expect(eaten).toBeLessThanOrEqual(10 * HORSE_FOOD_PER_DAY + 1)
    expect(h.hunger).toBeGreaterThan(0)
    expect(h.health).toBe(MAX_HEALTH)
  })

  it('starves a horse with nothing in reach like a resident, and logs its death', () => {
    const { world } = setup()
    const h = horse(world, 'h1', 2, 2)
    // A full meter lasts HUNGER_DAYS; then it loses health for STARVE_DAYS.
    run(world, HUNGER_DAYS - 0.01)
    expect(h.hunger).toBeGreaterThan(0)
    expect(h.health).toBe(MAX_HEALTH)
    const died = run(world, STARVE_DAYS + 0.02)
    expect(died).toEqual([h])
    expect(world.horses).toEqual([])
    expect(eventsFor(world, 7)).toEqual([
      expect.objectContaining({ kind: 'horseDied', horseId: 'h1' }),
    ])
  })

  it('has no inventory: carried food and food in another stable are out of reach', () => {
    const { world, w1 } = setup()
    // The resident with plenty of food stands right on the horse's tile.
    const h = horse(world, 'h1', w1.x, w1.y)
    world.buildings.push({
      id: 's2',
      kind: 'stable',
      cityId: null,
      x: 1,
      y: 0,
      stock: { food: 50 },
    })
    run(world, HUNGER_DAYS + STARVE_DAYS + 0.02)
    expect(world.horses).not.toContain(h)
    expect(w1.carried.food).toBe(5)
    expect(world.buildings.find((b) => b.id === 's2')!.stock).toEqual({ food: 50 })
  })

  it('eats food on the ground on its tile or right next to it, across the map’s join too', () => {
    const { world } = setup()
    const h = horse(world, 'h1', 0, 5)
    world.piles.push({ id: 'p1', x: 15, y: 6, goods: { food: 2, wood: 3 } })
    world.piles.push({ id: 'p2', x: 2, y: 5, goods: { food: 50 } })
    h.hunger = 0
    stepHorses(world, terrain)
    stepHorses(world, terrain)
    expect(world.piles.find((p) => p.id === 'p1')!.goods).toEqual({ wood: 3 })
    stepHorses(world, terrain)
    // Two tiles away is out of reach.
    expect(world.piles.find((p) => p.id === 'p2')!.goods).toEqual({ food: 50 })
    expect(h.hunger).toBeGreaterThan(0)
  })

  it('eats from its stable before food on the ground, and an emptied pile is gone', () => {
    const { world, stable } = setup(1)
    const h = horse(world, 'h1', 8, 8)
    world.piles.push({ id: 'p1', x: 8, y: 9, goods: { food: 1 } })
    h.hunger = 0
    stepHorses(world, terrain)
    expect(stable.stock).toEqual({})
    expect(world.piles).toHaveLength(1)
    stepHorses(world, terrain)
    expect(world.piles).toEqual([])
  })

  it('heals a fed horse that went hungry', () => {
    const { world } = setup(100)
    const h = horse(world, 'h1', 8, 8)
    h.health = MAX_HEALTH / 2
    run(world, 1)
    expect(h.health).toBeGreaterThan(MAX_HEALTH / 2)
  })
})

describe('stable breeding', () => {
  it('breeds a foal of their realm from two fed horses after STABLE_BREED_DAYS', () => {
    const { world, stable } = setup(100_000)
    horse(world, 'h1', 8, 8)
    horse(world, 'h2', 8, 8)
    for (let t = 0; t < STABLE_BREED_TICKS - 1; t++) stepHorses(world, terrain)
    expect(world.horses).toHaveLength(2)
    stepHorses(world, terrain)
    expect(world.horses).toHaveLength(3)
    const foal = world.horses[2]!
    expect(foal).toMatchObject({ realmId: 'r1', x: 8, y: 8, hunger: MAX_HUNGER })
    expect(stable.breeding).toBe(0)
    expect(eventsFor(world, 7)).toEqual([
      expect.objectContaining({ kind: 'foaled', horseId: foal.id, stableId: 's1' }),
    ])
  })

  it('needs two fed horses of one realm, in a finished stable with room', () => {
    const lone = setup(1000)
    horse(lone.world, 'h1', 8, 8)
    // A horse next to the stable is not in it.
    horse(lone.world, 'h2', 8, 9)
    stepHorses(lone.world, terrain)
    expect(lone.stable.breeding).toBeUndefined()

    const mixed = setup(1000)
    horse(mixed.world, 'h1', 8, 8)
    horse(mixed.world, 'h2', 8, 8, 'r2')
    stepHorses(mixed.world, terrain)
    expect(mixed.stable.breeding).toBeUndefined()

    const hungry = setup()
    horse(hungry.world, 'h1', 8, 8).hunger = 0
    horse(hungry.world, 'h2', 8, 8)
    stepHorses(hungry.world, terrain)
    expect(hungry.stable.breeding).toBeUndefined()

    const site = setup(1000)
    site.stable.site = { delivered: {}, work: 0 }
    horse(site.world, 'h1', 8, 8)
    horse(site.world, 'h2', 8, 8)
    stepHorses(site.world, terrain)
    expect(site.stable.breeding).toBeUndefined()

    const full = setup(100_000)
    for (let i = 0; i < STABLE_CAPACITY; i++) horse(full.world, `h${i}`, 8, 8)
    full.stable.breeding = STABLE_BREED_TICKS - 1
    stepHorses(full.world, terrain)
    expect(full.world.horses).toHaveLength(STABLE_CAPACITY)
  })
})

describe('stables in the world', () => {
  it('go on Plains off any resource node, and a build order checks the land', () => {
    const { world, w1 } = setup()
    world.nodes = [{ id: 'n1', kind: 'forest', x: 3, y: 3 }]
    expect(buildProblem(world, 5, 5, 'stable', terrain)).toBeUndefined()
    expect(buildProblem(world, 3, 3, 'stable', terrain)).toMatch(/Plains/)
    expect(buildProblem(world, 8, 8, 'stable', terrain)).toMatch(/already a building/)
    const queue = new OrderQueue(undefined, terrain)
    w1.x = 3
    w1.y = 3
    const answer = queue.receive(world, me, 'q', {
      kind: 'build',
      residentId: 'w1',
      building: 'stable',
    })
    expect(answer).toEqual({
      type: 'rejected',
      requestId: 'q',
      reason: expect.stringMatching(/Plains/),
    })
  })

  it('are built like other buildings, from wood and work', () => {
    const { world, w1 } = setup()
    const queue = new OrderQueue(undefined, terrain)
    w1.x = 5
    w1.y = 5
    expect(
      queue.receive(world, me, 'q', { kind: 'build', residentId: 'w1', building: 'stable' }),
    ).toEqual({ type: 'ack', requestId: 'q' })
    queue.applyAll(world)
    stepWorld(world, terrain)
    const site = world.buildings.find((b) => b.x === 5 && b.y === 5)!
    expect(site).toMatchObject({ kind: 'stable', site: { delivered: {}, work: 0 } })
    site.site!.delivered = { ...BUILD_MATERIALS.stable }
    site.site!.work = BUILD_WORK.stable! - 1
    stepWorld(world, terrain)
    expect(site.site).toBeUndefined()
  })

  it('take food that residents drop in, like a storage', () => {
    const { world, stable, w1 } = setup()
    w1.x = 8
    w1.y = 8
    expect(storageAt(world, 8, 8)).toBe(stable)
    const queue = new OrderQueue(undefined, terrain)
    const spot = { kind: 'storage', storageId: 's1' }
    expect(
      queue.receive(world, me, 'q', { kind: 'drop', residentId: 'w1', spot, goods: { food: 5 } }),
    ).toEqual({ type: 'ack', requestId: 'q' })
    queue.applyAll(world)
    stepWorld(world, terrain)
    expect(stable.stock).toEqual({ food: 5 })
  })

  it('leave the food they kept on the tile when torn down', () => {
    const { world, stable, w1 } = setup(30)
    w1.x = 8
    w1.y = 8
    w1.carried = {}
    stable.teardown = BUILD_WORK.stable! / 2 - 0.01
    w1.order = { kind: 'tearDown', buildingId: 's1', at: { x: 8, y: 8 } }
    stepWorld(world, terrain)
    expect(world.buildings).toEqual([])
    expect(world.piles).toEqual([
      expect.objectContaining({ x: 8, y: 8, goods: { wood: 20, food: 30 } }),
    ])
  })

  it('keep a starting city’s horses fed and breeding, with every invariant holding', () => {
    const { world, terrain: land } = worldWithCity()
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    stable.stock = { food: 1000 }
    for (const r of world.residents) r.carried = { food: 1000 }
    for (let t = 0; t < 2 * TICKS_PER_GAME_DAY; t++) stepWorld(world, land)
    expect(world.horses).toHaveLength(2)
    expect(stable.breeding).toBe(2 * TICKS_PER_GAME_DAY)
    expect(checkInvariants(world, land)).toEqual([])
  })
})

describe('horse and stable invariants', () => {
  it('report a horse out of range and breeding off a stable or past a foal', () => {
    const { world, stable } = setup()
    const h = horse(world, 'h1', 8, 8)
    h.health = MAX_HEALTH + 1
    stable.breeding = STABLE_BREED_TICKS
    world.buildings.push({ id: 'b2', kind: 'mine', cityId: null, x: 9, y: 9, breeding: 1 })
    const found = checkInvariants(world, terrain).map((v) => [v.invariant, v.entityIds[0]])
    expect(found).toContainEqual(['health-and-hunger-in-range', 'h1'])
    expect(found).toContainEqual(['stables-breed-in-range', 's1'])
    expect(found).toContainEqual(['stables-breed-in-range', 'b2'])
  })

  it('report a stable off Plains and goods only in storages and stables', () => {
    const { world } = setup(5)
    world.buildings.push({ id: 's2', kind: 'stable', cityId: null, x: 3, y: 3 })
    world.buildings.push({ id: 'f1', kind: 'mine', cityId: null, x: 4, y: 4, stock: { food: 1 } })
    const found = checkInvariants(world, terrain).map((v) => [v.invariant, v.entityIds[0]])
    expect(found).toContainEqual(['buildings-in-place', 's2'])
    expect(found).toContainEqual(['goods-in-place', 'f1'])
    expect(found).not.toContainEqual(['goods-in-place', 's1'])
  })
})
