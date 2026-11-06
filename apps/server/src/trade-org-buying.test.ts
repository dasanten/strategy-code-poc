import {
  CRIME_STANDING_LOSS,
  NPC_VILLAGE,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_PUNISH,
  Terrain,
  standingOf,
  warehouseKeeps,
  type Offer,
  type Punishment,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { newCaravanCarriage } from './caravans.js'
import { checkInvariants } from './invariants.js'
import { foundNpcCity } from './npc-cities.js'
import { attackersOf } from './npc-defence.js'
import { offersAcceptedIn, tradeOrgOnlyBuysFood } from './offers.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { takenBy, tookSoFar } from './trade-org-punishment.js'
import { resolveTrades } from './trading.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const open: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const MID = 320
/** Where the soldier is staged, on the road south of the HQ, and the target city far beyond them. */
const ROAD = { x: MID + 2, y: MID + 100 }
const TARGET_Y = MID + 280
/** A place near the soldier on the road. */
const NEAR = { x: ROAD.x + 16, y: ROAD.y }

/** The grown Leader of a realm, far from everything. */
function addLeader(world: WorldState, id: string, owner: string, cityId: string) {
  const leader = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
    cityId,
    x: MID - 200,
    y: MID - 200,
    tick: 0,
  })
  leader.bornAt = -20 * 24 * 3600
  leader.lifespan = 60
  world.residents.push(leader)
  return leader
}

/**
 * The Trade Org HQ at (MID, MID) with soldiers, realm r1 (Leader a1) with city c1 far south of it to
 * be punished, and realm r2 with city c2 elsewhere. One soldier is under way on
 * the road with nothing to eat and a purse, with no supply wagon.
 */
function setup(terrain: TerrainMap = open) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'a2' })
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: TARGET_Y, name: 'Ashford' })
  world.buildings.push({
    id: 's1',
    kind: 'storage',
    cityId: 'c1',
    x: MID + 4,
    y: TARGET_Y,
    stock: { coins: 1000 },
  })
  addCity(world, { id: 'c2', realmId: 'r2', x: NEAR.x + 200, y: NEAR.y, name: 'Brook' })
  addLeader(world, 'a1', 'r1', 'c1')
  addLeader(world, 'a2', 'r2', 'c2')
  const people = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
  for (const r of people.slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
  world.crimes.push({
    id: 'x1',
    kind: 'theft',
    tick: world.tick,
    x: MID,
    y: TARGET_Y - 20,
    culprit: { residentId: 'a1', name: 'Aldo', org: 'r1', orgName: 'the realm of Aldo' },
    victimOrg: hq.id,
    goods: { iron: 10 },
    witnesses: [],
    knownBy: [hq.id],
  })
  changeStanding(world, hq.id, 'r1', -CRIME_STANDING_LOSS.theft)
  const walking = new Walking(terrain)
  stepWorld(world, terrain, walking)
  const p = world.punishments[0]!
  // One soldier on the road, the rest and the wagon out of it.
  for (const m of p.members.slice(1)) {
    const r = world.residents.find((x) => x.id === m.residentId)!
    r.order = null
  }
  p.members = p.members.slice(0, 1)
  for (const w of world.supplyWagons) {
    const driver = world.residents.find((r) => r.id === w.driverId)
    if (driver) driver.order = null
    world.carriages = world.carriages.filter((k) => k.id !== w.carriageId)
  }
  world.supplyWagons = []
  const m = p.members[0]!
  m.packed = true
  const r = world.residents.find((x) => x.id === m.residentId)!
  r.x = ROAD.x
  r.y = ROAD.y
  r.order = null
  r.carried = { spear: 1, coins: TRADE_ORG_PUNISH.purse }
  m.own = { spear: 1, coins: TRADE_ORG_PUNISH.purse }
  return { world, hq, walking, terrain, p, m, r }
}

type Staged = ReturnType<typeof setup>

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(s: Staged, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of s.world.residents) r.hunger = 100
    stepWorld(s.world, s.terrain, s.walking)
    if (i % 100 === 0) expect(checkInvariants(s.world, s.terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(s.world, s.terrain)).toEqual([])
}

