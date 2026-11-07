import {
  FOOTPRINT,
  NPC_POST_AROUND_HALL,
  NPC_SOLDIERS_AT_GATE,
  NPC_SOLDIERS_ON_HALL,
  canWork,
  covers,
  footprintTiles,
  isArmed,
  isAt,
  isDown,
  isPassableTerrain,
  terrainAt,
  tileIndex,
  townHallOf,
  wrap,
  wrapDelta,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import { foundingParty } from './npc-founding.js'
import { runResidents } from './npc-plan.js'
import { hash } from './residents.js'

/*
 * Where an NPC city's soldiers stand between fights (`CONTEXT.md`: Soldier posts; ADR 0029): first on
 * its town hall, then at its gates and along its wall. Nothing about it is stored: their posts follow
 * from their ids and what the city has, worked out in the pass that sends them.
 */

/** A soldier's post: where their id puts them, and the tiles that count as being on it. */
export interface SoldierPost {
  /** The tile they walk to. */
  at: { x: number; y: number }
  /**
   * What counts as on this post, by tile index: one standing or going to any of them stays, so a new
   * stretch of wall moves nobody.
   */
  tiles: ReadonlySet<number>
}

/** Whether a city's soldiers stand posts: an NPC city with its town hall up, not the Trade Org's. */
export function standsPosts(world: WorldState, city: City): boolean {
  if (city.tradeOrg) return false
  const hall = townHallOf(world, city)
  return !!hall && !hall.site
}

/**
 * Those of a city's `adults` who take a post: its armed adults at hand (`soldiersAtHand`) and not at
 * a script, so not on alarm or training, nor teaching. Those away from it leave the posts to the
 * others, and they are shared out anew once they are back.
 */
export function freeSoldiers(world: WorldState, city: City, adults: readonly Resident[]): Resident[] {
  const jobs = world.cityPlans[city.id]?.jobs
  return soldiersAtHand(world, city, adults).filter(
    (r) => !r.script && jobs?.[r.id]?.kind !== 'teach' && jobs?.[r.id]?.kind !== 'train',
  )
}

/**
 * The armed adults of a city's `adults` it can put somewhere: not at any script but the Train default
 * (`CONTEXT.md`: Who trains), so not on alarm; not fighting, carrying a child, Down, on a round, nor
 * its traders or founding party.
 */
export function soldiersAtHand(
  world: WorldState,
  city: City,
  adults: readonly Resident[],
): Resident[] {
  const plan = world.cityPlans[city.id]
  const party = new Set(foundingParty(plan))
  const traders = new Set(plan?.traders?.map((t) => t.residentId))
  const onRound = new Set(plan?.patrols?.map((p) => p.residentId))
  return adults.filter(
    (r) =>
      isArmed(r) &&
      !isDown(r) &&
      (!r.script || r.script.task === 'train') &&
      !r.carrying &&
      r.order?.kind !== 'attack' &&
      !party.has(r.id) &&
      !traders.has(r.id) &&
      !onRound.has(r.id),
  )
}

/**
 * How many soldiers it takes to hold the posts on a city's hall and at its finished gates (`CONTEXT.md`:
 * Soldier posts), which come first: those it can't send anywhere else.
 */
export function postsToHold(world: WorldState, city: City): number {
  const gates = world.buildings.filter(
    (b) => b.kind === 'gate' && b.cityId === city.id && !b.site,
  ).length
  return NPC_SOLDIERS_ON_HALL + NPC_SOLDIERS_AT_GATE * gates
}

/**
 * The posts of a city's `soldiers` (`freeSoldiers`), by resident id; none for a city whose soldiers
 * stand none (`standsPosts`). In order of id, the first `NPC_SOLDIERS_ON_HALL` stand on the hall and
 * the next `NPC_SOLDIERS_AT_GATE` at each gate; the rest spread along its wall, each on the tile their
 * id hashes to. A city with too little wall for them adds the ground around its hall to it.
 */
export function soldierPosts(
  world: WorldState,
  city: City,
  soldiers: Resident[],
  size: number,
  terrain?: TerrainMap,
): Map<string, SoldierPost> {
  const posts = new Map<string, SoldierPost>()
  if (!standsPosts(world, city) || soldiers.length === 0) return posts
  const hall = townHallOf(world, city)!
  const hallTiles = footprintTiles(hall, size).map(([x, y]) => ({ x, y }))
  const ids = (tiles: { x: number; y: number }[]) =>
    new Set(tiles.map((t) => tileIndex(size, t.x, t.y)))
  const onHall = ids(hallTiles)
  const ranked = [...soldiers].sort((a, b) => (a.id < b.id ? -1 : 1))
  const pick = <T>(list: readonly T[], r: Resident) => list[hash(r.id) % list.length]!

  for (const r of ranked.slice(0, NPC_SOLDIERS_ON_HALL)) {
    posts.set(r.id, { at: pick(hallTiles, r), tiles: onHall })
  }
  let taken = NPC_SOLDIERS_ON_HALL
  const { gates, walls } = reachableWalls(world, city, size)
  for (const gate of gates) {
    const at = { x: gate.x, y: gate.y }
    for (const r of ranked.slice(taken, taken + NPC_SOLDIERS_AT_GATE)) {
      posts.set(r.id, { at, tiles: ids([at]) })
    }
    taken += NPC_SOLDIERS_AT_GATE
  }
  const rest = ranked.slice(taken)
  if (rest.length === 0) return posts
  const along = walls.map((w) => ({ x: w.x, y: w.y }))
  const spots = along.length >= rest.length ? along : [...along, ...aroundHall(world, hall, size, terrain)]
  // With no ground free around it either, the hall is all there is.
  const tiles = spots.length > 0 ? spots : hallTiles
  const onThem = ids(tiles)
  for (const r of rest) posts.set(r.id, { at: pick(tiles, r), tiles: onThem })
  return posts
}

/**
 * A city's finished gates, and those of its finished walls a soldier can get onto: they go up only
 * from a gate or from a closed ring's inside (`mayStep`), so a stretch joined side to side to a gate.
 * A wall still going up, or a stretch cut off by what was torn down, is no post.
 */
export function reachableWalls(
  world: WorldState,
  city: City,
  size: number,
): { gates: Building[]; walls: Building[] } {
  const gates: Building[] = []
  const walls = new Map<number, Building>()
  for (const b of world.buildings) {
    if (b.cityId !== city.id || b.site) continue
    if (b.kind === 'gate') gates.push(b)
    else if (b.kind === 'wall') walls.set(tileIndex(size, b.x, b.y), b)
  }
  const reached: Building[] = []
  const todo = [...gates]
  const seen = new Set<number>()
  while (todo.length > 0) {
    const { x, y } = todo.pop()!
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const t = tileIndex(size, wrap(x + dx, size), wrap(y + dy, size))
      const wall = walls.get(t)
      if (!wall || seen.has(t)) continue
      seen.add(t)
      reached.push(wall)
      todo.push(wall)
    }
  }
  // A set order, whichever way the search went: their ids must give them the same tile each pass.
  reached.sort((a, b) => (a.id < b.id ? -1 : 1))
  return { gates, walls: reached }
}

