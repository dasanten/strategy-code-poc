import {
  AVERAGE_HORSE_STATS,
  FOAL_STAT_SPREAD,
  HORSE_STAT_NAMES,
  MAX_HEALTH,
  MAX_HUNGER,
  OWN_FOOD,
  STABLE_BREED_TICKS,
  STABLE_CAPACITY,
  Terrain,
  type Building,
  type Horse,
  type HorseStats,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { foalStats } from './breeding.js'
import { eventsFor } from './events.js'
import { breedOrdersSound, checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { endRealm } from './survival.js'
import { defaultScripts } from './test-default-scripts.js'
import { worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 16, tiles: new Uint8Array(16 * 16).fill(Terrain.Plains) }
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7) with Leader w1 standing at a finished stable at (8, 8), plenty of Food in
 * it and on w1, and two horses of r1 in it: a fast weak one and a slow strong one.
 */
function setup() {
  const world = createWorld(terrain)
  world.nodes = []
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  const w1 = newResident(mulberry32(1), {
    id: 'w1',
    owner: 'r1',
    x: 9,
    y: 9,
    tick: 0,
  })
  w1.carried = { food: 50 }
  world.residents.push(w1)
  const stable: Building = {
    id: 's1',
    kind: 'stable',
    cityId: null,
    x: 8,
    y: 8,
    stock: { food: 10_000 },
  }
  world.buildings.push(stable)
  horse(world, 'h1', 8, 8, { speed: 14, strength: 6, endurance: 10 })
  horse(world, 'h2', 10, 10, { speed: 6, strength: 14, endurance: 12 })
  return { world, stable, w1 }
}

function horse(
  world: WorldState,
  id: string,
  x: number,
  y: number,
  stats: HorseStats = AVERAGE_HORSE_STATS,
  realmId: string | null = 'r1',
): Horse {
  const h: Horse = {
    id,
    realmId,
    cityId: null,
    x,
    y,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { ...stats },
    bornAt: 0,
  }
  world.horses.push(h)
  return h
}

/** Sends an order as Player 7 and answers it; an accepted one is applied as the next tick starts. */
function order(world: WorldState, o: object, queue = new OrderQueue(undefined, terrain)) {
  const answer = queue.receive(world, me, 'q', o)
  queue.applyAll(world)
  return answer.type === 'rejected' ? answer.reason : undefined
}

const breedH1H2 = { kind: 'breed', residentId: 'w1', stableId: 's1', horseIds: ['h1', 'h2'] }

function steps(world: WorldState, n: number) {
  for (let t = 0; t < n; t++) stepWorld(world, terrain)
}

describe('breeding horses', () => {
  it('brings a foal with its parents’ average stats after a resident tends them for STABLE_BREED_DAYS', () => {
    const { world, w1 } = setup()
    expect(order(world, breedH1H2)).toBeUndefined()
    steps(world, STABLE_BREED_TICKS - 1)
    expect(world.horses).toHaveLength(2)
    expect(w1.order).toMatchObject({ kind: 'breed', progress: STABLE_BREED_TICKS - 1 })
    expect(checkInvariants(world, terrain)).toEqual([])
    steps(world, 1)
    expect(world.horses).toHaveLength(3)
    const foal = world.horses[2]!
    expect(foal).toMatchObject({ realmId: 'r1', x: 8, y: 8, hunger: MAX_HUNGER })
    expect(foal.bornAt).toBe(world.tick - 1)
    // Parents average 10 Speed, 10 Strength, 11 Endurance.
    const average = { speed: 10, strength: 10, endurance: 11 }
    for (const s of HORSE_STAT_NAMES)
      expect(Math.abs(foal.stats[s] - average[s])).toBeLessThanOrEqual(FOAL_STAT_SPREAD)
    expect(w1.order).toBeNull()
    expect(eventsFor(world, 7)).toContainEqual(
      expect.objectContaining({ kind: 'foaled', horseId: foal.id, stableId: 's1' }),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('stops, and loses its progress, when the resident leaves', () => {
    const { world, w1 } = setup()
    order(world, breedH1H2)
    steps(world, STABLE_BREED_TICKS / 2)
    w1.x = 2
    steps(world, 1)
    expect(w1.order).toBeNull()
    w1.x = 9
    order(world, breedH1H2)
    steps(world, STABLE_BREED_TICKS / 2 + 1)
    expect(world.horses).toHaveLength(2)
    expect(w1.order).toMatchObject({ kind: 'breed', progress: STABLE_BREED_TICKS / 2 + 1 })
  })

  it('stops when the resident is given another order', () => {
    const { world, w1 } = setup()
    order(world, breedH1H2)
    steps(world, 10)
    expect(order(world, { kind: 'walkTo', residentId: 'w1', x: 2, y: 2 })).toBeUndefined()
    expect(w1.order?.kind).toBe('walkTo')
    steps(world, STABLE_BREED_TICKS)
    expect(world.horses).toHaveLength(2)
  })

  it('stops when a horse leaves or dies, or the stable has no room left', () => {
    const left = setup()
    order(left.world, breedH1H2)
    steps(left.world, 10)
    left.world.horses[1]!.x = 2
    steps(left.world, 1)
    expect(left.w1.order).toBeNull()

    const died = setup()
    order(died.world, breedH1H2)
    steps(died.world, 10)
    // Starved: `stepHorses` takes it out of the world.
    died.world.horses.pop()
    steps(died.world, 1)
    expect(died.w1.order).toBeNull()

    const full = setup()
    order(full.world, breedH1H2)
    steps(full.world, 10)
    for (let i = 2; i < STABLE_CAPACITY; i++) horse(full.world, `x${i}`, 9, 9)
    steps(full.world, 1)
    expect(full.w1.order).toBeNull()
  })

  it('needs an adult at a finished stable, and two fed horses of the realm in it with room for a foal', () => {
    const reason = (change: (s: ReturnType<typeof setup>) => void, o: object = breedH1H2) => {
      const s = setup()
      change(s)
      return order(s.world, o)
    }
    expect(reason(({ w1 }) => (w1.x = 2))).toMatch(/not standing at that stable/)
    expect(reason(({ w1, world }) => (w1.bornAt = world.tick))).toMatch(/children/)
    expect(reason(({ stable }) => (stable.site = { delivered: {}, work: 0 }))).toMatch(/finished/)
    expect(reason(({ world }) => (world.horses[0]!.hunger = 0))).toMatch(/hungry/)
    expect(reason(({ world }) => (world.horses[1]!.realmId = 'r2'))).toMatch(/not horses of your/)
    expect(reason(({ world }) => (world.horses[1]!.x = 12))).toMatch(/in the stable/)
    expect(reason(() => {}, { ...breedH1H2, horseIds: ['h1', 'h1'] })).toMatch(/two horses/)
    expect(reason(() => {}, { ...breedH1H2, horseIds: 'h1' })).toMatch(/two horses/)
    expect(
      reason(({ world }) => {
        for (let i = 2; i < STABLE_CAPACITY; i++) horse(world, `x${i}`, 9, 9)
      }),
    ).toMatch(/no room/)
    // Two residents can't breed the same horses at once.
    expect(
      reason(({ world }) => {
        const w2 = newResident(mulberry32(2), {
          id: 'w2',
          owner: 'r1',
          x: 8,
          y: 9,
          tick: 0,
        })
        w2.order = {
          kind: 'breed',
          stableId: 's1',
          horseIds: ['h2', 'h1'],
          at: { x: 8, y: 9 },
          progress: 0,
        }
        world.residents.push(w2)
      }),
    ).toMatch(/already being bred/)
  })

  it('gives a foal stats near its parents’ average, whole and at least 1', () => {
    const rand = mulberry32(5)
    for (let i = 0; i < 200; i++) {
      const s = foalStats(
        rand,
        { speed: 1, strength: 30, endurance: 7 },
        { speed: 1, strength: 2, endurance: 8 },
      )
      expect(s.speed).toBeGreaterThanOrEqual(1)
      expect(Math.abs(s.strength - 16)).toBeLessThanOrEqual(FOAL_STAT_SPREAD)
      expect(Math.abs(s.endurance - 8)).toBeLessThanOrEqual(FOAL_STAT_SPREAD)
      for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('is reported when it breeds a horse not in the stable, the same horse twice or past a foal', () => {
    const { world, w1 } = setup()
    w1.order = {
      kind: 'breed',
      stableId: 's1',
      horseIds: ['h1', 'h1'],
      at: { x: 9, y: 9 },
      progress: STABLE_BREED_TICKS,
    }
    world.horses[0]!.x = 2
    const messages = breedOrdersSound.check(world, terrain).map((v) => v.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/progress/),
        expect.stringMatching(/with itself/),
        expect.stringMatching(/isn’t in the stable/),
      ]),
    )
  })
})

describe('the Breed horses task', () => {
  it('runs the default script: the resident breeds the two horses picked at the stable, once', () => {
    const { world, w1 } = setup()
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    const task = {
      kind: 'task',
      task: 'breed',
      residentId: 'w1',
      stableId: 's1',
      horseIds: ['h1', 'h2'],
    }
    expect(order(world, task, queue)).toBeUndefined()
    expect(w1.script).toMatchObject({ memory: { stableId: 's1', horseIds: ['h1', 'h2'] } })
    for (let t = 0; t < STABLE_BREED_TICKS + 5; t++) {
      expect(tasks.runAll(world)).toEqual([])
      stepWorld(world, terrain)
    }
    expect(world.horses).toHaveLength(3)
    expect(w1.order).toBeNull()
    expect(w1.script?.memory.done).toBe(true)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('is turned down away from the stable or with horses that can’t breed', () => {
    const { world } = setup()
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    const task = { kind: 'task', task: 'breed', residentId: 'w1', stableId: 's1', horseIds: ['h1'] }
    expect(order(world, task, queue)).toMatch(/two horses/)
  })
})

describe('NPC cities', () => {
  it('have one of their residents breed their horses through the default task', () => {
    const { world, terrain: land } = worldWithCity()
    const realm = world.realms[0]!
    const stable = world.buildings.find((b) => b.kind === 'stable')!
    stable.stock = { food: 10_000 }
    for (const r of world.residents) r.carried = { food: 100 }
    endRealm(world, realm, land.size)
    const city = world.cities[0]!
    expect(world.horses.every((h) => h.cityId === city.id && h.realmId === null)).toBe(true)
    // One of them is idle, free for what the city needs.
    const idle = world.residents.find((r) => r.id !== realm.leaderId)!
    idle.order = null
    delete idle.script
    idle.carried = { food: OWN_FOOD }
    const walking = new Walking(land)
    stepWorld(world, land, walking)
    expect(idle.script).toMatchObject({ task: 'breed', memory: { stableId: stable.id } })
    expect(world.residents.filter((r) => r.script?.task === 'breed')).toHaveLength(1)
    for (let t = 0; t < STABLE_BREED_TICKS + 500; t++) stepWorld(world, land, walking)
    expect(world.horses.length).toBeGreaterThanOrEqual(3)
    expect(world.horses[2]).toMatchObject({ cityId: city.id, realmId: null })
    expect(checkInvariants(world, land)).toEqual([])
  }, 120_000)
})
