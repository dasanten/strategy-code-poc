import {
  CREW_FOOD,
  DEFAULT_SCRIPTS,
  GET_FOOD_TAKE,
  MAX_HUNGER,
  NPC_VILLAGE,
  OWN_FOOD,
  SET_OUT_WORK_DAYS,
  TICKS_PER_GAME_DAY,
  Terrain,
  WALK_TICKS_PER_TILE,
  pileAt,
  setOutFood,
  type Building,
  type City,
  type Resident,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { putToWork, stepNpcCities } from './npc-behaviour.js'
import { foundNpcCity } from './npc-cities.js'
import { mulberry32, newResident } from './residents.js'
import { ScriptRunner, type ScriptHost } from './script-runner.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/**
 * Crew food (`CONTEXT.md`: Crew food, Carrying the output, Refilling at a workplace): the Work
 * default's carrier brings back the Food the workplace's pile lacks of `crewFood` and puts it on
 * the pile, where the crew takes its meals; with Food on the pile nobody else leaves for Food. A
 * resident an NPC city sends to a workplace sets out with Food for the walk there and back plus
 * `SET_OUT_WORK_DAYS` of work (`setOutFood`), and its carrier walks the crew's Food back itself.
 */

const SIZE = 32
const WORK = 1

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** A forest node with a finished lumber camp of `cityId` on it. */
function lumberCamp(
  world: WorldState,
  terrain: TerrainMap,
  id: string,
  cityId: string | null,
  at: { x: number; y: number },
): Building {
  terrain.tiles[at.y * terrain.size + at.x] = Terrain.Forest
  world.nodes.push({ id: `n-${id}`, kind: 'forest', ...at })
  const camp: Building = { id, kind: 'lumberCamp', cityId, ...at }
  world.buildings.push(camp)
  return camp
}

/** Mara's realm r1 with city c1, a lumber camp at (6, 10) and workers w1–w3 on it, running Work. */
function campWorld(): { world: WorldState; terrain: TerrainMap; camp: Building } {
  const terrain = plains(SIZE)
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 6 })
  const camp = lumberCamp(world, terrain, 'camp', null, { x: 6, y: 10 })
  for (const id of ['w1', 'w2', 'w3']) addWorker(world, id, camp)
  return { world, terrain, camp }
}

function addWorker(world: WorldState, id: string, place: Building, food = OWN_FOOD): Resident {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId: 'c1',
    x: place.x,
    y: place.y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  r.carried = { food }
  r.order = { kind: 'workAt', buildingId: place.id, at: { x: place.x, y: place.y }, progress: 0 }
  r.script = { scriptId: WORK, memory: { workplaceId: place.id } }
  world.residents.push(r)
  return r
}

function storage(world: WorldState, id: string, x: number, y: number, stock: Stock = {}) {
  const b: Building = { id, kind: 'storage', cityId: 'c1', x, y, stock }
  world.buildings.push(b)
  return b
}

const host: ScriptHost = {
  script: () => ({
    userId: 1,
    name: DEFAULT_SCRIPTS.work.name,
    version: 1,
    source: DEFAULT_SCRIPTS.work.source,
    followsDefault: true,
  }),
  sender: (userId) => ({ userId, account: { name: 'Mara', isAdmin: false } }),
  explored: () => true,
}

const lines = (r: Resident) => (r.scriptLog ?? []).map((l) => l.text)

/**
 * Runs Mara's Work scripts and the world with nobody hungry, so the Food stays countable, until
 * `done` or the ticks run out; the order kinds each resident went through, in order, without
 * repeats.
 */
function run(
  world: WorldState,
  terrain: TerrainMap,
  done: () => boolean,
  ticks = 600,
): Map<string, string[]> {
  const runner = new ScriptRunner(terrain, host)
  const walking = new Walking(terrain)
  const orders = new Map<string, string[]>()
  // Noted right after the scripts ran: an order given at the spot is done within the tick.
  const note = () => {
    for (const r of world.residents) {
      const kinds = orders.get(r.id) ?? []
      if (r.order && kinds.at(-1) !== r.order.kind) kinds.push(r.order.kind)
      orders.set(r.id, kinds)
    }
  }
  for (let t = 0; t < ticks && !done(); t++) {
    for (const r of world.residents) r.hunger = MAX_HUNGER
    expect(runner.runAll(world, true)).toEqual([])
    note()
    stepWorld(world, terrain, walking)
  }
  return orders
}

/** The worker away from the camp carrying its output, if any. */
const carrierOf = (world: WorldState) => world.residents.find((r) => r.script?.memory.carry)

