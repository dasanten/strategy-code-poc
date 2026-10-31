import {
  BUILD_MATERIALS,
  NPC_CITY_REFUSES_STANDING,
  NPC_SMITHY_WEAPON,
  NPC_TRADE,
  NPC_WAR_CHEST_PER_RESIDENT,
  canWork,
  npcSoldierTarget,
  recipeFor,
  Terrain,
  commanderOf,
  isArmed,
  npcCityPrices,
  npcReserve,
  npcHirePrice,
  spareResidents,
  standingOf,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHireSound } from './npc-hire.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { npcTradesKeepReserve, tradesOf } from './trading.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Trading with and hiring from an NPC city (`CONTEXT.md`): in person at its storage, only its
 * surplus and what it lacks of its reserve, at prices from its stock moved by standing; and
 * lending the adults it can spare to a Player who asks and pays enough. Below
 * `NPC_CITY_REFUSES_STANDING` it does neither.
 */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/**
 * Realm r1 (Player 7, Leader a1 far away) and the NPC city npc: its town hall at (20, 20), a
 * storage at (23, 20) and a farm at (25, 20), where n1 to n6 live. r1's p1 stands on the storage.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  world.buildings.push({ id: 'store', kind: 'storage', cityId: 'npc', x: 23, y: 20, stock: {} })
  world.buildings.push({ id: 'farm', kind: 'farm', cityId: 'npc', x: 25, y: 20 })
  resident(world, 'a1', 'r1', 50, 50)
  for (let i = 1; i <= 6; i++) resident(world, `n${i}`, null, 20, 21, 'npc')
  const p1 = resident(world, 'p1', 'r1', 23, 20)
  return { world, npc, p1, queue: new OrderQueue(undefined, terrain) }
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

const storage = (world: WorldState) => world.buildings.find((b) => b.id === 'store')!
const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

/** Sends an order from the Player, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', o)
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

/** Steps the world once, keeping residents fed, and checks every invariant. */
function run(world: WorldState) {
  for (const r of world.residents) r.hunger = 100
  stepWorld(world, terrain)
  expect(checkInvariants(world, terrain)).toEqual([])
}

const trade = (side: 'buy' | 'sell', good: string, units: number, extra = {}) => ({
  kind: side,
  residentId: 'p1',
  good,
  units,
  ...extra,
})