/** A trading post with a warehouse of Food near the soldier. */
function post(world: WorldState, food = 50) {
  addCity(world, {
    id: 'post',
    realmId: null,
    x: NEAR.x,
    y: NEAR.y + 8,
    name: 'Waypost',
    tradeOrg: 'post',
  })
  const stock: Stock = { food }
  world.buildings.push({ id: 'pw', kind: 'warehouse', cityId: 'post', ...NEAR, stock })
  return world.buildings.find((b) => b.id === 'pw')!
}

/** An NPC city with a storage of Food near the soldier, and nobody to feed. */
function npcCity(world: WorldState, food = 50) {
  addCity(world, { id: 'n1', realmId: null, x: NEAR.x, y: NEAR.y + 8, name: 'Millbrook' })
  world.buildings.push({ id: 'ns', kind: 'storage', cityId: 'n1', ...NEAR, stock: { food } })
  return world.buildings.find((b) => b.id === 'ns')!
}

/** A storage of `realmId` near the soldier with a Food offer, 2 Food for `coins` Coins, 10 times. */
function foodOffer(world: WorldState, realmId = 'r2', coins = 4): Offer {
  addCity(world, { id: 'c3', realmId, x: NEAR.x, y: NEAR.y + 8, name: 'Crossing' })
  world.buildings.push({ id: 'off', kind: 'storage', cityId: 'c3', ...NEAR, stock: { food: 20 } })
  const offer: Offer = {
    id: 'o1',
    realmId,
    storageId: 'off',
    ...NEAR,
    gives: 'food',
    givesUnits: 2,
    wants: 'coins',
    wantsUnits: coins,
    times: 10,
  }
  world.offers.push(offer)
  return offer
}

/**
 * A walled NPC village with its gate near the soldier and plenty of Food in its storage, which lies
 * east of them, walls and all between.
 */
function gatedCity(s: Staged) {
  const { x, y } = { x: ROAD.x + 20, y: ROAD.y - 14 }
  const city = foundNpcCity(s.world, s.terrain, NPC_VILLAGE, x, y, mulberry32(7))
  const inCity = (kind: string) =>
    s.world.buildings.find((b) => b.cityId === city.id && b.kind === kind)!
  const storage = inCity('storage')
  storage.stock!.food = 1000
  return { city, storage, gate: inCity('gate') }
}

const food = (s: Staged) => s.r.carried.food ?? 0
const coins = (s: Staged) => s.r.carried.coins ?? 0
const bought = (s: Staged) => food(s) >= 1

/** Runs a soldier with no seller to go to, and sees they go on towards the city with nothing bought. */
function expectGoesOn(s: Staged, ticks = 120) {
  const startY = s.r.y
  run(s, ticks)
  expect(food(s)).toBe(0)
  expect(coins(s)).toBe(TRADE_ORG_PUNISH.purse)
  expect(s.r.y).toBeGreaterThan(startY + 5)
  expect(s.r.x).toBeLessThan(NEAR.x)
}