/**
 * The tiles within `NPC_POST_AROUND_HALL` of a town hall one can stand on: not on another building,
 * so not on its storage, a road aside, nor on ground nobody walks on.
 */
function aroundHall(
  world: WorldState,
  hall: Building,
  size: number,
  terrain?: TerrainMap,
): { x: number; y: number }[] {
  const reach = NPC_POST_AROUND_HALL
  const side = FOOTPRINT[hall.kind]
  // Nothing further off can cover one of these tiles.
  const far = reach + side + Math.max(...Object.values(FOOTPRINT))
  const nearby = world.buildings.filter(
    (b) =>
      b.kind !== 'road' &&
      Math.abs(wrapDelta(hall.x, b.x, size)) <= far &&
      Math.abs(wrapDelta(hall.y, b.y, size)) <= far,
  )
  const out: { x: number; y: number }[] = []
  for (let dy = -reach; dy < side + reach; dy++) {
    for (let dx = -reach; dx < side + reach; dx++) {
      const x = wrap(hall.x + dx, size)
      const y = wrap(hall.y + dy, size)
      if (nearby.some((b) => covers(b, x, y, size))) continue
      if (terrain && !isPassableTerrain(terrainAt(terrain, x, y))) continue
      out.push({ x, y })
    }
  }
  return out
}

/**
 * More than this many soldiers with nothing to do on one storage, just after the pass that sent them
 * off it, is a crowd (`npcSoldiersOnPosts`).
 */
const STORAGE_CROWD = 4

/**
 * An NPC city's soldiers stand their posts (ADR 0004; `CONTEXT.md`: Soldier posts). Looked at right
 * after its pass, which sends them: they aren't left standing in a crowd on its storage, and with any
 * free to, someone armed of the city holds its town hall or is on their way there.
 */
export const npcSoldiersOnPosts: Invariant = {
  name: 'npc-soldiers-on-posts',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const people = runResidents(world)
    for (const city of world.cities) {
      if (city.realmId !== null || !standsPosts(world, city)) continue
      const plan = world.cityPlans[city.id]
      // Only the tick after: that of the pass itself has ended, so its orders have gone out.
      if (!plan || world.tick !== plan.plannedAt + 1) continue
      const own = people.get(city.id) ?? []
      const adults = own.filter((r) => canWork(r, world.tick))
      // Soldiers when it planned: one armed since has had no post yet.
      const soldiers = freeSoldiers(world, city, adults).filter(
        (r) => plan.jobs[r.id]?.kind === 'soldier',
      )
      if (soldiers.length === 0) continue

      const storage = world.buildings.find(
        (b) => b.cityId === city.id && b.kind === 'storage' && !b.site,
      )
      const crowd = soldiers.filter(
        (r) => r.order === null && !!storage && isAt(r, storage, terrain.size),
      )
      if (crowd.length > STORAGE_CROWD) {
        out.push({
          invariant: this.name,
          message: `${crowd.length} soldiers of ${city.id} stand on its storage`,
          entityIds: crowd.map((r) => r.id),
        })
      }

      const hall = townHallOf(world, city)!
      const onTheWay = (r: Resident) =>
        r.order?.kind === 'walkTo' && isAt(r.order.target, hall, terrain.size)
      const held = own.some((r) => isArmed(r) && (isAt(r, hall, terrain.size) || onTheWay(r)))
      if (!held) {
        out.push({
          invariant: this.name,
          message: `nobody holds or is going to the town hall of ${city.id}`,
          entityIds: [hall.id, ...soldiers.map((r) => r.id)],
        })
      }
    }
    return out
  },
}