/** Whether every worker is back at the camp working, nobody carrying. */
const allBack = (world: WorldState, camp: Building) =>
  world.residents.every(
    (r) =>
      r.x === camp.x && r.y === camp.y && r.order?.kind === 'workAt' && !r.script?.memory.carry,
  )

describe('crew food in the Work default', () => {
  it('the carrier brings crewFood back from the storage and puts it on the pile', () => {
    const { world, terrain, camp } = campWorld()
    const s = storage(world, 's1', camp.x + 8, camp.y, { food: 50 })
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    const orders = run(world, terrain, () => (pileAt(world, camp.x, camp.y)?.goods.food ?? 0) > 0)
    const carrier = world.residents.find((r) => (orders.get(r.id) ?? []).includes('store'))!
    expect(orders.get(carrier.id)).toEqual(['pickUp', 'store', 'fetch', 'walkTo', 'drop'])
    expect(pileAt(world, camp.x, camp.y)?.goods.food).toBe(CREW_FOOD)
    // Their own food was topped up to foodTake at the storage; the crew's Food is all on the pile.
    expect(carrier.carried.food).toBe(GET_FOOD_TAKE)
    expect(s.stock?.food).toBe(50 - (GET_FOOD_TAKE - OWN_FOOD) - CREW_FOOD)
    expect(lines(carrier)).toEqual(
      expect.arrayContaining([
        `fetching ${CREW_FOOD} Food for the crew at the storage at ${s.x},${s.y}`,
        `put ${CREW_FOOD} Food on the pile for the crew`,
      ]),
    )
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('brings only what the pile lacks of crewFood, as much as fits', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 8, camp.y, { food: 50 })
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100, food: CREW_FOOD - 5 } })
    run(world, terrain, () => (pileAt(world, camp.x, camp.y)?.goods.food ?? 0) >= CREW_FOOD)
    expect(pileAt(world, camp.x, camp.y)?.goods.food).toBe(CREW_FOOD)
  })

  it('with crewFood 0 the carrier comes straight back, as before', () => {
    const { world, terrain, camp } = campWorld()
    const s = storage(world, 's1', camp.x + 8, camp.y, { food: 50 })
    for (const r of world.residents) r.scriptParams = { [WORK]: { crewFood: 0 } }
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { wood: 100 } })
    let went = false
    const orders = run(world, terrain, () => {
      went ||= Boolean(carrierOf(world))
      return went && allBack(world, camp)
    })
    expect(went).toBe(true)
    const carrier = world.residents.find((r) => (orders.get(r.id) ?? []).includes('store'))!
    expect(orders.get(carrier.id)).toEqual(['pickUp', 'store', 'walkTo', 'workAt'])
    expect(pileAt(world, camp.x, camp.y)?.goods.food).toBeUndefined()
    expect(carrier.carried.food).toBe(GET_FOOD_TAKE)
    expect(s.stock?.food).toBe(50 - (GET_FOOD_TAKE - OWN_FOOD))
  })

  it('brings none to a farm, whose pile keeps its own Food', () => {
    const terrain = plains(SIZE)
    const world = createWorld(terrain)
    world.realms.push({ id: 'r1', userId: 1, leaderId: 'w1' })
    addCity(world, { id: 'c1', realmId: 'r1', x: 20, y: 6 })
    const farm: Building = { id: 'farm', kind: 'farm', cityId: 'c1', x: 6, y: 6 }
    world.buildings.push(farm)
    for (const id of ['w1', 'w2', 'w3']) addWorker(world, id, farm)
    storage(world, 's1', farm.x + 8, farm.y, { food: 50 })
    world.piles.push({ id: 'p', x: farm.x, y: farm.y, goods: { food: 100 } })
    let went = false
    const orders = run(world, terrain, () => {
      went ||= Boolean(carrierOf(world))
      return went && allBack(world, farm)
    })
    expect(went).toBe(true)
    const carrier = world.residents.find((r) => (orders.get(r.id) ?? []).includes('store'))!
    expect(orders.get(carrier.id)).not.toContain('fetch')
    expect(carrier.script?.memory.carry).toBeFalsy()
  })

  it('a worker with Food on the pile stays and takes their meals from it', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 8, camp.y, { food: 50 })
    world.piles.push({ id: 'p', x: camp.x, y: camp.y, goods: { food: 10 } })
    for (const r of world.residents) r.carried = {}
    const orders = run(world, terrain, () => false, 20)
    for (const r of world.residents) {
      expect(orders.get(r.id)).toEqual(['workAt'])
      expect(r.x).toBe(camp.x)
      expect(r.carried.food).toBeGreaterThan(0)
    }
    expect(pileAt(world, camp.x, camp.y)?.goods.food).toBeLessThan(10)
  })

  it('a worker with none on the pile still goes for Food, as before', () => {
    const { world, terrain, camp } = campWorld()
    storage(world, 's1', camp.x + 8, camp.y, { food: 50 })
    for (const r of world.residents) r.carried = {}
    const orders = run(world, terrain, () => false, 5)
    for (const r of world.residents) expect(orders.get(r.id)).toContain('fetch')
  })
})

