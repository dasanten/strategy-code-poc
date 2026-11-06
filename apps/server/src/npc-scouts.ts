import {
  NPC_NODE_REACH,
  NPC_RESIDENTS_PER_SCOUT,
  NPC_SCOUT_LIMIT,
  NPC_SCOUT_SECTOR,
  SIGHT_RANGE,
  cityResidents,
  inCityArea,
  isDown,
  wrap,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type CityScouted,
  type ResourceNode,
  type Resident,
  type ScoutTrip,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { npcHome } from './npc-behaviour.js'
import { hash } from './residents.js'

/*
 * An NPC city's scouts (`CONTEXT.md`: Scout; ADR 0026). They run the game's Explore default like a
 * Player's explorer, but what is unexplored is what their city doesn't know. A city's knowledge
 * goes by sectors (`NPC_SCOUT_SECTOR`), so it stays small plain data: `City.scouted`, the sectors
 * scouts brought home, and `CityPlan.scouts`, what each scout out has seen and not brought home yet.
 */

/** Sectors along each side of the map. */
const sectorsAcross = (size: number) => Math.ceil(size / NPC_SCOUT_SECTOR)

/** The sector a tile lies in, as a number. */
export function sectorOf(size: number, x: number, y: number): number {
  const across = sectorsAcross(size)
  return Math.floor(y / NPC_SCOUT_SECTOR) * across + Math.floor(x / NPC_SCOUT_SECTOR)
}

/** The middle tile of a sector by its column and row, which wrap round the map. */
function sectorMiddle(size: number, column: number, row: number) {
  const across = sectorsAcross(size)
  const middle = (n: number) =>
    wrap(wrap(n, across) * NPC_SCOUT_SECTOR + Math.floor(NPC_SCOUT_SECTOR / 2), size)
  return { x: middle(column), y: middle(row) }
}

/** The sectors whose middle a resident on a tile has in sight. */
function sectorsInSight(size: number, at: { x: number; y: number }): number[] {
  const out = new Set<number>()
  const span = Math.ceil(SIGHT_RANGE / NPC_SCOUT_SECTOR) + 1
  const column = Math.floor(at.x / NPC_SCOUT_SECTOR)
  const row = Math.floor(at.y / NPC_SCOUT_SECTOR)
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const middle = sectorMiddle(size, column + dx, row + dy)
      if (wrapDistance(size, at, middle) <= SIGHT_RANGE) {
        out.add(sectorOf(size, middle.x, middle.y))
      }
    }
  }
  return [...out]
}

/** How many scouts a city sends at a time, by its size (`CONTEXT.md`: Scout). */
export function scoutsWanted(world: WorldState, city: City): number {
  return Math.ceil(cityResidents(world, city).length / NPC_RESIDENTS_PER_SCOUT)
}

/**
 * Whether a city knows of a resource node (`CONTEXT.md`: Scout): within its set reach it simply
 * does; out to its limit, once a scout who saw the node's sector has come home, unless it has found
 * no way to that sector.
 */
export function knowsNode(
  city: City,
  home: { x: number; y: number },
  node: Pick<ResourceNode, 'x' | 'y'>,
  size: number,
): boolean {
  const d = wrapDistance(size, home, node)
  if (d <= NPC_NODE_REACH) return true
  if (d > NPC_SCOUT_LIMIT || !city.scouted) return false
  const sector = sectorOf(size, node.x, node.y)
  return city.scouted.sectors.includes(sector) && !city.scouted.noWay?.includes(sector)
}

/**
 * A city's builder found no way to a site past its set reach (`CONTEXT.md`: Scout): it gives the
 * site's sector up as it does one a scout found no way to, so it picks another node or, knowing
 * none, buys the good. Inside its set reach it goes on knowing its nodes, and nothing is given up.
 * Whether it gave the sector up.
 */
export function giveUpSite(
  world: WorldState,
  city: City,
  site: { x: number; y: number },
  size: number,
): boolean {
  const home = npcHome(world, city)
  if (!home || wrapDistance(size, home, site) <= NPC_NODE_REACH) return false
  addAll(((city.scouted ??= { sectors: [] }).noWay ??= []), [sectorOf(size, site.x, site.y)])
  return true
}

/**
 * Those of a city's spare hands who scout for it next (`CONTEXT.md`: Spare hands' work), up to
 * `scoutsWanted`: while it doesn't know its limit and Food isn't short, of `unneeded`, first those
 * already out, then those with no workplace to go back to, then the rest.
 */
