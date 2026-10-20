import {
  CITY_AREA_MARGIN,
  CITY_MIN_DISTANCE,
  HOUSING_ROOM,
  MAX_HEALTH,
  MAX_HUNGER,
  NPC_CITY_MIN_DISTANCE,
  START_CARRIED_FOOD,
  START_CITY_SIZE,
  START_FOOD,
  START_HORSES,
  START_RESIDENTS,
  START_STABLE_FOOD,
  START_SPARE_HOUSES,
  TRADE_ORG_HQ,
  TRADE_ORG_HQ_MIN_DISTANCE,
  Terrain,
  terrainAt,
  townHallOf,
  wrapDistance,
  type Building,
  type City,
  type Realm,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { CITY_NAMES, updateCityMembership } from './cities.js'
import { mulberry32, newResident } from './residents.js'

/** A fresh id for a new entity; ids are never reused. */
export function newId(world: WorldState, prefix: string): string {
  return `${prefix}${world.nextId++}`
}

/** The Player's realm, if they have one. */
export function realmOf(world: WorldState, userId: number): Realm | undefined {
  return world.realms.find((r) => r.userId === userId)
}

/**
 * How many tiles out from a starting city's wall its farm and stable stand: just past its area
 * (`CITY_AREA_MARGIN`), so working the farm is not being at home.
 */
export const FARM_RING = 1 + CITY_AREA_MARGIN

/** Where a city may stand: its square and the rings around it on open land, with no nodes. */
function siteFits(terrain: TerrainMap, blocked: Set<string>, x: number, y: number): boolean {
  for (let ty = y - FARM_RING; ty < y + START_CITY_SIZE + FARM_RING; ty++) {
    for (let tx = x - FARM_RING; tx < x + START_CITY_SIZE + FARM_RING; tx++) {
      const t = terrainAt(terrain, tx, ty)
      if (t !== Terrain.Plains && t !== Terrain.Forest && t !== Terrain.Hills) return false
      if (blocked.has(`${tx},${ty}`)) return false
    }
  }
  // Room outside the wall for the farm and the stable.
  return plainsOutside(terrain, startCity(x, y), FARM_RING).length >= 2
}

/** A square ring of wall with one gate in it, as starting cities get. */
export interface WallSquare {
  /** Top-left tile of the square, wall included. */
  x: number
  y: number
  /** Tiles along each side, wall included. */
  size: number
  gate: { x: number; y: number }
}

/** A walled square at (x, y), `size` tiles along each side: the gate in the middle of the south side. */
export const wallSquare = (x: number, y: number, size: number): WallSquare => ({
  x,
  y,
  size,
  gate: { x: x + Math.floor(size / 2), y: y + size - 1 },
})

/** The square and gate a starting city at (x, y) gets. */
const startCity = (x: number, y: number): WallSquare => wallSquare(x, y, START_CITY_SIZE)

/** The tiles of a square's wall ring, the gate's included, each once. */
export function ringTiles(square: WallSquare): [number, number][] {
  const { x, y, size } = square
  const ring = new Map<string, [number, number]>()
  for (let i = 0; i < size; i++) {
    for (const t of [
      [x + i, y],
      [x + i, y + size - 1],
      [x, y + i],
      [x + size - 1, y + i],
    ] as [number, number][]) {
      ring.set(`${t[0]},${t[1]}`, t)
    }
  }
  return [...ring.values()]
}

/**
 * The Plains tiles in the ring `out` tiles outside a city's wall (1: just outside), nearest its
 * gate first, leaving the way out of the gate free: where a starting city's farm and stable go.
 */
export function plainsOutside(terrain: TerrainMap, city: WallSquare, out = 1): [number, number][] {
  const { x, y, size } = city
  const gate: [number, number] = [city.gate.x, city.gate.y]
  const ring = new Map<string, [number, number]>()
  for (let i = -out; i < size + out; i++) {
    for (const t of [
      [x + i, y - out],
      [x + i, y + size - 1 + out],
      [x - out, y + i],
      [x + size - 1 + out, y + i],
    ] as [number, number][]) {
      ring.set(`${t[0]},${t[1]}`, t)
    }
  }
  return [...ring.values()]
    .filter(([tx, ty]) => terrainAt(terrain, tx, ty) === Terrain.Plains)
    .filter(([tx, ty]) => !(tx === gate[0] && ty > gate[1] && ty <= gate[1] + out))
    .sort((a, b) => dist(a, gate) - dist(b, gate))
}

const dist = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1])

/** How far a starting city keeps from the Trade Org HQ while it keeps `minDistance` from others. */
const hqDistance = (minDistance: number) =>
  (TRADE_ORG_HQ_MIN_DISTANCE * minDistance) / CITY_MIN_DISTANCE

/**
 * Picks a site for a new starting city: on open land, at least `CITY_MIN_DISTANCE` from every
 * city of a realm, `TRADE_ORG_HQ_MIN_DISTANCE` from the Trade Org HQ and `NPC_CITY_MIN_DISTANCE`
 * from every other NPC city, the short way round the map.
 * When the map has no such room left, the required distances are halved until a site fits. A city never straddles the map's joins.
 */
