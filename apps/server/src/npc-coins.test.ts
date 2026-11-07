import {
  NPC_NODE_REACH,
  NPC_TOWN,
  NPC_TRADER_REACH,
  NPC_WAR_CHEST_PER_RESIDENT,
  TRADER_STOP_REACH,
  Terrain,
  cityResidents,
  npcCityPrices,
  npcReserve,
  tileIndex,
  type City,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { shortGoods } from './npc-chain.js'
import { foundNpcCity } from './npc-cities.js'
import { coinsShortOnlyWithIncome, earnsCoins } from './npc-coins.js'
import { farStableSpot, nextProject } from './npc-growth.js'
import { plains } from './npc-growth.fixture.js'
import { planCity } from './npc-plan.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { placeTraders } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { createWorld } from './world.js'

/*
 * A city with no way to earn Coins doesn't count them as short (`CONTEXT.md`: NPC reserve, Full
 * city; #996). Its war chest stays as it is for everything else.
 */

/** Everything a town's reserve wants but Coins, with none of them. */
const ALL_BUT_COINS = { food: 3000, wood: 800, stone: 800, iron: 200, spear: 20, coins: 0 }

/**
 * A town at (x, y) on `world`, its storage full of all its reserve wants but Coins, and none of
 * those, with its stable, so nothing is left to build but a daughter (as `fullTown` in
 * `npc-founding.test.ts`).
 */
function brokeTown(world: WorldState, terrain: TerrainMap, x: number, y: number): City {
  const city = foundNpcCity(world, terrain, NPC_TOWN, x, y, mulberry32(5))
  const home = npcHome(world, city)!
  home.stock = { ...ALL_BUT_COINS }
  const stable = farStableSpot(world, city, home, terrain)!
  world.buildings.push({ id: `stable-${city.id}`, kind: 'stable', cityId: city.id, ...stable })
  return city
}

/** A town alone on a Plains map, nothing short but Coins. */
function aloneBroke(size = 300) {
  const terrain = plains(size)
  const world = createWorld(terrain)
  const city = brokeTown(world, terrain, 60, 60)
  return { world, terrain, city, home: npcHome(world, city)! }
}

/** Puts a gold node on Hills at (x, y). */
function goldNode(world: WorldState, terrain: TerrainMap, x: number, y: number) {
  world.nodes.push({ id: `gold${x},${y}`, kind: 'goldOre', x, y })
  terrain.tiles[tileIndex(terrain.size, x, y)] = Terrain.Hills
}

describe('a city with no way to earn Coins', () => {
  it('counts as full once nothing else is short, though its Coins are under its war chest', () => {
    const { world, terrain, city } = aloneBroke()
    const plan = planCity(world, city, terrain)
    expect(plan.fullSince).toBe(world.tick)
  })

  it('does not count Coins as short, nor build for them', () => {
    const { world, terrain, city, home } = aloneBroke()
    expect(earnsCoins(world, city, terrain.size)).toBe(false)
    expect(shortGoods(world, city, terrain.size)).toEqual([])
    const project = nextProject(world, city, home, terrain)
    expect(project?.kind === 'build' && project.building).not.toBe('mint')
  })

  it('keeps its war chest for everything else: its reserve and what it sells', () => {
    const { world, city } = aloneBroke()
    const residents = cityResidents(world, city).filter((r) => r.health > 0).length
    expect(npcReserve(world, city).coins).toBe(residents * NPC_WAR_CHEST_PER_RESIDENT)
    // Its prices still read its reserve, war chest and all: none of it is for sale.
    const wood = npcCityPrices(world, city).find((p) => p.good === 'wood')!
    expect(wood.forSale).toBe(ALL_BUT_COINS.wood - (npcReserve(world, city).wood ?? 0))
  })

  it('still counts what else it lacks as short', () => {
    const { world, terrain, city, home } = aloneBroke()
    home.stock = { ...ALL_BUT_COINS, wood: 0 }
    expect(shortGoods(world, city, terrain.size)).toEqual(['wood'])
  })

  it('keeps the coins-short-sound invariant', () => {
    const { world, terrain } = aloneBroke()
    expect(coinsShortOnlyWithIncome.check(world, terrain)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })
})

describe('a city with gold or a mint of its own', () => {
  it('counts Coins as short with a mint of its own, finished or begun', () => {
    for (const site of [false, true]) {
      const { world, terrain, city, home } = aloneBroke()
      world.buildings.push({
        id: 'mint0',
        kind: 'mint',
        cityId: city.id,
        x: home.x + 6,
        y: home.y + 6,
        ...(site ? { site: { delivered: {}, work: 0 } } : {}),
      })
      expect(earnsCoins(world, city, terrain.size)).toBe(true)
      expect(shortGoods(world, city, terrain.size)).toEqual(['coins'])
    }
  })

  it('counts Coins as short with Gold ore in its storage', () => {
    const { world, terrain, city, home } = aloneBroke()
    home.stock = { ...ALL_BUT_COINS, goldOre: 1 }
    expect(shortGoods(world, city, terrain.size)).toEqual(['coins'])
  })

  it('counts Coins as short with a gold node it knows of, not one out of its knowing', () => {
    const { world, terrain, city, home } = aloneBroke(2048)
    goldNode(world, terrain, home.x + NPC_NODE_REACH + 200, home.y)
    expect(earnsCoins(world, city, terrain.size)).toBe(false)
    goldNode(world, terrain, home.x + NPC_NODE_REACH - 10, home.y)
    expect(earnsCoins(world, city, terrain.size)).toBe(true)
    expect(shortGoods(world, city, terrain.size)).toEqual(['coins'])
  })

  it('counts Coins as short with a gold mine of its own', () => {
    const { world, terrain, city, home } = aloneBroke(2048)
    const far = { x: home.x + NPC_NODE_REACH + 200, y: home.y }
    goldNode(world, terrain, far.x, far.y)
    world.buildings.push({ id: 'mine0', kind: 'mine', cityId: city.id, ...far })
    expect(earnsCoins(world, city, terrain.size)).toBe(true)
  })
})

describe('trade in reach', () => {
  it(
    'a Trade Org warehouse within its trader’s reach, across the map’s join too, not past it',
    { timeout: 60_000 },
    () => {
      const terrain = plains(2048)
      const world = createWorld(terrain)
      const rand = mulberry32(7)
      foundTradingPost(world, terrain, 1000, 1000, undefined, rand)
      const near = brokeTown(world, terrain, 1000 + NPC_TRADER_REACH - 60, 1000)
      const far = brokeTown(world, terrain, 1000 - NPC_TRADER_REACH - 60, 1000)
      expect(earnsCoins(world, near, terrain.size)).toBe(true)
      expect(shortGoods(world, near, terrain.size)).toEqual(['coins'])
      expect(earnsCoins(world, far, terrain.size)).toBe(false)
      expect(shortGoods(world, far, terrain.size)).toEqual([])

      const across = plains(2048)
      const other = createWorld(across)
      foundTradingPost(other, across, 30, 1000, undefined, mulberry32(7))
      const over = brokeTown(other, across, 2048 - NPC_TRADER_REACH + 120, 1000)
      expect(earnsCoins(other, over, across.size)).toBe(true)
    },
  )

  it(
    'a wandering trader whose loop passes it within a stop’s reach, not one passing further off',
    { timeout: 60_000 },
    () => {
      const terrain = plains(3200)
      const world = createWorld(terrain)
      const rand = mulberry32(5)
      foundTradeOrgHq(world, terrain, 100, 500, rand)
      foundTradingPost(world, terrain, 1600, 500, undefined, rand)
      placeTraders(world, terrain.size)
      // Halfway between the two, past every warehouse's reach.
      const by = brokeTown(world, terrain, 850, 500 + TRADER_STOP_REACH - 60)
      const off = brokeTown(world, terrain, 850, 500 + TRADER_STOP_REACH + 300)
      expect(earnsCoins(world, by, terrain.size)).toBe(true)
      expect(shortGoods(world, by, terrain.size)).toEqual(['coins'])
      expect(earnsCoins(world, off, terrain.size)).toBe(false)

      world.traders = []
      expect(earnsCoins(world, by, terrain.size)).toBe(false)
    },
  )
})