describe('a Trade Org army buying Food on the way', () => {
  it('packs Coins at the HQ, its own and no taking', () => {
    const world = createWorld(open)
    const hq = foundTradeOrgHq(world, open, MID, MID, mulberry32(7))
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
    addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 88, name: 'Ashford' })
    addLeader(world, 'a1', 'r1', 'c1')
    world.buildings.push({
      id: 's1',
      kind: 'storage',
      cityId: 'c1',
      x: MID + 4,
      y: MID + 88,
      stock: {},
    })
    const people = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
    for (const r of people.slice(0, TRADE_ORG_ARMY.guard + 1)) r.carried.spear = 1
    const coinHouse = world.buildings.find(
      (b) => b.cityId === hq.id && warehouseKeeps(world, b).includes('coins'),
    )!
    coinHouse.stock = { ...coinHouse.stock, coins: 1000 }
    world.crimes.push({
      id: 'x1',
      kind: 'theft',
      tick: 0,
      x: MID,
      y: MID + 60,
      culprit: { residentId: 'a1', name: 'Aldo', org: 'r1', orgName: 'the realm of Aldo' },
      victimOrg: hq.id,
      goods: { iron: 10 },
      witnesses: [],
      knownBy: [hq.id],
    })
    changeStanding(world, hq.id, 'r1', -CRIME_STANDING_LOSS.theft)
    const walking = new Walking(open)
    stepWorld(world, open, walking)
    const p = world.punishments[0]! as Punishment
    const soldier = () => world.residents.find((r) => r.id === p.members[0]!.residentId)!
    for (let i = 0; i < 1500 && !p.members[0]!.packed; i++) {
      for (const r of world.residents) r.hunger = 100
      stepWorld(world, open, walking)
    }
    expect(soldier().carried.coins).toBe(TRADE_ORG_PUNISH.purse)
    expect(takenBy(soldier(), p.members[0]!.own).coins).toBeUndefined()
    expect(tookSoFar(world, p)).toBe(0)
    expect(checkInvariants(world, open)).toEqual([])
  }, 240_000)

  it('buys at a trading post it passes, by the same trade: Coins go into its warehouse', () => {
    const s = setup()
    const place = post(s.world)
    run(s, 400, () => bought(s))
    expect(food(s)).toBeGreaterThanOrEqual(1)
    expect(place.stock!.food).toBeLessThan(50)
    expect(place.stock!.coins).toBe(TRADE_ORG_PUNISH.purse - coins(s))
    expect(coins(s)).toBeLessThan(TRADE_ORG_PUNISH.purse)
    expect(s.world.crimes.filter((c) => c.kind === 'theft').length).toBe(1)
    expect(takenBy(s.r, s.m.own)).toEqual({})
  })

  it('buys from an NPC city it passes, which raises its standing like any trade', () => {
    const s = setup()
    const place = npcCity(s.world)
    run(s, 400, () => bought(s))
    expect(place.stock!.food).toBeLessThan(50)
    expect(place.stock!.coins).toBe(TRADE_ORG_PUNISH.purse - coins(s))
    expect(standingOf(s.world, 'n1', TRADE_ORG)).toBeGreaterThan(0)
    expect(takenBy(s.r, s.m.own)).toEqual({})
  })

  it("takes a Player's Food offer it passes, and the Player hears of it", () => {
    const s = setup()
    const offer = foodOffer(s.world)
    run(s, 400, () => bought(s))
    const place = s.world.buildings.find((b) => b.id === 'off')!
    expect(offer.times).toBeLessThan(10)
    expect(place.stock!.coins).toBe(TRADE_ORG_PUNISH.purse - coins(s))
    expect(food(s) % 2).toBe(0)
    expect(s.world.events.some((e) => e.kind === 'offerTaken' && e.userId === 8)).toBe(true)
    expect(standingOf(s.world, 'r2', TRADE_ORG)).toBeGreaterThan(0)
    expect(takenBy(s.r, s.m.own)).toEqual({})
    // Food for Coins by a soldier is the one offer the Trade Organization takes.
    const record = { residentId: s.r.id, before: {}, after: {} }
    offersAcceptedIn(s.world).length = 0
    offersAcceptedIn(s.world).push({ ...record, foodForCoins: true })
    expect(tradeOrgOnlyBuysFood.check(s.world, s.terrain)).toEqual([])
    offersAcceptedIn(s.world).push({ ...record, foodForCoins: false })
    expect(tradeOrgOnlyBuysFood.check(s.world, s.terrain)).toHaveLength(1)
    offersAcceptedIn(s.world).length = 0
  })

  it('buys on the way home too', () => {
    const s = setup()
    post(s.world)
    s.p.heading = 'home'
    s.p.arrivedAt = s.world.tick
    run(s, 400, () => bought(s))
    expect(food(s)).toBeGreaterThanOrEqual(1)
    expect(takenBy(s.r, s.m.own)).toEqual({})
  })

  it('with no seller near goes on hungry', () => {
    const s = setup()
    expectGoesOn(s)
    expect(s.r.order?.kind).toBe('walkTo')
  })

  it('with no Coins goes on hungry, past a seller', () => {
    const s = setup()
    npcCity(s.world)
    s.r.carried = { spear: 1 }
    s.m.own = { spear: 1 }
    run(s, 120)
    expect(food(s)).toBe(0)
    expect(s.r.x).toBeLessThan(NEAR.x)
  })

  it("walks through an NPC city's gate, buys at its storage and walks on", () => {
    const s = setup()
    const { storage, gate } = gatedCity(s)
    run(s, 800, () => {
      expect(gate.closed).toBeUndefined()
      return bought(s)
    })
    expect(bought(s)).toBe(true)
    expect(coins(s)).toBeLessThan(TRADE_ORG_PUNISH.purse)
    expect(storage.stock!.food).toBeLessThan(1000)
    // Bought, they leave by the gate and carry on south, past the city's walls.
    run(s, 1500, () => s.r.y > ROAD.y + 30)
    expect(s.r.y).toBeGreaterThan(ROAD.y + 30)
  })

  it('is not fought by the city while it buys, armed as they are', () => {
    const s = setup()
    const { city } = gatedCity(s)
    const people = s.world.residents.filter((r) => r.owner === null && r.cityId === city.id)
    for (const r of people) r.carried.spear = 1
    const health = s.r.health
    run(s, 800, () => {
      for (const r of people) expect(r.order?.kind).not.toBe('attack')
      expect(attackersOf(s.world, city, s.terrain.size)).toEqual([])
      return bought(s)
    })
    expect(bought(s)).toBe(true)
    expect(s.r.health).toBe(health)
  })

  it('is shut out by a gated city that refuses the Trade Organization, and goes on', () => {
    const s = setup()
    const { city, gate } = gatedCity(s)
    changeStanding(s.world, city.id, TRADE_ORG, -60)
    Object.assign(s.r, { x: gate.x, y: gate.y + 10 })
    run(s, 1)
    expect(gate.closed).toBe(true)
    const startY = s.r.y
    run(s, 120)
    expect(food(s)).toBe(0)
    expect(coins(s)).toBe(TRADE_ORG_PUNISH.purse)
    expect(s.r.y).toBeGreaterThan(startY + 5)
  })

  it('finds a gated city shut while another armed outsider is near, and goes on', () => {
    const s = setup()
    const { storage, gate } = gatedCity(s)
    const other = addLeader(s.world, 'b1', 'r2', 'c2')
    Object.assign(other, { x: gate.x, y: gate.y + 3, order: null, carried: { spear: 1 } })
    run(s, 800, () => {
      Object.assign(other, { x: gate.x, y: gate.y + 3, order: null })
      expect(gate.closed).toBe(true)
      return s.m.noWay?.includes(storage.id) ?? false
    })
    expect(s.m.noWay).toContain(storage.id)
    expect(food(s)).toBe(0)
    expect(coins(s)).toBe(TRADE_ORG_PUNISH.purse)
    const startY = s.r.y
    run(s, 120)
    expect(s.r.y).toBeGreaterThan(startY)
  })

  it('passes by an NPC city that refuses the Trade Organization', () => {
    const s = setup()
    npcCity(s.world)
    changeStanding(s.world, 'n1', TRADE_ORG, -60)
    expectGoesOn(s)
  })

  it('is refused at the storage by a city that has come to refuse it since', () => {
    const s = setup()
    const place = npcCity(s.world)
    changeStanding(s.world, 'n1', TRADE_ORG, -60)
    s.r.x = place.x
    s.r.y = place.y
    s.r.order = { kind: 'trade', side: 'buy', good: 'food', units: 3, carriageId: null }
    expect(resolveTrades(s.world, s.terrain.size)).toBe(0)
    expect(food(s)).toBe(0)
    expect(coins(s)).toBe(TRADE_ORG_PUNISH.purse)
    expect(place.stock!.food).toBe(50)
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('passes by an offer asking too much', () => {
    const s = setup()
    foodOffer(s.world, 'r2', 2 * TRADE_ORG_PUNISH.offerFoodPrice + 2)
    expectGoesOn(s)
  })

  it('buys nothing from the one it is punishing', () => {
    const s = setup()
    foodOffer(s.world, 'r1')
    expectGoesOn(s)
  })

  it('buys nothing from an Organization the Trade Organization refuses', () => {
    const s = setup()
    foodOffer(s.world)
    changeStanding(s.world, s.hq.id, 'r2', -60)
    expectGoesOn(s)
  })

  it('leaves a Direct offer alone', () => {
    const s = setup()
    const offer = foodOffer(s.world)
    offer.direct = { toId: 'r1', lapsesAt: s.world.tick + 100_000 }
    expectGoesOn(s)
  })

  /** A supply wagon beside the soldier with `load` Food on it and nobody driving yet. */
  function wagonWith(s: Staged, load: number) {
    const carriageId = newCaravanCarriage(s.world, s.hq, s.r.x, s.r.y, 'test:wagon-horse')
    s.world.carriages.find((k) => k.id === carriageId)!.load = { food: load }
    s.world.supplyWagons.push({
      id: 'w1',
      punishmentId: s.p.id,
      carriageId,
      driverId: null,
      food: load,
      ownFood: load,
      holding: null,
      loaded: true,
    })
  }

  it('is not short with its share of the wagon, however little it carries', () => {
    const s = setup()
    const place = npcCity(s.world)
    wagonWith(s, 100)
    run(s, 60)
    expect(place.stock!.food).toBe(50)
    expect(coins(s)).toBe(TRADE_ORG_PUNISH.purse)
  })

  it('buys when its wagon set out short from a poor HQ, without turning back for it', () => {
    const s = setup()
    const place = npcCity(s.world)
    wagonWith(s, 2)
    run(s, 400, () => (place.stock!.food ?? 0) < 50)
    expect(place.stock!.food).toBeLessThan(50)
    expect(coins(s)).toBeLessThan(TRADE_ORG_PUNISH.purse)
  })

  it('what it bought and spent counts for nothing against what it came for or the debt', () => {
    const s = setup()
    post(s.world)
    run(s, 400, () => bought(s))
    run(s, 2)
    expect(tookSoFar(s.world, s.p)).toBe(0)
    expect(s.p.took).toBe(0)
    // Coins taken later are told from what is left of the purse.
    const spent = TRADE_ORG_PUNISH.purse - coins(s)
    expect(spent).toBeGreaterThan(0)
    expect(s.m.own.coins).toBe(coins(s))
    // The city goes: it turns back having taken nothing, so the whole of it stays owed.
    s.world.residents.find((r) => r.id === 'a1')!.cityId = null
    s.world.cities.find((c) => c.id === 'c1')!.realmId = 'r2'
    run(s, 1)
    expect(s.p.heading).toBe('home')
    expect(s.world.debts.find((d) => d.org === 'r1')?.coins).toBe(s.p.worth)
  })

  it('tells Coins taken from what is left of its purse', () => {
    const s = setup()
    s.r.carried.coins = 20
    run(s, 1)
    expect(s.m.own.coins).toBe(20)
    s.r.carried.coins = 120
    expect(takenBy(s.r, s.m.own)).toEqual({ coins: 100 })
    expect(tookSoFar(s.world, s.p)).toBe(100)
  })

  it('finds no way to a seller walled off from it and goes on', () => {
    const tiles = new Uint8Array(open.tiles)
    const size = open.size
    for (let dx = -4; dx <= 4; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 4) continue
        tiles[(NEAR.y + dy) * size + NEAR.x + dx] = Terrain.Sea
      }
    }
    const s = setup({ size, tiles })
    const place = npcCity(s.world)
    run(s, 2000, () => (s.m.noWay ?? []).length > 0)
    expect(s.m.noWay).toEqual([place.id])
    expect(s.m.seller).toBeUndefined()
    const y = s.r.y
    run(s, 120)
    expect(s.r.y).toBeGreaterThan(y + 5)
    expect(food(s)).toBe(0)
  }, 60_000)

  it('hands in what is left of its purse back home', () => {
    const s = setup()
    const coinHouse = s.world.buildings.find(
      (b) => b.cityId === s.hq.id && warehouseKeeps(s.world, b).includes('coins'),
    )!
    const before = coinHouse.stock?.coins ?? 0
    s.p.heading = 'home'
    s.p.arrivedAt = s.world.tick
    s.r.carried.food = 10
    s.m.own.food = 10
    s.r.x = coinHouse.x
    s.r.y = coinHouse.y + 2
    s.r.order = null
    run(s, 600, () => s.world.punishments.length === 0)
    expect(s.world.punishments).toEqual([])
    expect(s.r.carried.coins ?? 0).toBe(0)
    expect(coinHouse.stock!.coins).toBeGreaterThanOrEqual(before + TRADE_ORG_PUNISH.purse)
  }, 60_000)
})
