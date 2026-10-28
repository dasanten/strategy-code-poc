import {
  SHARES_A_TILE,
  TRADE_ORG_ARMY,
  TRADE_ORG_HQ,
  buildProblem,
  freeHousing,
  hasFoodSurplus,
  inCityArea,
  townHallOf,
  tradeOrgHq,
  tradeOrgArmyWanted,
  wrap,
  wrapDelta,
  type Building,
  type City,
  type Resident,
  type TerrainMap,
  type WorldState,
  middleOf,
  cityAreaTiles,
  footprintTiles,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { Project } from './npc-growth.js'
import { Ground } from './placing.js'
import { angleApart, angleOf, gateAngles, gatesOf, roundRing, within } from './trade-org.js'

/*
 * How the Trade Org HQ grows (`CONTEXT.md`: Trade Org HQ): while it is too weak against the
 * strongest Organization and has too few adults to arm, it grows like an NPC city (`cityGrowth`:
 * pairing and houses), its houses between its rings; with no room left for a house it puts up
 * another round ring of wall `TRADE_ORG_HQ.ringStep` further out, its gates in line with the
 * others, and keeps the old ones. All through the orders a Player's residents take (ADR 0002).
 */

/** The radius of the HQ's `k`th outer ring; the one it starts with is ring 0. */
export const hqRingRadius = (k: number) => TRADE_ORG_HQ.outerRadius + k * TRADE_ORG_HQ.ringStep

/** A tile of one of the HQ's outer rings, and what stands there. */
interface RingTile {
  kind: 'wall' | 'gate'
  x: number
  y: number
}

/**
 * The tiles of the HQ's `k`th outer ring round the middle of its town hall, on a map of `size`
 * tiles: its gates first, evenly round it like the others' (`gatesOf`), then outward from them.
 */
export function hqRingTiles(hall: Building, k: number, size: number): RingTile[] {
  const c = middleOf(hall, size)
  const ring = roundRing(c.x, c.y, hqRingRadius(k))
  const gates = gatesOf(c.x, c.y, ring)
  const toGate = ([x, y]: [number, number]) =>
    Math.min(...gates.map(([gx, gy]) => Math.hypot(x - gx, y - gy)))
  return ring
    .sort((p, q) => toGate(p) - toGate(q))
    .map(([x, y]) => ({
      kind: toGate([x, y]) === 0 ? 'gate' : 'wall',
      x: wrap(x, size),
      y: wrap(y, size),
    }))
}

/**
 * The buildings and construction sites by the "x,y" tiles they cover, as `buildingAt` finds them:
 * looking each ring tile up among all the buildings is too slow for rings of hundreds of tiles.
 */
function buildingsByTile(world: WorldState): Map<string, Building> {
  const out = new Map<string, Building>()
  for (const b of world.buildings) {
    if (SHARES_A_TILE.includes(b.kind)) continue
    for (const [x, y] of footprintTiles(b)) {
      const key = `${x},${y}`
      if (!out.has(key)) out.set(key, b)
    }
  }
  return out
}

/** The wall or gate on a tile, finished or begun, if one stands there (`buildingsByTile`). */
function wallAt(byTile: Map<string, Building>, t: { x: number; y: number }): Building | undefined {
  const b = byTile.get(`${t.x},${t.y}`)
  return b && (b.kind === 'wall' || b.kind === 'gate') ? b : undefined
}

/** The HQ's outer rings: the farthest that stands, and the one it is putting up beyond it. */
export interface HqRings {
  outermost: number
  building: number | undefined
}

/**
 * The HQ's outer rings (`HqRings`) round its town hall: the farthest ring with a wall or gate on
 * it, begun or finished, is the one it is putting up until every tile of it that can take one has
 * a finished wall or gate.
 */
export function hqRings(
  world: WorldState,
  hall: Building,
  terrain: TerrainMap,
  byTile = buildingsByTile(world),
): HqRings {
  let k = 0
  while (hqRingTiles(hall, k + 1, terrain.size).some((t) => wallAt(byTile, t))) k++
  if (k === 0) return { outermost: 0, building: undefined }
  const done = hqRingTiles(hall, k, terrain.size).every((t) => {
    const b = wallAt(byTile, t)
    return b ? !b.site : buildProblem(world, t.x, t.y, t.kind, terrain) !== undefined
  })
  return done ? { outermost: k, building: undefined } : { outermost: k - 1, building: k }
}

/**
 * Whether the HQ grows (`CONTEXT.md`: Trade Org HQ): it wants more soldiers
 * (`tradeOrgArmyWanted`) than it can arm from its `adults` while keeping its workers.
 */
export function hqGrows(world: WorldState, adults: Resident[]): boolean {
  return adults.length - TRADE_ORG_ARMY.workers < tradeOrgArmyWanted(world)
}

/**
 * Where the HQ puts its next house, by the north-west tile of its footprint: wholly in its area
 * between its inner ring and its outermost ring, off its rings and clear of the straight ways in
 * from its gates (as in `hqLayout`), nearest the town hall first.
 */
export function hqHouseTile(
  world: WorldState,
  hall: Building,
  terrain: TerrainMap,
  outermost: number,
): { x: number; y: number } | undefined {
  const size = terrain.size
  const c = middleOf(hall, size)
  const radius = hqRingRadius(outermost)
  const rings = new Set<string>()
  for (let k = 0; k <= outermost; k++) {
    for (const t of hqRingTiles(hall, k, size)) rings.add(`${t.x},${t.y}`)
  }
  const hq = world.cities.find((city) => city.id === hall.cityId)
  const area = hq ? cityAreaTiles(world, hq, size) : new Set<string>()
  const ground = new Ground(world, terrain)
  const gates = gateAngles(TRADE_ORG_HQ.gates)
  const fine = (x: number, y: number) => {
    const dx = wrapDelta(c.x, x, size)
    const dy = wrapDelta(c.y, y, size)
    if (!within(dx, dy, radius) || within(dx, dy, TRADE_ORG_HQ.innerRadius)) return false
    const clear = Math.asin(Math.min(1, 1.5 / Math.hypot(dx, dy)))
    const angle = angleOf(0, 0, [dx, dy])
    if (gates.some((a) => angleApart(angle, a) <= clear)) return false
    return !rings.has(`${x},${y}`) && area.has(`${x},${y}`)
  }
  const free: { x: number; y: number; d: number }[] = []
  const r = Math.ceil(radius)
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = wrap(c.x + dx, size)
      const y = wrap(c.y + dy, size)
      if (ground.fits('house', x, y, fine)) free.push({ x, y, d: Math.hypot(dx, dy) })
    }
  }
  free.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
  return free[0] && { x: free[0].x, y: free[0].y }
}

