import {
  CITY_MIN_DISTANCE,
  HOUSING_ROOM,
  MAX_HUNGER,
  START_CARRIED_FOOD,
  START_CITY_SIZE,
  START_FOOD,
  START_RESIDENTS,
  START_SPARE_HOUSES,
  Terrain,
  terrainAt,
  wrapDistance,
  type Building,
  type City,
  type Realm,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { mulberry32, newResident } from './residents.js'

/** City names. Only flavour, like resident names. */
const CITY_NAMES = [
  'Ashford',
  'Brackenholt',
  'Coldwater',
  'Dunmere',
  'Eastwick',
  'Fallowby',
  'Greyhaven',
  'Hartwell',
  'Ironside',
  'Juniper',
  'Kettleby',
  'Larkspur',
  'Millbrook',
  'Northam',
  'Oakhurst',
  'Pinecrest',
  'Quarrytown',
  'Redbank',
  'Stonebridge',
  'Thornbury',
]

/** A fresh id for a new entity; ids are never reused. */
export function newId(world: WorldState, prefix: string): string {
  return `${prefix}${world.nextId++}`
}

/** The Player's realm, if they have one. */
export function realmOf(world: WorldState, userId: number): Realm | undefined {
  return world.realms.find((r) => r.userId === userId)
}

/** Where a city may stand: its square and the ring around it on open land, with no nodes. */
function siteFits(terrain: TerrainMap, blocked: Set<string>, x: number, y: number): boolean {
  for (let ty = y - 1; ty <= y + START_CITY_SIZE; ty++) {
    for (let tx = x - 1; tx <= x + START_CITY_SIZE; tx++) {
      const t = terrainAt(terrain, tx, ty)
      if (t !== Terrain.Plains && t !== Terrain.Forest && t !== Terrain.Hills) return false
      if (blocked.has(`${tx},${ty}`)) return false
    }
  }
  return farmTile(terrain, x, y) !== undefined
}

/** A Plains tile just outside the wall for the farm, nearest the gate. */
function farmTile(terrain: TerrainMap, x: number, y: number): [number, number] | undefined {
  const gate: [number, number] = [x + Math.floor(START_CITY_SIZE / 2), y + START_CITY_SIZE - 1]
  const ring: [number, number][] = []
  for (let i = -1; i <= START_CITY_SIZE; i++) {
    ring.push(
      [x + i, y - 1],
      [x + i, y + START_CITY_SIZE],
      [x - 1, y + i],
      [x + START_CITY_SIZE, y + i],
    )
  }
  return ring
    .filter(([tx, ty]) => terrainAt(terrain, tx, ty) === Terrain.Plains)
    .filter(([tx, ty]) => !(tx === gate[0] && ty === gate[1] + 1))
    .sort((a, b) => dist(a, gate) - dist(b, gate))[0]
}

const dist = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1])

const centreOf = (c: City) => ({ x: c.x + c.size / 2, y: c.y + c.size / 2 })

/**
 * Picks a site for a new starting city: on open land and at least `CITY_MIN_DISTANCE` from every
 * other city, the short way round the map. When the map has no such room left, the required
 * distance is halved until a site fits. A city never straddles the map's joins.
 */
export function findCitySite(
  world: WorldState,
  terrain: TerrainMap,
  rand: () => number,
): [number, number] {
  // Room for the city and the ring of open land around it, without crossing a join.
  const span = terrain.size - START_CITY_SIZE - 2
  const others = world.cities.map(centreOf)
  const blocked = new Set([...world.nodes, ...world.buildings].map((e) => `${e.x},${e.y}`))
  for (let minDistance = CITY_MIN_DISTANCE; ; minDistance = Math.floor(minDistance / 2)) {
    for (let attempt = 0; attempt < 3000; attempt++) {
      const x = 1 + Math.floor(rand() * span)
      const y = 1 + Math.floor(rand() * span)
      const centre = { x: x + START_CITY_SIZE / 2, y: y + START_CITY_SIZE / 2 }
      if (others.some((o) => wrapDistance(terrain.size, o, centre) < minDistance)) continue
      if (siteFits(terrain, blocked, x, y)) return [x, y]
    }
    if (minDistance === 0) throw new Error('no room left on the map for a starting city')
  }
}

/**
 * Gives a Player their realm and starting city (`CONTEXT.md`: Starting city), unless they
 * already have one: residents with random stats, one of them the Leader, a wooden wall with a
 * gate, houses for everyone and a spare, a storage with food, a farm outside the wall, a horse
 * and a carriage. The residents start on the farm, working it, each carrying a little food.
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
  const city: City = {
    id: newId(world, 'city'),
    name: CITY_NAMES[Math.floor(rand() * CITY_NAMES.length)]!,
    realmId,
    x,
    y,
    size,
    wall: 'wooden',
    gate: { x: x + mid, y: y + size - 1 },
  }

  // Inside the wall: the storage in the middle, houses along the north side.
  const building = (kind: Building['kind'], bx: number, by: number): Building => ({
    id: newId(world, 'b'),
    kind,
    cityId: city.id,
    x: bx,
    y: by,
  })
  const houses = Math.ceil(START_RESIDENTS / HOUSING_ROOM.house!) + START_SPARE_HOUSES
  const buildings: Building[] = [
    { ...building('storage', x + mid, y + mid), stock: { food: START_FOOD } },
    ...Array.from({ length: houses }, (_, i) => building('house', x + 1 + i * 2, y + 1)),
  ]
  const [fx, fy] = farmTile(terrain, x, y)!
  const farm = building('farm', fx, fy)
  buildings.push(farm)

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
  world.residents.push(...residents)
  world.horses.push({
    id: newId(world, 'horse'),
    realmId,
    x: x + mid - 1,
    y: y + size - 2,
    hunger: MAX_HUNGER,
  })
  world.carriages.push({
    id: newId(world, 'carriage'),
    realmId,
    x: x + mid + 1,
    y: y + size - 2,
    load: {},
  })
  return realm
}
