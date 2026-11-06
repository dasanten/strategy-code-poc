import {
  CITY_PRICE_STANDING_SWING,
  GOOD_WEIGHT,
  HORSE_PRICE_BASE,
  HORSE_PRICE_PAID_SHARE,
  NPC_CITY_REFUSES_STANDING,
  STANDING_RANGE,
  STANDING_TRADE_COINS_PER_POINT,
  TICKS_PER_GAME_YEAR,
  Terrain,
  carryCapacity,
  horseStockFactor,
  npcHorseBuyPrice,
  npcHorsePrice,
  npcHorsesOf,
  npcHorsesWanted,
  standingOf,
  type Carriage,
  type Horse,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { refreshLastSeen } from './last-seen.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { npcHorsePurchasesWanted, tradesOf } from './trading.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Selling a horse at an NPC city's stable (`CONTEXT.md`: Horse market): what it pays, the Coins and
 * the horse both moving, and each reason it won't go.
 */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Average stats, born at the world's start, of the realm r1. */
function horse(id: string, x: number, y: number, fields: Partial<Horse> = {}): Horse {
  return {
    id,
    name: `Horse ${id}`,
    realmId: 'r1',
    cityId: null,
    x,
    y,
    hunger: 100,
    health: 100,
    stats: { speed: 10, strength: 10, endurance: 10 },
    bornAt: 0,
    ...fields,
  }
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

/**
 * Realm r1 (Player 7, Leader a1 far away) and the NPC city npc: its town hall at (20, 20), a storage
 * at (23, 20) with 500 Coins and a stable at (30, 20) with two horses of its own, where n1 to n6 live.
 * It wants four. r1's p1 stands in the stable with their horse mine.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const city = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  const store = {
    id: 'store',
    kind: 'storage' as const,
    cityId: 'npc',
    x: 23,
    y: 20,
    stock: { coins: 500 } as { coins?: number },
  }
  const stable = {
    id: 'stable',
    kind: 'stable' as const,
    cityId: 'npc',
    x: 30,
    y: 20,
    stock: { food: 500 },
  }
  world.buildings.push(store, stable)
  resident(world, 'a1', 'r1', 50, 50)
  for (let i = 1; i <= 6; i++) resident(world, `n${i}`, null, 20, 21, 'npc')
  const own = { realmId: null, cityId: 'npc' }
  world.horses.push(horse('h1', 31, 21, own), horse('h2', 31, 21, own), horse('mine', 31, 21))
  const p1 = resident(world, 'p1', 'r1', 31, 21)
  return { world, city, store, stable, p1, queue: new OrderQueue(undefined, terrain) }
}

const horseOf = (world: WorldState, id: string) => world.horses.find((h) => h.id === id)!

/** Sends an order from the Player, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const sell = (horseId = 'mine', residentId = 'p1') => ({ kind: 'sellHorse', residentId, horseId })

/** Steps the world once, keeping everyone fed, and checks every invariant. */
function run(world: WorldState) {
  for (const r of world.residents) r.hunger = 100
  stepWorld(world, terrain)
  expect(checkInvariants(world, terrain)).toEqual([])
}

describe('what an NPC city pays for a horse', () => {
  it('is its share of what it would ask with that horse among its own', () => {
    const { world, city } = setup()
    const has = npcHorsesOf(world, city).length
    const stock = horseStockFactor(has + 1, npcHorsesWanted(world, city))
    expect(npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')).toBe(
      Math.round(HORSE_PRICE_BASE * stock * HORSE_PRICE_PAID_SHARE),
    )
  })

  it('follows its stats and age', () => {
    const { world, city } = setup()
    const h = horseOf(world, 'mine')
    const average = npcHorseBuyPrice(world, city, h, 'r1')
    const good = { ...h, stats: { speed: 15, strength: 15, endurance: 15 } }
    expect(npcHorseBuyPrice(world, city, good, 'r1')).toBeGreaterThan(average)
    const old = { ...h, bornAt: -10 * TICKS_PER_GAME_YEAR }
    expect(npcHorseBuyPrice(world, city, old, 'r1')).toBeLessThan(average)
  })

  it('is more with fewer horses, and moved by its standing the other way from what it asks', () => {
    const { world, city } = setup()
    const h = horseOf(world, 'mine')
    const withTwo = npcHorseBuyPrice(world, city, h, 'r1')
    world.horses.push(horse('h3', 31, 21, { realmId: null, cityId: 'npc' }))
    expect(npcHorseBuyPrice(world, city, h, 'r1')).toBeLessThan(withTwo)
    world.horses = world.horses.filter((x) => x.id !== 'h3')

    changeStanding(world, 'npc', 'r1', 10)
    const swing = (CITY_PRICE_STANDING_SWING * 10) / STANDING_RANGE
    const has = npcHorsesOf(world, city).length
    const stock = horseStockFactor(has + 1, npcHorsesWanted(world, city))
    expect(npcHorseBuyPrice(world, city, h, 'r1')).toBe(
      Math.round(HORSE_PRICE_BASE * stock * HORSE_PRICE_PAID_SHARE * (1 + swing)),
    )
    changeStanding(world, 'npc', 'r1', -30)
    expect(npcHorseBuyPrice(world, city, h, 'r1')).toBeLessThan(withTwo)
  })

  it('is always less than it would ask for that horse back, at any standing', () => {
    for (const standing of [-40, 0, 25, 50, 100]) {
      const { world, city } = setup()
      changeStanding(world, 'npc', 'r1', standing)
      const h = horseOf(world, 'mine')
      const pays = npcHorseBuyPrice(world, city, h, 'r1')
      const was = { realmId: h.realmId, cityId: h.cityId }
      Object.assign(h, { realmId: null, cityId: 'npc' })
      expect(npcHorsePrice(world, city, h, 'r1')).toBeGreaterThan(pays)
      Object.assign(h, was)
    }
  })
})

describe('selling a horse', () => {
  it('moves the Coins into their hands and the horse to the city, and nothing else', () => {
    const { world, city, store, p1, queue } = setup()
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')
    const horses = world.horses.length

    expect(order(world, queue, sell())).toBe('ack')
    run(world)

    const h = horseOf(world, 'mine')
    expect(h.realmId).toBeNull()
    expect(h.cityId).toBe('npc')
    expect([h.x, h.y]).toEqual([31, 21])
    expect(p1.carried.coins).toBe(price)
    expect(store.stock.coins).toBe(500 - price)
    expect(world.horses).toHaveLength(horses)
    expect(npcHorsesOf(world, city)).toHaveLength(3)
    expect(p1.order).toBeNull()
    expect(standingOf(world, 'npc', 'r1')).toBeCloseTo(price / STANDING_TRADE_COINS_PER_POINT)
    expect(standingOf(world, 'r1', 'npc')).toBeCloseTo(price / STANDING_TRADE_COINS_PER_POINT)
    expect(world.events.filter((e) => e.kind === 'horseSold')).toMatchObject([
      { name: p1.name, horse: 'Horse mine', city: 'Dunmere', coins: price },
    ])
  })

  it('takes the Coins from all its storages', () => {
    const { world, city, store, p1, queue } = setup()
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')
    store.stock.coins = price - 1
    world.buildings.push({
      id: 'store2',
      kind: 'storage',
      cityId: 'npc',
      x: 26,
      y: 20,
      stock: { coins: 5 },
    })
    expect(order(world, queue, sell())).toBe('ack')
    run(world)
    expect(p1.carried.coins).toBe(price)
    expect(store.stock.coins).toBeUndefined()
    const second = world.buildings.find((b) => b.id === 'store2')!
    expect(second.stock?.coins).toBe(4)
  })

  it('comes after riding the horse in and getting off', () => {
    const { world, p1, queue } = setup()
    p1.riding = 'mine'
    expect(order(world, queue, sell())).toBe(`${p1.name} has to get off Horse mine first`)
    expect(order(world, queue, { kind: 'dismount', residentId: 'p1' })).toBe('ack')
    expect(p1.riding).toBeUndefined()
    expect(order(world, queue, sell())).toBe('ack')
    run(world)
    expect(horseOf(world, 'mine').cityId).toBe('npc')
  })

  it('takes a stolen horse like any other', () => {
    const { world, city, p1, queue } = setup()
    world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
    resident(world, 'b1', 'r2', 55, 55)
    world.horses.push(horse('theirs', 31, 21, { realmId: 'r2' }))
    expect(order(world, queue, { kind: 'mount', residentId: 'p1', horseId: 'theirs' })).toBe('ack')
    expect(horseOf(world, 'theirs').realmId).toBe('r1')
    order(world, queue, { kind: 'dismount', residentId: 'p1' })
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'theirs'), 'r1')
    expect(order(world, queue, sell('theirs'))).toBe('ack')
    run(world)
    expect(horseOf(world, 'theirs').cityId).toBe('npc')
    expect(p1.carried.coins).toBe(price)
  })

  it('takes a hired resident’s sale for the hirer’s horse, the Coins in their hands', () => {
    const { world, city, queue, p1 } = setup()
    p1.owner = null
    p1.cityId = 'npc'
    world.contracts.push({
      id: 'c1',
      cityId: 'npc',
      hirerId: 'r1',
      residentIds: ['p1'],
      pricePerWeek: 1,
    } as never)
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')
    expect(order(world, queue, sell())).toBe('ack')
    run(world)
    expect(horseOf(world, 'mine').cityId).toBe('npc')
    expect(p1.carried.coins).toBe(price)
  })

  it('ends the breeding the horse was part of', () => {
    const { world, stable, queue } = setup()
    world.horses.push(horse('mate', 31, 21))
    const breeder = resident(world, 'p2', 'r1', 31, 21)
    breeder.order = {
      kind: 'breed',
      stableId: 'stable',
      horseIds: ['mine', 'mate'],
      at: { x: 31, y: 21 },
      progress: 5,
    }
    Object.assign(stable, { breedings: [{ horseIds: ['mine', 'mate'], progress: 5 }] })
    expect(order(world, queue, sell())).toBe('ack')
    run(world)
    expect(breeder.order?.kind).not.toBe('breed')
    expect((stable as { breedings?: unknown }).breedings).toBeUndefined()
  })

  it('tells why it didn’t go when something came in the way before the tick', () => {
    const { world, store, p1, queue } = setup()
    expect(order(world, queue, sell())).toBe('ack')
    store.stock.coins = 1
    run(world)
    expect(horseOf(world, 'mine').realmId).toBe('r1')
    expect(p1.carried.coins).toBeUndefined()
    expect(store.stock.coins).toBe(1)
    expect(p1.order).toBeNull()
    expect(world.events.filter((e) => e.kind === 'horseSold')).toMatchObject([
      { coins: 0, problem: 'Dunmere hasn’t the coins for Horse mine' },
    ])
  })

  it('the invariant catches a sale to a city that wanted no more', () => {
    const { world, queue } = setup()
    order(world, queue, sell())
    run(world)
    expect(npcHorsePurchasesWanted.check(world, terrain)).toEqual([])
    tradesOf(world)[0]!.wanted = false
    expect(npcHorsePurchasesWanted.check(world, terrain)).toHaveLength(1)
  })
})

