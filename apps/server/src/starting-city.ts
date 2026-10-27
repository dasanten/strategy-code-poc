import {
  CITY_AREA_MARGIN,
  CITY_MIN_DISTANCE,
  HOUSING_ROOM,
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
  type BuildingKind,
  type City,
  type Realm,
  type TerrainMap,
  type WorldState,
  FOOTPRINT,
  CITY_BUILDING_REACH,
  footprintKeys,
} from '@csp/shared'
import { CITY_NAMES, updateCityMembership } from './cities.js'
import { recordEvent } from './events.js'
import { newHorse } from './horses.js'
import { mulberry32, newResident, residentName } from './residents.js'
import { welcomeFormerPlayer } from './standing.js'
import { Ground } from './placing.js'

/** A fresh id for a new entity; ids are never reused. */
export function newId(world: WorldState, prefix: string): string {
  return `${prefix}${world.nextId++}`
}

/** The Player's realm, if they have one. */
export function realmOf(world: WorldState, userId: number): Realm | undefined {
  return world.realms.find((r) => r.userId === userId)
}

/**
 * The Leader's name from the game offered to a Player founding a realm, which they may keep
 * (`CONTEXT.md`: Leader death).
 */
export function suggestedLeaderName(world: WorldState, userId: number): string {
  return residentName(mulberry32(world.seed * 6151 + userId * 31 + world.tick))
}

/**
 * How many tiles out from a starting city's wall its farm and stable stand: just past its area
 * (`CITY_AREA_MARGIN`), so working the farm is not being at home.
 */
export const FARM_RING = 1 + CITY_AREA_MARGIN

/**
 * Where a walled square city's town hall goes, with the storage on its middle tile: just south
 * of the storage, a tile apart.
 */
export function hallTile(x: number, y: number, size: number): [number, number] {
  const mid = Math.floor(size / 2)
  return [x + mid - 1, y + mid + FOOTPRINT.storage + 1]
}

/**
 * Where a walled square city's `i`th house goes: in a row along the north side, a tile apart
 * from each other and from the wall, but near enough to the storage for the city's chain to reach
 * it (`CITY_BUILDING_REACH`).
 */
export function houseTile(x: number, y: number, size: number, i: number): [number, number] {
  const mid = Math.floor(size / 2)
  const row = y + Math.max(2, mid - CITY_BUILDING_REACH)
  return [x + 2 + i * (FOOTPRINT.house + 1), row]
}

/** The tiles residents, horses, carriages and piles stand on, as "x,y" keys. */
export function residentTiles(world: WorldState): string[] {
  return [...world.residents, ...world.horses, ...world.carriages, ...world.piles].map(
    (e) => `${e.x},${e.y}`,
  )
}