export function pickScouts(
  world: WorldState,
  city: City,
  plan: CityPlan,
  unneeded: Resident[],
  hasPlace: (r: Resident) => boolean,
  foodShort: boolean,
): Resident[] {
  if (city.tradeOrg || city.scouted?.done || foodShort) return []
  const rank = (r: Resident) => (plan.scouts?.[r.id] ? 0 : hasPlace(r) ? 2 : 1)
  return [...unneeded].sort((a, b) => rank(a) - rank(b)).slice(0, scoutsWanted(world, city))
}

/** Sends a resident scouting: they run the game's Explore default with no `find`. */
export function sendScout(plan: CityPlan, r: Resident): void {
  r.script = { scriptId: 0, task: 'explore', memory: {} }
  ;(plan.scouts ??= {})[r.id] ??= { saw: [] }
}

const addAll = (to: number[], sectors: readonly number[]) => {
  for (const s of sectors) if (!to.includes(s)) to.push(s)
}

/**
 * What a city's scouts do for it each tick, with `people` the residents it runs: each scout adds
 * what they have in sight to their trip, and the tiles their script found no way to. On stepping
 * into its area they bring it all home, the only way the city learns it. One gone, dead or no
 * longer the city's, brings nothing; one Down sees nothing, and carries it on once awake.
 */
export function stepScouts(
  world: WorldState,
  city: City,
  plan: CityPlan,
  people: readonly Resident[],
  size: number,
): void {
  if (!plan.scouts) return
  for (const [id, trip] of Object.entries(plan.scouts)) {
    const r = people.find((p) => p.id === id)
    if (!r) {
      delete plan.scouts[id]
      continue
    }
    if (isDown(r)) continue
    addAll(trip.saw, sectorsInSight(size, r))
    addAll((trip.noWay ??= []), noWayTiles(r, size))
    if (!inCityArea(world, city, r.x, r.y, size)) continue
    bringHome(city, trip)
    if (r.script?.task === 'explore') plan.scouts[id] = { saw: [] }
    else delete plan.scouts[id]
  }
  if (Object.keys(plan.scouts).length === 0) delete plan.scouts
}

/** The sectors of the tiles a scout's script found no way to, which it keeps in its memory. */
function noWayTiles(r: Resident, size: number): number[] {
  const skip = r.script?.task === 'explore' ? r.script.memory.skip : undefined
  if (!Array.isArray(skip)) return []
  return skip.flatMap((t) => {
    const at = t as { x?: unknown; y?: unknown } | null
    if (typeof at?.x !== 'number' || typeof at.y !== 'number') return []
    return [sectorOf(size, at.x, at.y)]
  })
}

function bringHome(city: City, trip: ScoutTrip): void {
  if (trip.saw.length === 0 && !trip.noWay?.length) return
  const scouted: CityScouted = (city.scouted ??= { sectors: [] })
  addAll(scouted.sectors, trip.saw)
  if (trip.noWay?.length) addAll((scouted.noWay ??= []), trip.noWay)
}

/** How a scout's Explore default says it has no tile left to go to (`scoutEnded`). */
const NOTHING_LEFT = 'nothing unexplored in reach'

/**
 * A scout's Explore default ended: saying nothing is left to find, or nothing the Food they can
 * carry reaches, the city knows its limit and stops scouting (`CONTEXT.md`: Scout).
 */
export function scoutEnded(city: City, reason: string | null): void {
  if (!reason?.startsWith(NOTHING_LEFT)) return
  ;(city.scouted ??= { sectors: [] }).done = true
}

/** What `scoutEdge` needs of the script's question (`exploredEdge`). */
export interface ScoutEdgeSearch {
  /** Whether the scout can go onto a tile: on foot, or riding. */
  canEnter: (x: number, y: number) => boolean
  /** Tiles their script found no way to; their sectors are left out. */
  skip: readonly { x: number; y: number }[]
}

/**
 * Where a scout goes next (`CONTEXT.md`: Explore, Scout), in place of a Player's explored edge: the
 * nearest tile they can go onto of a sector out to the city's limit that neither it nor they know
 * of. Past its set reach only: inside that a city simply knows its nodes. The nearest first, leaning
 * toward a way out of its own, by their id, so scouts going out together spread. Undefined with none.
 */
