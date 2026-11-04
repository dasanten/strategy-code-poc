import {
  CRIME_STANDING_LOSS,
  FOOD_PER_DAY,
  MAP_SIZE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG_ARMY,
  TRADE_ORG_PUNISH,
  Terrain,
  WALK_TICKS_PER_TILE,
  carriageCapacity,
  driveOffProblem,
  inCityArea,
  punishers,
  stockWeight,
  townHallOf,
  wagonFoodFor,
  warehouseKeeps,
  wrapDistance,
  type City,
  type Crime,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { takeOver } from './stealing.js'
import { supplyWagonsSound, wagonFood } from './supply-wagons.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { stepPunishments, tookSoFar, waitingOnTheRoad, worthOf } from './trade-org-punishment.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const MID = 320

/** A grown resident of realm r1. */
function resident(world: WorldState, id: string, x: number, y: number, cityId: string | null) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** The HQ's own residents. */
const hqPeople = (world: WorldState, hq: City) =>
  world.residents.filter((r) => r.owner === null && r.cityId === hq.id)

/**
 * The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 4 soldiers and the rest of its people
 * at hand; realm r1 (Leader a1) with city c1 south of it, its storage s1 holding `stock`.
 */
function setup(stock: Stock = { coins: 1000 }) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 88, name: 'Ashford' })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: MID + 4, y: MID + 88, stock })
  resident(world, 'a1', MID - 4, MID + 92, 'c1')
  for (const r of hqPeople(world, hq).slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
  return { world, hq, walking: new Walking(terrain) }
}

/** A1 of r1 stole `goods` from the HQ, and the Trade Organization knows it and holds it lower. */
function theft(world: WorldState, hq: City, goods: Stock): Crime {
  const crime: Crime = {
    id: `x${world.crimes.length + 1}`,
    kind: 'theft',
    tick: world.tick,
    x: MID,
    y: MID + 60,
    culprit: { residentId: 'a1', name: 'Aldo', org: 'r1', orgName: 'the realm of Aldo' },
    victimOrg: hq.id,
    goods,
    witnesses: [],
    knownBy: [hq.id],
  }
  world.crimes.push(crime)
  changeStanding(world, hq.id, 'r1', -CRIME_STANDING_LOSS.theft)
  return crime
}

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

/** The world's only supply wagon, with its carriage. */
function theWagon(world: WorldState) {
  const wagon = world.supplyWagons[0]!
  return { wagon, carriage: world.carriages.find((k) => k.id === wagon.carriageId)! }
}

/** Sets a punishment off and runs it until its wagon has set off after its soldiers. */
function setOff(s: ReturnType<typeof setup>, goods: Stock = { iron: 10 }) {
  theft(s.world, s.hq, goods)
  run(s.world, s.walking, 1)
  const p = s.world.punishments[0]!
  const { wagon } = theWagon(s.world)
  run(s.world, s.walking, 2000, () => wagon.loaded === true && p.members.every((m) => m.packed))
  run(s.world, s.walking, 2 * TRADE_ORG_PUNISH.wagonRetryTicks)
  return { p, ...theWagon(s.world) }
}

