import {
  CITY_AREA_MARGIN,
  HQ_COIN_WAREHOUSE,
  NODE_WORKPLACE,
  SIGHT_RANGE,
  START_CARRIED_FOOD,
  TRADE_ORG_HQ,
  Terrain,
  terrainAt,
  townHallOf,
  tradeOrgHq,
  wrapDistance,
  type Building,
  type City,
  type ResourceKind,
  type TerrainMap,
  type WorldState,
  footprintKeys,
  FOOTPRINT,
} from '@csp/shared'
import { CITY_NAMES, updateCityMembership } from './cities.js'
import { hash, mulberry32, newResident } from './residents.js'
import { Ground, nodeCorner } from './placing.js'
import { FARM_RING, newId, residentTiles } from './starting-city.js'

/** A tile as [x, y]. */
type Tile = [number, number]

/** Offsets from the middle that lie within `radius`, as a round shape on the tile grid. */
export const within = (dx: number, dy: number, radius: number) => Math.hypot(dx, dy) <= radius + 0.5

/**
 * A round ring of tiles `radius` out from (cx, cy): the tiles within it that touch a tile outside
 * it, along a side or a corner. So the ring holds together along its sides and nobody slips
 * through it diagonally.
 */
export function roundRing(cx: number, cy: number, radius: number): Tile[] {
  const out: Tile[] = []
  const r = Math.ceil(radius) + 1
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (!within(dx, dy, radius)) continue
      let edge = false
      for (let ny = -1; ny <= 1 && !edge; ny++) {
        for (let nx = -1; nx <= 1; nx++) if (!within(dx + nx, dy + ny, radius)) edge = true
      }
      if (edge) out.push([cx + dx, cy + dy])
    }
  }
  return out
}

/** The angle of a tile seen from (cx, cy), clockwise from due north, in [0, 2π). */
export const angleOf = (cx: number, cy: number, [x, y]: Tile) =>
  (Math.atan2(x - cx, cy - y) + 2 * Math.PI) % (2 * Math.PI)

/** The `n` gate angles of a ring, evenly round it, the first due north. */
export const gateAngles = (n: number) => Array.from({ length: n }, (_, i) => (i * 2 * Math.PI) / n)

/** How far apart two angles are, the short way round. */
export const angleApart = (a: number, b: number) => {
  const d = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(d, 2 * Math.PI - d)
}

/** The tile of `ring` nearest each gate angle. */
export function gatesOf(cx: number, cy: number, ring: Tile[]): Tile[] {
  return gateAngles(TRADE_ORG_HQ.gates).map(
    (a) =>
      [...ring].sort(
        (p, q) => angleApart(angleOf(cx, cy, p), a) - angleApart(angleOf(cx, cy, q), a),
      )[0]!,
  )
}

/**
 * Where the HQ's buildings stand around the middle tile (cx, cy) of its town hall (`CONTEXT.md`:
 * Trade Org HQ), each by the north-west tile of its footprint; its rings are round that tile.
 */
export interface HqLayout {
  hall: Tile
  /** The storage with Food for its residents, inside the inner ring. */
  storage: Tile
  /** The warehouse that holds its coins, inside the inner ring. */
  coinWarehouse: Tile
  /** The warehouse that holds its other goods, inside the inner ring. */
  goodsWarehouse: Tile
  innerRing: Tile[]
  innerGates: Tile[]
  outerRing: Tile[]
  outerGates: Tile[]
  houses: Tile[]
  smelter: Tile
  mint: Tile
}

/**
 * The HQ's shape around the middle tile (cx, cy) of its town hall: the storage and the two
 * warehouses next to the town hall inside the inner ring, the houses, smelter and mint in a
 * circle between the rings, clear of the straight ways from each gate of the outer ring to the
 * gate of the inner ring behind it. The same for the same tile, so it is worked out once.
 */
export function hqLayout(cx: number, cy: number): HqLayout {
  const key = `${cx},${cy}`
  let layout = layouts.get(key)
  if (!layout) layouts.set(key, (layout = workOutLayout(cx, cy)))
  return layout
}

/** Layouts worked out so far (`hqLayout`), by their middle tile. */
const layouts = new Map<string, HqLayout>()

