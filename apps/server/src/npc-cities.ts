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
  wrap,
  wrapDistance,
  type Building,
  type City,
  type NpcCitySize,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { CITY_NAMES, givenCityName, updateCityMembership } from './cities.js'
import { layoutPlan, pickLayout, type LayoutPlan } from './city-layout.js'
import { giveNpcHorses } from './npc-horses.js'
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
 * of it, houses in a row north of it, each on the nearest spot its layout has (`CONTEXT.md`: City
 * layout), and farms outside the wall by the gate. Its residents belong to no realm; they start on
 * the farms, working them, each with a little food on them. A trading post (`tradeOrg`) has no
 * layout, and its row stands as it falls.
 */
export function foundNpcCity(
  world: WorldState,
  terrain: TerrainMap,
  kind: NpcCitySize,
  x: number,
  y: number,
  rand: () => number,
  tradeOrg?: 'post',
): City {
  const mid = Math.floor(kind.size / 2)
  const square = wallSquare(x, y, kind.size)
  const id = newId(world, 'city')
  const city: City = {
    id,
    ...givenCityName(world, CITY_NAMES[hash(`${world.seed}:${id}`) % CITY_NAMES.length]!),
    realmId: null,
    townHallId: '',
    occupation: null,
    ...(tradeOrg ? { tradeOrg } : { layout: pickLayout(world.seed, id) }),
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
  const storage = { ...building('storage', x + mid, y + mid), stock: { food: kind.food } }
  const walls = ringTiles(square).map(([wx, wy]) =>
    building(wx === square.gate.x && wy === square.gate.y ? 'gate' : 'wall', wx, wy),
  )
  world.cities.push(city)
  world.buildings.push(hall, storage, ...walls, ...farms)
  const plan = layoutPlan(world, city, storage, { dx: 0, dy: mid }, terrain.size)
  const ground = new Ground(world, terrain)
  for (let i = 0; i < kind.houses; i++) {
    const row = houseTile(x, y, kind.size, i)
    const [hx, hy] = (plan && startingHouseSpot(plan, ground, storage, row)) ?? row
    ground.take('house', hx, hy)
    world.buildings.push(building('house', hx, hy))
  }
  const names = new Set<string>()
  const residents = Array.from({ length: kind.residents }, (_, i) => {
    const farm = farms[i % farms.length]!
    const r = newResident(
      rand,
      {
        id: newId(world, 'r'),
        owner: null,
        cityId: city.id,
        x: farm.x,
        y: farm.y,
        tick: world.tick,
      },
      names,
    )
    r.carried = { food: START_CARRIED_FOOD }
    r.order = { kind: 'workAt', buildingId: farm.id, at: { x: farm.x, y: farm.y }, progress: 0 }
    r.script = { scriptId: 0, task: 'work', memory: { workplaceId: farm.id } }
    return r
  })
  world.residents.push(...residents)
  updateCityMembership(world, terrain.size)
  return city
}

/**
 * Where a starting house goes by its city's layout: the spot nearest its tile in a starting city's
 * row, and no further from the home than that. The row is what ties a town's wall to its middle
 * (`CITY_BUILDING_REACH`), so the houses stay near it and the wall stays part of the city. A layout
 * that fills some spots first (`LayoutPlan.rank`) takes the first of those, as far out as the row
 * stands.
 */
function startingHouseSpot(
  plan: LayoutPlan,
  ground: Ground,
  home: Building,
  [rx, ry]: [number, number],
): [number, number] | undefined {
  const size = ground.terrain.size
  const reach = Math.max(Math.abs(rx - home.x), Math.abs(ry - home.y))
  const off = (x: number, y: number) => !plan.street(x, y)
  let best: { at: [number, number]; rank: number; d: number } | undefined
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = wrap(home.x + dx, size)
      const y = wrap(home.y + dy, size)
      if (!plan.spot('house', x, y)) continue
      const rank = plan.rank?.('house', x, y) ?? 0
      const d = plan.rank
        ? reach - Math.max(Math.abs(dx), Math.abs(dy))
        : Math.hypot(home.x + dx - rx, home.y + dy - ry)
      if (best && (rank > best.rank || (rank === best.rank && d >= best.d))) continue
      if (ground.fits('house', x, y, off)) best = { at: [x, y], rank, d }
    }
  }
  return best?.at
}

/**
 * Places the world's NPC cities (`CONTEXT.md`: NPC city): `NPC_TOWNS` towns, then `NPC_VILLAGES`
 * villages, scaled to the map's area, each on a site `findNpcCitySite` picks and with its first
 * horses (`giveNpcHorses`). Fewer when the map has no room left. The same world always gets the
 * same cities.
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
  // Trading posts are laid out by `foundNpcCity` too, and get none.
  for (const city of placed) giveNpcHorses(world, terrain, city)
  return placed
}
