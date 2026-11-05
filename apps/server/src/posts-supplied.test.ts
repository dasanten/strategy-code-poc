import {
  AVERAGE_HORSE_STATS,
  TICKS_PER_GAME_DAY,
  Terrain,
  WAREHOUSE_FLOOR,
  WEAPONS,
  tileIndex,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { placeCaravans } from './caravans.js'
import { tallyGoods, takeMade } from './goods-made.js'
import { checkInvariants, goodsOnlyFromNothingAtTheFloor } from './invariants.js'
import { mulberry32 } from './residents.js'
import { foundTradeOrgHq } from './trade-org.js'
import { placeTraders } from './traders.js'
import { foundTradingPost } from './trading-posts.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

/*
 * Trading posts stay supplied with nobody interfering (`CONTEXT.md`: Stock floor, Wandering trader;
 * ADR 0023): nothing tops up their warehouses, so all they hold comes by caravan and trader, and
 * those carriages' crews eat from the same storages as the posts' people.
 */

const SIZE = 640
const MID = SIZE / 2
/** How long the world runs: about ten times round the loop of this small map. */
const DAYS = 30
/** Game days the traders get to go round once before the posts are held to anything. */
const SETTLE_DAYS = 5

/**
 * The HQ in the middle of an open map with its nodes beside it, and a post at each corner of a square
 * round it, with no node of its own, so that goods reach it only by carriage.
 */
function posts(): { world: WorldState; terrain: TerrainMap; posts: City[] } {
  const terrain: TerrainMap = {
    size: SIZE,
    tiles: new Uint8Array(SIZE * SIZE).fill(Terrain.Plains),
  }
  const nodes: [ResourceKind, number, number][] = [
    ['forest', MID + 80, MID],
    ['stone', MID + 80, MID + 12],
    ['ironOre', MID + 88, MID - 12],
    ['goldOre', MID + 96, MID],
  ]
  for (const [kind, x, y] of nodes) {
    terrain.tiles[tileIndex(SIZE, x, y)] = kind === 'forest' ? Terrain.Forest : Terrain.Hills
  }
  const world = createWorld(terrain)
  world.nodes = nodes.map(([kind, x, y], i) => ({ id: `n${i}`, kind, x, y }))
  const rand = mulberry32(11)
  foundTradeOrgHq(world, terrain, MID, MID, rand)
  const sites = [
    [MID - 180, MID - 180],
    [MID + 180, MID - 180],
    [MID + 180, MID + 180],
    [MID - 180, MID + 180],
  ] as const
  const founded = sites.map(([x, y]) => foundTradingPost(world, terrain, x, y, undefined, rand))
  placeCaravans(world)
  placeTraders(world, SIZE)
  for (const h of world.horses) h.stats = { ...AVERAGE_HORSE_STATS }
  return { world, terrain, posts: founded }
}

describe('trading posts with nobody interfering', () => {
  it(
    'hold Food, weapons and Coins over many game days, and their people do not starve',
    { tags: ['slow'], timeout: 900_000 },
    () => {
      const { world, terrain, posts: all } = posts()
      const walking = new Walking(terrain)
      const people = (c: City) => world.residents.filter((r) => r.cityId === c.id).length
      const born = all.map(people)
      for (let day = 1; day <= DAYS; day++) {
        const before = tallyGoods(world)
        takeMade(world)
        for (let t = 0; t < TICKS_PER_GAME_DAY; t++) stepWorld(world, terrain, walking)
        expect(goodsOnlyFromNothingAtTheFloor(before, world, takeMade(world))).toEqual([])
        expect(checkInvariants(world, terrain)).toEqual([])
        expect(all.map(people)).toEqual(born)
        if (day < SETTLE_DAYS) continue
        for (const post of all) {
          const warehouse = world.buildings.find(
            (b) => b.kind === 'warehouse' && b.cityId === post.id,
          )!
          const stock = warehouse.stock ?? {}
          expect(stock.food ?? 0).toBeGreaterThanOrEqual(WAREHOUSE_FLOOR.food)
          expect(stock.coins ?? 0).toBeGreaterThanOrEqual(WAREHOUSE_FLOOR.coins)
          expect(WEAPONS.reduce((n, w) => n + (stock[w] ?? 0), 0)).toBeGreaterThan(0)
        }
      }
    },
  )
})
