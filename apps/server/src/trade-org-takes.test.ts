import {
  AVERAGE_HORSE_STATS,
  NPC_VILLAGE,
  OCCUPATION_TICKS,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_DEBT_TRIPS,
  Terrain,
  debtOf,
  occupierOf,
  townHallOf,
  warehouseKeeps,
  warehousePrices,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it, vi } from 'vitest'
import { placeCaravans } from './caravans.js'
import { attackOrder } from './combat.js'
import { checkInvariants } from './invariants.js'
import { foundNpcCity } from './npc-cities.js'
import { OrderQueue } from './orders.js'
import { mulberry32 } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import { punishmentsSound, stepPunishments } from './trade-org-punishment.js'
import { citiesTakenOf, citiesTakenSound } from './trade-org-takes.js'
import { placeTraders } from './traders.js'
import { foundTradingPost, storagesBecomeWarehouses } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

// Armies walk and work tick by tick; a machine under load can take a while over it.
vi.setConfig({ testTimeout: 120_000 })

const size = 512
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** The HQ with a trading post, their caravan and traders; Player 7's realm owing `coins`. */
function fixture(coins = 500, trips = TRADE_ORG_DEBT_TRIPS) {
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 128, 128, rand)
  foundTradingPost(world, terrain, 220, 128, undefined, rand)
  placeCaravans(world)
  placeTraders(world, size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  const soldiers = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
  for (const r of soldiers.slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
  const realm = foundStartingCity(world, terrain, 7)
  const city = world.cities.find((c) => c.realmId === realm.id)!
  world.debts.push({ org: realm.id, coins, step: 'wrecks', cityId: city.id, trips })
  const storage = world.buildings.find((b) => b.cityId === city.id && b.kind === 'storage')!
  storage.stock = { ...storage.stock, iron: 40, coins: 300 }
  return { world, hq, realm, city, storage, walking: new Walking(terrain) }
}
type Fixture = ReturnType<typeof fixture>

/** Stands a city's way clear: nobody of it is armed. */
function disarm(world: WorldState, city: City) {
  for (const r of world.residents) {
    if (r.cityId === city.id) delete r.carried.spear
  }
}

/** Sends out the army for the debt and stands it on the city's town hall. */
function armyOnTheHall(world: WorldState, city: City) {
  stepPunishments(world, size)
  const p = world.punishments.find((x) => x.cityId === city.id)!
  const hall = townHallOf(world, city)!
  for (const m of p.members) {
    const r = world.residents.find((x) => x.id === m.residentId)!
    r.x = hall.x
    r.y = hall.y
    r.order = null
    m.packed = true
  }
  return p
}

/** Steps the world, keeping everyone fed, with every invariant checked now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 50 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** The army holds the hall of the Player's city almost to the end, and runs out the time. */
function takeIt(s: Fixture) {
  disarm(s.world, s.city)
  const p = armyOnTheHall(s.world, s.city)
  run(s.world, s.walking, 1)
  expect(s.city.occupation?.realmId).toBe(TRADE_ORG)
  s.city.occupation!.since = s.world.tick - OCCUPATION_TICKS + 3
  run(s.world, s.walking, 10, () => s.city.tradeOrg === 'post')
  expect(s.city.tradeOrg).toBe('post')
  return p
}

const events = (world: WorldState) => world.events.filter((e) => e.userId === 7)

describe('its trips', () => {
  it('sends armies for workplaces until the set number of them reached a city', () => {
    for (let trips = 0; trips < TRADE_ORG_DEBT_TRIPS; trips++) {
      const s = fixture(500, trips)
      stepPunishments(s.world, size)
      expect(s.world.punishments[0]!.wrecks).toEqual([])
      expect(s.world.punishments[0]!.takes).toBeUndefined()
    }
    const s = fixture(500, TRADE_ORG_DEBT_TRIPS)
    stepPunishments(s.world, size)
    expect(s.world.punishments[0]!.takes).toBe(true)
    expect(s.world.punishments[0]!.wrecks).toBeUndefined()
    expect(events(s.world).at(-1)).toMatchObject({ kind: 'punished', what: 'coming', takes: true })
  })

  it('counts a trip once, when its army reaches the city', () => {
    const s = fixture(500, 0)
    const p = armyOnTheHall(s.world, s.city)
    expect(s.world.debts[0]!.trips).toBe(0)
    stepPunishments(s.world, size)
    expect(p.arrivedAt).toBeDefined()
    expect(s.world.debts[0]!.trips).toBe(1)
    stepPunishments(s.world, size)
    expect(s.world.debts[0]!.trips).toBe(1)
  })

  it('counts none for an army lost on the road', () => {
    const s = fixture(500, 0)
    stepPunishments(s.world, size)
    const p = s.world.punishments[0]!
    const lost = new Set(p.members.map((m) => m.residentId))
    s.world.residents = s.world.residents.filter((r) => !lost.has(r.id))
    stepPunishments(s.world, size)
    expect(s.world.debts[0]!.trips).toBe(0)
  })

  it('goes from wrecking to taking by itself, once the last wrecking army is home', () => {
    const s = fixture(500, TRADE_ORG_DEBT_TRIPS - 1)
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    expect(p.wrecks).toEqual([])
    stepPunishments(s.world, size)
    expect(s.world.debts[0]!.trips).toBe(TRADE_ORG_DEBT_TRIPS)
    expect(s.world.punishments).toEqual([p])
    s.world.punishments = []
    stepPunishments(s.world, size)
    expect(s.world.punishments[0]!.takes).toBe(true)
  })
})

describe('holding the town hall', () => {
  it('is an occupation only for the army come to take the city', () => {
    const wrecking = fixture(500, 0)
    disarm(wrecking.world, wrecking.city)
    armyOnTheHall(wrecking.world, wrecking.city)
    expect(occupierOf(wrecking.world, wrecking.city, size)).toBeNull()

    const taking = fixture()
    disarm(taking.world, taking.city)
    armyOnTheHall(taking.world, taking.city)
    expect(occupierOf(taking.world, taking.city, size)).toBe(TRADE_ORG)
  })

  it('runs as anyone’s: the realm’s log says so, and the city falls only at the end', () => {
    const s = fixture()
    disarm(s.world, s.city)
    armyOnTheHall(s.world, s.city)
    run(s.world, s.walking, 1)
    expect(events(s.world)).toContainEqual(
      expect.objectContaining({ kind: 'hallOccupied', other: 'the Trade Organization' }),
    )
    run(s.world, s.walking, 20)
    expect(s.city.realmId).toBe(s.realm.id)
    expect(s.city.tradeOrg).toBeUndefined()
    expect(s.world.debts).toHaveLength(1)
  })

  it('fights whoever armed stands on the hall, who breaks it meanwhile', () => {
    const s = fixture()
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    run(s.world, s.walking, 1)
    const leader = s.world.residents.find((r) => r.id === s.realm.leaderId)!
    const hall = townHallOf(s.world, s.city)!
    leader.x = hall.x
    leader.y = hall.y
    leader.carried.spear = 1
    leader.order = null
    expect(occupierOf(s.world, s.city, size)).toBeNull()
    stepPunishments(s.world, size)
    const soldier = s.world.residents.find((r) => r.id === p.members[0]!.residentId)!
    expect(soldier.order).toEqual(attackOrder(leader.id))
  })

  it('keeps one soldier on it while the others go for Food', () => {
    const s = fixture()
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    stepPunishments(s.world, size)
    for (const m of p.members) {
      const r = s.world.residents.find((x) => x.id === m.residentId)!
      r.carried.food = 0
      r.order = null
      m.own.food = 0
    }
    stepPunishments(s.world, size)
    const orders = p.members.map(
      (m) => s.world.residents.find((x) => x.id === m.residentId)!.order,
    )
    expect(orders[0]).toBeNull()
    expect(orders.slice(1).some((o) => o !== null)).toBe(true)
    expect(p.heading).toBe('out')
  })

  it('doesn’t give up with its occupation running, and does with it broken', () => {
    const s = fixture()
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    stepPunishments(s.world, size)
    s.city.occupation = { realmId: TRADE_ORG, since: s.world.tick }
    p.arrivedAt = s.world.tick - 10_000_000
    stepPunishments(s.world, size)
    expect(p.heading).toBe('out')
    s.city.occupation = null
    stepPunishments(s.world, size)
    expect(p.heading).toBe('home')
    expect(events(s.world).at(-1)).toMatchObject({ what: 'left', why: 'gaveUp', takes: true })
    // It leaves no more debt behind it, and the next one comes for the city again.
    expect(debtOf(s.world, s.realm.id)).toBe(500)
  })
})

describe('the city it takes', () => {
  it('becomes a working post', () => {
    const s = fixture()
    const { world, city, storage } = s
    const food = storage.stock!.food!
    const leader = world.residents.find((r) => r.id === s.realm.leaderId)!
    leader.cityId = city.id
    const people = world.residents.filter((r) => r.cityId === city.id && r.id !== leader.id)
    expect(people.length).toBeGreaterThan(0)
    takeIt(s)

    expect(city.realmId).toBeNull()
    expect(world.cities.filter((c) => c.tradeOrg === 'post')).toContain(city)
    // The storage is a warehouse with its goods, which it prices; the Food is in a new storage.
    expect(storage.kind).toBe('warehouse')
    expect(storage.stock).toMatchObject({ iron: 40, coins: 300 })
    expect(storage.stock!.food ?? 0).toBe(0)
    expect(warehouseKeeps(world, storage).length).toBeGreaterThan(0)
    expect(warehousePrices(world, storage).find((l) => l.good === 'iron')?.stock).toBe(40)
    const eats = world.buildings.filter((b) => b.cityId === city.id && b.kind === 'storage')
    expect(eats).toHaveLength(1)
    expect(eats[0]!.stock!.food).toBeGreaterThan(0)
    expect(eats[0]!.stock!.food).toBeLessThanOrEqual(food)
    // Its people are the post's, and the Leader stays in their realm, homeless.
    for (const r of people) {
      const now = world.residents.find((x) => x.id === r.id)
      if (now) expect(now).toMatchObject({ owner: null, cityId: city.id })
    }
    expect(leader).toMatchObject({ owner: s.realm.id, cityId: null })
    // A caravan, and traders' loops as they come round.
    expect(world.caravans.filter((c) => c.postId === city.id)).toHaveLength(1)
    run(world, s.walking, 100)
    for (const t of world.traders) expect(t.loop).toContain(city.id)
    expect(world.cities.filter((c) => c.tradeOrg === 'post')).toContain(city)
    // Its people are at work, the game running them now.
    const living = world.residents.filter((r) => r.cityId === city.id && r.owner === null)
    expect(living.some((r) => r.order !== null)).toBe(true)
  })

  it('sells to anyone, as a post does', () => {
    const s = fixture()
    takeIt(s)
    const { leaderId } = foundStartingCity(s.world, terrain, 8)
    const buyer = s.world.residents.find((r) => r.id === leaderId)!
    buyer.x = s.storage.x
    buyer.y = s.storage.y
    buyer.carried = { coins: 500 }
    buyer.order = { kind: 'trade', side: 'buy', good: 'iron', units: 3, carriageId: null }
    stepWorld(s.world, terrain, s.walking)
    expect(buyer.carried.iron).toBe(3)
    expect(buyer.carried.coins).toBeLessThan(500)
  })

  it('opens its gates to those who come to trade', () => {
    const s = fixture()
    const gates = s.world.buildings.filter((b) => b.cityId === s.city.id && b.kind === 'gate')
    expect(gates.length).toBeGreaterThan(0)
    for (const g of gates) g.closed = true
    takeIt(s)
    for (const g of gates) expect(g.closed).toBeUndefined()
  })

  it('settles the whole debt, and the army goes home', () => {
    const s = fixture(9_000)
    const p = takeIt(s)
    expect(debtOf(s.world, s.realm.id)).toBe(0)
    expect(events(s.world)).toContainEqual(
      expect.objectContaining({ kind: 'debt', what: 'cityTaken', coins: 9_000, owed: 0 }),
    )
    expect(events(s.world)).toContainEqual(
      expect.objectContaining({ kind: 'cityCaptured', other: 'the Trade Organization' }),
    )
    run(s.world, s.walking, 1)
    expect(p.heading).toBe('home')
    expect(events(s.world)).toContainEqual(
      expect.objectContaining({ what: 'left', why: 'tookCity', takes: true }),
    )
    expect(s.world.demands.filter((d) => d.toId === s.realm.id)).toEqual([])
  })

  it('takes one city for a realm with two, which keeps the other', () => {
    const s = fixture()
    addCity(s.world, { id: 'c9', realmId: s.realm.id, x: 400, y: 400, name: 'Mirk' })
    takeIt(s)
    expect(s.world.cities.find((c) => c.id === 'c9')!.realmId).toBe(s.realm.id)
    expect(s.city.tradeOrg).toBe('post')
  })

  it('is captured later as any post is', () => {
    const s = fixture()
    takeIt(s)
    run(s.world, s.walking, 400, () => s.world.punishments.length === 0)
    const hall = townHallOf(s.world, s.city)!
    const { leaderId, id } = foundStartingCity(s.world, terrain, 8)
    const taker = s.world.residents.find((r) => r.id === leaderId)!
    for (const r of s.world.residents) if (r.cityId === s.city.id) delete r.carried.spear
    taker.x = hall.x
    taker.y = hall.y
    taker.carried.spear = 1
    taker.order = null
    run(s.world, s.walking, 1)
    expect(s.city.occupation?.realmId).toBe(id)
    s.city.occupation!.since = s.world.tick - OCCUPATION_TICKS + 2
    taker.x = hall.x
    taker.y = hall.y
    run(s.world, s.walking, 10, () => s.city.realmId === id)
    expect(s.city.realmId).toBe(id)
    expect(s.city.tradeOrg).toBeUndefined()
    expect(s.storage.kind).toBe('storage')
    expect(s.world.caravans.filter((c) => c.postId === s.city.id)).toEqual([])
    expect(s.world.crimes.filter((c) => c.kind === 'capture' && c.post === s.city.id)).toHaveLength(
      1,
    )
  })

  it('takes an NPC city that owes, and the invariants hold', () => {
    const s = fixture()
    const npc = foundNpcCity(s.world, terrain, NPC_VILLAGE, 380, 128, mulberry32(9))
    npc.formerPlayer = { userId: 99, tick: 0 }
    s.world.debts = [{ org: npc.id, coins: 500, step: 'wrecks', cityId: npc.id, trips: 2 }]
    for (const r of s.world.residents) if (r.cityId === npc.id) delete r.carried.spear
    const p = armyOnTheHall(s.world, npc)
    run(s.world, s.walking, 1)
    expect(npc.occupation?.realmId).toBe(TRADE_ORG)
    npc.occupation!.since = s.world.tick - OCCUPATION_TICKS + 3
    run(s.world, s.walking, 10, () => npc.tradeOrg === 'post')
    expect(npc.tradeOrg).toBe('post')
    expect(npc.formerPlayer).toBeUndefined()
    expect(s.world.debts).toEqual([])
    // Its army punished what is the Trade Organization's own now, on its way home.
    run(s.world, s.walking, 100)
    expect(p.heading).toBe('home')
  })
})

describe('where its goods go', () => {
  it('turns every storage, with their Food all in one new storage', () => {
    const s = fixture()
    const second = {
      id: 'b-second',
      kind: 'storage' as const,
      cityId: s.city.id,
      x: s.storage.x + 3,
      y: s.storage.y,
      stock: { food: 7, wood: 5 },
    }
    s.world.buildings.push(second)
    const food = (s.storage.stock!.food ?? 0) + 7
    s.city.tradeOrg = 'post'
    storagesBecomeWarehouses(s.world, s.city, terrain)
    expect(s.storage.kind).toBe('warehouse')
    expect(second).toMatchObject({ kind: 'warehouse', stock: { wood: 5 } })
    const eats = s.world.buildings.filter((b) => b.cityId === s.city.id && b.kind === 'storage')
    expect(eats).toHaveLength(1)
    expect(eats[0]!.stock).toEqual({ food })
  })

  it('gives a city with no storage an empty storage and warehouse', () => {
    const s = fixture()
    s.world.buildings = s.world.buildings.filter((b) => b !== s.storage)
    s.city.tradeOrg = 'post'
    storagesBecomeWarehouses(s.world, s.city, terrain)
    const own = s.world.buildings.filter((b) => b.cityId === s.city.id)
    expect(own.filter((b) => b.kind === 'storage').map((b) => b.stock)).toEqual([{}])
    expect(own.filter((b) => b.kind === 'warehouse').map((b) => b.stock)).toEqual([{}])
  })

  it('with no room keeps the storage holding the most Food', () => {
    const water: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Sea) }
    const world = createWorld(water)
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
    const city = addCity(world, { id: 'c1', realmId: null, x: 100, y: 100, name: 'Ashford' })
    const add = (id: string, x: number, food: number) =>
      world.buildings.push({
        id,
        kind: 'storage',
        cityId: 'c1',
        x,
        y: 100,
        stock: { food, iron: 2 },
      })
    add('s1', 104, 4)
    add('s2', 108, 6)
    city.tradeOrg = 'post'
    storagesBecomeWarehouses(world, city, water)
    const at = (id: string) => world.buildings.find((b) => b.id === id)!
    expect(at('s2')).toMatchObject({ kind: 'storage', stock: { food: 10, iron: 2 } })
    expect(at('s1')).toMatchObject({ kind: 'warehouse', stock: { iron: 2 } })
    expect(at('s1').stock!.food).toBeUndefined()
  })
})

