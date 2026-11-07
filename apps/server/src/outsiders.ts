import {
  CITY_AREA_MARGIN,
  FOOTPRINT,
  allied,
  isArmed,
  isCityBuilding,
  nearFootprint,
  type Building,
  type City,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { raiseOutsider } from './alarms.js'
import { caravanCrew } from './caravans.js'
import type { Invariant } from './invariants.js'
import { worldIndex } from './world-index.js'

/**
 * Outsiders in a City area (`CONTEXT.md`: Alarm, outsider; ADR 0028). Who is inside is plain data on
 * the city (`City.outsiders`), brought up to date once a tick: one who wasn't on it last tick just
 * came in, which raises the alarm once, and one who left drops off it, so coming back raises it
 * again. This runs for every city each tick, so the areas are indexed once and each resident looks
 * only at those near them (ADR 0016).
 */

/**
 * Tiles along a side of a square of the index, at least. An area is far narrower than this, so it
 * lies in at most two squares along each direction.
 */
const SQUARE_TILES = 32

/** Whether the city keeps track of outsiders: trading posts and the HQ keep their own rules. */
const watches = (city: City) => !city.tradeOrg

/**
 * The buildings that make up each city's area, by square, a building under every square its area
 * reaches into. Scratch memory like `WorldIndex`, never saved (ADR 0006).
 */
interface AreaIndex {
  size: number
  /** How many cities the world had. */
  cities: number
  /** The city buildings it was made from, and the city each belonged to then. */
  buildings: Building[]
  cityIds: string[]
  squares: Map<number, Map<City, Building[]>>
  key(r: Resident): number
}

const areaIndexes = new WeakMap<WorldState, AreaIndex>()

/**
 * The world's area index. Cities rarely change between ticks, so it is kept until a city building
 * comes, goes, or changes city; seeing that it hasn't is one cheap walk over the buildings.
 */
function areasBySquare(world: WorldState, size: number): AreaIndex {
  const known = areaIndexes.get(world)
  if (known?.size === size && stillStands(world, known)) return known
  const across = Math.max(1, Math.floor(size / SQUARE_TILES))
  const side = size / across
  const square = (v: number) =>
    Math.min(across - 1, Math.floor((((v % size) + size) % size) / side))
  const cities = new Map(world.cities.map((c) => [c.id, c]))
  const index: AreaIndex = {
    size,
    cities: world.cities.length,
    buildings: [],
    cityIds: [],
    squares: new Map(),
    key: (r) => square(r.y) * across + square(r.x),
  }
  const add = (key: number, city: City, b: Building) => {
    let near = index.squares.get(key)
    if (!near) index.squares.set(key, (near = new Map()))
    const list = near.get(city)
    if (list) list.push(b)
    else near.set(city, [b])
  }
  for (const b of world.buildings) {
    if (b.cityId === null || !isCityBuilding(b)) continue
    index.buildings.push(b)
    index.cityIds.push(b.cityId)
    const city = cities.get(b.cityId)
    if (!city) continue
    const far = FOOTPRINT[b.kind] - 1 + CITY_AREA_MARGIN
    const [x0, x1] = [square(b.x - CITY_AREA_MARGIN), square(b.x + far)]
    const [y0, y1] = [square(b.y - CITY_AREA_MARGIN), square(b.y + far)]
    add(y0 * across + x0, city, b)
    if (x1 !== x0) add(y0 * across + x1, city, b)
    if (y1 !== y0) add(y1 * across + x0, city, b)
    if (x1 !== x0 && y1 !== y0) add(y1 * across + x1, city, b)
  }
  areaIndexes.set(world, index)
  return index
}

/** Whether the city buildings are still the ones the index was made from, in the same cities. */
function stillStands(world: WorldState, index: AreaIndex): boolean {
  if (index.cities !== world.cities.length) return false
  let i = 0
  for (const b of world.buildings) {
    if (b.cityId === null || !isCityBuilding(b)) continue
    if (index.buildings[i] !== b || index.cityIds[i] !== b.cityId) return false
    i++
  }
  return i === index.buildings.length
}

/**
 * Whether `r` counts as an outsider for `city`, wherever they stand (`CONTEXT.md`: Alarm): of
 * another realm, or of another NPC city, and not allied; someone hired by the city's realm or an
 * ally of it is on its side. Crews of caravans and wandering traders are left out by the caller.
 */
function outsiderTo(world: WorldState, city: City, r: Resident): boolean {
  const theirs = r.owner ?? r.cityId
  if (theirs === null) return false
  const side = city.realmId ?? city.id
  if (allied(world, side, theirs)) return false
  const by = worldIndex(world).commanderOf(r)
  return by === null || by === theirs || !allied(world, side, by)
}

/** The outsiders standing in each watching city's area, in the order of `world.residents`. */
function outsidersByCity(world: WorldState, size: number): Map<City, Resident[]> {
  const { squares, key } = areasBySquare(world, size)
  const inside = new Map<City, Resident[]>()
  let crew: Set<string> | undefined
  for (const r of world.residents) {
    const near = squares.get(key(r))
    if (!near) continue
    const theirs = r.owner ?? r.cityId
    for (const [city, buildings] of near) {
      // Nearly everyone stands at home, and is done with here.
      if ((city.realmId ?? city.id) === theirs || !watches(city)) continue
      if (!buildings.some((b) => nearFootprint(b, r, CITY_AREA_MARGIN, size))) continue
      if (!outsiderTo(world, city, r)) continue
      if ((crew ??= caravanCrew(world)).has(r.id)) continue
      const list = inside.get(city)
      if (list) list.push(r)
      else inside.set(city, [r])
    }
  }
  return inside
}

/**
 * Brings every city's `outsiders` up to date, and raises the alarm for each one who just came in
 * (`raiseOutsider`). The armed go first: one alarm doesn't interrupt another, so someone armed
 * among those coming in together isn't missed for an unarmed one, who is only logged.
 */
export function stepOutsiders(world: WorldState, size: number): void {
  const inside = outsidersByCity(world, size)
  for (const city of world.cities) {
    const now = inside.get(city)
    const before = city.outsiders
    if (!now && !before) continue
    if (now) city.outsiders = now.map((r) => r.id)
    else delete city.outsiders
    if (!now) continue
    const known = new Set(before)
    const came = now.filter((r) => !known.has(r.id))
    for (const r of came) if (isArmed(r)) raiseOutsider(world, city, r, size)
    for (const r of came) if (!isArmed(r)) raiseOutsider(world, city, r, size)
  }
}

/**
 * Those standing in each city's area right now, as if they had always been there: for a world from
 * before cities kept track, so nobody rings for having come in before there were alarms.
 */
export function noteOutsidersInside(world: WorldState, size: number): void {
  for (const [city, list] of outsidersByCity(world, size)) {
    city.outsiders = list.map((r) => r.id)
  }
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Alarm): a city's outsiders are there as of the tick that just
 * ended: each one once, alive, of no side of the city's and standing in its area. A list is never
 * left empty, and trading posts and the HQ keep none.
 */
export const outsidersSound: Invariant = {
  name: 'outsiders-sound',
  check: (world, terrain) => {
    const index = worldIndex(world)
    const crew = caravanCrew(world)
    return world.cities.flatMap((city) => {
      const list = city.outsiders
      if (!list) return []
      const problem = (message: string, ...ids: string[]) => ({
        invariant: 'outsiders-sound',
        message: `${city.id} ${message}`,
        entityIds: [city.id, ...ids],
      })
      const problems = []
      if (list.length === 0) problems.push(problem('keeps an empty list of outsiders'))
      if (!watches(city)) problems.push(problem('keeps outsiders, but keeps its own rules'))
      if (new Set(list).size !== list.length) problems.push(problem('lists an outsider twice'))
      const area = world.buildings.filter((b) => b.cityId === city.id && isCityBuilding(b))
      for (const id of list) {
        const r = index.residentById(id)
        if (!r) problems.push(problem(`lists ${id}, who is gone`, id))
        else if (!outsiderTo(world, city, r) || crew.has(id)) {
          problems.push(problem(`lists ${id}, who is no outsider`, id))
        } else if (!area.some((b) => nearFootprint(b, r, CITY_AREA_MARGIN, terrain.size))) {
          problems.push(problem(`lists ${id}, who stands outside its area`, id))
        }
      }
      return problems
    })
  },
}