describe('a Trade Org army’s supply wagon', () => {
  it('sets out with the army: a carriage of the HQ, a driver of its own, and Food', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    expect(wagon.punishmentId).toBe(p.id)
    expect(carriage).toMatchObject({ realmId: null, cityId: s.hq.id })
    expect(carriage.horseId).not.toBeNull()
    const driver = at(s.world, wagon.driverId!)
    expect(p.members.some((m) => m.residentId === driver.id)).toBe(false)
    expect(punishers(s.world).has(driver.id)).toBe(true)
    expect(carriage.load.food).toBeGreaterThan(0)
    expect(wagon.ownFood).toBe(carriage.load.food)
    // What it set out with is its own, not what it came to take.
    expect(tookSoFar(s.world, p)).toBe(0)
  }, 240_000)

  it('keeps room free of Food for what the army takes, however far it goes', () => {
    const s = setup()
    theft(s.world, s.hq, { iron: 10 })
    run(s.world, s.walking, 1)
    const { wagon, carriage } = theWagon(s.world)
    wagon.food = wagonFoodFor(4000, 8)
    expect(wagon.food).toBeGreaterThan(carriageCapacity(s.world, carriage))
    const hqFood = s.world.buildings.find((b) => b.cityId === s.hq.id && b.kind === 'storage')!
    hqFood.stock = { ...hqFood.stock, food: 1000 }
    run(s.world, s.walking, 2000, () => wagon.loaded === true)
    expect(carriageCapacity(s.world, carriage) - stockWeight(carriage.load)).toBeGreaterThanOrEqual(
      TRADE_ORG_PUNISH.wagonRoom,
    )
    expect(carriage.load.food).toBeGreaterThan(0)
  }, 240_000)

  it('goes without when the HQ has nobody free to drive it', () => {
    const { world, hq } = setup()
    world.residents = world.residents.filter((r) => r.owner !== null || r.carried.spear)
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 640)
    expect(world.punishments).toHaveLength(1)
    expect(world.supplyWagons).toEqual([])
  })

  it('follows the army along the road', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    const near = () =>
      Math.min(...p.members.map((m) => wrapDistance(640, carriage, at(s.world, m.residentId))))
    run(s.world, s.walking, 2000, () => p.arrivedAt !== undefined)
    expect(p.arrivedAt).toBeDefined()
    expect(at(s.world, wagon.driverId!).order).toMatchObject({ kind: 'drive', army: p.id })
    run(s.world, s.walking, 60)
    expect(near()).toBeLessThanOrEqual(8)
    const c1 = s.world.cities.find((c) => c.id === 'c1')!
    expect(wrapDistance(640, carriage, townHallOf(s.world, c1)!)).toBeLessThan(40)
  }, 240_000)

  it('feeds its soldiers and its driver on the way', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    const m = at(s.world, p.members[0]!.residentId)
    const driver = at(s.world, wagon.driverId!)
    // Out on the road, far from any storage of the HQ.
    const horse = s.world.horses.find((h) => h.id === carriage.horseId)!
    for (const thing of [carriage, horse, driver, m]) {
      thing.x = MID + 200
      thing.y = MID
    }
    driver.order = null
    m.order = null
    m.carried.food = 0
    p.members[0]!.own.food = 0
    expect(wagonFood(s.world, m, 640)).toBe(carriage.load)
    expect(wagonFood(s.world, driver, 640)).toBe(carriage.load)
    const before = carriage.load.food!
    run(s.world, s.walking, 2)
    expect(m.carried.food ?? 0).toBeGreaterThan(0)
    expect(carriage.load.food!).toBeLessThan(before)
    // A meal from it is no theft, and doesn't look like what it came to take.
    expect(s.world.crimes.filter((c) => c.culprit.residentId === m.id)).toEqual([])
    expect(tookSoFar(s.world, p)).toBe(0)
    // Anyone else eats nothing from it.
    const other = resident(s.world, 'a2', carriage.x, carriage.y, 'c1')
    expect(wagonFood(s.world, other, 640)).toBeUndefined()
  }, 240_000)

  it('has a soldier out of Food go to meet it when it is out of reach', () => {
    const s = setup()
    const { p, carriage } = setOff(s)
    const m = at(s.world, p.members[0]!.residentId)
    p.members[0]!.own.food = 0
    m.carried.food = 0
    m.x = carriage.x + 30
    m.y = carriage.y
    m.order = null
    for (const other of p.members.slice(1)) {
      const r = at(s.world, other.residentId)
      r.x = m.x
      r.y = m.y
    }
    stepPunishments(s.world, 640)
    expect(m.order).toMatchObject({
      kind: 'walkTo',
      target: { x: carriage.x, y: carriage.y },
    })
  }, 240_000)

  it('keeps its soldiers together on the road, at the pace of the slowest', () => {
    const s = setup()
    const { p } = setOff(s)
    const [a, b] = p.members.map((m) => at(s.world, m.residentId))
    const step = (n: number): [number, number][] => Array.from({ length: n }, () => [1, 1])
    const c1 = s.world.cities.find((c) => c.id === 'c1')!
    const hall = townHallOf(s.world, c1)!
    const walk = (n: number) => ({
      kind: 'walkTo' as const,
      target: { x: hall.x, y: hall.y },
      path: step(n),
      progress: 0,
    })
    for (const m of p.members) at(s.world, m.residentId).order = null
    a!.order = walk(10)
    b!.order = walk(40)
    expect(waitingOnTheRoad(s.world, 640)).toEqual(new Set([a!.id]))
    a!.order = walk(38)
    expect(waitingOnTheRoad(s.world, 640)).toEqual(new Set())
    // Not at the city, where each goes their own way.
    a!.order = walk(10)
    p.arrivedAt = s.world.tick
    expect(waitingOnTheRoad(s.world, 640)).toEqual(new Set())
  }, 240_000)

  it('takes on what the soldiers take and carries more home than they could', () => {
    // More than four soldiers could ever carry at once, so what they take goes on the wagon.
    const s = setup({ iron: 300 })
    const iron = s.world.buildings.find(
      (b) => b.cityId === s.hq.id && warehouseKeeps(s.world, b).includes('iron'),
    )!
    // Nobody at work at the HQ but those on the trip, so its own chain leaves its Iron be.
    const { p, wagon, carriage } = setOff(s, { iron: 100 })
    s.world.residents = s.world.residents.filter(
      (r) => r.owner !== null || r.carried.spear || r.id === wagon.driverId,
    )
    const before = iron.stock!.iron ?? 0
    const worth = TRADE_ORG_PUNISH.times * worthOf({ iron: 100 })
    let most = 0
    run(s.world, s.walking, 10 * TICKS_PER_GAME_DAY, () => {
      most = Math.max(most, carriage.load.iron ?? 0)
      return p.heading === 'home'
    })
    expect(p.heading).toBe('home')
    expect(p.took).toBe(worth)
    expect(most).toBeGreaterThan(0)
    expect(tookSoFar(s.world, p)).toBeGreaterThanOrEqual(worth)
    run(s.world, s.walking, 10 * TICKS_PER_GAME_DAY, () => s.world.supplyWagons.length === 0)
    expect(s.world.punishments).toEqual([])
    expect(s.world.supplyWagons).toEqual([])
    // All of it reached the warehouse, and the carriage and horse went back into the HQ's stock.
    expect((iron.stock!.iron ?? 0) - before).toBe(200)
    expect(s.world.buildings.find((b) => b.id === 's1')!.stock!.iron).toBe(100)
    expect(s.world.carriages.some((k) => k.id === carriage.id)).toBe(false)
    expect(s.world.horses.some((h) => h.id === carriage.horseId)).toBe(false)
    // Its driver is back with the HQ.
    const driver = at(s.world, wagon.driverId!)
    expect(punishers(s.world).has(driver.id)).toBe(false)
    expect(inCityArea(s.world, s.hq, driver.x, driver.y, 640)).toBe(true)
  }, 480_000)

  it('unloads its leftover Food at home too', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    wagon.punishmentId = null
    s.world.punishments = s.world.punishments.filter((x) => x !== p)
    for (const m of p.members) at(s.world, m.residentId).order = null
    const food = (): number =>
      s.world.buildings
        .filter((b) => b.cityId === s.hq.id && b.kind === 'warehouse')
        .reduce((sum, b) => sum + (b.stock?.food ?? 0), 0)
    const on = carriage.load.food!
    const before = food()
    run(s.world, s.walking, 3000, () => s.world.supplyWagons.length === 0)
    expect(s.world.supplyWagons).toEqual([])
    expect(food()).toBeGreaterThanOrEqual(before + on - 40)
  }, 240_000)

  it('is robbed like a caravan: a crime, and its soldiers go after the thief', () => {
    const s = setup()
    const { p, carriage } = setOff(s)
    const thief = resident(s.world, 'a2', carriage.x, carriage.y, 'c1')
    thief.order = {
      kind: 'pickUp',
      from: { kind: 'carriage', carriageId: carriage.id },
      goods: { food: 5 },
    }
    const before = carriage.load.food!
    stepPunishments(s.world, 640)
    for (const m of p.members) {
      expect(at(s.world, m.residentId).order).toMatchObject({ kind: 'attack', targetId: 'a2' })
    }
    // The carriage moves on, so the thief keeps up with it until they get a hold of something.
    for (let i = 0; i < 30 && (thief.carried.food ?? 0) === 0; i++) {
      thief.x = carriage.x
      thief.y = carriage.y
      thief.order = {
        kind: 'pickUp',
        from: { kind: 'carriage', carriageId: carriage.id },
        goods: { food: 5 },
      }
      run(s.world, s.walking, 1)
    }
    expect(carriage.load.food!).toBeLessThan(before)
    expect(thief.carried.food ?? 0).toBeGreaterThan(0)
    expect(s.world.crimes.at(-1)).toMatchObject({
      kind: 'theft',
      victimOrg: s.hq.id,
      culprit: { residentId: 'a2' },
    })
  }, 240_000)

  it('counts no more than is left on it, so a robbed army takes again', () => {
    const s = setup({ iron: 100 })
    const { p, wagon, carriage } = setOff(s)
    carriage.load.iron = 10
    expect(tookSoFar(s.world, p)).toBe(worthOf({ iron: 10 }))
    delete carriage.load.iron
    expect(tookSoFar(s.world, p)).toBe(0)
    expect(wagon.ownFood).toBe(carriage.load.food)
  }, 240_000)

  it('can’t be stolen while its driver or soldiers hold it, and is gone for them once it is', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    const horse = s.world.horses.find((h) => h.id === carriage.horseId)!
    // Off on its own, with the soldiers out of its way, and stopped for a moment.
    const park = { x: MID + 200, y: MID }
    Object.assign(carriage, park)
    Object.assign(horse, park)
    const thief = resident(s.world, 'a2', park.x, park.y, 'c1')
    const driver = at(s.world, wagon.driverId!)
    Object.assign(driver, park)
    const problem = () => driveOffProblem(s.world, thief, carriage, 'r1', 640)
    expect(problem()).toBe('someone is driving that carriage')
    driver.order = null
    expect(problem()).toBe('its driver is still with that supply wagon')
    driver.x = park.x - 100
    const soldier = at(s.world, p.members[0]!.residentId)
    const { x, y } = soldier
    Object.assign(soldier, park)
    expect(problem()).toBe('its escort guards that supply wagon')
    Object.assign(soldier, { x, y })
    expect(problem()).toBeUndefined()
    const load = { ...carriage.load }
    takeOver(s.world, thief, 'r1', { carriage, horse }, 640)
    expect(carriage.realmId).toBe('r1')
    expect(carriage.load).toEqual(load)
    expect(s.world.supplyWagons).toEqual([])
    expect(s.world.crimes.at(-1)).toMatchObject({ kind: 'theft', carriage: true })
    expect(punishers(s.world).has(driver.id)).toBe(false)
    // Its soldiers go on with what they carry.
    expect(s.world.punishments).toEqual([p])
    run(s.world, s.walking, 2000, () => p.arrivedAt !== undefined)
    expect(p.arrivedAt).toBeDefined()
  }, 240_000)

  it('has a soldier take over from a driver who died, bringing on board what they took', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    const driverId = wagon.driverId!
    s.world.residents = s.world.residents.filter((r) => r.id !== driverId)
    const taker = p.members.reduce((a, b) =>
      wrapDistance(640, at(s.world, a.residentId), carriage) <=
      wrapDistance(640, at(s.world, b.residentId), carriage)
        ? a
        : b,
    )
    const r = at(s.world, taker.residentId)
    r.carried.iron = 3
    const soldiers = p.members.length
    stepPunishments(s.world, 640)
    expect(wagon.driverId).toBe(r.id)
    expect(p.members).toHaveLength(soldiers - 1)
    expect(p.members.some((m) => m.residentId === r.id)).toBe(false)
    run(s.world, s.walking, 400, () => (carriage.load.iron ?? 0) === 3)
    expect(carriage.load.iron).toBe(3)
    expect(r.carried.iron ?? 0).toBe(0)
  }, 240_000)

  it('leaves the last soldier a soldier, and the HQ sends a new driver who packs for the walk', () => {
    const s = setup()
    const { p, wagon, carriage } = setOff(s)
    const last = p.members[0]!
    for (const m of p.members.slice(1)) {
      s.world.residents = s.world.residents.filter((r) => r.id !== m.residentId)
    }
    const old = wagon.driverId!
    s.world.residents = s.world.residents.filter((r) => r.id !== old)
    for (const r of hqPeople(s.world, s.hq)) if (r.id !== last.residentId) r.carried = {}
    // Stood far out on the road, so the walk asks for more than a meal.
    const horse = s.world.horses.find((h) => h.id === carriage.horseId)!
    for (const thing of [carriage, horse]) {
      thing.x = (MID + 320) % 640
      thing.y = (MID + 320) % 640
    }
    stepPunishments(s.world, 640)
    expect(p.members.map((m) => m.residentId)).toContain(last.residentId)
    expect(wagon.driverId).not.toBeNull()
    expect(wagon.driverId).not.toBe(old)
    expect(wagon.driverId).not.toBe(last.residentId)
    expect(wagon.sentOut).toBe(true)
    const driver = at(s.world, wagon.driverId!)
    run(s.world, s.walking, 400, () => wagon.sentOut === undefined)
    run(s.world, s.walking, 2)
    expect(driver.carried.food ?? 0).toBeGreaterThanOrEqual(2)
  }, 240_000)

  it('goes home by itself when its army is lost, and what it took leaves less owed', () => {
    const s = setup({ coins: 1000 })
    const { p, wagon, carriage } = setOff(s)
    p.arrivedAt = s.world.tick
    carriage.load.coins = 15
    p.took = 15
    const ids = new Set(p.members.map((m) => m.residentId))
    s.world.residents = s.world.residents.filter((r) => !ids.has(r.id))
    stepPunishments(s.world, 640)
    expect(s.world.punishments).toEqual([])
    expect(wagon.punishmentId).toBeNull()
    expect(s.world.debts).toEqual([{ org: 'r1', coins: p.worth - 15 }])
    const coins = s.world.buildings.find(
      (b) => b.cityId === s.hq.id && warehouseKeeps(s.world, b).includes('coins'),
    )!
    const before = coins.stock!.coins ?? 0
    run(s.world, s.walking, 3000, () => s.world.supplyWagons.length === 0)
    expect(s.world.supplyWagons).toEqual([])
    expect(coins.stock!.coins).toBe(before + 15)
  }, 240_000)

  it('ends standing where it is when its horse dies', () => {
    const s = setup()
    const { wagon, carriage } = setOff(s)
    const driver = at(s.world, wagon.driverId!)
    s.world.horses = s.world.horses.filter((h) => h.id !== carriage.horseId)
    carriage.horseId = null
    stepPunishments(s.world, 640)
    expect(s.world.supplyWagons).toEqual([])
    expect(s.world.carriages).toContain(carriage)
    expect(punishers(s.world).has(driver.id)).toBe(false)
  }, 240_000)

  it('reports a wagon that doesn’t hold together', () => {
    const s = setup()
    theft(s.world, s.hq, { iron: 10 })
    stepPunishments(s.world, 640)
    const { wagon, carriage } = theWagon(s.world)
    expect(supplyWagonsSound.check(s.world, terrain)).toEqual([])
    const soldier = s.world.punishments[0]!.members[0]!.residentId
    s.world.supplyWagons.push({ ...wagon, id: 'w2', driverId: soldier, punishmentId: 'gone' })
    wagon.ownFood = -1
    carriage.realmId = 'r1'
    const messages = supplyWagonsSound.check(s.world, terrain).map((v) => v.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        `supply wagon ${wagon.id} has carriage ${carriage.id}, which isn't the Trade Org HQ's`,
        `supply wagon ${wagon.id} calls -1 Food its own`,
        'supply wagon w2 follows gone, which is no punishment under way',
        `supply wagon w2 is driven by its soldier ${soldier}`,
      ]),
    )
  })

  it('ends with the HQ', () => {
    const s = setup()
    theft(s.world, s.hq, { iron: 10 })
    stepPunishments(s.world, 640)
    expect(s.world.supplyWagons).toHaveLength(1)
    s.world.cities = s.world.cities.filter((c) => c !== s.hq)
    stepPunishments(s.world, 640)
    expect(s.world.supplyWagons).toEqual([])
  })
})