/**
 * What the HQ builds next, if anything (`CONTEXT.md`: Trade Org HQ): a house or a tile of its new
 * ring it has begun; else a house when it has a food surplus and no free housing (`hqHouseTile`),
 * or with no room left for one, the next tile of a new ring; else the next tile of the ring it is
 * putting up.
 */
export function hqProject(
  world: WorldState,
  hq: City,
  terrain: TerrainMap,
): Extract<Project, { kind: 'build' }> | undefined {
  const hall = townHallOf(world, hq)
  if (!hall) return undefined
  const size = terrain.size
  const byTile = buildingsByTile(world)
  const rings = hqRings(world, hall, terrain, byTile)
  const ring = hqRingTiles(hall, rings.building ?? rings.outermost + 1, size)
  const build = (b: { kind: Building['kind']; x: number; y: number }) => ({
    kind: 'build' as const,
    building: b.kind,
    x: b.x,
    y: b.y,
  })
  const begun =
    world.buildings.find(
      (b) => b.site && b.kind === 'house' && inCityArea(world, hq, b.x, b.y, size),
    ) ?? ring.flatMap((t) => wallAt(byTile, t) ?? []).find((b) => b.site)
  if (begun) return build(begun)
  const nextOfRing = ring.find(
    (t) => !wallAt(byTile, t) && !buildProblem(world, t.x, t.y, t.kind, terrain),
  )
  if (hasFoodSurplus(world, hq) && freeHousing(world, hq) <= 0) {
    const house = hqHouseTile(world, hall, terrain, rings.outermost)
    if (house) return build({ kind: 'house', ...house })
    if (nextOfRing) return build(nextOfRing)
  }
  return rings.building !== undefined && nextOfRing ? build(nextOfRing) : undefined
}

/**
 * The HQ's rings hold together (`CONTEXT.md`: Trade Org HQ; ADR 0004): each of its walls and
 * gates stands on its inner ring or one of its outer rings, and each of its houses between its
 * inner ring and its farthest ring.
 */
export const hqRingsSound: Invariant = {
  name: 'hq-rings-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const hq = tradeOrgHq(world)
    const hall = hq && townHallOf(world, hq)
    if (!hq || !hall) return out
    const fail = (message: string, b: Building) =>
      out.push({ invariant: this.name, message, entityIds: [b.id] })
    const size = terrain.size
    const rings = hqRings(world, hall, terrain)
    const top = rings.building ?? rings.outermost
    const c = middleOf(hall, size)
    const onRing = new Set(
      roundRing(c.x, c.y, TRADE_ORG_HQ.innerRadius).map(
        ([x, y]) => `${wrap(x, size)},${wrap(y, size)}`,
      ),
    )
    for (let k = 0; k <= top; k++) {
      for (const t of hqRingTiles(hall, k, size)) onRing.add(`${t.x},${t.y}`)
    }
    for (const b of world.buildings) {
      if (b.cityId !== hq.id) continue
      if ((b.kind === 'wall' || b.kind === 'gate') && !onRing.has(`${b.x},${b.y}`)) {
        fail(`${b.kind} ${b.id} of the Trade Org HQ stands on none of its rings`, b)
      }
      if (b.kind !== 'house') continue
      const out = footprintTiles(b, size).some(([x, y]) => {
        const d = Math.hypot(wrapDelta(c.x, x, size), wrapDelta(c.y, y, size))
        return d <= TRADE_ORG_HQ.innerRadius + 0.5 || d > hqRingRadius(top) + 0.5
      })
      if (out) {
        fail(`house ${b.id} of the Trade Org HQ stands outside its rings`, b)
      }
    }
    return out
  },
}
