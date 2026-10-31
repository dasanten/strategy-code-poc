import {
  AVERAGE_HORSE_STATS,
  MAX_HEALTH,
  MAX_HUNGER,
  TICKS_PER_GAME_DAY,
  Terrain,
  footprintTiles,
  pileAt,
  type Building,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { defaultScripts } from './test-default-scripts.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Crews spread over the footprint (`CONTEXT.md`: Spreading over the footprint): the Work, Build
 * and Breed horses defaults send each resident to the footprint tile with the fewest of the crew
 * on it, the nearest on ties, through `crewTile`. Which tile they stand on changes nothing else.
 */

const SIZE = 16
const terrain: TerrainMap = { size: SIZE, tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains) }
const walking = new Walking(terrain)
const me = { userId: 7, account: { name: 'Mara', isAdmin: false } }
/** A Player's version of a task's default, as `defaultScripts` numbers them. */
const WORK = 701
const BUILD = 702

/** A 2x2 iron mine of realm r1's city, its north-west tile at (5, 5). */
const mine: Building = { id: 'mine', kind: 'mine', cityId: 'c1', x: 5, y: 5 }

/** Realm r1 (Player 7) with the mine finished on an iron node and its city off to the side. */
function setup(): WorldState {
  const world = createWorld(terrain)
  world.nodes = [{ id: 'n1', kind: 'ironOre', x: 5, y: 5 }]
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 12, y: 12 })
  world.buildings.push({ ...mine })
  return world
}

function addResident(world: WorldState, id: string, x: number, y: number): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), { id, owner: 'r1', x, y, tick: 0 })
  r.carried = { food: 20 }
  world.residents.push(r)
  return r
}

/** Runs the scripts and steps the world `ticks` times, nobody going hungry; the invariants hold. */
function play(world: WorldState, tasks: ReturnType<typeof defaultScripts>, ticks: number) {
  for (let t = 0; t < ticks; t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    expect(tasks.runAll(world)).toEqual([])
    stepWorld(world, terrain, walking)
  }
}

/** How many of the residents stand on each footprint tile of `b`, by "x,y". */
function perTile(world: WorldState, b: Building): Map<string, number> {
  const counts = new Map(footprintTiles(b, SIZE).map(([x, y]) => [`${x},${y}`, 0]))
  for (const r of world.residents) {
    const key = `${r.x},${r.y}`
    expect(counts.has(key)).toBe(true)
    counts.set(key, counts.get(key)! + 1)
  }
  return counts
}

const give = (world: WorldState, queue: OrderQueue, order: object) => {
  const answer = queue.receive(world, me, 'q', order)
  expect(answer).toMatchObject({ type: 'ack' })
}

describe('a Work crew (`CONTEXT.md`: Spreading over the footprint)', () => {
  it('spreads six sent to a 2x2 mine over its tiles, at most two to a tile', () => {
    const world = setup()
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    for (let i = 0; i < 6; i++) {
      addResident(world, `w${i + 1}`, 5, 5)
      give(world, queue, {
        kind: 'task',
        task: 'work',
        residentId: `w${i + 1}`,
        workplaceId: 'mine',
      })
    }
    queue.applyAll(world)
    play(world, tasks, 40)
    for (const r of world.residents)
      expect(r.order).toMatchObject({ kind: 'workAt', buildingId: 'mine' })
    const counts = perTile(world, mine)
    expect([...counts.values()].sort()).toEqual([1, 1, 2, 2])
  })

  it('stands four at a 2x2 mine one to a tile, and they stay put once there', () => {
    const world = setup()
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    for (let i = 0; i < 4; i++) {
      addResident(world, `w${i + 1}`, 5, 5)
      give(world, queue, {
        kind: 'task',
        task: 'work',
        residentId: `w${i + 1}`,
        workplaceId: 'mine',
      })
    }
    queue.applyAll(world)
    play(world, tasks, 40)
    expect([...perTile(world, mine).values()]).toEqual([1, 1, 1, 1])
    const standing = world.residents.map((r) => [r.x, r.y])
    play(world, tasks, 30)
    expect(world.residents.map((r) => [r.x, r.y])).toEqual(standing)
    for (const r of world.residents)
      expect(r.order).toMatchObject({ kind: 'workAt', progress: expect.any(Number) })
  })

  it('sends a lone worker to the footprint tile nearest them', () => {
    const world = setup()
    const tasks = defaultScripts(terrain, [me])
    const w1 = addResident(world, 'w1', 9, 6)
    w1.script = { scriptId: WORK, memory: { workplaceId: 'mine' } }
    play(world, tasks, 40)
    expect([w1.x, w1.y]).toEqual([6, 6])
    expect(w1.order).toMatchObject({ kind: 'workAt', buildingId: 'mine' })
    expect(w1.script?.memory.at).toEqual({ x: 6, y: 6 })
  })

  it('leaves a resident already on the footprint where they are', () => {
    const world = setup()
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    const w1 = addResident(world, 'w1', 6, 6)
    give(world, queue, { kind: 'task', task: 'work', residentId: 'w1', workplaceId: 'mine' })
    queue.applyAll(world)
    for (let t = 0; t < 40; t++) {
      play(world, tasks, 1)
      expect([w1.x, w1.y]).toEqual([6, 6])
    }
    expect(w1.order).toMatchObject({ kind: 'workAt', buildingId: 'mine', at: { x: 6, y: 6 } })
  })

  it('makes the same output on the same pile with as many workers as a crew on one corner', () => {
    /** Six at work on the mine for a while: the ore on its pile and the workers counted. */
    const outcome = (spread: boolean) => {
      const world = setup()
      const tasks = defaultScripts(terrain, [me])
      const queue = new OrderQueue(tasks.kinds, terrain)
      for (let i = 0; i < 6; i++) {
        const r = addResident(world, `w${i + 1}`, 5, 5)
        if (spread) {
          give(world, queue, { kind: 'task', task: 'work', residentId: r.id, workplaceId: 'mine' })
        } else {
          // Already at work on the corner, their tile picked: nobody moves.
          r.order = { kind: 'workAt', buildingId: 'mine', at: { x: 5, y: 5 }, progress: 0 }
          r.script = { scriptId: WORK, memory: { workplaceId: 'mine', at: { x: 5, y: 5 } } }
        }
      }
      queue.applyAll(world)
      // The spread crew spends a while walking a tile; both work the same stretch after that.
      play(world, tasks, 40)
      const before = pileAt(world, 5, 5)?.goods.ironOre ?? 0
      play(world, tasks, TICKS_PER_GAME_DAY)
      const workers = world.residents.filter((r) => r.order?.kind === 'workAt').length
      const tiles = new Set(world.residents.map((r) => `${r.x},${r.y}`)).size
      return { ore: (pileAt(world, 5, 5)?.goods.ironOre ?? 0) - before, workers, tiles }
    }
    const spread = outcome(true)
    const corner = outcome(false)
    expect(spread.tiles).toBe(4)
    expect(corner.tiles).toBe(1)
    expect(spread.workers).toBe(6)
    expect(spread.ore).toBeGreaterThan(0)
    expect(spread).toMatchObject({ ore: corner.ore, workers: corner.workers })
  })
})