describe('trading with an NPC city', () => {
  it('keeps a reserve of Food, materials for a house and some wall, weapons and a war chest', () => {
    const { world, npc } = setup()
    const reserve = npcReserve(world, npc)
    expect(reserve.food).toBeGreaterThan(0)
    const residents = world.residents.filter((r) => r.cityId === npc.id)
    const adults = residents.filter((r) => canWork(r, world.tick))
    const unarmed = npcSoldierTarget(adults.length) - adults.filter(isArmed).length
    const spear = recipeFor('smithy', NPC_SMITHY_WEAPON)!.input
    expect(reserve[NPC_SMITHY_WEAPON]).toBe(unarmed)
    expect(reserve.wood).toBe(
      BUILD_MATERIALS.house!.wood! +
        BUILD_MATERIALS.wall!.wood! * NPC_TRADE.reserveWallStretches +
        spear.wood! * unarmed,
    )
    expect(reserve.iron).toBe(spear.iron! * unarmed)
    expect(reserve.stone).toBeUndefined()
    expect(reserve.coins).toBe(residents.length * NPC_WAR_CHEST_PER_RESIDENT)
    // Armed soldiers want no more weapons, nor Iron to forge them.
    for (const r of residents) r.carried.spear = 1
    expect(npcReserve(world, npc).iron).toBeUndefined()
    expect(npcReserve(world, npc)[NPC_SMITHY_WEAPON]).toBeUndefined()
  })

  it('sells only its surplus, and the trade raises its standing', () => {
    const { world, npc, p1, queue } = setup()
    const keep = npcReserve(world, npc).food!
    storage(world).stock = { food: keep + 5 }
    p1.carried.coins = 500
    expect(order(world, queue, trade('buy', 'food', 50))).toBe('ack')
    run(world)
    expect(p1.carried.food).toBe(5)
    expect(tradesOf(world)[0]).toMatchObject({ npcCityId: 'npc', keptReserve: true })
    expect(storage(world).stock!.coins).toBe(500 - p1.carried.coins!)
    expect(standingOf(world, 'npc', 'r1')).toBeGreaterThan(0)
    // Nothing above the reserve is left, so it sells no more.
    expect(order(world, queue, trade('buy', 'food', 1))).toBe('ack')
    run(world)
    expect(p1.carried.food).toBe(5)
  })

  it('buys only what it lacks of its reserve, with the coins in its storage', () => {
    const { world, npc, p1, queue } = setup()
    const keep = npcReserve(world, npc).wood!
    storage(world).stock = { wood: keep - 3, coins: 1000 }
    p1.carried = { wood: 8, stone: 4 }
    expect(order(world, queue, trade('sell', 'wood', 8))).toBe('ack')
    run(world)
    expect(p1.carried.wood).toBe(5)
    expect(storage(world).stock!.wood).toBe(keep)
    expect(p1.carried.coins).toBeGreaterThan(0)
    // Stone it keeps no reserve of, so it doesn't take any.
    expect(order(world, queue, trade('sell', 'stone', 4))).toBe('ack')
    run(world)
    expect(p1.carried.stone).toBe(4)
    // With no coins in its storage it buys nothing.
    storage(world).stock = { wood: 0 }
    expect(order(world, queue, trade('sell', 'wood', 1))).toBe('ack')
    run(world)
    expect(p1.carried.wood).toBe(5)
  })

  it('prices from its stock, cheaper to an Organization it holds in good standing', () => {
    const { world, npc } = setup()
    storage(world).stock = { armour: 20 }
    const neutral = npcCityPrices(world, npc, 'r1').find((p) => p.good === 'armour')!
    storage(world).stock = { armour: 1 }
    const scarce = npcCityPrices(world, npc, 'r1').find((p) => p.good === 'armour')!
    expect(scarce.sell).toBeGreaterThan(neutral.sell)
    expect(neutral.buy).toBeLessThan(neutral.sell)
    changeStanding(world, 'npc', 'r1', 60)
    const liked = npcCityPrices(world, npc, 'r1').find((p) => p.good === 'armour')!
    expect(liked.sell).toBeLessThan(scarce.sell)
    expect(liked.buy).toBeGreaterThan(scarce.buy)
    expect(liked.buy).toBeLessThan(liked.sell)
  })

  it('refuses to trade below NPC_CITY_REFUSES_STANDING, and delivers nothing', () => {
    const { world, npc, p1, queue } = setup()
    storage(world).stock = { food: 1000 }
    p1.carried.coins = 100
    expect(order(world, queue, trade('buy', 'food', 1, { cityId: 'npc' }))).toBe(
      'only the Trade Organization delivers',
    )
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(order(world, queue, trade('buy', 'food', 1))).toBe('Dunmere won’t trade with you')
    // It names a refused Player no prices and no residents to hire.
    const seen = entitiesInSight(world, terrain, 'r1').find((e) => e.id === npc.id)
    expect(seen).toMatchObject({ refuses: true })
    expect(seen).not.toHaveProperty('trade')
    expect(seen).not.toHaveProperty('hire')
  })

  it('names a Player in sight its prices and what it would lend', () => {
    const { world, npc } = setup()
    const seen = entitiesInSight(world, terrain, 'r1').find((e) => e.id === npc.id)
    expect(seen).toMatchObject({
      hire: { spare: spareResidents(world, npc).length, pricePerResidentWeek: 5 },
    })
    expect((seen as { trade: unknown[] }).trade.length).toBeGreaterThan(0)
  })

  it('reports a trade that broke into the reserve', () => {
    const { world, npc, p1, queue } = setup()
    storage(world).stock = { food: npcReserve(world, npc).food! + 1 }
    p1.carried.coins = 100
    order(world, queue, trade('buy', 'food', 1))
    run(world)
    expect(npcTradesKeepReserve.check(world, terrain)).toEqual([])
    tradesOf(world)[0]!.keptReserve = false
    expect(npcTradesKeepReserve.check(world, terrain)).toHaveLength(1)
  })
})