function workOutLayout(cx: number, cy: number): HqLayout {
  const { innerRadius, outerRadius } = TRADE_ORG_HQ
  const innerRing = roundRing(cx, cy, innerRadius)
  const outerRing = roundRing(cx, cy, outerRadius)
  const between = Math.round((innerRadius + outerRadius) / 2)
  // Keep a tile and a half clear on either side of each way in, beside the houses' footprints.
  const clear = Math.asin((1.5 + FOOTPRINT.house) / between)
  const slots = roundRing(cx, cy, between)
    .filter((t) =>
      gateAngles(TRADE_ORG_HQ.gates).every((a) => angleApart(angleOf(cx, cy, t), a) > clear),
    )
    .sort((p, q) => angleOf(cx, cy, p) - angleOf(cx, cy, q))
  const wanted = TRADE_ORG_HQ.houses + 2
  if (slots.length < wanted * (FOOTPRINT.house + 1))
    throw new Error('the Trade Org HQ has no room for its houses')
  const spread = Array.from(
    { length: wanted },
    (_, i) => slots[Math.floor((i * slots.length) / wanted)]!,
  )
  const hall: Tile = [cx - 1, cy - 1]
  return {
    hall,
    storage: [hall[0] - FOOTPRINT.storage - 1, hall[1] - FOOTPRINT.storage - 1],
    coinWarehouse: [hall[0] + HQ_COIN_WAREHOUSE.dx, hall[1] + HQ_COIN_WAREHOUSE.dy],
    goodsWarehouse: [hall[0] + HQ_COIN_WAREHOUSE.dx, hall[1] - HQ_COIN_WAREHOUSE.dy],
    innerRing,
    innerGates: gatesOf(cx, cy, innerRing),
    outerRing,
    outerGates: gatesOf(cx, cy, outerRing),
    houses: spread.slice(0, TRADE_ORG_HQ.houses),
    smelter: spread[TRADE_ORG_HQ.houses]!,
    mint: spread[TRADE_ORG_HQ.houses + 1]!,
  }
}

/** How far the HQ's ground reaches from its town hall: its outer ring and the farms beyond it. */
export const HQ_FOOTPRINT = TRADE_ORG_HQ.outerRadius + FARM_RING

/** The ground with what stands on it: nodes, footprints, residents, horses, carriages, piles. */
function takenGround(world: WorldState, terrain: TerrainMap): Ground {
  const nodes = world.nodes.map((n) => `${n.x},${n.y}`)
  return new Ground(world, terrain, [...nodes, ...residentTiles(world)])
}

/**
 * Where the HQ's farms go, by the north-west tiles of their footprints: wholly just past its area
 * on Plains, apart from each other, nearest an outer gate first. As many as it gets, or fewer
 * when there is no room for more.
 */
function farmTiles(ground: Ground, cx: number, cy: number): Tile[] {
  const { outerRing, outerGates } = hqLayout(cx, cy)
  const near = new Set<string>()
  for (const [x, y] of outerRing) {
    for (let dy = -CITY_AREA_MARGIN; dy <= CITY_AREA_MARGIN; dy++) {
      for (let dx = -CITY_AREA_MARGIN; dx <= CITY_AREA_MARGIN; dx++) near.add(`${x + dx},${y + dy}`)
    }
  }
  const side = FOOTPRINT.farm
  const toGate = (t: Tile) =>
    Math.min(
      ...outerGates.map((g) =>
        Math.hypot(t[0] + (side - 1) / 2 - g[0], t[1] + (side - 1) / 2 - g[1]),
      ),
    )
  // North-west tiles of footprints that reach no further in than the ring just past the area.
  const candidates = new Map<string, Tile>()
  for (let k = 0; k < side; k++) {
    for (const t of roundRing(cx, cy, HQ_FOOTPRINT + k)) candidates.set(`${t[0]},${t[1]}`, t)
  }
  const mine = new Set<string>()
  const out: Tile[] = []
  for (const t of [...candidates.values()].sort((p, q) => toGate(p) - toGate(q))) {
    if (out.length >= TRADE_ORG_HQ.farms) break
    const fits = ground.fits('farm', t[0], t[1], (x, y) => {
      const key = `${x},${y}`
      return !near.has(key) && !mine.has(key) && within(x - cx, y - cy, HQ_FOOTPRINT + side)
    })
    if (!fits) continue
    out.push(t)
    for (const key of footprintKeys({ kind: 'farm', x: t[0], y: t[1] })) mine.add(key)
  }
  return out
}