describe('a Build crew (`CONTEXT.md`: Spreading over the footprint)', () => {
  /** An unfinished 2x2 house of the city, its north-west tile at (5, 5), in place of the mine. */
  const siteWorld = () => {
    const world = setup()
    world.nodes = []
    world.buildings = world.buildings.filter((b) => b.id !== 'mine')
    world.buildings.push({
      id: 'h1',
      kind: 'house',
      cityId: 'c1',
      x: 5,
      y: 5,
      site: { delivered: {}, work: 0 },
    })
    return world
  }

  it('spreads four joining the site on their tile one to a tile', () => {
    const world = siteWorld()
    const tasks = defaultScripts(terrain, [me])
    for (let i = 0; i < 4; i++) {
      addResident(world, `w${i + 1}`, 5, 5).script = { scriptId: BUILD, memory: {} }
    }
    play(world, tasks, 40)
    for (const r of world.residents) expect(r.order).toMatchObject({ kind: 'build', siteId: 'h1' })
    expect([
      ...perTile(
        world,
        world.buildings.find((b) => b.id === 'h1')!,
      ).values(),
    ]).toEqual([1, 1, 1, 1])
  })

  it('spreads a group given Build: the first lays out the site, the next stands on another tile', () => {
    const world = setup()
    world.nodes = []
    world.buildings = world.buildings.filter((b) => b.id !== 'mine')
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    addResident(world, 'w1', 5, 5)
    addResident(world, 'w2', 5, 9)
    const at = { x: 5, y: 5 }
    for (const id of ['w1', 'w2']) {
      give(world, queue, { kind: 'task', task: 'build', residentId: id, building: 'storage', at })
    }
    queue.applyAll(world)
    play(world, tasks, 80)
    const site = world.buildings.find((b) => b.kind === 'storage')!
    expect(site).toMatchObject({ ...at, site: expect.any(Object) })
    for (const r of world.residents)
      expect(r.order).toMatchObject({ kind: 'build', siteId: site.id })
    const [w1, w2] = world.residents
    expect([w1!.x, w1!.y]).toEqual([5, 5])
    expect([w2!.x, w2!.y]).not.toEqual([5, 5])
    expect([...perTile(world, site).values()].sort()).toEqual([0, 0, 1, 1])
  })
})

describe('a Breeding crew (`CONTEXT.md`: Spreading over the footprint)', () => {
  it('stands two breeders at a 3x3 stable on different tiles', () => {
    const world = setup()
    world.nodes = []
    world.buildings = world.buildings.filter((b) => b.id !== 'mine')
    const stable: Building = {
      id: 's1',
      kind: 'stable',
      cityId: 'c1',
      x: 5,
      y: 5,
      stock: { food: 10_000 },
    }
    world.buildings.push(stable)
    for (const id of ['h1', 'h2', 'h3', 'h4']) {
      world.horses.push({
        id,
        realmId: 'r1',
        cityId: null,
        x: 6,
        y: 6,
        hunger: MAX_HUNGER,
        health: MAX_HEALTH,
        stats: { ...AVERAGE_HORSE_STATS },
        bornAt: 0,
      })
    }
    const tasks = defaultScripts(terrain, [me])
    const queue = new OrderQueue(tasks.kinds, terrain)
    addResident(world, 'w1', 5, 5)
    addResident(world, 'w2', 5, 5)
    give(world, queue, {
      kind: 'task',
      task: 'breed',
      residentId: 'w1',
      stableId: 's1',
      horseIds: ['h1', 'h2'],
    })
    give(world, queue, {
      kind: 'task',
      task: 'breed',
      residentId: 'w2',
      stableId: 's1',
      horseIds: ['h3', 'h4'],
    })
    queue.applyAll(world)
    play(world, tasks, 40)
    for (const r of world.residents)
      expect(r.order).toMatchObject({ kind: 'breed', stableId: 's1' })
    expect([...perTile(world, stable).values()].sort()).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1])
  })
})
