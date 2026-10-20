import {
  NODE_WORKPLACE,
  TRADING_POST,
  TRADING_POST_REGION,
  townHallOf,
  type Building,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { updateCityMembership } from './cities.js'
import { foundNpcCity, npcSiteFits, takenTiles } from './npc-cities.js'
import { mulberry32 } from './residents.js'
import { FARM_RING, newId } from './starting-city.js'
import { nearestFreeNode } from './trade-org.js'

/** A part of the map one trading post serves: its top-left tile and how far it reaches. */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The map cut into a grid of regions about `TRADING_POST_REGION` wide (`CONTEXT.md`: Trading
 * post), row by row from the top left; a map smaller than that is one region.
 */
export function regions(size: number): Region[] {
  const perSide = Math.max(1, Math.round(size / TRADING_POST_REGION))
  const width = size / perSide
  const out: Region[] = []
  for (let j = 0; j < perSide; j++) {
    for (let i = 0; i < perSide; i++) {
      const x = Math.round(i * width)
      const y = Math.round(j * width)
      out.push({
        x,
        y,
        width: Math.round((i + 1) * width) - x,
        height: Math.round((j + 1) * width) - y,
      })
    }
  }
  return out
}

export const inRegion = (r: Region, p: { x: number; y: number }) =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

/** The resource kinds in the order they win a tie for a region's most common. */
const KINDS: readonly ResourceKind[] = ['forest', 'stone', 'ironOre', 'goldOre']

/** The kind of resource node a region has most of, or none when it has no nodes. */
export function commonResource(world: WorldState, region: Region): ResourceKind | undefined {
  const count = new Map<ResourceKind, number>()
  for (const n of world.nodes) {
    if (inRegion(region, n)) count.set(n.kind, (count.get(n.kind) ?? 0) + 1)
  }
  let best: ResourceKind | undefined
  for (const k of KINDS) if ((count.get(k) ?? 0) > (best ? count.get(best)! : 0)) best = k
  return best
}

/** How far apart candidate sites for a trading post lie, in tiles along each direction. */
const SITE_STEP = 3

/**
 * Picks the site for a region's trading post: the one nearest the region's middle where an NPC
 * village would fit (`npcSiteFits`: open Plains, far enough from every city, out of every Player's
 * sight), wholly inside the region. None when nothing there fits.
 */
export function findTradingPostSite(
  world: WorldState,
  terrain: TerrainMap,
  region: Region,
  taken: Set<string> = takenTiles(world),
): [number, number] | undefined {
  const { size } = TRADING_POST
  const candidates: { at: [number, number]; off: number }[] = []
  for (let dy = FARM_RING; dy <= region.height - size - FARM_RING; dy += SITE_STEP) {
    for (let dx = FARM_RING; dx <= region.width - size - FARM_RING; dx += SITE_STEP) {
      const off = Math.hypot(dx + (size - region.width) / 2, dy + (size - region.height) / 2)
      candidates.push({ at: [region.x + dx, region.y + dy], off })
    }
  }
  candidates.sort((a, b) => a.off - b.off)
  return candidates.find((c) => npcSiteFits(world, terrain, TRADING_POST, c.at[0], c.at[1], taken))
    ?.at
}

/**
 * Lays out a trading post with its top-left wall tile at (x, y) (`CONTEXT.md`: Trading post): an
 * NPC village (`foundNpcCity`) of the Trade Organization's, with a warehouse next to its storage
 * and a workplace on the nearest free node of `resource`, the region's most common.
 */
export function foundTradingPost(
  world: WorldState,
  terrain: TerrainMap,
  x: number,
  y: number,
  resource: ResourceKind | undefined,
  rand: () => number,
): City {
  const city = foundNpcCity(world, terrain, TRADING_POST, x, y, rand)
  city.tradeOrg = 'post'
  const mid = Math.floor(TRADING_POST.size / 2)
  const warehouse: Building = {
    id: newId(world, 'b'),
    kind: 'warehouse',
    cityId: city.id,
    x: x + mid + 1,
    y: y + mid,
    stock: { coins: TRADING_POST.coins, ...TRADING_POST.goods },
  }
  world.buildings.push(warehouse)
  const hall = townHallOf(world, city)!
  const node = resource && nearestFreeNode(world, terrain.size, resource, hall.x, hall.y)
  city.workplaceIds = []
  if (node) {
    const workplace: Building = {
      id: newId(world, 'b'),
      kind: NODE_WORKPLACE[resource],
      cityId: null,
      x: node.x,
      y: node.y,
    }
    world.buildings.push(workplace)
    city.workplaceIds.push(workplace.id)
  }
  updateCityMembership(world, terrain.size)
  return city
}

/** The world's trading posts. */
export function tradingPosts(world: WorldState): City[] {
  return world.cities.filter((c) => c.tradeOrg === 'post')
}

/**
 * Places a trading post in every region that has none yet (`regions`, `findTradingPostSite`,
 * `foundTradingPost`), skipping a region with no room. The same world always gets the same posts.
 */
export function placeTradingPosts(world: WorldState, terrain: TerrainMap): City[] {
  const rand = mulberry32(world.seed * 15485863 + 47)
  const halls = tradingPosts(world).flatMap((c) => townHallOf(world, c) ?? [])
  const placed: City[] = []
  for (const region of regions(terrain.size)) {
    if (halls.some((h) => inRegion(region, h))) continue
    const site = findTradingPostSite(world, terrain, region)
    if (!site) continue
    const resource = commonResource(world, region)
    placed.push(foundTradingPost(world, terrain, site[0], site[1], resource, rand))
  }
  return placed
}