/**
 * Whether the HQ fits with the middle of its town hall at (cx, cy): its round ground within
 * `HQ_FOOTPRINT` all open land (Plains, Forest or Hills) with nothing on it, room for its farms
 * on Plains, and none of it in sight of a Player's resident.
 */
export function hqSiteFits(
  world: WorldState,
  terrain: TerrainMap,
  cx: number,
  cy: number,
  ground: Ground = takenGround(world, terrain),
): boolean {
  const unseen = SIGHT_RANGE + HQ_FOOTPRINT + FOOTPRINT.farm
  for (const r of world.residents) {
    if (r.owner !== null && wrapDistance(terrain.size, r, { x: cx, y: cy }) <= unseen) return false
  }
  for (let dy = -HQ_FOOTPRINT; dy <= HQ_FOOTPRINT; dy++) {
    for (let dx = -HQ_FOOTPRINT; dx <= HQ_FOOTPRINT; dx++) {
      if (!within(dx, dy, HQ_FOOTPRINT)) continue
      const t = terrainAt(terrain, cx + dx, cy + dy)
      if (t !== Terrain.Plains && t !== Terrain.Forest && t !== Terrain.Hills) return false
      if (!ground.free(cx + dx, cy + dy)) return false
    }
  }
  return farmTiles(ground, cx, cy).length >= TRADE_ORG_HQ.farms
}

/** How far apart candidate sites for the HQ lie, in tiles along each direction. */
const SITE_STEP = 24

/**
 * Picks the site for the HQ's town hall (`hqSiteFits`): as far from the nearest city as the map
 * allows, by a random pick among the equally far (all of them, before any city stands). None
 * when nothing fits. The HQ never straddles the map's joins.
 */
export function findHqSite(
  world: WorldState,
  terrain: TerrainMap,
  rand: () => number,
): Tile | undefined {
  const edge = HQ_FOOTPRINT + FOOTPRINT.farm
  const halls = world.cities.flatMap((c) => townHallOf(world, c) ?? [])
  const candidates: { at: Tile; far: number; order: number }[] = []
  for (let y = edge; y < terrain.size - edge; y += SITE_STEP) {
    for (let x = edge; x < terrain.size - edge; x += SITE_STEP) {
      const far = Math.min(Infinity, ...halls.map((h) => wrapDistance(terrain.size, h, { x, y })))
      candidates.push({ at: [x, y], far, order: rand() })
    }
  }
  candidates.sort((a, b) => b.far - a.far || a.order - b.order)
  const ground = takenGround(world, terrain)
  return candidates.find((c) => hqSiteFits(world, terrain, c.at[0], c.at[1], ground))?.at
}

/**
 * The nearest resource node of `kind` from (cx, cy) whose workplace can still be laid out on it
 * (`nodeCorner`): where that workplace goes, by the north-west tile of its footprint.
 */
export function nearestFreeNode(
  world: WorldState,
  terrain: TerrainMap,
  kind: ResourceKind,
  cx: number,
  cy: number,
): { x: number; y: number } | undefined {
  const nodes = world.nodes
    .filter((n) => n.kind === kind)
    .map((n) => ({ n, d: wrapDistance(terrain.size, n, { x: cx, y: cy }) }))
    .sort((a, b) => a.d - b.d)
  for (const { n } of nodes) {
    const corner = nodeCorner(world, terrain, n)
    if (corner) return corner
  }
  return undefined
}

/** The resource kinds the HQ runs a workplace on, one each: wood, stone, iron ore and gold ore. */
const HQ_NODES: readonly ResourceKind[] = ['forest', 'stone', 'ironOre', 'goldOre']