describe('paying first', () => {
  it('stops it at once, and it goes home', () => {
    const s = fixture()
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    run(s.world, s.walking, 1)
    expect(s.city.occupation?.realmId).toBe(TRADE_ORG)
    s.world.debts = []
    expect(occupierOf(s.world, s.city, size)).toBeNull()
    run(s.world, s.walking, 1)
    expect(s.city.occupation).toBeNull()
    expect(p.heading).toBe('home')
    expect(s.city.realmId).toBe(s.realm.id)
    expect(s.city.tradeOrg).toBeUndefined()
    expect(s.storage.kind).toBe('storage')
    expect(events(s.world)).toContainEqual(
      expect.objectContaining({ what: 'left', why: 'paid', takes: true }),
    )
    expect(events(s.world)).toContainEqual(expect.objectContaining({ kind: 'occupationBroken' }))
  })

  it('stops a city falling in the very tick the debt is paid', () => {
    const s = fixture()
    disarm(s.world, s.city)
    armyOnTheHall(s.world, s.city)
    run(s.world, s.walking, 1)
    s.city.occupation!.since = s.world.tick - OCCUPATION_TICKS - 1
    const warehouse = s.world.buildings.find((b) => b.kind === 'warehouse' && b.cityId !== null)!
    const payer = s.world.residents.find((r) => r.id === s.realm.leaderId)!
    payer.x = warehouse.x
    payer.y = warehouse.y
    payer.carried = { coins: 500 }
    const queue = new OrderQueue(undefined, terrain)
    const said = queue.receive(s.world, sender, 'a', {
      kind: 'payDebt',
      residentId: payer.id,
      coins: 500,
    })
    expect(said.type).toBe('ack')
    queue.applyAll(s.world)
    stepWorld(s.world, terrain, s.walking)
    expect(debtOf(s.world, s.realm.id)).toBe(0)
    expect(s.city.realmId).toBe(s.realm.id)
    expect(s.city.tradeOrg).toBeUndefined()
  })

  it('in part doesn’t stop it', () => {
    const s = fixture()
    disarm(s.world, s.city)
    const p = armyOnTheHall(s.world, s.city)
    run(s.world, s.walking, 1)
    s.world.debts[0]!.coins = 100
    run(s.world, s.walking, 2)
    expect(p.heading).toBe('out')
    expect(s.city.occupation?.realmId).toBe(TRADE_ORG)
  })
})

