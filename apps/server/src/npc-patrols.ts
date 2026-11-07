import {
  FOOTPRINT,
  HOME_FOOD_LOW,
  NPC_PATROLS_MAX,
  NPC_PATROL_ROAD_STOPS,
  NPC_PATROL_WALL_STOPS,
  NPC_SOLDIERS_AT_GATE,
  NPC_SOLDIERS_ON_HALL,
  NPC_SOLDIERS_PER_PATROL,
  isArmed,
  isCityBuilding,
  tileIndex,
  townHallOf,
  wrap,
  wrapDelta,
  wrapDistance,
  type Building,
  type City,
  type CityPlan,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { freeSoldiers, reachableWalls, soldierPosts, standsPosts } from './npc-posts.js'
import { refillSource } from './survival.js'

/*
 * Soldiers on patrol (`CONTEXT.md`: Soldier posts; ADR 0029). A few of an NPC city's soldiers on its
 * wall walk a round along it and its roads, one after another by id, and end where they set out from.
 * It is the dearest of a soldier's jobs, so a round is plain walks to a few stops: one search a leg, and
 * no script to run. An alarm keeps the walk aside like any order, and they go on with it after.
 */

type Tile = { x: number; y: number }

/** How many of a city's soldiers walk a round at once, with this many on its wall or walking one. */
export function patrolsWanted(onWall: number): number {
  return Math.min(NPC_PATROLS_MAX, Math.floor(onWall / NPC_SOLDIERS_PER_PATROL))
}

/**
 * The next stop of `r`'s round, if they are on one, taken off it. A round with none left is over and
 * goes off the plan, so they stand where its last stop brought them: where they set out from.
 */
export function nextStop(plan: CityPlan, r: Resident): Tile | undefined {
  const round = plan.patrols?.find((p) => p.residentId === r.id)
  if (!round) return undefined
  const stop = round.stops.shift()
  if (!stop) dropRounds(plan, (p) => p === round)
  return stop
}

/** Takes these rounds off a city's plan, the list with them once it is empty. */
function dropRounds(
  plan: CityPlan,
  drop: (p: NonNullable<CityPlan['patrols']>[number]) => boolean,
) {
  const left = plan.patrols?.filter((p) => !drop(p)) ?? []
  if (left.length > 0) plan.patrols = left
  else delete plan.patrols
}

/**
 * Who walks a round, for a city's pass (`CONTEXT.md`: Soldier posts). A round ends early for one who
 * is no longer a soldier at hand, or who runs low on Food where there is none to take: back on their
 * post in its area they refill when it has some. Then, while fewer walk than `patrolsWanted`, the next
 * by id after whoever set out last takes their turn, of those its posts on the wall leave standing. The
 * hall and the gates keep theirs: a soldier leaving one would move the next few along.
 */
export function sharePatrols(
  world: WorldState,
  city: City,
  plan: CityPlan,
  adults: Resident[],
  size: number,
  terrain?: TerrainMap,
): void {
  if (!standsPosts(world, city)) {
    delete plan.patrols
    return
  }
  const here = new Map(adults.map((r) => [r.id, r]))
  dropRounds(plan, (p) => {
    const r = here.get(p.residentId)
    if (!r || !isArmed(r) || plan.jobs[r.id]?.kind !== 'soldier') return true
    return (r.carried.food ?? 0) < HOME_FOOD_LOW && !refillSource(world, r, size)
  })

  const out = plan.patrols?.length ?? 0
  const free = freeSoldiers(world, city, adults)
  // Too few to have any on the wall, whatever its gates: most cities, most passes.
  if (free.length + out < NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_PER_PATROL) return
  const { gates, walls } = reachableWalls(world, city, size)
  const held = NPC_SOLDIERS_ON_HALL + gates.length * NPC_SOLDIERS_AT_GATE
  const ranked = [...free].sort((a, b) => (a.id < b.id ? -1 : 1))
  const onWall = ranked.slice(held)
  const room = patrolsWanted(onWall.length + out) - out
  if (room <= 0) return

  // Only one standing on their post sets out: that is where the round brings them back to.
  const posts = soldierPosts(world, city, free, size, terrain)
  const stands = onWall.filter(
    (r) =>
      r.order === null &&
      plan.jobs[r.id]?.kind === 'soldier' &&
      posts.get(r.id)?.tiles.has(tileIndex(size, r.x, r.y)),
  )
  const last = plan.patrolledLast ?? ''
  const inTurn = [...stands.filter((r) => r.id > last), ...stands.filter((r) => r.id <= last)]
  const way = roundStops(world, city, walls, size)
  if (way.length === 0) return
  for (const r of inTurn.slice(0, room)) {
    const stops = [...nearestFirst(way, r, size), { x: r.x, y: r.y }]
    ;(plan.patrols ??= []).push({ residentId: r.id, stops })
    plan.patrolledLast = r.id
  }
}

/**
 * The stops of a round in a city: along the longest stretch of its `walls` in order round its hall,
 * then along its roads inside it. A city with neither has no round.
 */
function roundStops(world: WorldState, city: City, walls: Building[], size: number): Tile[] {
  const hall = townHallOf(world, city)!
  const side = FOOTPRINT[hall.kind] / 2
  const round = (tiles: readonly Tile[]) =>
    tiles
      .map((t) => ({
        t,
        by: Math.atan2(wrapDelta(hall.y + side, t.y, size), wrapDelta(hall.x + side, t.x, size)),
      }))
      .sort((a, b) => a.by - b.by)
      .map(({ t }) => ({ x: t.x, y: t.y }))
  const along = thin(round(longestStretch(walls, size)), NPC_PATROL_WALL_STOPS)
  const roads = thin(round(roadsInside(world, city, hall, size)), NPC_PATROL_ROAD_STOPS)
  const end = along.at(-1)
  return [...along, ...(end ? nearestFirst(roads, end, size) : roads)]
}

/** `n` of `list`, evenly spread, in its order; all of a shorter one. */
function thin<T>(list: readonly T[], n: number): T[] {
  if (list.length <= n) return [...list]
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]!)
}