describe('the Trade Org army’s longest trip', () => {
  const HQ = 200
  const FAR = MAP_SIZE / 2
  /**
   * As large as the real map and all Forest, so the walk takes about `walkMargin` times the straight
   * way, but for a clearing around the HQ and around the city, which need Plains to stand on.
   */
  const forest: TerrainMap = {
    size: MAP_SIZE,
    tiles: new Uint8Array(MAP_SIZE * MAP_SIZE).fill(Terrain.Forest),
  }
  for (const [mx, my] of [
    [HQ, HQ],
    [HQ + FAR, HQ + FAR],
  ] as const) {
    for (let y = my - 150; y < my + 150; y++) {
      forest.tiles.fill(Terrain.Plains, y * MAP_SIZE + mx - 150, y * MAP_SIZE + mx + 150)
    }
  }

  it(
    'reaches the farthest city on a real-size map and gets home fed, with no Food but its own',
    { tags: ['slow'], timeout: 1_800_000 },
    () => {
      const world = createWorld(forest)
      const hq = foundTradeOrgHq(world, forest, HQ, HQ, mulberry32(7))
      world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
      addCity(world, { id: 'c1', realmId: 'r1', x: HQ + FAR, y: HQ + FAR, name: 'Ashford' })
      // Coins and no Food: nothing to refill from at the city, and no posts on the way.
      world.buildings.push({
        id: 's1',
        kind: 'storage',
        cityId: 'c1',
        x: HQ + FAR + 4,
        y: HQ + FAR,
        stock: { coins: 1000 },
      })
      resident(world, 'a1', HQ + FAR - 4, HQ + FAR + 4, 'c1')
      const people = hqPeople(world, hq)
      const soldiers = people.slice(0, TRADE_ORG_ARMY.guard + 4)
      const driverToBe = people.slice(TRADE_ORG_ARMY.guard + 4, TRADE_ORG_ARMY.guard + 5)
      world.residents = world.residents.filter(
        (r) => r.cityId !== hq.id || soldiers.includes(r) || driverToBe.includes(r),
      )
      world.caravans = []
      for (const r of [...soldiers, ...driverToBe]) {
        r.carried = soldiers.includes(r) ? { spear: 1 } : {}
        const average = { base: 10, trained: 0 }
        r.stats = { ...r.stats, strength: average, endurance: average, agility: average }
        r.bornAt = -20 * 24 * 3600
        r.lifespan = 60
      }
      // An HQ that has had time to fill its storage: it can pack for all of them.
      const store = world.buildings.find((b) => b.cityId === hq.id && b.kind === 'storage')!
      store.stock = { ...store.stock, food: 1000 }
      const walking = new Walking(forest)
      theft(world, hq, { iron: 10 })
      const worth = TRADE_ORG_PUNISH.times * worthOf({ iron: 10 })
      const stepUntil = (until: () => boolean, most: number) => {
        for (let i = 0; i < most && !until(); i++) stepWorld(world, forest, walking)
      }
      stepUntil(() => world.punishments.length > 0, 2)
      const p = world.punishments[0]!
      const ids = p.members.map((m) => m.residentId)
      const { wagon, carriage } = theWagon(world)
      const driverId = wagon.driverId!
      stepUntil(() => wagon.loaded === true && p.members.every((m) => m.packed), 2000)
      stepUntil(() => false, 2)
      expect(carriage.load.food ?? 0).toBeGreaterThan(0)
      // Through Forest the way there and back eats more than any of them can pack.
      const days = (2 * FAR * Math.SQRT2 * WALK_TICKS_PER_TILE) / (0.7 * TICKS_PER_GAME_DAY)
      for (const id of ids) {
        expect(at(world, id).carried.food ?? 0).toBeLessThan(days * FOOD_PER_DAY)
      }
      stepUntil(() => p.arrivedAt !== undefined || world.punishments.length === 0, 120_000)
      expect(p.arrivedAt).toBeDefined()
      const c1 = world.cities.find((c) => c.id === 'c1')!
      expect(wrapDistance(MAP_SIZE, carriage, townHallOf(world, c1)!)).toBeLessThan(100)
      stepUntil(() => world.supplyWagons.length === 0, 140_000)
      expect(world.punishments).toEqual([])
      expect(world.supplyWagons).toEqual([])
      expect(world.buildings.find((b) => b.id === 's1')!.stock!.coins).toBe(1000 - worth)
      for (const id of [...ids, driverId]) {
        const r = at(world, id)
        expect(r.health).toBeGreaterThan(0)
        expect(r.downUntil).toBeUndefined()
        expect(inCityArea(world, hq, r.x, r.y, MAP_SIZE)).toBe(true)
      }
      expect(checkInvariants(world, forest)).toEqual([])
    },
  )
})