/**
 * Lays out the Trade Org HQ with the middle of its town hall at (cx, cy) (`CONTEXT.md`: Trade
 * Org HQ): the
 * town hall in the middle, the storage with Food and the coin and goods warehouses next to it,
 * an inner and an outer round ring of wall with gates, houses, a smelter and a mint between the
 * rings, farms outside the outer ring by its gates, and a lumber camp, a quarry and an iron and a
 * gold mine on the nearest free nodes. Its residents belong to no realm and the game runs the
 * city like an NPC city; they start on the farms, working them, each with a little food on them.
 */
export function foundTradeOrgHq(
  world: WorldState,
  terrain: TerrainMap,
  cx: number,
  cy: number,
  rand: () => number,
): City {
  const layout = hqLayout(cx, cy)
  const id = newId(world, 'city')
  const city: City = {
    id,
    name: CITY_NAMES[hash(`${world.seed}:${id}`) % CITY_NAMES.length]!,
    realmId: null,
    townHallId: '',
    tradeOrg: 'hq',
  }
  // Workplaces belong to no city; the HQ keeps a list of its own.
  const building = (
    k: Building['kind'],
    [bx, by]: Tile,
    cityId: string | null = city.id,
  ): Building => ({
    id: newId(world, 'b'),
    kind: k,
    cityId,
    x: bx,
    y: by,
  })
  const hall = building('townHall', layout.hall)
  city.townHallId = hall.id
  // The inner gates stay closed (`CONTEXT.md`: Trade Org army); its own residents pass them.
  const ring = (tiles: Tile[], gates: Tile[], closed = false) =>
    tiles.map((t): Building => {
      if (!gates.some((g) => g[0] === t[0] && g[1] === t[1])) return building('wall', t)
      return closed ? { ...building('gate', t), closed } : building('gate', t)
    })
  const farms = farmTiles(takenGround(world, terrain), cx, cy).map((t) => building('farm', t))
  const buildings: Building[] = [
    hall,
    { ...building('storage', layout.storage), stock: { food: TRADE_ORG_HQ.food } },
    { ...building('warehouse', layout.coinWarehouse), stock: { coins: TRADE_ORG_HQ.coins } },
    { ...building('warehouse', layout.goodsWarehouse), stock: { ...TRADE_ORG_HQ.goods } },
    ...ring(layout.innerRing, layout.innerGates, true),
    ...ring(layout.outerRing, layout.outerGates),
    ...layout.houses.map((t) => building('house', t)),
    ...farms,
  ]
  const workplaces = [
    building('smelter', layout.smelter, null),
    building('mint', layout.mint, null),
  ]
  city.workplaceIds = workplaces.map((b) => b.id)
  world.cities.push(city)
  world.buildings.push(...buildings, ...workplaces)
  // One on each kind of node, each laid out once the others stand, so none overlaps another.
  for (const kind of HQ_NODES) {
    const spot = nearestFreeNode(world, terrain, kind, cx, cy)
    if (!spot) continue
    const b = building(NODE_WORKPLACE[kind], [spot.x, spot.y], null)
    city.workplaceIds.push(b.id)
    world.buildings.push(b)
  }
  const residents = Array.from({ length: TRADE_ORG_HQ.residents }, (_, i) => {
    const farm = farms[i % farms.length]!
    const r = newResident(rand, {
      id: newId(world, 'r'),
      owner: null,
      cityId: city.id,
      x: farm.x,
      y: farm.y,
      tick: world.tick,
    })
    r.carried = { food: START_CARRIED_FOOD }
    r.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
    r.script = { scriptId: 0, task: 'work', memory: { workplaceId: farm.id } }
    return r
  })
  world.residents.push(...residents)
  updateCityMembership(world, terrain.size)
  return city
}

/** The Trade Org HQ, if the world has one. */
export { tradeOrgHq }

/**
 * Places the Trade Org HQ (`findHqSite`, `foundTradeOrgHq`) unless the world has one already, or
 * none when the map has no room for it. The same world always gets the same HQ.
 */
export function placeTradeOrgHq(world: WorldState, terrain: TerrainMap): City | undefined {
  const existing = tradeOrgHq(world)
  if (existing) return existing
  const rand = mulberry32(world.seed * 7919 + 17)
  const site = findHqSite(world, terrain, rand)
  return site && foundTradeOrgHq(world, terrain, site[0], site[1], rand)
}
