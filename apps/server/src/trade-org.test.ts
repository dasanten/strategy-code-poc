import {
  NODE_WORKPLACE,
  NPC_CITY_MIN_DISTANCE,
  TICKS_PER_GAME_DAY,
  TRADE_ORG_HQ,
  TRADE_ORG_HQ_MIN_DISTANCE,
  Terrain,
  inCityArea,
  isCityBuilding,
  storedFood,
  tileIndex,
  townHallOf,
  warehousePrices,
  wrapDistance,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkInvariants, tradeOrgSound } from './invariants.js'
import { mulberry32 } from './residents.js'
import { entitiesInSight } from './sight.js'
import { foundStartingCity, realmOf } from './starting-city.js'
import { generateTerrain } from './terrain-gen.js'
import { addCity } from './test-terrain.js'
import { findHqSite, foundTradeOrgHq, placeTradeOrgHq, roundRing, tradeOrgHq } from './trade-org.js'
import { Walking } from './walking.js'
import { createWorld, generateWorld, stepWorld } from './world.js'

/** An open map of Plains, `size` tiles along each side. */
const plains = (size: number): TerrainMap => ({
  size,
  tiles: new Uint8Array(size * size).fill(Terrain.Plains),
})

/** Where the test HQ's town hall stands on its map. */
const MID = 320

/** A resource node of each kind a little way east of the middle, on terrain that fits it. */
const NODES: [ResourceKind, number, number][] = [
  ['forest', MID + 80, MID],
  ['stone', MID + 80, MID + 12],
  ['ironOre', MID + 88, MID - 12],
  ['goldOre', MID + 96, MID],
]

