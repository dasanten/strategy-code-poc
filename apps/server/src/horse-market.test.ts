import {
  CITY_PRICE_STANDING_SWING,
  HORSE_PRICE_AGE_FLOOR,
  HORSE_PRICE_AGE_PER_YEAR,
  HORSE_PRICE_BASE,
  HORSE_PRICE_GLUT,
  HORSE_PRICE_PER_STAT,
  HORSE_PRICE_SCARCITY,
  HORSE_PRICE_STATS_FLOOR,
  HORSE_STAT_AVERAGE,
  NPC_CITY_REFUSES_STANDING,
  NPC_HORSES_KEPT,
  STANDING_RANGE,
  STANDING_TRADE_COINS_PER_POINT,
  TICKS_PER_GAME_YEAR,
  Terrain,
  horseStockFactor,
  horseWorth,
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
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { npcHorseSalesKeepPair, tradesOf } from './trading.js'
import { refreshLastSeen } from './last-seen.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Buying a horse at an NPC city's stable (`CONTEXT.md`: Horse market): what it asks, the Coins and
 * the horse both moving, and each reason it won't go.
 */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Average stats, born at the world's start. */
function horse(id: string, x: number, y: number, fields: Partial<Horse> = {}): Horse {
  return {
    id,
    name: `Horse ${id}`,
    realmId: null,
    cityId: 'npc',
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
 * at (23, 20) and a stable at (30, 20) with three horses, h1 to h3, where n1 to n6 live. It wants
 * four. r1's p1 stands in the stable with 500 Coins.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const city = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  const store = { id: 'store', kind: 'storage' as const, cityId: 'npc', x: 23, y: 20, stock: {} }
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
  world.horses.push(horse('h1', 31, 21), horse('h2', 31, 21), horse('h3', 31, 21))
  const p1 = resident(world, 'p1', 'r1', 31, 21)
  p1.carried = { coins: 500 }
  return { world, city, store, stable, p1, queue: new OrderQueue(undefined, terrain) }
}

const horseOf = (world: WorldState, id: string) => world.horses.find((h) => h.id === id)!

/** Sends an order from the Player, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const buy = (horseId = 'h1', residentId = 'p1') => ({ kind: 'buyHorse', residentId, horseId })

/** Steps the world once, keeping everyone fed, and checks every invariant. */
function run(world: WorldState) {
  for (const r of world.residents) r.hunger = 100
  stepWorld(world, terrain)
  expect(checkInvariants(world, terrain)).toEqual([])
}

describe('what an NPC city asks for a horse', () => {
  it('follows its stats, an average new horse at the base', () => {
    const stats = (s: number) => ({ speed: s, strength: s, endurance: s })
    expect(horseWorth({ stats: stats(HORSE_STAT_AVERAGE), bornAt: 0 }, 0)).toBeCloseTo(1)
    expect(horseWorth({ stats: stats(HORSE_STAT_AVERAGE + 5), bornAt: 0 }, 0)).toBeCloseTo(
      1 + 5 * HORSE_PRICE_PER_STAT,
    )
    expect(horseWorth({ stats: stats(HORSE_STAT_AVERAGE - 5), bornAt: 0 }, 0)).toBeCloseTo(
      1 - 5 * HORSE_PRICE_PER_STAT,
    )
    // The mean counts: one stat up and another down cancel out.
    const mixed = { speed: 12, strength: 8, endurance: 10 }
    expect(horseWorth({ stats: mixed, bornAt: 0 }, 0)).toBeCloseTo(1)
    expect(horseWorth({ stats: stats(1), bornAt: 0 }, 0)).toBeCloseTo(HORSE_PRICE_STATS_FLOOR)
  })

  it('falls with age, down to a floor', () => {
    const h = { stats: { speed: 10, strength: 10, endurance: 10 }, bornAt: 0 }
    expect(horseWorth(h, 4 * TICKS_PER_GAME_YEAR)).toBeCloseTo(1 - 4 * HORSE_PRICE_AGE_PER_YEAR)
    expect(horseWorth(h, 100 * TICKS_PER_GAME_YEAR)).toBeCloseTo(HORSE_PRICE_AGE_FLOOR)
  })

  it('rises as the city nears the pair it keeps, and falls with more than it wants', () => {
    const wanted = 6
    expect(horseStockFactor(wanted, wanted)).toBeCloseTo(1)
    const dearer = [6, 5, 4, 3].map((has) => horseStockFactor(has, wanted))
    for (let i = 1; i < dearer.length; i++) expect(dearer[i]!).toBeGreaterThan(dearer[i - 1]!)
    expect(horseStockFactor(NPC_HORSES_KEPT, wanted)).toBeCloseTo(1 + HORSE_PRICE_SCARCITY)
    // However small the number it wants, the most it takes off is the same.
    expect(horseStockFactor(3, NPC_HORSES_KEPT)).toBeCloseTo(
      1 - HORSE_PRICE_SCARCITY * HORSE_PRICE_GLUT,
    )
    expect(horseStockFactor(50, wanted)).toBeCloseTo(1 - HORSE_PRICE_SCARCITY * HORSE_PRICE_GLUT)
  })

  it('is moved by its standing like its trade prices', () => {
    const { world, city } = setup()
    const h = horseOf(world, 'h1')
    const has = npcHorsesOf(world, city).length
    const at = horseStockFactor(has, npcHorsesWanted(world, city))
    expect(npcHorsePrice(world, city, h, 'r1')).toBe(Math.round(HORSE_PRICE_BASE * at))
    changeStanding(world, 'npc', 'r1', 20)
    const swing = (CITY_PRICE_STANDING_SWING * 20) / STANDING_RANGE
    expect(npcHorsePrice(world, city, h, 'r1')).toBe(
      Math.round(HORSE_PRICE_BASE * at * (1 - swing)),
    )
    changeStanding(world, 'npc', 'r1', -40)
    expect(npcHorsePrice(world, city, h, 'r1')).toBeGreaterThan(Math.round(HORSE_PRICE_BASE * at))
  })
})

describe('buying a horse', () => {
  it('moves the Coins into its storage and the horse into the realm, and nothing else', () => {
    const { world, city, store, stable, p1, queue } = setup()
    const price = npcHorsePrice(world, city, horseOf(world, 'h1'), 'r1')
    const food = stable.stock.food
    const horses = world.horses.length

    expect(order(world, queue, buy())).toBe('ack')
    run(world)

    const h = horseOf(world, 'h1')
    expect(h.realmId).toBe('r1')
    expect(h.cityId).toBeNull()
    expect([h.x, h.y]).toEqual([31, 21])
    expect(p1.carried.coins).toBe(500 - price)
    expect((store.stock as { coins?: number }).coins).toBe(price)
    expect(world.horses).toHaveLength(horses)
    expect(npcHorsesOf(world, city)).toHaveLength(NPC_HORSES_KEPT)
    expect(stable.stock.food).toBeLessThanOrEqual(food)
    expect(p1.order).toBeNull()
    expect(standingOf(world, 'npc', 'r1')).toBeCloseTo(price / STANDING_TRADE_COINS_PER_POINT)
    expect(standingOf(world, 'r1', 'npc')).toBeCloseTo(price / STANDING_TRADE_COINS_PER_POINT)
  })

  it('leaves a horse the buyer can ride home', () => {
    const { world, p1, queue } = setup()
    order(world, queue, buy())
    run(world)
    expect(order(world, queue, { kind: 'mount', residentId: 'p1', horseId: 'h1' })).toBe('ack')
    expect(p1.riding).toBe('h1')
    // Nobody saw a theft: it is theirs.
    expect(world.crimes).toEqual([])
  })

  it('takes a hired resident’s purchase into the hirer’s realm', () => {
    const { world, queue, p1 } = setup()
    p1.owner = null
    p1.cityId = 'npc'
    world.contracts.push({
      id: 'c1',
      cityId: 'npc',
      hirerId: 'r1',
      residentIds: ['p1'],
      pricePerWeek: 1,
    } as never)
    expect(order(world, queue, buy())).toBe('ack')
    run(world)
    expect(horseOf(world, 'h1').realmId).toBe('r1')
  })

  it('gets the city down to the pair and no further', () => {
    const { world, queue } = setup()
    expect(order(world, queue, buy('h1'))).toBe('ack')
    run(world)
    expect(order(world, queue, buy('h2'))).toBe('Dunmere keeps its last 2 horses to breed')
    expect(horseOf(world, 'h2').cityId).toBe('npc')
  })

  it('ends the breeding the horse was part of', () => {
    const { world, stable, queue } = setup()
    const n1 = world.residents.find((r) => r.id === 'n1')!
    n1.x = 31
    n1.y = 21
    n1.order = {
      kind: 'breed',
      stableId: 'stable',
      horseIds: ['h1', 'h2'],
      at: { x: 31, y: 21 },
      progress: 5,
    }
    Object.assign(stable, { breedings: [{ horseIds: ['h1', 'h2'], progress: 5 }] })
    expect(order(world, queue, buy('h1'))).toBe('ack')
    run(world)
    expect(n1.order?.kind).not.toBe('breed')
    expect((stable as { breedings?: unknown }).breedings).toBeUndefined()
  })

  it('tells why it didn’t go when something came in the way before the tick', () => {
    const { world, store, p1, queue } = setup()
    expect(order(world, queue, buy())).toBe('ack')
    p1.carried.coins = 1
    run(world)
    expect(horseOf(world, 'h1').cityId).toBe('npc')
    expect(p1.carried.coins).toBe(1)
    expect(store.stock).toEqual({})
    expect(p1.order).toBeNull()
  })

  it('the invariant catches a sale out of the pair', () => {
    const { world, queue } = setup()
    order(world, queue, buy())
    run(world)
    expect(npcHorseSalesKeepPair.check(world, terrain)).toEqual([])
    tradesOf(world)[0]!.keptPair = false
    expect(npcHorseSalesKeepPair.check(world, terrain)).toHaveLength(1)
  })
})

describe('refusing to sell a horse', () => {
  it('with too few Coins in hand, Coins on a carriage or in the realm not counting', () => {
    const { world, city, p1, queue } = setup()
    const price = npcHorsePrice(world, city, horseOf(world, 'h1'), 'r1')
    p1.carried = { coins: price - 1 }
    expect(order(world, queue, buy())).toBe(`it costs ${price} coins and they hold ${price - 1}`)
    p1.carried = {}
    expect(order(world, queue, buy())).toBe(`it costs ${price} coins and they hold 0`)
    p1.carried = { coins: price }
    expect(order(world, queue, buy())).toBe('ack')
  })

  it('a hitched horse', () => {
    const { world, queue } = setup()
    world.carriages.push({ id: 'k1', horseId: 'h1', x: 31, y: 21 } as Carriage)
    expect(order(world, queue, buy())).toBe('Horse h1 is hitched to a carriage')
  })

  it('a ridden horse', () => {
    const { world, queue } = setup()
    world.residents.find((r) => r.id === 'n1')!.riding = 'h1'
    expect(order(world, queue, buy())).toBe('someone rides Horse h1')
  })

  it('a Down horse', () => {
    const { world, queue } = setup()
    horseOf(world, 'h1').downUntil = 1000
    expect(order(world, queue, buy())).toBe('Horse h1 is Down')
  })

  it('with none to spare', () => {
    const { world, queue } = setup()
    world.horses = world.horses.filter((h) => h.id !== 'h3')
    expect(order(world, queue, buy())).toBe('Dunmere keeps its last 2 horses to breed')
  })

  it('at low standing', () => {
    const { world, queue } = setup()
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(order(world, queue, buy())).toBe('Dunmere won’t trade with you')
  })

  it('with no storage for the Coins', () => {
    const { world, queue } = setup()
    world.buildings = world.buildings.filter((b) => b.id !== 'store')
    expect(order(world, queue, buy())).toBe('Dunmere has no storage for the Coins')
  })

  it('a child, someone elsewhere, another’s horse, and one that doesn’t stand in the stable', () => {
    const { world, p1, queue } = setup()
    p1.bornAt = world.tick
    expect(order(world, queue, buy())).toBe('children can’t trade')
    p1.bornAt = -20 * 24 * 3600
    expect(order(world, queue, buy('nope'))).toBe('no such horse')
    p1.x = 40
    expect(order(world, queue, buy())).toBe('not at the NPC city’s stable with that horse')
    p1.x = 31
    horseOf(world, 'h1').cityId = 'elsewhere'
    expect(order(world, queue, buy())).toBe('not at the NPC city’s stable with that horse')
    horseOf(world, 'h1').cityId = 'npc'
    horseOf(world, 'h1').x = 45
    expect(order(world, queue, buy())).toBe('not at the NPC city’s stable with that horse')
  })

  it('at an unfinished stable, or a Player’s', () => {
    const { world, city, stable, queue } = setup()
    Object.assign(stable, { site: { work: 0 } })
    expect(order(world, queue, buy())).toBe('not at the NPC city’s stable with that horse')
    delete (stable as { site?: unknown }).site
    city.realmId = 'r2'
    expect(order(world, queue, buy())).toBe('not at the NPC city’s stable with that horse')
  })
})

describe('what a Player sees of its horses', () => {
  const seenCity = (world: WorldState) =>
    entitiesInSight(world, terrain, 'r1').find((e) => e.is === 'city' && e.id === 'npc') as {
      horses?: { horseId: string; price: number; name: string; problem?: string }[]
    }

  it('lists the horses in its stable with name, stats and price', () => {
    const { world, city } = setup()
    const { horses } = seenCity(world)
    expect(horses?.map((h) => h.horseId)).toEqual(['h1', 'h2', 'h3'])
    expect(horses?.[0]).toMatchObject({
      name: 'Horse h1',
      stableId: 'stable',
      stats: { speed: 10, strength: 10, endurance: 10 },
      price: npcHorsePrice(world, city, horseOf(world, 'h1'), 'r1'),
    })
    expect(horses?.[0]?.problem).toBeUndefined()
  })

  it('says why it won’t sell one, also at low standing', () => {
    const { world } = setup()
    horseOf(world, 'h2').downUntil = 1000
    expect(seenCity(world).horses?.[1]?.problem).toBe('Horse h2 is Down')
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(seenCity(world).horses?.[0]?.problem).toBe('Dunmere won’t trade with you')
  })

  it('lists nothing with its stable out of sight, its city in sight through its town hall', () => {
    const { world, p1 } = setup()
    const big: TerrainMap = { size: 256, tiles: new Uint8Array(256 * 256).fill(Terrain.Plains) }
    for (const r of world.residents.filter((x) => x.owner === 'r1')) {
      r.x = 230
      r.y = 20
    }
    expect(p1.x).toBe(230)
    const city = entitiesInSight(world, big, 'r1').find((e) => e.is === 'city' && e.id === 'npc')
    expect(city).toBeDefined()
    expect((city as { horses?: unknown }).horses).toBeUndefined()
  })

  it('isn’t remembered once out of sight', () => {
    const { world } = setup()
    refreshLastSeen(world, terrain.size)
    const memory = world.lastSeen[7] ?? []
    const remembered = memory.find((e) => e.id === 'npc') as { horses?: unknown } | undefined
    expect(remembered).toBeDefined()
    expect(remembered?.horses).toBeUndefined()
  })
})