export function findCitySite(
  world: WorldState,
  terrain: TerrainMap,
  rand: () => number,
): [number, number] {
  // Room for the city and the ring of open land around it, without crossing a join.
  const span = terrain.size - START_CITY_SIZE - 2 * FARM_RING
  // Every other city, by where its town hall stands, and whether it is an NPC city.
  const others = world.cities.flatMap((c) => {
    const hall = townHallOf(world, c)
    return hall ? [{ x: hall.x, y: hall.y, npc: c.realmId === null, hq: c.tradeOrg === 'hq' }] : []
  })
  const blocked = new Set([...world.nodes, ...world.buildings].map((e) => `${e.x},${e.y}`))
  for (let minDistance = CITY_MIN_DISTANCE; ; minDistance = Math.floor(minDistance / 2)) {
    for (let attempt = 0; attempt < 3000; attempt++) {
      const x = FARM_RING + Math.floor(rand() * span)
      const y = FARM_RING + Math.floor(rand() * span)
      const centre = { x: x + START_CITY_SIZE / 2, y: y + START_CITY_SIZE / 2 }
      const tooNear = (o: (typeof others)[number]) =>
        wrapDistance(terrain.size, o, centre) <
        (o.hq
          ? Math.max(
              hqDistance(minDistance),
              TRADE_ORG_HQ.outerRadius + FARM_RING + START_CITY_SIZE,
            )
          : o.npc
            ? Math.min(NPC_CITY_MIN_DISTANCE, minDistance)
            : minDistance)
      if (others.some(tooNear)) continue
      if (siteFits(terrain, blocked, x, y)) return [x, y]
    }
    if (minDistance === 0) throw new Error('no room left on the map for a starting city')
  }
}

/**
 * Gives a Player their realm and starting city (`CONTEXT.md`: Starting city), unless they
 * already have one: residents with random stats, one of them the Leader, a town hall, a ring of
 * wooden wall with a gate, houses for everyone and a spare, a storage with food, a farm outside
 * the wall, a stable
 * next to it with horses and a little food, and a carriage at the stable with a horse hitched to
 * it. The residents start on the farm, working it, each carrying a little food.
 * The same world and Player always get the same city.
 */
export function foundStartingCity(world: WorldState, terrain: TerrainMap, userId: number): Realm {
  const existing = realmOf(world, userId)
  if (existing) return existing

  const rand = mulberry32(world.seed * 7919 + userId)
  const [x, y] = findCitySite(world, terrain, rand)
  const size = START_CITY_SIZE
  const mid = Math.floor(size / 2)
  const realmId = newId(world, 'realm')
  const square = startCity(x, y)
  const city: City = {
    id: newId(world, 'city'),
    name: CITY_NAMES[Math.floor(rand() * CITY_NAMES.length)]!,
    realmId,
    townHallId: '',
  }

  // Inside the wall: the storage in the middle, the town hall south of it, houses along the
  // north side.
  const building = (kind: Building['kind'], bx: number, by: number): Building => ({
    id: newId(world, 'b'),
    kind,
    cityId: city.id,
    x: bx,
    y: by,
  })
  const hall = building('townHall', x + mid, y + mid + 1)
  city.townHallId = hall.id
  const houses = Math.ceil(START_RESIDENTS / HOUSING_ROOM.house!) + START_SPARE_HOUSES
  const buildings: Building[] = [
    hall,
    { ...building('storage', x + mid, y + mid), stock: { food: START_FOOD } },
    ...Array.from({ length: houses }, (_, i) => building('house', x + 1 + i * 2, y + 1)),
    ...ringTiles(square).map(([wx, wy]) =>
      building(wx === square.gate.x && wy === square.gate.y ? 'gate' : 'wall', wx, wy),
    ),
  ]
  // Outside the wall, just past the city's area by the gate: the farm, and the stable next to it
  // with a little food.
  const [farmTile, stableTile] = plainsOutside(terrain, square, FARM_RING)
  const [fx, fy] = farmTile!
  const [sx, sy] = stableTile!
  const farm = building('farm', fx, fy)
  buildings.push(farm, { ...building('stable', sx, sy), stock: { food: START_STABLE_FOOD } })

  // Everyone starts on the farm, working it, with a little food on them; the first is the Leader.
  const residents = Array.from({ length: START_RESIDENTS }, () => {
    const r = newResident(rand, {
      id: newId(world, 'r'),
      owner: realmId,
      cityId: city.id,
      x: fx,
      y: fy,
      tick: world.tick,
    })
    r.carried = { food: START_CARRIED_FOOD }
    r.order = { kind: 'workAt', buildingId: farm.id, at: { x: fx, y: fy }, progress: 0 }
    return r
  })
  const realm: Realm = { id: realmId, userId, leaderId: residents[0]!.id }

  world.realms.push(realm)
  world.cities.push(city)
  world.buildings.push(...buildings)
  updateCityMembership(world, terrain.size)
  world.residents.push(...residents)
  for (let i = 0; i < START_HORSES; i++) {
    world.horses.push({
      id: newId(world, 'horse'),
      realmId,
      cityId: null,
      x: sx,
      y: sy,
      hunger: MAX_HUNGER,
      health: MAX_HEALTH,
    })
  }
  // The carriage stands at the stable, with one of the horses hitched to it.
  world.carriages.push({
    id: newId(world, 'carriage'),
    realmId,
    cityId: null,
    x: sx,
    y: sy,
    horseId: world.horses.at(-1)!.id,
    load: {},
  })
  return realm
}