/** The HQ alone on a Plains map 640 across, with one node of each kind near it. */
function hq(): { world: WorldState; terrain: TerrainMap; city: City } {
  const terrain = plains(640)
  for (const [kind, x, y] of NODES) {
    terrain.tiles[tileIndex(terrain.size, x, y)] =
      kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = NODES.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  const city = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  return { world, terrain, city }
}

/**
 * The tiles reached from the middle without crossing any of `walls`, stepping to all eight
 * neighbours, up to `limit` tiles out.
 */
function reached(walls: [number, number][], limit: number): Set<string> {
  const blocked = new Set(walls.map(([x, y]) => `${x},${y}`))
  const seen = new Set([`${MID},${MID}`])
  const queue: [number, number][] = [[MID, MID]]
  while (queue.length > 0) {
    const [x, y] = queue.pop()!
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${x + dx},${y + dy}`
        if (seen.has(key) || blocked.has(key) || Math.hypot(x + dx - MID, y + dy - MID) > limit)
          continue
        seen.add(key)
        queue.push([x + dx, y + dy])
      }
    }
  }
  return seen
}

describe('the Trade Org HQ', () => {
  it('is a round city of the Trade Organization with two rings of wall', () => {
    const { world, terrain, city } = hq()
    expect(city).toMatchObject({ realmId: null, tradeOrg: 'hq' })
    expect(tradeOrgHq(world)).toBe(city)
    const own = world.buildings.filter((b) => b.cityId === city.id)
    const count = (k: string) => own.filter((b) => b.kind === k).length
    expect(townHallOf(world, city)).toMatchObject({ x: MID - 1, y: MID - 1 })
    expect(count('townHall')).toBe(1)
    expect(count('storage')).toBe(1)
    expect(count('house')).toBe(TRADE_ORG_HQ.houses)
    expect(count('farm')).toBe(TRADE_ORG_HQ.farms)
    expect(count('gate')).toBe(2 * TRADE_ORG_HQ.gates)
    const inner = roundRing(MID, MID, TRADE_ORG_HQ.innerRadius)
    const outer = roundRing(MID, MID, TRADE_ORG_HQ.outerRadius)
    expect(count('wall') + count('gate')).toBe(inner.length + outer.length)
    // Every city building is part of the city; the farms lie outside its area.
    for (const b of own) {
      expect(inCityArea(world, city, b.x, b.y, terrain.size)).toBe(isCityBuilding(b))
    }
    // The rings hold: from the town hall nobody gets past the inner ring without a gate, nor past
    // the outer one.
    const insideInner = reached([...inner, ...outer], TRADE_ORG_HQ.outerRadius + 12)
    for (const key of insideInner) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      expect(Math.hypot(x - MID, y - MID)).toBeLessThan(TRADE_ORG_HQ.innerRadius)
    }
    const insideOuter = reached(outer, TRADE_ORG_HQ.outerRadius + 12)
    for (const key of insideOuter) {
      const [x, y] = key.split(',').map(Number) as [number, number]
      expect(Math.hypot(x - MID, y - MID)).toBeLessThan(TRADE_ORG_HQ.outerRadius)
    }
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('keeps its coins and goods in warehouses inside the inner ring', () => {
    const { world, city } = hq()
    const warehouses = world.buildings.filter((b) => b.kind === 'warehouse')
    expect(warehouses.map((b) => b.stock)).toEqual([
      { coins: TRADE_ORG_HQ.coins },
      TRADE_ORG_HQ.goods,
    ])
    for (const b of [...warehouses, ...world.buildings.filter((x) => x.kind === 'storage')]) {
      expect(b.cityId).toBe(city.id)
      expect(Math.hypot(b.x - MID, b.y - MID)).toBeLessThan(TRADE_ORG_HQ.innerRadius)
    }
  })

  it('runs its own workplaces on the nearest nodes, and a smelter and a mint', () => {
    const { world, city } = hq()
    const own = world.buildings.filter((b) => city.workplaceIds?.includes(b.id))
    expect(own.map((b) => b.kind).sort()).toEqual(
      ['lumberCamp', 'mine', 'mine', 'mint', 'quarry', 'smelter'].sort(),
    )
    // Workplaces belong to no city.
    for (const b of own) expect(b.cityId).toBeNull()
    for (const [kind, x, y] of NODES) {
      expect(own.find((b) => b.x === x && b.y === y)?.kind).toBe(NODE_WORKPLACE[kind])
    }
    for (const b of own.filter((x) => x.kind === 'smelter' || x.kind === 'mint')) {
      const d = Math.hypot(b.x - MID, b.y - MID)
      expect(d).toBeGreaterThan(TRADE_ORG_HQ.innerRadius)
      expect(d).toBeLessThan(TRADE_ORG_HQ.outerRadius)
    }
  })

  it('shows on the map to a Player whose resident comes in sight of it', () => {
    const { world, terrain, city } = hq()
    const realm = foundStartingCity(world, terrain, 1)
    const scout = world.residents.find((r) => r.owner === realm.id)!
    // Far to the south nothing of it is in sight; in its south gate, its middle is.
    Object.assign(scout, { x: MID, y: MID + 160, order: null })
    expect(entitiesInSight(world, terrain, realm.id).some((e) => e.id === city.id)).toBe(false)
    Object.assign(scout, { x: MID, y: MID + TRADE_ORG_HQ.outerRadius })
    const seen = entitiesInSight(world, terrain, realm.id)
    expect(seen).toContainEqual({ is: 'city', ...city })
    expect(seen).toContainEqual({ is: 'building', ...townHallOf(world, city)! })
    // Its warehouses with their prices, but not what they hold: the scout isn't at one
    // (`CONTEXT.md`: Seeing inside a storage).
    for (const b of world.buildings.filter((x) => x.kind === 'warehouse')) {
      const shown = seen.find((e) => e.id === b.id)
      expect(shown).toMatchObject({ is: 'building', kind: 'warehouse', x: b.x, y: b.y })
      expect(shown).not.toHaveProperty('stock')
      const prices = warehousePrices(world, b).map(({ good, buy, sell }) => ({ good, buy, sell }))
      expect(shown && 'prices' in shown ? (shown.prices ?? []) : []).toEqual(prices)
    }
  })

  it('left alone keeps itself fed over seven game weeks', () => {
    const { world, terrain, city } = hq()
    const walking = new Walking(terrain)
    const people = world.residents.map((r) => r.id)
    for (let t = 0; t < 49 * TICKS_PER_GAME_DAY; t++) {
      stepWorld(world, terrain, walking)
      if (world.tick % TICKS_PER_GAME_DAY === 0) expect(checkInvariants(world, terrain)).toEqual([])
    }
    // Starting ages and lifespans leave nobody to die of old age in seven weeks.
    expect(world.residents.map((r) => r.id)).toEqual(expect.arrayContaining(people))
    expect(storedFood(world, city)).toBeGreaterThan(0)
    // Its workplaces on the nodes were worked too.
    const goods = world.buildings.find((b) => b.kind === 'storage' && b.cityId === city.id)!.stock!
    expect(goods.wood ?? 0).toBeGreaterThan(0)
  }, 600_000)
})

describe('placing the Trade Org HQ', () => {
  it('places it as far from every city as the map allows', () => {
    const terrain = plains(1024)
    const world = createWorld(terrain)
    world.nodes = []
    addCity(world, { id: 'c1', realmId: 'realm1', x: 160, y: 160 })
    const site = findHqSite(world, terrain, mulberry32(1))!
    // The far corner of the map is about 724 tiles away; the HQ never straddles a join.
    expect(
      wrapDistance(terrain.size, { x: 160, y: 160 }, { x: site[0], y: site[1] }),
    ).toBeGreaterThan(680)
  })

  it('places none on a map with no room for it', () => {
    const terrain: TerrainMap = { size: 26, tiles: new Uint8Array(26 * 26).fill(Terrain.Plains) }
    expect(placeTradeOrgHq(createWorld(terrain), terrain)).toBeUndefined()
  })

  describe('through generateWorld', () => {
    let terrain: TerrainMap
    let world: WorldState
    beforeAll(() => {
      terrain = generateTerrain(1, 2880)
      world = generateWorld(terrain)
    })

    it('places one HQ first, with the NPC cities far from it', () => {
      const hqs = world.cities.filter((c) => c.tradeOrg === 'hq')
      expect(hqs).toHaveLength(1)
      expect(world.cities[0]).toBe(hqs[0])
      const hall = townHallOf(world, hqs[0]!)!
      for (const c of world.cities.slice(1)) {
        const d = wrapDistance(terrain.size, hall, townHallOf(world, c)!)
        expect(d).toBeGreaterThanOrEqual(NPC_CITY_MIN_DISTANCE)
      }
      expect(placeTradeOrgHq(world, terrain)).toBe(hqs[0])
      expect(checkInvariants(world, terrain)).toEqual([])
    })

    it('works the nearest node of every kind', () => {
      const city = tradeOrgHq(world)!
      const hall = townHallOf(world, city)!
      for (const kind of ['forest', 'stone', 'ironOre', 'goldOre'] as const) {
        const nearest = world.nodes
          .filter((n) => n.kind === kind)
          .sort(
            (a, b) => wrapDistance(terrain.size, hall, a) - wrapDistance(terrain.size, hall, b),
          )[0]!
        const place = world.buildings.find((b) => b.x === nearest.x && b.y === nearest.y)
        expect(place?.kind).toBe(NODE_WORKPLACE[kind])
        expect(city.workplaceIds).toContain(place!.id)
      }
    })

    it('keeps starting cities far from it', () => {
      const w = structuredClone(world)
      foundStartingCity(w, terrain, 1)
      const realm = realmOf(w, 1)!
      const start = w.cities.find((c) => c.realmId === realm.id)!
      const d = wrapDistance(terrain.size, townHallOf(w, tradeOrgHq(w)!)!, townHallOf(w, start)!)
      expect(d).toBeGreaterThanOrEqual(TRADE_ORG_HQ_MIN_DISTANCE / 2)
    })

    it('places the same HQ for the same world', () => {
      expect(generateWorld(terrain)).toEqual(world)
    })
  })
})

describe('trade-org-sound', () => {
  it('allows one HQ of no realm, with warehouses only in Trade Org cities', () => {
    const { world, terrain, city } = hq()
    expect(tradeOrgSound.check(world, terrain)).toEqual([])
    const other = addCity(world, { id: 'c9', realmId: 'realm1', x: 10, y: 10 })
    world.buildings.push({ id: 'w9', kind: 'warehouse', cityId: other.id, x: 11, y: 10 })
    city.realmId = 'realm1'
    world.cities.push({ ...other, id: 'c10', tradeOrg: 'hq' })
    expect(tradeOrgSound.check(world, terrain).map((v) => v.message)).toEqual([
      `Trade Org city ${city.id} belongs to realm realm1`,
      'Trade Org city c10 belongs to realm realm1',
      'the world has 2 Trade Org HQs',
      'warehouse w9 stands in c9, not a Trade Org city',
    ])
  })
})
