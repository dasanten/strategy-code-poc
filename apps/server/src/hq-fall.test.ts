import {
  OCCUPATION_TICKS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  diplomacyFor,
  townHallOf,
  tradeOrgHq,
  tradeProblem,
  type MercenaryContract,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity, stepCaptures } from './capture.js'
import { nothingLeftOfTheHq } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { stepStockFloor } from './stock-floor.js'
import { eventsOf, mara, order, setup, runUntil } from './transfers.fixture.js'

const hqOf = (world: WorldState) => tradeOrgHq(world)!

/** A contract in force, from tick 0, one week paid. */
const contract = (c: Partial<MercenaryContract>): MercenaryContract => ({
  id: 'k',
  lenderId: TRADE_ORG,
  hirerId: 'nobody',
  offeredBy: 'hirer',
  residentIds: [],
  days: 7,
  pricePerWeek: 5,
  storageId: 'nowhere',
  startedAt: 0,
  paidWeeks: 1,
  ...c,
})

describe('the fall of the HQ (CONTEXT.md: Fall of the HQ)', () => {
  it('turns the HQ into a plain city of the captor, its warehouses storages with all they hold', () => {
    const { world, terrain, realm } = setup()
    const hq = hqOf(world)
    const warehouses = world.buildings.filter((b) => b.cityId === hq.id && b.kind === 'warehouse')
    const stocks = warehouses.map((b) => structuredClone(b.stock))
    const coins = warehouses.reduce((n, b) => n + (b.stock?.coins ?? 0), 0)
    expect(coins).toBeGreaterThan(0)
    const people = world.residents.filter((r) => r.cityId === hq.id)
    // Planning is over for the tick when a city is captured, so its plan must go with it.
    world.cityPlans[hq.id] = { plannedAt: world.tick, jobs: {} }
    captureCity(world, hq, realm.id, terrain.size)
    expect(world.cityPlans[hq.id]).toBeUndefined()
    expect(hq.realmId).toBe(realm.id)
    expect(hq.tradeOrg).toBeUndefined()
    expect(tradeOrgHq(world)).toBeUndefined()
    for (const r of people) expect(r.owner).toBe(realm.id)
    expect(warehouses.map((b) => b.kind)).toEqual(warehouses.map(() => 'storage'))
    expect(warehouses.map((b) => b.stock)).toEqual(stocks)
    expect(checkInvariants(world, terrain)).toEqual([])
    // No stock floor any more: what they hold runs out like any storage's.
    for (const b of warehouses) b.stock = {}
    world.tick = TICKS_PER_GAME_DAY - 1
    stepStockFloor(world)
    for (const b of warehouses) expect(b.stock).toEqual({})
  })

  it('ends the caravans: crew, carriage, horse and load join the captor where they stand', () => {
    const { world, terrain, realm, caravan } = setup()
    const carriage = world.carriages.find((k) => k.id === caravan.carriageId)!
    const horse = world.horses.find((h) => h.id === carriage.horseId)!
    const crew = [caravan.driverId!, ...caravan.escortIds].map((id) =>
      world.residents.find((r) => r.id === id)!,
    )
    // Far out on the road, away from the HQ.
    for (const t of [carriage, horse, ...crew]) Object.assign(t, { x: 300, y: 300 })
    carriage.load = { wood: 7 }
    world.routeRobberies[caravan.postId] = 3
    // Driving when it falls: they join the captor and stop, so no drive is left over.
    crew[0]!.order = {
      kind: 'drive',
      carriageId: carriage.id,
      target: { x: 310, y: 300 },
      path: null,
      progress: 0,
    }
    captureCity(world, hqOf(world), realm.id, terrain.size)
    expect(world.caravans).toEqual([])
    expect(world.routeRobberies).toEqual({})
    for (const r of crew) expect(r).toMatchObject({ owner: realm.id, x: 300, y: 300, order: null })
    expect(carriage).toMatchObject({ realmId: realm.id, x: 300, y: 300, load: { wood: 7 } })
    expect(horse).toMatchObject({ realmId: realm.id, x: 300, y: 300 })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('happens by occupying its town hall the full time, like any city', () => {
    const { world, terrain, realm, p1 } = setup()
    const hq = hqOf(world)
    const hall = townHallOf(world, hq)!
    for (const r of world.residents) if (r.cityId === hq.id) Object.assign(r, { x: hall.x - 5 })
    Object.assign(p1, { x: hall.x + 1, y: hall.y + 1, carried: { sword: 1, food: 5 } })
    hq.occupation = { realmId: realm.id, since: world.tick + 1 - OCCUPATION_TICKS }
    world.tick++
    expect(stepCaptures(world, terrain.size)).toEqual([{ cityId: hq.id, from: null, to: realm.id }])
    expect(hq.tradeOrg).toBeUndefined()
    expect(world.caravans).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('cancels open deliveries and transfers without refund, each with a line in the log', () => {
    const { world, terrain, realm, other, city, toCity, warehouse, caravan } = setup()
    const good = 'wood' as const
    const base = { good, units: 5, caravanId: null, warehouseId: warehouse.id }
    world.deliveries.push(
      { ...base, id: 'd', kind: 'delivery', realmId: realm.id, cityId: city.id, fee: 10 },
      { ...base, id: 'p', kind: 'pickUp', realmId: realm.id, cityId: city.id, fee: 0 },
    )
    world.transfers.push({
      ...base,
      id: 't',
      realmId: realm.id,
      toRealmId: other.id,
      toCityId: toCity.id,
      fromCityId: null,
      fee: 10,
      back: false,
    })
    const stock = structuredClone(warehouse.stock)
    expect(caravan.job).toBeNull()
    captureCity(world, hqOf(world), other.id, terrain.size)
    expect(world.deliveries).toEqual([])
    expect(world.transfers).toEqual([])
    // Goods kept at a post stay in its warehouse.
    expect(warehouse.stock).toEqual(stock)
    expect(eventsOf(world, 'orderEndedWithHq', mara.userId)).toEqual([
      expect.objectContaining({ order: 'delivery', good, units: 5, cityId: city.id }),
      expect.objectContaining({ order: 'pickUp', good, units: 5, cityId: city.id }),
      expect.objectContaining({ order: 'transfer', good, units: 5, cityId: toCity.id }),
    ])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('leaves the trading posts trading, but they take no new deliveries or transfers', () => {
    const { world, terrain, realm, other, city, toCity, warehouse, p1, queue } = setup()
    captureCity(world, hqOf(world), other.id, terrain.size)
    const post = world.cities.find((c) => c.id === warehouse.cityId)!
    expect(post.tradeOrg).toBe('post')
    expect(warehouse.kind).toBe('warehouse')
    expect(tradeProblem(world, realm.id, p1, 'buy', 'wood', 1, null)).toBeUndefined()
    // Nothing tops it up (ADR 0023), and with the HQ gone nothing brings it more but its own hands.
    warehouse.stock = { wood: 3 }
    world.tick = TICKS_PER_GAME_DAY - 1
    stepStockFloor(world)
    expect(warehouse.stock).toEqual({ wood: 3 })
    const refused = 'no caravans run since the Trade Org HQ fell'
    expect(tradeProblem(world, realm.id, p1, 'buy', 'wood', 1, null, city.id)).toBe(refused)
    expect(order(world, queue, { kind: 'buy', good: 'wood', units: 1, cityId: city.id })).toBe(
      refused,
    )
    expect(
      order(world, queue, {
        kind: 'transfer',
        fromCityId: city.id,
        good: 'wood',
        units: 1,
        toCityId: toCity.id,
      }),
    ).toBe(refused)
    expect(
      order(world, queue, { kind: 'handIn', good: 'coins', units: 1, toCityId: toCity.id }),
    ).toBe(refused)
    expect(diplomacyFor(world, realm.id, []).noCaravans).toBe(true)
  })

  it('lets a delivery ordered just before the fall come to nothing', () => {
    const { world, terrain, other, city, p1, warehouse } = setup()
    p1.order = {
      kind: 'trade',
      side: 'buy',
      good: 'wood',
      units: 1,
      carriageId: null,
      cityId: city.id,
    }
    captureCity(world, hqOf(world), other.id, terrain.size)
    const coins = p1.carried.coins
    const stock = warehouse.stock?.wood
    runUntil(world, terrain, () => p1.order === null, 5)
    expect(p1.carried.coins).toBe(coins)
    expect(warehouse.stock?.wood).toBe(stock)
    expect(world.deliveries).toEqual([])
    expect(eventsOf(world, 'deliveryOrdered', mara.userId)).toEqual([])
  })

  it('ends contracts with the Trade Organization: soldiers join the captor, mercenaries walk home', () => {
    const { world, terrain, realm, other, storage, p1, warehouse } = setup()
    const hq = hqOf(world)
    const hall = townHallOf(world, hq)!
    const [soldier] = world.residents.filter((r) => r.cityId === hq.id)
    Object.assign(soldier!, { x: 400, y: 400, script: { scriptId: 0, task: 'work', memory: {} } })
    const home = townHallOf(
      world,
      world.cities.find((c) => c.realmId === realm.id)!,
    )!
    const stranger = world.residents.find((r) => r.owner === realm.id && r !== p1)!
    Object.assign(stranger, { x: hall.x + 1, y: hall.y + 1 })
    world.armies.push({
      id: 'army',
      realmId: realm.id,
      name: 'Hired',
      memberIds: [soldier!.id],
      order: null,
    })
    world.contracts.push(
      contract({
        id: 'hiredOut',
        hirerId: realm.id,
        residentIds: [soldier!.id],
        storageId: warehouse.id,
      }),
      contract({
        id: 'mercenaries',
        lenderId: realm.id,
        hirerId: TRADE_ORG,
        residentIds: [stranger.id],
        storageId: storage.id,
      }),
      contract({
        id: 'offer',
        hirerId: realm.id,
        residentIds: [],
        startedAt: null,
        storageId: warehouse.id,
      }),
    )
    const standing = structuredClone(world.standings)
    captureCity(world, hq, other.id, terrain.size)
    expect(world.contracts).toEqual([])
    expect(world.armies).toEqual([])
    expect(soldier).toMatchObject({ owner: other.id, x: 400, y: 400, order: null })
    expect(soldier!.script).toBeUndefined()
    expect(stranger.owner).toBe(realm.id)
    expect(stranger.order).toMatchObject({ kind: 'walkTo', target: { x: home.x, y: home.y } })
    expect(world.standings).toEqual(standing)
    expect(eventsOf(world, 'contract', mara.userId).map((e) => e.what)).toEqual(['ended', 'ended'])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('ends its punishments, and nobody can hire from it any more', () => {
    const { world, terrain, realm, other, city, warehouse, p1, queue } = setup()
    const hq = hqOf(world)
    const soldier = world.residents.find((r) => r.cityId === hq.id)!
    world.punishments.push({
      id: 'punish',
      culpritOrg: realm.id,
      cityId: city.id,
      worth: 100,
      members: [{ residentId: soldier.id, own: {} }],
      heading: 'out',
      took: 0,
    })
    captureCity(world, hq, other.id, terrain.size)
    expect(world.punishments).toEqual([])
    expect(soldier.owner).toBe(other.id)
    expect(
      order(world, queue, {
        kind: 'offerContract',
        realmId: TRADE_ORG,
        soldiers: 1,
        days: 7,
        pricePerWeek: 100,
        storageId: warehouse.id,
      }),
    ).toBe('the Trade Organization has had no army since its HQ fell')
    expect(p1.owner).toBe(realm.id)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('forgets standing toward the Trade Organization only once its last post falls too', () => {
    const { world, terrain, realm, other, warehouse } = setup()
    world.standings.push({ of: TRADE_ORG, toward: realm.id, value: 5 })
    captureCity(world, hqOf(world), other.id, terrain.size)
    expect(checkInvariants(world, terrain)).toEqual([])
    expect(world.standings.some((s) => s.of === TRADE_ORG)).toBe(true)
    const post = world.cities.find((c) => c.id === warehouse.cityId)!
    captureCity(world, post, other.id, terrain.size)
    expect(world.cities.some((c) => c.tradeOrg !== undefined)).toBe(false)
    runUntil(world, terrain, () => true, 1)
    expect(world.standings.some((s) => s.of === TRADE_ORG)).toBe(false)
  })

  it('never comes back: the world runs on with no HQ and no broken rule', () => {
    const { world, terrain, other } = setup()
    captureCity(world, hqOf(world), other.id, terrain.size)
    const end = world.tick + 200
    runUntil(world, terrain, () => world.tick >= end, 201)
    expect(tradeOrgHq(world)).toBeUndefined()
    expect(world.caravans).toEqual([])
  })

  it('reports whatever an HQ that fell left behind', () => {
    const { world, terrain, other, caravan } = setup()
    captureCity(world, hqOf(world), other.id, terrain.size)
    expect(nothingLeftOfTheHq.check(world, terrain)).toEqual([])
    world.caravans.push(caravan)
    world.routeRobberies.gone = 1
    world.contracts.push(contract({ id: 'left', hirerId: other.id }))
    expect(nothingLeftOfTheHq.check(world, terrain).map((v) => v.message)).toEqual([
      'the world has no Trade Org HQ but still has caravans',
      'the world has no Trade Org HQ but still has robberies counted on routes',
      'the world has no Trade Org HQ but still has contracts with the Trade Organization',
    ])
  })
})