/** A village alone on a Plains map `size` tiles wide, its top-left wall tile at (20, 20). */
function village(size = 64): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = foundNpcCity(world, terrain, NPC_VILLAGE, 20, 20, mulberry32(7))
  return { world, terrain, city }
}

const storageOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!

const farmOf = (world: WorldState, city: City): Building =>
  world.buildings.find((b) => b.cityId === city.id && b.kind === 'farm')!

/** An adult of the city standing at `at`, idle, with `food` on them. */
function villager(
  world: WorldState,
  city: City,
  id: string,
  at: { x: number; y: number },
  food: number,
) {
  const r = newResident(mulberry32(world.residents.length + 11), {
    id,
    owner: null,
    cityId: city.id,
    x: at.x,
    y: at.y,
    tick: 0,
  })
  r.stats.strength = { base: 10, trained: 0 }
  // Average Agility: they walk a Plains tile in `WALK_TICKS_PER_TILE`.
  r.stats.agility = { base: 10, trained: 0 }
  r.carried = { food }
  r.hunger = MAX_HUNGER
  world.residents.push(r)
  return r
}

/** A lumber camp of no city that the NPC city works (`City.workplaceIds`), as it builds far off. */
function farCamp(world: WorldState, terrain: TerrainMap, city: City, at: { x: number; y: number }) {
  const camp = lumberCamp(world, terrain, 'camp', null, at)
  city.workplaceIds = [...(city.workplaceIds ?? []), camp.id]
  return camp
}

