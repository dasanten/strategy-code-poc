import {
  MAP_SIZE,
  NPC_CITY_MIN_DISTANCE,
  NPC_TOWN,
  NPC_TOWNS,
  NPC_VILLAGE,
  NPC_VILLAGES,
  SIGHT_RANGE,
  START_CARRIED_FOOD,
  Terrain,
  terrainAt,
  townHallOf,
  wrapDistance,
  type Building,
  type City,
  type NpcCitySize,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { CITY_NAMES, updateCityMembership } from './cities.js'
import { hash, mulberry32, newResident } from './residents.js'
import { Ground } from './placing.js'
import {
  FARM_RING,
  hallTile,
  houseTile,
  newId,
  residentTiles,
  ringTiles,
  spotsOutside,
  wallSquare,
} from './starting-city.js'

/** How many cities of a kind a map of `size` gets: `perFullMap` on a full-size map, by area. */
export function npcCityCount(perFullMap: number, size: number): number {
  return Math.round((perFullMap * (size * size)) / (MAP_SIZE * MAP_SIZE))
}

/** How far a city's tiles reach from its middle at most: its square and the ring around it. */
const footprintRadius = (kind: NpcCitySize) => (kind.size / 2 + FARM_RING) * Math.SQRT2

/**
 * Whether an NPC city of `kind` with its top-left wall tile at (x, y) fits there: its square and
 * the ring around it all Plains with nothing on them, room for its farms outside the wall, at
 * least `NPC_CITY_MIN_DISTANCE` from every city, and, unless `outOfSight` is false (a daughter's
 * site, `CONTEXT.md`: Founding), out of sight of every Player's resident (`CONTEXT.md`: NPC city,
 * Sight).
 */
export function npcSiteFits(
  world: WorldState,
  terrain: TerrainMap,
  kind: NpcCitySize,
  x: number,
  y: number,
  ground: Ground = takenGround(world, terrain),
  outOfSight = true,
): boolean {
  const size = terrain.size
  const centre = { x: x + kind.size / 2, y: y + kind.size / 2 }
  for (const c of world.cities) {
    const hall = townHallOf(world, c)
    if (hall && wrapDistance(size, hall, centre) < NPC_CITY_MIN_DISTANCE) return false
  }
  // No tile of it within sight of a Player's resident.
  const unseen = SIGHT_RANGE + footprintRadius(kind)
  for (const r of outOfSight ? world.residents : []) {
    if (r.owner !== null && wrapDistance(size, r, centre) <= unseen) return false
  }
  for (let ty = y - FARM_RING; ty < y + kind.size + FARM_RING; ty++) {
    for (let tx = x - FARM_RING; tx < x + kind.size + FARM_RING; tx++) {
      if (terrainAt(terrain, tx, ty) !== Terrain.Plains) return false
      if (!ground.free(tx, ty)) return false
    }
  }
  return spotsOutside(ground, wallSquare(x, y, kind.size), farmKinds(kind)) !== undefined
}

/**
 * The ground with what stands on it (`Ground`): nodes, footprints, residents, horses, carriages
 * and piles.
 */
export function takenGround(world: WorldState, terrain: TerrainMap): Ground {
  const nodes = world.nodes.map((n) => `${n.x},${n.y}`)
  return new Ground(world, terrain, [...nodes, ...residentTiles(world)])
}

/** One farm for each of a city's farms. */
const farmKinds = (kind: NpcCitySize): 'farm'[] => Array<'farm'>(kind.farms).fill('farm')

/**
 * Picks a site for an NPC city of `kind` (`npcSiteFits`), or none when the map has no room left
 * for it. A city never straddles the map's joins.
 */
export function findNpcCitySite(
  world: WorldState,
  terrain: TerrainMap,
  kind: NpcCitySize,
  rand: () => number,
): [number, number] | undefined {
  const span = terrain.size - kind.size - 2 * FARM_RING
  if (span <= 0) return undefined
  const ground = takenGround(world, terrain)
  for (let attempt = 0; attempt < 3000; attempt++) {
    const x = FARM_RING + Math.floor(rand() * span)
    const y = FARM_RING + Math.floor(rand() * span)
    if (npcSiteFits(world, terrain, kind, x, y, ground)) return [x, y]
  }
  return undefined
}

/**
 * Lays out an NPC city of `kind` with its top-left wall tile at (x, y), as a starting city is
 * laid out: a ring of wall with a gate, the storage with food in the middle, the town hall south
 * of it, houses in a row north of it, and farms outside the wall by the gate. Its residents
 * belong to no realm; they start on the farms, working them, each with a little food on them.
 */
export function foundNpcCity(
  world: WorldState,
  terrain: TerrainMap,
  kind: NpcCitySize,
  x: number,
  y: number,
  rand: () => number,
): City {
  const mid = Math.floor(kind.size / 2)
  const square = wallSquare(x, y, kind.size)
  const id = newId(world, 'city')
  const city: City = {
    id,
    name: CITY_NAMES[hash(`${world.seed}:${id}`) % CITY_NAMES.length]!,
    realmId: null,
    townHallId: '',
    occupation: null,
  }
  const building = (k: Building['kind'], bx: number, by: number): Building => ({
    id: newId(world, 'b'),
    kind: k,
    cityId: city.id,
    x: bx,
    y: by,
  })
  const hall = building('townHall', ...hallTile(x, y, kind.size))
  city.townHallId = hall.id
  const farms = (spotsOutside(takenGround(world, terrain), square, farmKinds(kind)) ?? []).map(
    ([fx, fy]) => building('farm', fx, fy),
  )
  const buildings: Building[] = [
    hall,
    { ...building('storage', x + mid, y + mid), stock: { food: kind.food } },
    ...Array.from({ length: kind.houses }, (_, i) =>
      building('house', ...houseTile(x, y, kind.size, i)),
    ),
    ...ringTiles(square).map(([wx, wy]) =>
      building(wx === square.gate.x && wy === square.gate.y ? 'gate' : 'wall', wx, wy),
    ),
    ...farms,
  ]
  const residents = Array.from({ length: kind.residents }, (_, i) => {
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
  world.cities.push(city)
  world.buildings.push(...buildings)
  world.residents.push(...residents)
  updateCityMembership(world, terrain.size)
  return city
}

/**
 * Places the world's NPC cities (`CONTEXT.md`: NPC city): `NPC_TOWNS` towns, then `NPC_VILLAGES`
 * villages, scaled to the map's area, each on a site `findNpcCitySite` picks. Fewer when the map
 * has no room left. The same world always gets the same cities.
 */
export function placeNpcCities(world: WorldState, terrain: TerrainMap): City[] {
  const rand = mulberry32(world.seed * 104729 + 31)
  const placed: City[] = []
  const kinds = [
    ...Array<NpcCitySize>(npcCityCount(NPC_TOWNS, terrain.size)).fill(NPC_TOWN),
    ...Array<NpcCitySize>(npcCityCount(NPC_VILLAGES, terrain.size)).fill(NPC_VILLAGE),
  ]
  for (const kind of kinds) {
    const site = findNpcCitySite(world, terrain, kind, rand)
    if (site) placed.push(foundNpcCity(world, terrain, kind, site[0], site[1], rand))
  }
  return placed
}
