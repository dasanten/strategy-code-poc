import {
  NODE_WORKPLACE,
  NPC_CITY_MIN_DISTANCE,
  TICKS_PER_GAME_DAY,
  TRADING_POST,
  Terrain,
  inCityArea,
  isCityBuilding,
  storedFood,
  tileIndex,
  townHallOf,
  wrapDistance,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkInvariants } from './invariants.js'
import { mulberry32 } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import {
  commonResource,
  foundTradingPost,
  inRegion,
  placeTradingPosts,
  regions,
  tradingPosts,
  type Region,
} from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, generateWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** Resource nodes east of the post's square: two of stone, one of each other kind nearer. */
const NODES: [ResourceKind, number, number][] = [
  ['forest', 34, 22],
  ['stone', 40, 20],
  ['stone', 38, 26],
  ['ironOre', 33, 18],
]

/** A trading post alone on a Plains map 64 across, its square's top-left at (20, 20). */
function post(): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(64)
  for (const [kind, x, y] of NODES) {
    terrain.tiles[tileIndex(terrain.size, x, y)] =
      kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = NODES.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  const region: Region = { x: 0, y: 0, width: 64, height: 64 }
  const city = foundTradingPost(
    world,
    terrain,
    20,
    20,
    commonResource(world, region),
    mulberry32(3),
  )
  return { world, terrain, city }
}

describe('regions', () => {
  it('cuts a full-size map into 4 × 4 regions, a small one into one', () => {
    expect(regions(1440)).toHaveLength(16)
    expect(regions(1440).every((r) => r.width === 360 && r.height === 360)).toBe(true)
    expect(regions(128)).toEqual([{ x: 0, y: 0, width: 128, height: 128 }])
  })

  it('covers the map once', () => {
    const size = 1000
    const covered = new Uint8Array(size * size)
    for (const r of regions(size)) {
      for (let y = r.y; y < r.y + r.height; y++) {
        for (let x = r.x; x < r.x + r.width; x++) covered[y * size + x]!++
      }
    }
    expect(covered.every((n) => n === 1)).toBe(true)
  })
})

describe('a trading post', () => {
  it('is a small walled city of the Trade Organization with a warehouse', () => {
    const { world, terrain, city } = post()
    expect(city).toMatchObject({ realmId: null, tradeOrg: 'post' })
    expect(tradingPosts(world)).toEqual([city])
    const own = world.buildings.filter((b) => b.cityId === city.id)
    const count = (k: string) => own.filter((b) => b.kind === k).length
    expect(count('townHall')).toBe(1)
    expect(count('storage')).toBe(1)
    expect(count('house')).toBe(TRADING_POST.houses)
    expect(count('farm')).toBe(TRADING_POST.farms)
    expect(count('gate')).toBe(1)
    expect(world.residents.filter((r) => r.cityId === city.id)).toHaveLength(TRADING_POST.residents)
    const warehouse = own.find((b) => b.kind === 'warehouse')!
    expect(warehouse.stock).toEqual({ coins: TRADING_POST.coins, ...TRADING_POST.goods })
    for (const b of own) {
      expect(inCityArea(world, city, b.x, b.y, terrain.size)).toBe(isCityBuilding(b))
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it("works the nearest node of its region's most common resource", () => {
    const { world, city } = post()
    expect(city.workplaceIds).toHaveLength(1)
    const workplace = world.buildings.find((b) => b.id === city.workplaceIds![0])!
    // Stone is the most common; of the two stone nodes, (38, 26) is nearer the town hall.
    expect(workplace).toMatchObject({ kind: NODE_WORKPLACE.stone, cityId: null, x: 38, y: 26 })
  })

  it('left alone keeps its size and keeps itself fed', () => {
    const { world, terrain, city } = post()
    const walking = new Walking(terrain)
    const buildings = structuredClone(world.buildings.map(({ stock: _stock, ...b }) => b))
    const people = world.residents.map((r) => r.id)
    for (let t = 0; t < 30 * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    }
    expect(world.buildings.map(({ stock: _stock, ...b }) => b)).toEqual(buildings)
    expect(world.residents.map((r) => r.id)).toEqual(expect.arrayContaining(people))
    expect(storedFood(world, city)).toBeGreaterThan(0)
  }, 120_000)
})

describe('placing trading posts', () => {
  let terrain: TerrainMap
  let world: WorldState
  beforeAll(() => {
    terrain = generateTerrain(1, 720)
    world = generateWorld(terrain)
  })

  it('places about one in every region, spread evenly', () => {
    const posts = tradingPosts(world)
    const all = regions(terrain.size)
    expect(all).toHaveLength(4)
    expect(posts.length).toBeGreaterThanOrEqual(all.length - 1)
    // At most one in each region, and none near another city.
    for (const r of all) {
      const inside = posts.filter((c) => inRegion(r, townHallOf(world, c)!))
      expect(inside.length).toBeLessThanOrEqual(1)
    }
    for (const p of posts) {
      const hall = townHallOf(world, p)!
      for (const c of world.cities.filter((o) => o !== p)) {
        const d = wrapDistance(terrain.size, hall, townHallOf(world, c)!)
        expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE - TRADING_POST.size)
      }
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps starting cities at a distance', () => {
    const w = structuredClone(world)
    foundStartingCity(w, terrain, 1)
    const start = w.cities.find((c) => c.realmId === realmOf(w, 1)!.id)!
    for (const p of tradingPosts(w)) {
      const d = wrapDistance(terrain.size, townHallOf(w, p)!, townHallOf(w, start)!)
      expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE / 2)
    }
  })

  it('places the same posts for the same world, and no more once each region has one', () => {
    expect(generateWorld(terrain)).toEqual(world)
    const w = structuredClone(world)
    expect(placeTradingPosts(w, terrain)).toEqual([])
    expect(w).toEqual(world)
  })

  it('places them out of sight of every Player', () => {
    const w = createWorld(terrain)
    const realm = foundStartingCity(w, terrain, 1)
    placeTradingPosts(w, terrain)
    const seen = new Set(entitiesInSight(w, terrain, realm.id).map((e) => e.id))
    for (const p of tradingPosts(w)) expect(seen.has(p.id)).toBe(false)
  })
})