describe('refusing to buy a horse', () => {
  it('when it wants no more', () => {
    const { world, city, queue } = setup()
    const own = { realmId: null, cityId: 'npc' }
    world.horses.push(horse('h3', 31, 21, own), horse('h4', 31, 21, own))
    expect(npcHorsesOf(world, city)).toHaveLength(npcHorsesWanted(world, city))
    expect(order(world, queue, sell())).toBe('Dunmere has all the horses it wants')
  })

  it('when its storages lack the Coins', () => {
    const { world, city, store, queue } = setup()
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')
    store.stock.coins = price - 1
    expect(order(world, queue, sell())).toBe('Dunmere hasn’t the coins for Horse mine')
    store.stock.coins = price
    expect(order(world, queue, sell())).toBe('ack')
  })

  it('when the resident can’t carry the Coins, whole', () => {
    const { world, city, p1, queue } = setup()
    const price = npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1')
    const capacity = carryCapacity(p1, world.tick)
    // Room for one Coin less than the price.
    p1.carried = { wood: (capacity - (price - 1) * GOOD_WEIGHT.coins) / GOOD_WEIGHT.wood }
    expect(order(world, queue, sell())).toBe(`they can’t carry the ${price} coins`)
    // Room for exactly the price.
    p1.carried = { wood: (capacity - price * GOOD_WEIGHT.coins) / GOOD_WEIGHT.wood }
    expect(order(world, queue, sell())).toBe('ack')
  })

  it('a hitched horse', () => {
    const { world, queue } = setup()
    world.carriages.push({ id: 'k1', horseId: 'mine', x: 31, y: 21 } as Carriage)
    expect(order(world, queue, sell())).toBe('Horse mine is hitched to a carriage')
  })

  it('a Down horse', () => {
    const { world, queue } = setup()
    horseOf(world, 'mine').downUntil = 1000
    expect(order(world, queue, sell())).toBe('Horse mine is Down')
  })

  it('at low standing', () => {
    const { world, queue } = setup()
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(order(world, queue, sell())).toBe('Dunmere won’t trade with you')
  })

  it('from a child, someone elsewhere, or for a horse not theirs or not in the stable', () => {
    const { world, p1, queue } = setup()
    p1.bornAt = world.tick
    expect(order(world, queue, sell())).toBe('children can’t trade')
    p1.bornAt = -20 * 24 * 3600
    expect(order(world, queue, sell('nope'))).toBe('no such horse')
    expect(order(world, queue, sell('h1'))).toBe('not a horse of your realm')
    p1.x = 40
    expect(order(world, queue, sell())).toBe('not at an NPC city’s stable with that horse')
    p1.x = 31
    horseOf(world, 'mine').x = 45
    expect(order(world, queue, sell())).toBe('not at an NPC city’s stable with that horse')
  })

  it('at an unfinished stable, or a Player’s', () => {
    const { world, city, stable, queue } = setup()
    Object.assign(stable, { site: { work: 0 } })
    expect(order(world, queue, sell())).toBe('not at an NPC city’s stable with that horse')
    delete (stable as { site?: unknown }).site
    city.realmId = 'r2'
    expect(order(world, queue, sell())).toBe('not at an NPC city’s stable with that horse')
  })
})

