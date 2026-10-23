import {
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  Terrain,
  cityPrice,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { buyOrdersDone } from './buying.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { addCity } from './test-terrain.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const buyer = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** What the NPC city of `setup` asks: two residents, its town hall, a house and a farm. */
const PRICE =
  2 * CITY_PRICE_PER_RESIDENT +
  CITY_PRICE_BY_BUILDING.townHall! +
  CITY_PRICE_BY_BUILDING.house! +
  CITY_PRICE_BY_BUILDING.farm!

/**
 * Realm r1 (Player 7, Leader a1 far away) and the NPC city npc, its town hall at (20, 20), with a
 * house and a farm, where n1 and n2 live. r1's p1 and p2 stand on the town hall carrying `coins`.
 */
function setup(coins: [number, number] = [PRICE - 100, 300]) {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  world.buildings.push({ id: 'house', kind: 'house', cityId: 'npc', x: 24, y: 20 })
  world.buildings.push({ id: 'farm', kind: 'farm', cityId: 'npc', x: 23, y: 23 })
  resident(world, 'a1', 'r1', 50, 50)
  resident(world, 'n1', null, 24, 20, 'npc')
  resident(world, 'n2', null, 23, 23, 'npc')
  resident(world, 'p1', 'r1', 20, 20).carried.coins = coins[0]
  resident(world, 'p2', 'r1', 20, 20).carried.coins = coins[1]
  return { world, npc, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

function resident(
  world: WorldState,
  id: string,
  owner: string | null,
  x: number,
  y: number,
  cityId: string | null = null,
) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner,
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

/** Sends an order from the buyer, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, buyer, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world once, keeping residents fed, and checks every invariant. */
function run(world: WorldState, walking: Walking) {
  for (const r of world.residents) r.hunger = 100
  stepWorld(world, terrain, walking)
  expect(checkInvariants(world, terrain)).toEqual([])
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!
const buy = { kind: 'buyCity', residentId: 'p1', cityId: 'npc' }

describe('buying an NPC city', () => {
  it('names a price from its residents and buildings, which its seen city carries', () => {
    const { world, npc } = setup()
    expect(cityPrice(world, npc)).toBe(PRICE)
    // A construction site adds nothing.
    world.buildings.push({
      id: 'site',
      kind: 'house',
      cityId: 'npc',
      x: 22,
      y: 20,
      site: { delivered: {}, work: 0 },
    })
    expect(cityPrice(world, npc)).toBe(PRICE)
    const seen = entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'npc')
    expect(seen).toMatchObject({ is: 'city', price: PRICE })
  })

  it('only NPC cities name a price', () => {
    const { world } = setup()
    addCity(world, { id: 'mine', realmId: 'r1', x: 24, y: 18 })
    addCity(world, { id: 'post', realmId: null, x: 18, y: 24 })
    world.cities.find((c) => c.id === 'post')!.tradeOrg = 'post'
    const seen = entitiesInSight(world, terrain, 'r1')
    expect(seen.find((e) => e.id === 'mine')).not.toHaveProperty('price')
    expect(seen.find((e) => e.id === 'post')).not.toHaveProperty('price')
  })

  it('fails with too few coins at the town hall', () => {
    const { world, npc, queue } = setup([100, 100])
    expect(order(world, queue, buy)).toBe(
      `it costs ${PRICE} coins; your residents at its town hall carry 200`,
    )
    expect(npc.realmId).toBeNull()
    expect(at(world, 'p1').carried.coins).toBe(100)
  })

  it('counts only coins carried on the town hall itself', () => {
    const { world, npc, queue, walking } = setup()
    at(world, 'p2').x = 23
    expect(order(world, queue, buy)).toMatch(/^it costs/)
    at(world, 'p2').x = 20
    expect(order(world, queue, buy)).toBe('ack')
    run(world, walking)
    expect(npc.realmId).toBe('r1')
  })

  it('with enough coins the coins are gone and the city joins the realm with everything in it', () => {
    const { world, npc, queue, walking } = setup()
    expect(order(world, queue, buy)).toBe('ack')
    run(world, walking)
    expect(npc.realmId).toBe('r1')
    expect([at(world, 'n1').owner, at(world, 'n2').owner]).toEqual(['r1', 'r1'])
    // Its buildings stay its own, so they are the realm's now.
    for (const id of ['npc-hall', 'house', 'farm']) {
      expect(world.buildings.find((b) => b.id === id)?.cityId).toBe('npc')
    }
    // The buyer's coins go first, the rest from p2; the price is used up, not kept by anyone.
    expect(at(world, 'p1').carried.coins).toBeUndefined()
    expect(at(world, 'p2').carried.coins).toBe(200)
    const coins = (s: { coins?: number } | undefined) => s?.coins ?? 0
    const total =
      world.residents.reduce((n, r) => n + coins(r.carried), 0) +
      world.buildings.reduce((n, b) => n + coins(b.stock), 0) +
      world.piles.reduce((n, p) => n + coins(p.goods), 0)
    expect(total).toBe(200)
    expect(at(world, 'p1').order).toBeNull()
    expect(world.events.filter((e) => e.kind === 'cityBought')).toEqual([
      expect.objectContaining({
        userId: 7,
        cityId: 'npc',
        city: 'Dunmere',
        price: PRICE,
        residents: 2,
        x: 20,
        y: 20,
      }),
    ])
    // It is no longer for sale.
    expect(entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'npc')).not.toHaveProperty(
      'price',
    )
    expect(order(world, queue, buy)).toBe('only NPC cities are for sale')
  })

  it('falls through when the coins are gone by the time it is carried out', () => {
    const { world, npc, queue, walking } = setup()
    expect(order(world, queue, buy)).toBe('ack')
    at(world, 'p2').carried.coins = 0
    run(world, walking)
    expect(npc.realmId).toBeNull()
    expect(at(world, 'p1').carried.coins).toBe(PRICE - 100)
    expect(at(world, 'p1').order).toBeNull()
    expect(world.events.filter((e) => e.kind === 'cityNotBought')).toEqual([
      expect.objectContaining({ cityId: 'npc', price: PRICE, coins: PRICE - 100 }),
    ])
  })

  it('needs the resident on its town hall, and an NPC city', () => {
    const { world, queue } = setup()
    at(world, 'p1').x = 23
    expect(order(world, queue, buy)).toBe('the resident must stand at its town hall')
    expect(order(world, queue, { ...buy, residentId: 'n1' })).toBe('not one of your residents')
    addCity(world, { id: 'post', realmId: null, x: 18, y: 24 })
    world.cities.find((c) => c.id === 'post')!.tradeOrg = 'post'
    expect(order(world, queue, { ...buy, cityId: 'post' })).toBe(
      'the Trade Organization doesn’t sell its cities',
    )
    expect(order(world, queue, { ...buy, cityId: 'nowhere' })).toBe('no such city')
  })

  it('invariant: no buy order outlasts its tick', () => {
    const { world } = setup()
    at(world, 'p1').order = { kind: 'buyCity', cityId: 'npc' }
    expect(buyOrdersDone.check(world, terrain)).toEqual([
      expect.objectContaining({ invariant: 'buy-orders-done', entityIds: ['p1'] }),
    ])
  })
})