export function scoutEdge(
  world: WorldState,
  city: City,
  plan: CityPlan | undefined,
  r: Resident,
  size: number,
  search: ScoutEdgeSearch,
): { x: number; y: number } | undefined {
  const home = npcHome(world, city)
  if (!home) return undefined
  const trip = plan?.scouts?.[r.id]
  const known = new Set<number>([
    ...(city.scouted?.sectors ?? []),
    ...(city.scouted?.noWay ?? []),
    ...(trip?.saw ?? []),
    ...(trip?.noWay ?? []),
    ...search.skip.map((t) => sectorOf(size, t.x, t.y)),
  ])
  const way = ((hash(r.id) % 360) * Math.PI) / 180
  const across = sectorsAcross(size)
  const span = Math.min(
    Math.ceil(NPC_SCOUT_LIMIT / NPC_SCOUT_SECTOR) + 1,
    Math.floor((across - 1) / 2),
  )
  const column = Math.floor(home.x / NPC_SCOUT_SECTOR)
  const row = Math.floor(home.y / NPC_SCOUT_SECTOR)
  const open: { column: number; row: number; score: number }[] = []
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const middle = sectorMiddle(size, column + dx, row + dy)
      const d = wrapDistance(size, home, middle)
      if (d > NPC_SCOUT_LIMIT || d + NPC_SCOUT_SECTOR * Math.SQRT1_2 <= NPC_NODE_REACH) continue
      if (known.has(sectorOf(size, middle.x, middle.y))) continue
      const out = (dx * Math.cos(way) + dy * Math.sin(way)) * NPC_SCOUT_SECTOR
      open.push({
        column: column + dx,
        row: row + dy,
        score: wrapDistance(size, r, middle) - out / 2,
      })
    }
  }
  open.sort((a, b) => a.score - b.score)
  for (const sector of open) {
    const tile = nearestTileIn(size, sector, r, search.canEnter)
    if (tile) return tile
  }
  return undefined
}

/** The tile of a sector nearest a resident that they can go onto; none in the middle of a lake. */
function nearestTileIn(
  size: number,
  sector: { column: number; row: number },
  r: Resident,
  canEnter: (x: number, y: number) => boolean,
): { x: number; y: number } | undefined {
  const half = Math.floor(NPC_SCOUT_SECTOR / 2)
  const middle = sectorMiddle(size, sector.column, sector.row)
  const left = middle.x - half
  const top = middle.y - half
  let best: { x: number; y: number; d: number } | undefined
  for (let dy = 0; dy < NPC_SCOUT_SECTOR; dy++) {
    for (let dx = 0; dx < NPC_SCOUT_SECTOR; dx++) {
      const x = wrap(left + dx, size)
      const y = wrap(top + dy, size)
      const d = wrapDistance(size, r, { x, y })
      if ((!best || d < best.d) && canEnter(x, y)) best = { x, y, d }
    }
  }
  return best && { x: best.x, y: best.y }
}

/**
 * An NPC city's scouts are few and its knowledge sound (`CONTEXT.md`: Scout; ADR 0004): in the plan
 * its pass made this tick it sends no more than `scoutsWanted`, and one for a death since; a Trade
 * Org city sends none; a sector it knows of, or a scout has seen, is a sector of the map.
 */
export const npcScoutsSound: Invariant = {
  name: 'npc-scouts-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const sectors = sectorsAcross(terrain.size) ** 2
    const onMap = (s: number) => Number.isInteger(s) && s >= 0 && s < sectors
    const fail = (cityId: string, message: string) =>
      out.push({ invariant: this.name, message: `${cityId} ${message}`, entityIds: [cityId] })
    for (const city of world.cities) {
      const known = [...(city.scouted?.sectors ?? []), ...(city.scouted?.noWay ?? [])]
      if (!known.every(onMap)) fail(city.id, 'knows of a sector off the map')
      const plan = world.cityPlans[city.id]
      if (!plan) continue
      const trips = Object.values(plan.scouts ?? {})
      if (!trips.every((t) => [...t.saw, ...(t.noWay ?? [])].every(onMap))) {
        fail(city.id, 'has a scout who saw a sector off the map')
      }
      const scouts = Object.values(plan.jobs).filter((j) => j.kind === 'scout').length
      if (city.tradeOrg && (scouts > 0 || trips.length > 0)) {
        fail(city.id, 'of the Trade Organization, sends scouts')
      }
      if (plan.plannedAt === world.tick && scouts > scoutsWanted(world, city) + 1) {
        fail(city.id, `plans ${scouts} scouts of ${scoutsWanted(world, city)}`)
      }
    }
    return out
  },
}
