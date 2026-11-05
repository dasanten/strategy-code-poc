import {
  AVERAGE_HORSE_STATS,
  FOOTPRINT,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_DEBT_DEMAND_DAYS,
  TRADE_ORG_LOSS,
  Terrain,
  debtOf,
  townHallOf,
  tradingWarehouseAt,
  type City,
  type Crime,
  type Resident,
  type TerrainMap,
  type Trader,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { placeCaravans } from './caravans.js'
import { captureCity } from './capture.js'
import { stepCrimes } from './crimes.js'
import { stepDemands } from './demands.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32 } from './residents.js'
import { foundStartingCity } from './starting-city.js'
import { endRealm } from './survival.js'
import { debtDemandsSound, oweTradeOrg, stepDebts } from './trade-org-debt.js'
import { foundTradeOrgHq } from './trade-org.js'
import { stepPunishments } from './trade-org-punishment.js'
import { placeTraders } from './traders.js'
import { foundTradingPost, tradingPosts } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const size = 512
const terrain: TerrainMap = { size, tiles: new Uint8Array(size * size).fill(Terrain.Plains) }
const WORTH = TRADE_ORG_LOSS.capture

/** The Trade Org HQ, three trading posts with their caravans and traders, and a Player's realm. */
function fixture() {
  const world = createWorld(terrain)
  const rand = mulberry32(5)
  const hq = foundTradeOrgHq(world, terrain, 128, 128, rand)
  const posts = [
    foundTradingPost(world, terrain, 220, 128, undefined, rand),
    foundTradingPost(world, terrain, 220, 220, undefined, rand),
    foundTradingPost(world, terrain, 128, 220, undefined, rand),
  ]
  placeCaravans(world)
  const traders = placeTraders(world, size)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  const realm = foundStartingCity(world, terrain, 7)
  const leader = world.residents.find((r) => r.id === realm.leaderId)!
  const sender = { userId: 7, account: { name: 'Mara', isAdmin: false } }
  return { world, hq, posts, traders, realm, leader, sender, post: posts[0]! }
}
type Fixture = ReturnType<typeof fixture>

/** `by`, armed, stands on the post's town hall as it falls to their realm. */
function capture(world: WorldState, post: City, by: Resident) {
  const hall = townHallOf(world, post)!
  by.x = hall.x
  by.y = hall.y
  by.carried.spear = 1
  by.order = null
  captureCity(world, post, by.owner!, size)
}

const captureOf = (world: WorldState, post: City): Crime =>
  world.crimes.find((c) => c.kind === 'capture' && c.post === post.id)!

/** The news of the post's capture comes in: someone of the Trade Org gets to its HQ with it. */
function newsComes(s: Fixture, post = s.post, trader: Trader = s.traders[0]!) {
  const crime = captureOf(s.world, post)
  const witness = s.world.residents.find((r) => r.id === trader.driverId)!
  const hall = townHallOf(s.world, s.hq)!
  witness.x = hall.x
  witness.y = hall.y
  crime.witnesses = [witness.id]
  stepCrimes(s.world, size)
  expect(crime.knownBy).toContain(crime.victimOrg)
  stepDebts(s.world)
}

/** A post taken and heard of: what the Trade Organization then wants of the realm. */
function heardOf() {
  const s = fixture()
  capture(s.world, s.post, s.leader)
  newsComes(s)
  return s
}

const postDemand = (world: WorldState, post: City) =>
  world.demands.find((d) => d.terms.kind === 'city' && d.terms.cityId === post.id)

const coinDemand = (world: WorldState) => world.demands.find((d) => d.terms.kind === 'goods')

/** The Player's answer to the demand, applied, and what it says. */
function answer(
  s: Fixture,
  kind: 'acceptDemand' | 'declineDemand',
  demandId = postDemand(s.world, s.post)!.id,
) {
  const queue = new OrderQueue(undefined, terrain)
  const said = queue.receive(s.world, s.sender, 'a', { kind, demandId })
  queue.applyAll(s.world)
  return said.type === 'ack' ? 'ack' : (said as { reason: string }).reason
}

const events = (world: WorldState) => world.events.filter((e) => e.userId === 7)

const debtEvents = (world: WorldState, what: string) =>
  events(world).filter((e) => e.kind === 'debt' && e.what === what)

describe('a captured post the Trade Organization has not heard of', () => {
  it('owes nothing and is asked for nothing, however long it stands', () => {
    const s = fixture()
    capture(s.world, s.post, s.leader)
    for (let i = 0; i < 10; i++) {
      stepCrimes(s.world, size)
      stepDebts(s.world)
      stepPunishments(s.world, size)
      s.world.tick += TICKS_PER_GAME_DAY
    }
    expect(s.world.debts).toEqual([])
    expect(s.world.demands).toEqual([])
    expect(s.world.punishments).toEqual([])
  })
})

describe('once it has heard who took a post', () => {
  it('demands the city back with a debt for its worth, and sends no army', () => {
    const s = heardOf()
    const d = postDemand(s.world, s.post)!
    expect(s.world.debts).toEqual([{ org: s.realm.id, coins: WORTH, cityId: s.post.id }])
    expect(d).toMatchObject({
      fromId: TRADE_ORG,
      toId: s.realm.id,
      terms: { kind: 'city', cityId: s.post.id, cityName: s.post.name },
      deadline: s.world.tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY,
    })
    expect(coinDemand(s.world)).toBeUndefined()
    expect(captureOf(s.world, s.post).punished).toBe(true)
    expect(debtEvents(s.world, 'postOwed')).toHaveLength(1)
    expect(
      events(s.world).filter((e) => e.kind === 'demand' && e.what === 'received'),
    ).toHaveLength(1)
    // It knows, however low its standing went: the debt is what it does about it.
    for (const r of s.world.residents) {
      if (r.cityId === s.hq.id && r.owner === null) r.carried.spear = 1
    }
    stepPunishments(s.world, size)
    expect(s.world.punishments).toEqual([])
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })

  it('does so once, however often its debts come round', () => {
    const s = heardOf()
    stepDebts(s.world)
    stepDebts(s.world)
    expect(s.world.demands).toHaveLength(1)
    expect(s.world.debts[0]!.coins).toBe(WORTH)
  })

  it('with a city they no longer hold, it is a debt like any: a demand for the Coins', () => {
    const s = fixture()
    capture(s.world, s.post, s.leader)
    const other = foundStartingCity(s.world, terrain, 8)
    s.post.realmId = other.id
    newsComes(s)
    expect(postDemand(s.world, s.post)).toBeUndefined()
    expect(coinDemand(s.world)).toMatchObject({
      toId: s.realm.id,
      terms: { goods: { coins: WORTH } },
    })
  })

  it('asks a realm that owes already for both, its demand for the Coins rising by the worth', () => {
    const s = fixture()
    oweTradeOrg(s.world, s.realm.id, 300)
    stepDebts(s.world)
    expect(coinDemand(s.world)!.terms).toEqual({ kind: 'goods', goods: { coins: 300 } })
    capture(s.world, s.post, s.leader)
    newsComes(s)
    expect(debtOf(s.world, s.realm.id)).toBe(300 + WORTH)
    expect(coinDemand(s.world)!.terms).toEqual({ kind: 'goods', goods: { coins: 300 + WORTH } })
    expect(postDemand(s.world, s.post)).toBeDefined()
    expect(debtEvents(s.world, 'rose')).toHaveLength(1)
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })

  it('reacts to nothing at all once the HQ has fallen', () => {
    const s = fixture()
    capture(s.world, s.post, s.leader)
    captureOf(s.world, s.post).knownBy.push(captureOf(s.world, s.post).victimOrg)
    delete s.hq.tradeOrg
    stepDebts(s.world)
    expect(s.world.debts).toEqual([])
    expect(s.world.demands).toEqual([])
  })
})

describe('giving the post back', () => {
  it('settles the debt and makes it a trading post again', () => {
    const s = heardOf()
    const warehouseStock = () =>
      s.world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === s.post.id)?.stock
    const before = s.world.buildings.filter((b) => b.cityId === s.post.id && b.kind === 'storage')
    expect(before).toHaveLength(2)
    before[1]!.stock = { coins: 777, wood: 5 }
    expect(answer(s, 'acceptDemand')).toBe('ack')
    expect(s.post).toMatchObject({ tradeOrg: 'post', realmId: null })
    expect(tradingPosts(s.world)).toContain(s.post)
    expect(warehouseStock()).toEqual({ coins: 777, wood: 5 })
    expect(s.world.buildings.filter((b) => b.cityId === s.post.id && b.kind === 'storage')).toEqual(
      [before[0]],
    )
    expect(s.world.debts).toEqual([])
    expect(s.world.demands).toEqual([])
    expect(debtEvents(s.world, 'postReturned')).toEqual([
      expect.objectContaining({ coins: WORTH, owed: 0 }),
    ])
    expect(
      events(s.world).filter((e) => e.kind === 'demand' && e.what === 'accepted'),
    ).toHaveLength(1)
  })

  it('gives it back its people, horses and carriages, and a Leader stays in the realm', () => {
    const s = fixture()
    const living = s.world.residents.filter((r) => r.cityId === s.post.id)
    // The Leader moved in while they held it.
    capture(s.world, s.post, s.leader)
    s.leader.cityId = s.post.id
    const hall = townHallOf(s.world, s.post)!
    const carriage = {
      id: 'k-in-post',
      realmId: s.realm.id,
      cityId: null,
      x: hall.x,
      y: hall.y,
      horseId: null,
      load: {},
    }
    s.world.carriages.push(carriage)
    newsComes(s)
    answer(s, 'acceptDemand')
    for (const r of living) {
      expect(r).toMatchObject({ owner: null, cityId: s.post.id, order: null })
    }
    expect(s.leader).toMatchObject({ owner: s.realm.id, cityId: null })
    expect(carriage).toMatchObject({ realmId: null, cityId: s.post.id })
  })

  it('leaves a working post: it trades, has its caravan, and traders call again', () => {
    const s = heardOf()
    const walking = new Walking(terrain)
    expect(s.world.caravans.filter((c) => c.postId === s.post.id)).toEqual([])
    answer(s, 'acceptDemand')
    expect(s.world.caravans.filter((c) => c.postId === s.post.id)).toHaveLength(1)
    const warehouse = s.world.buildings.find(
      (b) => b.kind === 'warehouse' && b.cityId === s.post.id,
    )!
    // Another realm buys there, as anywhere the Trade Organization trades.
    const { leaderId } = foundStartingCity(s.world, terrain, 8)
    const buyer = s.world.residents.find((r) => r.id === leaderId)!
    buyer.x = warehouse.x
    buyer.y = warehouse.y
    buyer.carried = { coins: 1_000 }
    warehouse.stock = { ...warehouse.stock, food: 50 }
    buyer.order = { kind: 'trade', side: 'buy', good: 'food', units: 3, carriageId: null }
    expect(tradingWarehouseAt(s.world, warehouse.x, warehouse.y)).toMatchObject({
      id: warehouse.id,
    })
    stepWorld(s.world, terrain)
    expect(buyer.carried.food).toBe(3)
    expect(buyer.carried.coins).toBeLessThan(1_000)
    const left = () => s.world.residents.filter((r) => r.cityId === s.post.id && r.owner === null)
    for (let i = 0; i < 100; i++) {
      stepWorld(s.world, terrain, walking)
      if (i % 10 === 0) expect(checkInvariants(s.world, terrain)).toEqual([])
    }
    for (const t of s.world.traders) expect(t.loop).toContain(s.post.id)
    expect(left().length).toBeGreaterThan(0)
    expect(s.post.tradeOrg).toBe('post')
    // Its own people are at work again, the game running them.
    expect(left().some((r) => r.order !== null)).toBe(true)
  })

  it('takes off only the post’s worth: anything else owed stays, and gets its own demand', () => {
    const s = fixture()
    capture(s.world, s.post, s.leader)
    newsComes(s)
    oweTradeOrg(s.world, s.realm.id, 300)
    stepDebts(s.world)
    expect(coinDemand(s.world)).toBeUndefined()
    answer(s, 'acceptDemand')
    expect(s.world.debts).toEqual([expect.objectContaining({ org: s.realm.id, coins: 300 })])
    stepDebts(s.world)
    expect(coinDemand(s.world)).toMatchObject({ terms: { goods: { coins: 300 } } })
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })

  it('leaves what a demand for the Coins asks following what is owed now', () => {
    const s = fixture()
    oweTradeOrg(s.world, s.realm.id, 300)
    stepDebts(s.world)
    capture(s.world, s.post, s.leader)
    newsComes(s)
    answer(s, 'acceptDemand')
    stepDebts(s.world)
    expect(s.world.debts).toEqual([expect.objectContaining({ org: s.realm.id, coins: 300 })])
    expect(coinDemand(s.world)!.terms).toEqual({ kind: 'goods', goods: { coins: 300 } })
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })

  it('is refused for a city no longer theirs, and stays until they decline or it lapses', () => {
    const s = heardOf()
    const other = foundStartingCity(s.world, terrain, 8)
    s.post.realmId = other.id
    expect(answer(s, 'acceptDemand')).toMatch(/no longer yours/)
    expect(postDemand(s.world, s.post)).toBeDefined()
    expect(s.post.tradeOrg).toBeUndefined()
  })

  it('makes a new warehouse only when nothing is left to turn back', () => {
    const s = heardOf()
    const hall = townHallOf(s.world, s.post)!
    const spot = { x: hall.x + FOOTPRINT.storage + 2, y: hall.y - FOOTPRINT.storage - 1 }
    const stores = () =>
      s.world.buildings.filter((b) => b.cityId === s.post.id && b.kind === 'storage')
    const old = stores().find((b) => b.x === spot.x && b.y === spot.y)!
    // Torn down while they held it.
    s.world.buildings = s.world.buildings.filter((b) => b !== old)
    expect(stores()).toHaveLength(1)
    answer(s, 'acceptDemand')
    expect(stores()).toHaveLength(1)
    expect(
      s.world.buildings.find((b) => b.kind === 'warehouse' && b.cityId === s.post.id),
    ).toMatchObject({ ...spot, stock: {} })
  })

  it('turns another storage into its warehouse when its old one is gone', () => {
    const s = heardOf()
    const hall = townHallOf(s.world, s.post)!
    const stores = () =>
      s.world.buildings.filter((b) => b.cityId === s.post.id && b.kind === 'storage')
    const old = stores().find((b) => b.x === hall.x + FOOTPRINT.storage + 2)!
    // It stands elsewhere now: a storage the realm built instead.
    old.x -= 8
    answer(s, 'acceptDemand')
    expect(stores()).toHaveLength(1)
    expect(old.kind).toBe('warehouse')
  })
})