describe('hiring from an NPC city', () => {
  /** n1 and n2 farm, n3 is a soldier (carries a spear), n4 to n6 are idle. */
  function staffed(world: WorldState) {
    for (const id of ['n1', 'n2']) {
      at(world, id).order = {
        kind: 'workAt',
        buildingId: 'farm',
        at: { x: 25, y: 20 },
        progress: 0,
      }
    }
    at(world, 'n3').carried.spear = 1
  }

  const ask = (residents: number, pricePerWeek: number) => ({
    kind: 'offerContract',
    realmId: 'npc',
    residents,
    days: 7,
    pricePerWeek,
    storageId: 'store',
  })

  it('lends only idle adults it can spare, keeping its farmers and a share at home', () => {
    const { world, npc } = setup()
    staffed(world)
    // Six adults: two farm, a quarter (two) stay at home with the soldier among them.
    const spare = spareResidents(world, npc).map((r) => r.id)
    expect(spare).toEqual(['n4', 'n5'])
    resident(world, 'kid', null, 20, 21, 'npc').bornAt = 0
    expect(spareResidents(world, npc).map((r) => r.id)).not.toContain('kid')
  })

  it('accepts at its asking price, lends armed residents and is paid weekly', () => {
    const { world, npc, p1, queue } = setup()
    staffed(world)
    storage(world).stock = { sword: 1, armour: 2 }
    p1.carried.coins = 100
    const price = 2 * npcHirePrice(world, npc, 'r1')
    expect(order(world, queue, ask(2, price))).toBe('ack')
    run(world)
    const c = world.contracts[0]!
    expect(c).toMatchObject({ lenderId: 'npc', hirerId: 'r1', offeredBy: 'hirer' })
    expect(c.startedAt).not.toBeNull()
    expect(c.residentIds).toEqual(['n4', 'n5'])
    for (const id of c.residentIds) expect(commanderOf(world, at(world, id))).toBe('r1')
    // They took the sword and the armour from its storage along.
    expect(isArmed(at(world, 'n4'))).toBe(true)
    expect(at(world, 'n4').carried.armour).toBe(1)
    expect(at(world, 'n5').carried.armour).toBe(1)
    expect(storage(world).stock!.sword ?? 0).toBe(0)
    // p1 pays the first week into the city's storage, which raises its standing.
    expect(order(world, queue, { kind: 'pay', residentId: 'p1', contractId: c.id, weeks: 1 })).toBe(
      'ack',
    )
    run(world)
    expect(storage(world).stock!.coins).toBe(price)
    expect(c.paidWeeks).toBe(1)
    expect(standingOf(world, 'npc', 'r1')).toBeGreaterThan(0)
    // Lent residents are left to the hirer: the city gives them no work.
    expect(at(world, 'n4').order?.kind).not.toBe('workAt')
  })

  it('declines too low a price and asks for more than it can spare', () => {
    const { world, npc, queue } = setup()
    staffed(world)
    expect(order(world, queue, ask(3, 1000))).toBe('Dunmere can spare only 2 residents')
    const price = 2 * npcHirePrice(world, npc, 'r1') - 1
    expect(order(world, queue, ask(2, price))).toBe('ack')
    run(world)
    expect(world.contracts).toEqual([])
    expect(world.events.some((e) => e.kind === 'contract' && e.what === 'declined')).toBe(true)
  })

  it('hires out only by being asked for a number, and never below NPC_CITY_REFUSES_STANDING', () => {
    const { world, queue } = setup()
    staffed(world)
    expect(
      order(world, queue, {
        kind: 'offerContract',
        residentIds: ['n4'],
        days: 7,
        pricePerWeek: 100,
        storageId: 'store',
      }),
    ).toBe('ask the city for a number of its residents')
    expect(order(world, queue, { ...ask(1, 100), storageId: 'npc-hall' })).toBe(
      'the coins go into a storage of the city',
    )
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(order(world, queue, ask(1, 100))).toBe('Dunmere won’t hire out to you')
  })

  it('reports a contract an NPC city offered itself or is paid outside its storages', () => {
    const { world } = setup()
    world.buildings.push({ id: 'other', kind: 'storage', cityId: null, x: 30, y: 30 })
    world.contracts.push({
      id: 'k',
      lenderId: 'npc',
      hirerId: 'r1',
      offeredBy: 'lender',
      residentIds: ['n4'],
      days: 7,
      pricePerWeek: 20,
      storageId: 'other',
      startedAt: null,
      paidWeeks: 0,
    })
    expect(npcHireSound.check(world, terrain).map((v) => v.message)).toEqual([
      'NPC city npc offered contract k',
      'contract k is paid into other, no storage of npc',
    ])
  })
})