describe('the invariants', () => {
  it('catch a city taken before its trips were over', () => {
    const s = fixture()
    takeIt(s)
    citiesTakenOf(s.world)[0]!.enoughTrips = false
    expect(citiesTakenSound.check(s.world, terrain)).toHaveLength(1)
  })

  it('catch a city taken with its debt still owed, or no storage to eat from', () => {
    const s = fixture()
    takeIt(s)
    s.world.debts.push({ org: s.realm.id, coins: 1 })
    expect(citiesTakenSound.check(s.world, terrain)[0]!.message).toMatch(/still owes/)
    s.world.debts = []
    s.world.buildings = s.world.buildings.filter(
      (b) => !(b.cityId === s.city.id && b.kind === 'storage'),
    )
    expect(citiesTakenSound.check(s.world, terrain)[0]!.message).toMatch(/no storage/)
  })

  it('catch an army come to take a city before its trips are over', () => {
    const s = fixture()
    stepPunishments(s.world, size)
    expect(punishmentsSound.check(s.world, terrain)).toEqual([])
    s.world.debts[0]!.trips = 0
    expect(punishmentsSound.check(s.world, terrain)[0]!.message).toMatch(/after 0 trips/)
  })

  it('catch a city in the realm of the Trade Organization', () => {
    const s = fixture()
    s.city.realmId = TRADE_ORG
    expect(punishmentsSound.check(s.world, terrain).map((v) => v.message)).toContainEqual(
      expect.stringMatching(/holds city/),
    )
  })
})