describe('setting out for a workplace in an NPC city', () => {
  it('the set-out Food grows with the walk, from their own food', () => {
    const walk = (tiles: number) => tiles * WALK_TICKS_PER_TILE
    expect(setOutFood(0)).toBe(OWN_FOOD)
    expect(setOutFood(walk(160))).toBeGreaterThan(OWN_FOOD)
    expect(setOutFood(walk(480))).toBeGreaterThan(setOutFood(walk(160)))
    // Twice the walk plus the first days of work, rounded up to whole units.
    const days = (tiles: number) => (2 * walk(tiles)) / TICKS_PER_GAME_DAY + SET_OUT_WORK_DAYS
    expect(setOutFood(walk(160))).toBe(Math.ceil(days(160) * 0.5))
  })

  it('a resident sent far takes the set-out Food at the storage first; one sent next door goes', () => {
    const { world, terrain, city } = village(256)
    const storage = storageOf(world, city)
    storage.stock = { food: 200 }
    world.residents = []
    const far = farCamp(world, terrain, city, { x: storage.x + 150, y: storage.y })
    const r = villager(world, city, 'a1', storage, OWN_FOOD)
    stepNpcCities(world, terrain.size, terrain)
    const want = setOutFood(150 * WALK_TICKS_PER_TILE)
    expect(want).toBeGreaterThan(OWN_FOOD)
    // The pick-up and the Work default come together: the script waits for the pick-up, then
    // walks them out, and the city never sees them idle with Food to put back.
    expect(r.order).toEqual({
      kind: 'pickUp',
      from: { kind: 'storage', storageId: storage.id },
      goods: { food: want - OWN_FOOD },
    })
    expect(r.script).toMatchObject({ scriptId: 0, task: 'work', memory: { workplaceId: far.id } })
    const walking = new Walking(terrain)
    stepWorld(world, terrain, walking)
    expect(r.carried.food).toBe(want)
    stepWorld(world, terrain, walking)
    expect(r.order).toMatchObject({ kind: 'walkTo', target: { x: far.x, y: far.y } })

    // One sent from afar walks to the storage for their Food first.
    const away = villager(world, city, 'a3', { x: storage.x - 10, y: storage.y + 10 }, OWN_FOOD)
    stepNpcCities(world, terrain.size, terrain)
    expect(away.order).toMatchObject({ kind: 'walkTo', target: { x: storage.x, y: storage.y } })
    expect(away.script).toBeUndefined()

    // The farm next door needs no more than their own food.
    world.buildings = world.buildings.filter((b) => b.id !== far.id)
    const f = villager(world, city, 'a2', storage, OWN_FOOD)
    stepNpcCities(world, terrain.size, terrain)
    expect(f.order).toBeNull()
    expect(f.script).toMatchObject({ memory: { workplaceId: farmOf(world, city).id } })
  })

  it('a carrier home with the load stored goes back by the Work default while they bring crew food', () => {
    const { world, terrain, city } = village()
    const storage = storageOf(world, city)
    const farm = farmOf(world, city)
    const stored = (crewFood: number) => ({
      storageId: storage.id,
      goods: ['wood'],
      load: { wood: 10 },
      stored: true,
      crewFood,
    })
    const stays = villager(world, city, 'a1', storage, OWN_FOOD)
    putToWork(stays, farm)
    stays.script!.memory.carry = stored(CREW_FOOD)
    const freed = villager(world, city, 'a2', storage, OWN_FOOD)
    putToWork(freed, farm)
    freed.script!.memory.carry = stored(0)
    stepNpcCities(world, terrain.size, terrain)
    expect(stays.script?.memory.carry).toEqual(stored(CREW_FOOD))
    expect(freed.script?.memory.carry).toBeUndefined()
  })

  it(
    'a lumber camp 160 tiles from home keeps six workers at work for 30 game days, only the carrier leaving',
    { tags: ['slow'], timeout: 600_000 },
    () => {
      const { world, terrain, city } = village(400)
      const storage = storageOf(world, city)
      storage.stock = { food: 2000 }
      // The village's own residents farm and stand guard, so the city keeps its soldiers
      // without drafting the crew.
      const camp = farCamp(world, terrain, city, { x: storage.x + 160, y: storage.y })
      const walk = 160 * WALK_TICKS_PER_TILE
      const crew = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) =>
        villager(world, city, id, storage, setOutFood(walk)),
      )
      for (const r of crew) putToWork(r, camp)
      const walking = new Walking(terrain)
      const atCamp = (r: Resident) => r.x === camp.x && r.y === camp.y
      let arrived = false
      let lastPileFood = 0
      let trips = 0
      const here = new Map<string, boolean>()
      for (let t = 0; t < 30 * TICKS_PER_GAME_DAY; t++) {
        stepWorld(world, terrain, walking)
        if (!arrived) {
          arrived = crew.every(atCamp)
          for (const r of crew) here.set(r.id, true)
          continue
        }
        // Once there, one of them at a time is away, and only ever as its carrier: who leaves the
        // camp carries a load off, nobody walks home for Food. Home with the load stored, a
        // carrier bringing no crew food is free and the city sends them back (Carrying the
        // output, NPC city).
        const away = crew.filter((r) => !atCamp(r))
        expect(away.filter((r) => r.script?.memory.carry).length).toBeLessThanOrEqual(1)
        for (const r of crew) {
          if (here.get(r.id) && !atCamp(r)) expect(r.script?.memory.carry).toBeTruthy()
          expect(r.script?.memory.food).toBeUndefined()
          here.set(r.id, atCamp(r))
        }
        // A trip with the crew's Food: the pile's Food goes up (it only ever goes down otherwise).
        const pileFood = pileAt(world, camp.x, camp.y)?.goods.food ?? 0
        if (pileFood > lastPileFood) trips++
        lastPileFood = pileFood
        if (world.tick % TICKS_PER_GAME_DAY === 0)
          expect(checkInvariants(world, terrain)).toEqual([])
      }
      expect(arrived).toBe(true)
      // In 30 days the carrier walks the 160 tiles both ways many times, Food back each time.
      expect(trips).toBeGreaterThan(5)
      for (const r of crew) expect(world.residents).toContain(r)
      // Still a crew of six on the camp: all at work there, or one of them away as its carrier.
      const workers = crew.filter((r) => r.script?.memory.workplaceId === camp.id)
      expect(workers.length + crew.filter((r) => !r.script).length).toBe(6)
      expect(crew.filter((r) => atCamp(r) && r.order?.kind === 'workAt').length).toBeGreaterThan(4)
      // The pile keeps about crewFood: the carrier tops it up, never heaps it.
      expect(pileAt(world, camp.x, camp.y)?.goods.food ?? 0).toBeLessThanOrEqual(CREW_FOOD)
      expect((storage.stock?.wood ?? 0) > 0).toBe(true)
    },
  )
})
