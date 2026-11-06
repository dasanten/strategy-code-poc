import {
  MAX_WORKERS,
  NPC_SMITHY_WEAPON,
  TASKS,
  TICKS_PER_GAME_DAY,
  buildingPile,
  carryCapacity,
  inCityArea,
  isArmed,
  recipeFor,
  type City,
  type Resident,
  type ResidentOrder,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { NPC_ORDER_KINDS, npcResidentsKeptGoing } from './npc-behaviour.js'
import { stepNpcDefence } from './npc-defence.js'
import { storageOf, village } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { mulberry32, newResident } from './residents.js'
import { endRealm } from './survival.js'
import { defaultScripts } from './test-default-scripts.js'
import { worldWithCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { stepWorld } from './world.js'

/** Starts `r` carrying a child of `partner`, having carried for `days` game days already. */
function startCarrying(world: WorldState, r: Resident, partner: Resident, days = 0): void {
  r.pair = { partnerId: partner.id, since: 0 }
  partner.pair = { partnerId: r.id, since: 0 }
  r.carrying = {
    since: world.tick - days * TICKS_PER_GAME_DAY,
    partnerId: partner.id,
    partnerName: partner.name,
    partnerBase: { strength: 10, endurance: 10, agility: 10, intellect: 10 },
  }
  r.order = null
  delete r.script
}

/** A village down to two adults: `a` far east of home, `b` on the farm. */
function coupleAway() {
  const { world, terrain, city, home } = village()
  const [a, b] = world.residents as [Resident, Resident]
  world.residents = [a, b]
  a.x = home.x + 60
  return { world, terrain, city, a, b }
}

const invariants = (world: WorldState, terrain: TerrainMap) =>
  checkInvariants(world, terrain).map((v) => v.message)

describe('an NPC resident Carrying a child', () => {
  it('with hands full and no Food, far from home, puts the load away, eats at home and works after the birth', () => {
    const { world, terrain, city, a, b } = coupleAway()
    // A carrier on the way home with a full load, who has eaten their Food.
    a.carried = { wood: Math.floor(carryCapacity(a, world.tick)) }
    // The Food the city has isn't a surplus, so it wants a second farmer once the child is born.
    const storage = storageOf(world, city)
    storage.stock = { food: 12 }
    startCarrying(world, a, b, 3)
    const walking = new Walking(terrain)
    while (a.carrying) {
      stepWorld(world, terrain, walking)
      expect(a.downUntil).toBeUndefined()
      expect(a.script).toBeUndefined()
      if (world.tick % TICKS_PER_GAME_DAY === 0) expect(invariants(world, terrain)).toEqual([])
    }
    // Home, with the load in the storage.
    expect(inCityArea(world, city, a.x, a.y, terrain.size)).toBe(true)
    expect(a.carried.wood ?? 0).toBe(0)
    expect(storage.stock.wood).toBeGreaterThan(0)
    expect(world.residents).toHaveLength(3)
    // The next planning pass gives them work again.
    for (let t = 0; t < TICKS_PER_GAME_DAY && a.script?.task !== 'work'; t++) {
      stepWorld(world, terrain, walking)
    }
    expect(world.cityPlans[city.id]!.jobs[a.id]?.kind).toBe('farm')
    expect(a.script?.task).toBe('work')
    expect(a.downUntil).toBeUndefined()
  }, 120_000)

  it('walks home through its own closed gates on the Food they have, and eats there', () => {
    const { world, terrain, city, a, b } = coupleAway()
    a.carried = { food: 1 }
    storageOf(world, city).stock = { food: 12 }
    startCarrying(world, a, b)
    const gates = world.buildings.filter((x) => x.kind === 'gate' && x.cityId === city.id)
    expect(gates.length).toBeGreaterThan(0)
    const walking = new Walking(terrain)
    for (let t = 0; t < 6 * TICKS_PER_GAME_DAY; t++) {
      for (const g of gates) g.closed = true
      stepWorld(world, terrain, walking)
      expect(a.downUntil).toBeUndefined()
    }
    expect(inCityArea(world, city, a.x, a.y, terrain.size)).toBe(true)
    expect(a.order).toBeNull()
    expect(a.carried.food ?? 0).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('at home with an empty storage, eats once the farm’s crew brings Food home', () => {
    const { world, terrain, city, home } = village()
    const [a, b] = world.residents as [Resident, Resident]
    Object.assign(a, { x: home.x, y: home.y, carried: { food: 1 } })
    storageOf(world, city).stock = {}
    startCarrying(world, a, b)
    const walking = new Walking(terrain)
    for (let t = 0; t < 8 * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      expect(a.downUntil).toBeUndefined()
    }
    expect(a.hunger).toBeGreaterThan(0)
  }, 120_000)

  it('isn’t sent for the smith’s Iron and Wood, which they couldn’t forge', () => {
    const { world, terrain, city, home } = village()
    const [a, b] = world.residents as [Resident, Resident]
    const hall = world.buildings.find((x) => x.id === city.townHallId)!
    world.buildings.push({ id: 'smithy', kind: 'smithy', cityId: null, x: hall.x + 3, y: hall.y })
    city.workplaceIds = ['smithy']
    const input = recipeFor('smithy', NPC_SMITHY_WEAPON)!.input
    storageOf(world, city).stock = { food: 100, ...input }
    Object.assign(a, { x: home.x, y: home.y, carried: { food: 2 } })
    startCarrying(world, a, b)
    stepNpcDefence(world, terrain.size)
    expect(a.order).toBeNull()
  })
})

/** Player 1's realm in play: their residents have real scripts, as from their first tick. */
function realmInPlay() {
  const { world, terrain } = worldWithCity()
  const realm = world.realms[0]!
  const city = world.cities[0]!
  const { runAll } = defaultScripts(terrain, [{ userId: realm.userId, name: 'P1' }])
  runAll(world)
  const farm = world.buildings.find((b) => b.kind === 'farm' && b.cityId === city.id)!
  const storage = storageOf(world, city)
  const hall = world.buildings.find((b) => b.id === city.townHallId)!
  const rand = mulberry32(5)
  const add = (id: string, at: { x: number; y: number }, set?: (r: Resident) => void) => {
    const r = newResident(rand, {
      id,
      owner: realm.id,
      cityId: city.id,
      x: at.x,
      y: at.y,
      tick: 0,
    })
    r.carried = { food: 1 }
    set?.(r)
    world.residents.push(r)
    return r
  }
  const workAt = (): ResidentOrder => ({
    kind: 'workAt',
    buildingId: farm.id,
    at: { x: farm.x, y: farm.y },
    progress: 0,
  })
  /** Fills the farm with the realm's workers by their Work script, the Leader's place too. */
  const fillFarm = () => {
    const scripted = world.residents.find((r) => r.script?.memory.workplaceId === farm.id)!
    const scriptId = scripted.script!.scriptId
    for (let i = world.residents.length; i <= MAX_WORKERS.farm!; i++) {
      add(`worker${i}`, farm, (r) => {
        r.order = workAt()
        r.script = { scriptId, memory: { workplaceId: farm.id } }
      })
    }
  }
  /** The Leader is dead: the realm ended, and its city self-managed. */
  const leaderDies = () => {
    world.residents = world.residents.filter((r) => r.id !== realm.leaderId)
    endRealm(world, realm, terrain.size)
  }
  const walking = new Walking(terrain)
  const tick = () => {
    runAll(world)
    stepWorld(world, terrain, walking)
  }
  return { world, terrain, city, farm, storage, hall, add, workAt, fillFarm, leaderDies, tick }
}

/** Why a grown resident of a self-managed `city` is left doing nothing, if they are. */
function stuck(world: WorldState, terrain: TerrainMap, city: City, r: Resident): string[] {
  const o = r.order
  const away = !inCityArea(world, city, r.x, r.y, terrain.size)
  return [
    r.downUntil !== undefined && 'is Down',
    !world.cityPlans[city.id]?.jobs[r.id] && 'has no job',
    o && !NPC_ORDER_KINDS.includes(o.kind) && `holds a ${o.kind} order`,
    o?.kind === 'workAt' && !r.script && 'works by a bare work-at order',
    r.script && r.script.scriptId !== 0 && `runs the Player's script ${r.script.scriptId}`,
    away && !o && !r.script && 'stands away from home with nothing to do',
    r.aboard !== undefined && 'stays aboard a carriage',
  ].filter((p): p is string => typeof p === 'string')
}

describe('after a Leader death', () => {
  it('a full farm carries its Food home, so those who were not working do not go Down', () => {
    const { world, terrain, farm, storage, hall, add, fillFarm, leaderDies, tick } = realmInPlay()
    fillFarm()
    const idle = [0, 1, 2].map((i) => add(`idle${i}`, { x: hall.x, y: hall.y + 1 }))
    storage.stock = {}
    leaderDies()
    for (let t = 0; t < 8 * TICKS_PER_GAME_DAY; t++) {
      tick()
      expect(idle.filter((r) => r.downUntil !== undefined).map((r) => r.id)).toEqual([])
    }
    expect(invariants(world, terrain)).toEqual([])
    expect(world.residents.filter((r) => r.downUntil !== undefined)).toEqual([])
    // Food gets from the farm to the storage, and the crew goes on by the Work default.
    expect(storage.stock.food ?? 0).toBeGreaterThan(0)
    expect(buildingPile(world, farm)?.goods.food ?? 0).toBeLessThan(100)
    const crew = world.residents.filter((r) => r.order?.kind === 'workAt')
    expect(crew.length).toBeGreaterThan(0)
    for (const r of crew) expect(r.script).toMatchObject({ scriptId: 0, task: 'work' })
  }, 120_000)

  it('a resident gets a job or walks home, whatever order or task they had', () => {
    const { world, terrain, city, farm, storage, hall, add, workAt, leaderDies, tick } =
      realmInPlay()
    storage.stock = { food: 200 }
    const home = { x: hall.x, y: hall.y + 1 }
    const far = { x: hall.x + 60, y: hall.y }
    const carriage = world.carriages[0]!
    const horse = world.horses[0]!
    const drive: ResidentOrder = {
      kind: 'drive',
      carriageId: carriage.id,
      target: { x: hall.x, y: hall.y },
      path: null,
      progress: 0,
    }
    const walk: ResidentOrder = {
      kind: 'walkTo',
      target: { x: far.x + 2, y: far.y },
      path: null,
      progress: 0,
    }
    const named = [
      add('idle-home', home),
      add('idle-away', far),
      add('walking-away', far, (r) => void (r.order = walk)),
      add('driving', carriage, (r) => void (r.order = drive)),
      add('aboard', carriage, (r) => void (r.aboard = carriage.id)),
      add('riding', horse, (r) => void (r.riding = horse.id)),
      add('full-hands', home, (r) => {
        r.carried = { wood: Math.floor(carryCapacity(r, 0)) }
      }),
      add('own-script', far, (r) => void (r.script = { scriptId: 101, memory: {} })),
      add('defending', home, (r) => {
        r.script = { scriptId: 0, task: 'defend', memory: {} }
        r.interrupted = { order: drive }
      }),
      add('bare-worker', farm, (r) => void (r.order = workAt())),
      ...TASKS.map((task) =>
        add(`task-${task}`, home, (r) => void (r.script = { scriptId: 0, task, memory: {} })),
      ),
    ]
    leaderDies()
    for (let t = 0; t < 2 * TICKS_PER_GAME_DAY; t++) tick()
    expect(invariants(world, terrain)).toEqual([])
    expect(named.flatMap((r) => stuck(world, terrain, city, r).map((p) => `${r.id} ${p}`))).toEqual(
      [],
    )
  }, 120_000)

  it('an armed worker on a bare order stands as a soldier, leaving their place to others', () => {
    const { world, city, farm, add, workAt, leaderDies, tick } = realmInPlay()
    const armed = add('armed', farm, (r) => {
      r.carried = { spear: 1, food: 1 }
      r.order = workAt()
    })
    expect(isArmed(armed)).toBe(true)
    leaderDies()
    for (let t = 0; t < 70; t++) tick()
    expect(world.cityPlans[city.id]!.jobs[armed.id]?.kind).toBe('soldier')
    expect(armed.order?.kind).not.toBe('workAt')
    expect(armed.script).toBeUndefined()
  }, 120_000)
})

/** A city's farmers left on bare orders, and one of its adults Carrying with their hands full. */
function stuckVillage() {
  const { world, terrain, city, home } = village()
  const [carrier, partner, ...crew] = world.residents as [Resident, Resident, ...Resident[]]
  for (const r of crew) delete r.script
  Object.assign(carrier, { x: home.x, y: home.y })
  carrier.carried = { wood: Math.floor(carryCapacity(carrier, world.tick)) }
  startCarrying(world, carrier, partner)
  storageOf(world, city).stock = { food: 100 }
  planCity(world, city, terrain)
  world.tick += 2
  return { world, terrain, city, carrier, crew, storage: storageOf(world, city) }
}

describe('residents already stuck in a running world', () => {
  it('get going again by the next tick, with no migration', () => {
    const { world, terrain, carrier, crew, storage } = stuckVillage()
    // As from a save.
    const saved = JSON.parse(JSON.stringify(world)) as WorldState
    expect(npcResidentsKeptGoing.check(saved, terrain).length).toBeGreaterThanOrEqual(crew.length)
    stepWorld(saved, terrain, new Walking(terrain))
    for (const r of crew) {
      const now = saved.residents.find((x) => x.id === r.id)!
      expect(now.script).toMatchObject({ scriptId: 0, task: 'work' })
    }
    const c = saved.residents.find((x) => x.id === carrier.id)!
    expect(c.carried.wood ?? 0).toBe(0)
    expect(saved.buildings.find((b) => b.id === storage.id)!.stock?.wood).toBeGreaterThan(0)
    expect(npcResidentsKeptGoing.check(saved, terrain)).toEqual([])
  })

  it('are what the invariant names, but not the tick a resident starts carrying', () => {
    const { world, terrain, city, carrier, crew } = stuckVillage()
    const ids = npcResidentsKeptGoing.check(world, terrain).flatMap((v) => v.entityIds)
    expect(new Set(ids)).toEqual(new Set([carrier.id, ...crew.map((r) => r.id)]))
    carrier.carrying!.since = world.tick - 1
    expect(npcResidentsKeptGoing.check(world, terrain).flatMap((v) => v.entityIds)).not.toContain(
      carrier.id,
    )
    // Before the city's first pass it hasn't had the chance to take them on.
    delete world.cityPlans[city.id]
    expect(npcResidentsKeptGoing.check(world, terrain)).toEqual([])
  })
})