describe('what a Player sees of their horses there', () => {
  const seenCity = (world: WorldState) =>
    entitiesInSight(world, terrain, 'r1').find((e) => e.is === 'city' && e.id === 'npc') as {
      horsesToSell?: { horseId: string; price: number; name: string; problem?: string }[]
    }

  it('lists theirs in its stable with what it pays', () => {
    const { world, city } = setup()
    const { horsesToSell } = seenCity(world)
    expect(horsesToSell?.map((h) => h.horseId)).toEqual(['mine'])
    expect(horsesToSell?.[0]).toMatchObject({
      name: 'Horse mine',
      stableId: 'stable',
      price: npcHorseBuyPrice(world, city, horseOf(world, 'mine'), 'r1'),
    })
    expect(horsesToSell?.[0]?.problem).toBeUndefined()
  })

  it('says why it won’t buy one, also at low standing', () => {
    const { world, p1 } = setup()
    p1.riding = 'mine'
    expect(seenCity(world).horsesToSell?.[0]?.problem).toBe(
      `${p1.name} has to get off Horse mine first`,
    )
    p1.riding = undefined
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(seenCity(world).horsesToSell?.[0]?.problem).toBe('Dunmere won’t trade with you')
  })

  it('lists none once sold, and none with no horse of theirs there', () => {
    const { world, queue } = setup()
    order(world, queue, sell())
    run(world)
    expect(seenCity(world).horsesToSell).toBeUndefined()
  })

  it('isn’t remembered once out of sight', () => {
    const { world } = setup()
    refreshLastSeen(world, terrain.size)
    const remembered = (world.lastSeen[7] ?? []).find((e) => e.id === 'npc') as
      | { horsesToSell?: unknown }
      | undefined
    expect(remembered).toBeDefined()
    expect(remembered?.horsesToSell).toBeUndefined()
  })
})