/** Where a city may stand: its square and the rings around it on open land, with no nodes. */
function siteFits(terrain: TerrainMap, ground: Ground, x: number, y: number): boolean {
  for (let ty = y - FARM_RING; ty < y + START_CITY_SIZE + FARM_RING; ty++) {
    for (let tx = x - FARM_RING; tx < x + START_CITY_SIZE + FARM_RING; tx++) {
      const t = terrainAt(terrain, tx, ty)
      if (t !== Terrain.Plains && t !== Terrain.Forest && t !== Terrain.Hills) return false
      if (!ground.free(tx, ty) || ground.nodeAt(tx, ty)) return false
    }
  }
  // Room outside the wall for the farm and the stable.
  return spotsOutside(ground, startCity(x, y), ['farm', 'stable']) !== undefined
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

/**
 * A walled square at (x, y), `size` tiles along each side (an odd number, so it has a middle
 * tile): the gate in the middle of the south side.
 */
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
 * Where buildings of `kinds` go outside a city's wall, one after another: each footprint wholly
 * at least `out` tiles out from the wall (`FARM_RING`: just past the city's area), touching that
 * ring, on ground that takes it (`Ground.fits`: Plains for farms and stables), off the way
 * straight out of the gate and off the others; each the one nearest the gate. The north-west
 * tiles in order of `kinds`, or none when one of them finds no room.
 */
export function spotsOutside(
  ground: Ground,
  city: WallSquare,
  kinds: readonly BuildingKind[],
  out = FARM_RING,
): [number, number][] | undefined {
  const { x, y, size } = city
  const gate = city.gate
  const lane = (tx: number, ty: number) => tx === gate.x && ty > gate.y
  const mine = new Set<string>()
  const spots: [number, number][] = []
  for (const kind of kinds) {
    const side = FOOTPRINT[kind]
    const candidates: [number, number][] = []
    // North-west tiles of footprints touching the ring `out` tiles out, on each side.
    for (let i = -out - side + 1; i < size + out; i++) {
      candidates.push(
        [x + i, y - out - side + 1],
        [x + i, y + size - 1 + out],
        [x - out - side + 1, y + i],
        [x + size - 1 + out, y + i],
      )
    }
    const free = candidates.filter(([cx, cy]) => {
      const ring = Math.max(
        Math.max(x - (cx + side - 1), cx - (x + size - 1), 0),
        Math.max(y - (cy + side - 1), cy - (y + size - 1), 0),
      )
      return (
        ring >= out &&
        ground.fits(kind, cx, cy, (tx, ty) => !lane(tx, ty) && !mine.has(`${tx},${ty}`))
      )
    })
    const toGate = ([cx, cy]: [number, number]) =>
      Math.hypot(cx + (side - 1) / 2 - gate.x, cy + (side - 1) / 2 - gate.y)
    const best = free.sort((a, b) => toGate(a) - toGate(b))[0]
    if (!best) return undefined
    for (const k of footprintKeys({ kind, x: best[0], y: best[1] })) mine.add(k)
    spots.push(best)
  }
  return spots
}

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
  const ground = new Ground(world, terrain)
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
      if (siteFits(terrain, ground, x, y)) return [x, y]
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
 * `names`, from the Player's `found` request, name the realm and the Leader (`CONTEXT.md`: Realm
 * name); trimmed here, checked before (`foundingProblem`). Without them the realm goes by its
 * Leader's name from the game, as in tests.
 */
export function foundStartingCity(
  world: WorldState,
  terrain: TerrainMap,
  userId: number,
  names?: { realmName: string; leaderName: string },
): Realm {
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

  // Inside the wall: the storage on the middle tile, the town hall south of it, houses in a row
  // along the north side (`houseRow`).
  const building = (kind: Building['kind'], bx: number, by: number): Building => ({
    id: newId(world, 'b'),
    kind,
    cityId: city.id,
    x: bx,
    y: by,
  })
  const hall = building('townHall', ...hallTile(x, y, size))
  city.townHallId = hall.id
  const houses = Math.ceil(START_RESIDENTS / HOUSING_ROOM.house!) + START_SPARE_HOUSES
  const buildings: Building[] = [
    hall,
    { ...building('storage', x + mid, y + mid), stock: { food: START_FOOD } },
    ...Array.from({ length: houses }, (_, i) => building('house', ...houseTile(x, y, size, i))),
    ...ringTiles(square).map(([wx, wy]) =>
      building(wx === square.gate.x && wy === square.gate.y ? 'gate' : 'wall', wx, wy),
    ),
  ]
  // Outside the wall, just past the city's area by the gate: the farm, and the stable next to it
  // with a little food.
  const [[fx, fy], [sx, sy]] = spotsOutside(
    new Ground(world, terrain, residentTiles(world)),
    square,
    ['farm', 'stable'],
  )! as [[number, number], [number, number]]
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
    // By the Work default (`CONTEXT.md`: Carrying the output), the Player's version from the
    // first tick their scripts run.
    r.script = { scriptId: 0, task: 'work', memory: { workplaceId: farm.id } }
    return r
  })
  const realm: Realm = { id: realmId, userId, leaderId: residents[0]!.id }
  if (names) {
    realm.name = names.realmName.trim()
    residents[0]!.name = names.leaderName.trim()
  }

  world.realms.push(realm)
  welcomeFormerPlayer(world, realm)
  world.cities.push(city)
  world.buildings.push(...buildings)
  updateCityMembership(world, terrain.size)
  world.residents.push(...residents)
  const horseRand = mulberry32(world.seed * 7919 + userId + 1)
  for (let i = 0; i < START_HORSES; i++) {
    const id = newId(world, 'horse')
    world.horses.push(
      newHorse(horseRand, { id, realmId, cityId: null, x: sx, y: sy, tick: world.tick }),
    )
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
  const leader = residents[0]!
  recordEvent(world, realmId, {
    kind: 'founded',
    residentId: leader.id,
    name: leader.name,
    cityId: city.id,
    city: city.name,
    x: hall.x,
    y: hall.y,
  })
  return realm
}