/** A ring of tiles from the one nearest `from`, going on the way it goes. */
function nearestFirst(tiles: readonly Tile[], from: Tile, size: number): Tile[] {
  let at = 0
  tiles.forEach((t, i) => {
    if (wrapDistance(size, from, t) < wrapDistance(size, from, tiles[at]!)) at = i
  })
  return [...tiles.slice(at), ...tiles.slice(0, at)].map((t) => ({ x: t.x, y: t.y }))
}

/** The longest stretch of `walls` joined side to side: of a big city with an inner ring, its outer one. */
function longestStretch(walls: readonly Building[], size: number): Building[] {
  const left = new Map(walls.map((w) => [tileIndex(size, w.x, w.y), w]))
  let longest: Building[] = []
  for (const start of walls) {
    if (!left.delete(tileIndex(size, start.x, start.y))) continue
    const stretch = [start]
    for (let i = 0; i < stretch.length; i++) {
      const { x, y } = stretch[i]!
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const t = tileIndex(size, wrap(x + dx, size), wrap(y + dy, size))
        const next = left.get(t)
        if (!next) continue
        left.delete(t)
        stretch.push(next)
      }
    }
    if (stretch.length > longest.length) longest = stretch
  }
  return longest
}

/**
 * The finished roads as near a city's hall as the furthest of its city buildings, so inside its area
 * but for a corner or two: a road out to a far workplace leaves it at about that point, and they walk
 * it no further.
 */
function roadsInside(world: WorldState, city: City, hall: Building, size: number): Building[] {
  const from = (b: Tile) =>
    Math.max(Math.abs(wrapDelta(hall.x, b.x, size)), Math.abs(wrapDelta(hall.y, b.y, size)))
  let reach = 0
  for (const b of world.buildings) {
    if (b.cityId === city.id && isCityBuilding(b)) reach = Math.max(reach, from(b))
  }
  return world.buildings.filter((b) => b.kind === 'road' && !b.site && from(b) <= reach)
}

/**
 * The most stops a round has: along the wall, along the roads, and back where it set out from.
 */
const MOST_STOPS = NPC_PATROL_WALL_STOPS + NPC_PATROL_ROAD_STOPS + 1

/**
 * An NPC city's patrols stay within their limit (ADR 0004; `CONTEXT.md`: Soldier posts): no more than
 * `NPC_PATROLS_MAX` at once, each on one round of a few tiles, and none in a Trade Org city. Right
 * after a pass, which ends the rounds of those who left, each is an armed resident of the city; one who
 * died or moved since the pass is left for the next one.
 */
export const npcPatrolsSound: Invariant = {
  name: 'npc-patrols-sound',
  check(world) {
    const out: InvariantViolation[] = []
    for (const city of world.cities) {
      if (city.realmId !== null) continue
      const plan = world.cityPlans[city.id]
      const rounds = plan?.patrols
      if (!plan || !rounds) continue
      const fail = (message: string, ...ids: string[]) =>
        out.push({ invariant: this.name, message: `${city.id} ${message}`, entityIds: ids })
      const ids = rounds.map((p) => p.residentId)
      if (rounds.length === 0) fail('keeps an empty list of patrols')
      if (rounds.length > NPC_PATROLS_MAX) fail(`has ${rounds.length} on patrol at once`, ...ids)
      if (new Set(ids).size < ids.length) fail('has a soldier on two rounds', ...ids)
      if (city.tradeOrg) fail('is the Trade Org’s, and has patrols', ...ids)
      for (const p of rounds) {
        if (p.stops.length > MOST_STOPS)
          fail(`has a round of ${p.stops.length} stops`, p.residentId)
        // Only the tick after: that of the pass itself has ended, so its orders have gone out.
        if (world.tick !== plan.plannedAt + 1) continue
        const r = world.residents.find((x) => x.id === p.residentId)
        if (r && (r.cityId !== city.id || r.owner !== null)) {
          fail(`has ${r.id} on patrol, who isn’t its own`, r.id)
        }
      }
    }
    return out
  },
}
