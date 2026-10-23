import {
  CITY_PRICE_BY_BUILDING,
  CITY_PRICE_PER_RESIDENT,
  CITY_PRICE_STANDING_SWING,
  NPC_CITY_REFUSES_STANDING,
  NPC_CITY_WONT_SELL_STANDING,
  STANDING_RANGE,
  TRADE_ORG,
  Terrain,
  buyProblem,
  cityPrice,
  mayStep,
  npcCityRefuses,
  sellsTo,
  tileIndex,
  wallMap,
  wallsKey,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { cityPricesSound, resolvePurchases } from './buying.js'
import { checkInvariants } from './invariants.js'
import { mulberry32, newResident } from './residents.js'
import { entitiesInSight } from './sight.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { createWorld } from './world.js'

/*
 * NPC city reaction (`CONTEXT.md`): at low standing an NPC city refuses you and shuts its gates
 * to your residents; the lower it is, the more it asks to be bought, and at very low standing it
 * won't sell at all.
 */

const terrain: TerrainMap = { size: 64, tiles: new Uint8Array(64 * 64).fill(Terrain.Plains) }

/** What the NPC city of `setup` is worth: two residents, its town hall, a house and a gate. */
const WORTH = Math.round(
  2 * CITY_PRICE_PER_RESIDENT +
    CITY_PRICE_BY_BUILDING.townHall! +
    CITY_PRICE_BY_BUILDING.house! +
    (CITY_PRICE_BY_BUILDING.gate ?? 0),
)

/**
 * Realm r1 (Leader a1 far away), realm r2, and the NPC city npc, its town hall at (20, 20), a
 * house at (23, 20) and an open gate at (20, 17), where n1 and n2 live. r1’s p1 stands on the town hall
 * carrying plenty of coins.
 */
function setup() {
  const world = createWorld(terrain)
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
  const npc = addCity(world, { id: 'npc', realmId: null, x: 20, y: 20, name: 'Dunmere' })
  world.buildings.push({ id: 'house', kind: 'house', cityId: 'npc', x: 23, y: 20 })
  world.buildings.push({ id: 'gate', kind: 'gate', cityId: 'npc', x: 20, y: 17 })
  resident(world, 'a1', 'r1', 50, 50)
  resident(world, 'b1', 'r2', 52, 50)
  resident(world, 'n1', null, 23, 20, 'npc')
  resident(world, 'n2', null, 20, 19, 'npc')
  resident(world, 'p1', 'r1', 20, 20).carried.coins = 10 * WORTH
  return { world, npc }
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

/** Whether someone of `side` may step from just outside the gate onto it. */
function passes(world: WorldState, side: string | null) {
  const walls = wallMap(world, terrain)
  const size = terrain.size
  return mayStep(walls, side, tileIndex(size, 20, 16), tileIndex(size, 20, 17), false)
}

const p1 = (world: WorldState) => world.residents.find((r) => r.id === 'p1')!

describe('NPC city reaction', () => {
  it('refuses an Organization only below the threshold, and only as an NPC city', () => {
    const { world, npc } = setup()
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING)
    expect(npcCityRefuses(world, npc, 'r1')).toBe(false)
    changeStanding(world, 'npc', 'r1', -1)
    expect(npcCityRefuses(world, npc, 'r1')).toBe(true)
    expect(npcCityRefuses(world, npc, 'r2')).toBe(false)
    // A realm's city, or one of the Trade Organization, never refuses here.
    const mine = addCity(world, { id: 'mine', realmId: 'r2', x: 40, y: 40 })
    changeStanding(world, 'r2', 'r1', -STANDING_RANGE)
    expect(npcCityRefuses(world, mine, 'r1')).toBe(false)
  })

  it('shuts its open gate to the residents of an Organization it refuses, not to others', () => {
    const { world } = setup()
    expect(passes(world, 'r1')).toBe(true)
    const before = wallsKey(world)
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(wallsKey(world)).not.toBe(before)
    expect(passes(world, 'r1')).toBe(false)
    expect(passes(world, 'r2')).toBe(true)
    expect(passes(world, null)).toBe(true)
    expect(passes(world, 'npc')).toBe(true)
    // Its standing drifts back up past the threshold, and the gate lets them through again.
    changeStanding(world, 'npc', 'r1', 2)
    expect(passes(world, 'r1')).toBe(true)
  })

  it('shuts its gate to the Trade Organization’s residents, by each of its cities', () => {
    const { world } = setup()
    const post = addCity(world, { id: 'post', realmId: null, x: 40, y: 20 })
    post.tradeOrg = 'post'
    changeStanding(world, 'npc', TRADE_ORG, NPC_CITY_REFUSES_STANDING - 1)
    expect(passes(world, 'post')).toBe(false)
    expect(passes(world, 'r1')).toBe(true)
  })

  it('says in sight that it refuses the Player', () => {
    const { world } = setup()
    const seen = () => entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'npc')
    expect(seen()).not.toHaveProperty('refuses')
    changeStanding(world, 'npc', 'r1', NPC_CITY_REFUSES_STANDING - 1)
    expect(seen()).toMatchObject({ is: 'city', refuses: true })
  })

  it('asks more the lower its standing toward the buyer, less the higher', () => {
    const { world, npc } = setup()
    expect(cityPrice(world, npc, 'r1')).toBe(WORTH)
    changeStanding(world, 'npc', 'r1', 50)
    const good = Math.round(WORTH * (1 - CITY_PRICE_STANDING_SWING / 2))
    expect(cityPrice(world, npc, 'r1')).toBe(good)
    expect(good).toBeLessThan(WORTH)
    expect(entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'npc')).toMatchObject({
      price: good,
    })
    changeStanding(world, 'npc', 'r1', -100)
    const bad = Math.round(WORTH * (1 + CITY_PRICE_STANDING_SWING / 2))
    expect(cityPrice(world, npc, 'r1')).toBe(bad)
    expect(bad).toBeGreaterThan(WORTH)
    // Another realm still pays what it is worth.
    expect(cityPrice(world, npc, 'r2')).toBe(WORTH)
    expect(checkInvariants(world, terrain, [cityPricesSound])).toEqual([])
  })

  it('charges the buyer the price it names them', () => {
    const { world, npc } = setup()
    changeStanding(world, 'npc', 'r1', -40)
    const price = cityPrice(world, npc, 'r1')
    p1(world).order = { kind: 'buyCity', cityId: 'npc' }
    expect(resolvePurchases(world, terrain.size)).toBe(1)
    expect(p1(world).carried.coins).toBe(10 * WORTH - price)
    expect(npc.realmId).toBe('r1')
  })

  it('won’t sell at all below the lower threshold', () => {
    const { world, npc } = setup()
    changeStanding(world, 'npc', 'r1', NPC_CITY_WONT_SELL_STANDING)
    expect(sellsTo(world, npc, 'r1')).toBe(true)
    changeStanding(world, 'npc', 'r1', -1)
    expect(sellsTo(world, npc, 'r1')).toBe(false)
    expect(sellsTo(world, npc, 'r2')).toBe(true)
    expect(buyProblem(world, 'r1', p1(world), 'npc')).toMatch(/won’t sell to you/)
    const seen = entitiesInSight(world, terrain, 'r1').find((e) => e.id === 'npc')
    expect(seen).toMatchObject({ is: 'city', wontSell: true, refuses: true })
    expect(seen).not.toHaveProperty('price')
    // An order given before its standing fell through falls through too.
    p1(world).order = { kind: 'buyCity', cityId: 'npc' }
    expect(resolvePurchases(world, terrain.size)).toBe(0)
    expect(npc.realmId).toBeNull()
    expect(p1(world).carried.coins).toBe(10 * WORTH)
    expect(p1(world).order).toBeNull()
  })

  it('the thresholds are in order: it refuses before it stops selling', () => {
    expect(NPC_CITY_WONT_SELL_STANDING).toBeLessThan(NPC_CITY_REFUSES_STANDING)
    expect(NPC_CITY_REFUSES_STANDING).toBeLessThan(0)
    expect(NPC_CITY_WONT_SELL_STANDING).toBeGreaterThan(-STANDING_RANGE)
    expect(CITY_PRICE_STANDING_SWING).toBeGreaterThan(0)
    expect(CITY_PRICE_STANDING_SWING).toBeLessThan(1)
  })
})