describe('anything but giving it back', () => {
  it('declined, goes up the steps like any debt', () => {
    const s = heardOf()
    expect(answer(s, 'declineDemand')).toBe('ack')
    expect(s.world.debts[0]).toMatchObject({ org: s.realm.id, coins: WORTH, step: 'wrecks' })
    expect(postDemand(s.world, s.post)).toBeUndefined()
    expect(debtEvents(s.world, 'overdue')).toHaveLength(1)
    expect(s.post.realmId).toBe(s.realm.id)
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })

  it('declined, sends its next army to the post it wants back, wherever else they hold', () => {
    const s = heardOf()
    const home = s.world.cities.find((c) => c.realmId === s.realm.id && c.id !== s.post.id)!
    expect(home).toBeDefined()
    // Their home stands nearer the HQ, where an army with no city to go to would go.
    const hall = townHallOf(s.world, home)!
    const hqHall = townHallOf(s.world, s.hq)!
    hall.x = hqHall.x + 10
    hall.y = hqHall.y
    expect(answer(s, 'declineDemand')).toBe('ack')
    expect(s.world.debts[0]).toMatchObject({ cityId: s.post.id })
    const soldiers = s.world.residents.filter((r) => r.owner === null && r.cityId === s.hq.id)
    for (const r of soldiers.slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
    stepPunishments(s.world, size)
    expect(s.world.punishments).toHaveLength(1)
    expect(s.world.punishments[0]).toMatchObject({ culpritOrg: s.realm.id, cityId: s.post.id })
  })

  it('lapsed, goes up the steps like any debt', () => {
    const s = heardOf()
    s.world.tick = postDemand(s.world, s.post)!.deadline
    stepDemands(s.world)
    expect(s.world.debts[0]).toMatchObject({ step: 'wrecks' })
    expect(debtEvents(s.world, 'overdue')).toHaveLength(1)
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
  })

  it('with a demand for the Coins still open, leaves it to that one', () => {
    const s = fixture()
    oweTradeOrg(s.world, s.realm.id, 300)
    stepDebts(s.world)
    capture(s.world, s.post, s.leader)
    newsComes(s)
    answer(s, 'declineDemand')
    expect(s.world.debts[0]).toMatchObject({ step: 'demanded' })
    expect(coinDemand(s.world)).toBeDefined()
    expect(debtEvents(s.world, 'overdue')).toEqual([])
    // Both out at once and lapsing together, it goes up the once.
    capture(s.world, s.posts[1]!, s.leader)
    newsComes(s, s.posts[1]!)
    const deadline = Math.max(...s.world.demands.map((d) => d.deadline))
    s.world.tick = deadline
    stepDemands(s.world)
    expect(s.world.debts[0]).toMatchObject({ step: 'wrecks' })
    expect(debtEvents(s.world, 'overdue')).toHaveLength(1)
  })

  it('at a step further up, stays there, and the city can still go back', () => {
    const s = fixture()
    capture(s.world, s.post, s.leader)
    capture(s.world, s.posts[1]!, s.leader)
    newsComes(s)
    newsComes(s, s.posts[1]!)
    expect(s.world.debts[0]!.coins).toBe(2 * WORTH)
    answer(s, 'declineDemand')
    expect(s.world.debts[0]).toMatchObject({ step: 'wrecks' })
    answer(s, 'acceptDemand', postDemand(s.world, s.posts[1]!)!.id)
    expect(s.posts[1]!.tradeOrg).toBe('post')
    expect(s.world.debts[0]).toMatchObject({ step: 'wrecks', coins: WORTH })
    expect(debtEvents(s.world, 'overdue')).toHaveLength(1)
  })

  it('paid in full at a warehouse, ends the demand, and they keep the city', () => {
    const s = heardOf()
    const warehouse = s.world.buildings.find(
      (b) => b.kind === 'warehouse' && b.cityId === s.posts[1]!.id,
    )!
    s.leader.x = warehouse.x
    s.leader.y = warehouse.y
    s.leader.carried.coins = WORTH
    s.leader.order = { kind: 'payDebt', coins: WORTH, carriageId: null }
    stepWorld(s.world, terrain)
    expect(s.world.debts).toEqual([])
    expect(s.world.demands).toEqual([])
    expect(s.post.realmId).toBe(s.realm.id)
  })

  it('with the Leader dead, goes with the realm', () => {
    const s = heardOf()
    endRealm(s.world, s.realm, size)
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
    expect(s.world.debts).toEqual([])
    expect(debtDemandsSound.check(s.world, terrain)).toEqual([])
  })
})

describe('invariants of a post wanted back', () => {
  it('catch one demanded with no debt, or twice, or heard of and on no debt', () => {
    const s = heardOf()
    const twice = { ...postDemand(s.world, s.post)!, id: 'demand-again' }
    s.world.demands.push(twice)
    expect(debtDemandsSound.check(s.world, terrain).map((v) => v.message)).toEqual([
      expect.stringContaining('demanded back twice'),
    ])
    s.world.demands = s.world.demands.filter((d) => d !== twice)
    s.world.debts = []
    expect(debtDemandsSound.check(s.world, terrain).map((v) => v.message)).toEqual([
      expect.stringContaining('owes nothing for'),
    ])
    s.world.demands = []
    delete captureOf(s.world, s.post).punished
    expect(debtDemandsSound.check(s.world, terrain).map((v) => v.message)).toEqual([
      expect.stringContaining('on no debt'),
    ])
  })
})
