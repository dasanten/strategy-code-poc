import {
  TERRITORY_CITY_BASE,
  TERRITORY_MAX_REACH,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TERRITORY_REACH_PER_ROOT,
  TERRITORY_WORKPLACE_BASE,
  isArmed,
} from './balance.js'
import { MAX_WORKERS, workersOf } from './building.js'
import { inCityArea, isCityBuilding } from './city.js'
import { footprintTiles, nearFootprint } from './footprint.js'
import { wrap, wrapDelta } from './terrain.js'
import type { City, WorldState } from './world.js'

/** World queries about territory (ADR 0002: the game API orders and scripts share). */

/**
 * Something that projects control (`CONTEXT.md`: Territory): a city, or a guarded workplace for
 * one of its holders. `owner` is the Organization it projects for: a realm's id, or the city's own
 * id for a city that belongs to no realm. Control reaches out from each of `tiles`.
 */
export interface ControlSource {
  /** The city's or workplace's id. */
  id: string
  owner: string
  strength: number
  /** How far the control reaches, in tiles (`controlReach`). */
  reach: number
  tiles: { x: number; y: number }[]
}

/**
 * The area Organizations control (`CONTEXT.md`: Territory), as worked out at `tick`. Derived,
 * never stored in the world: `owners` maps "x,y" tile keys to the Organization holding the tile.
 * A tile nobody controls, or where the strongest are tied, is missing.
 */
export interface Territory {
  tick: number
  owners: Map<string, string>
}

/** The Trade Organization's id as an Organization (`CONTEXT.md`: Trade Organization). */
export const TRADE_ORGANIZATION = 'tradeOrg'

/**
 * The Organization a city projects control for: the Trade Organization for its cities, else its
 * realm, or itself when it has none.
 */
export function cityOrganization(city: City): string {
  return city.tradeOrg ? TRADE_ORGANIZATION : (city.realmId ?? city.id)
}

/** How far control of the given strength reaches, in tiles. */
export function controlReach(strength: number): number {
  return Math.min(TERRITORY_MAX_REACH, Math.floor(TERRITORY_REACH_PER_ROOT * Math.sqrt(strength)))
}

/**
 * The control a source projects onto a tile `d` tiles (straight line) from it: its full strength
 * on its own tiles, fading to nothing just past its reach.
 */
export function controlAt(source: Pick<ControlSource, 'strength' | 'reach'>, d: number): number {
  if (d > source.reach) return 0
  return source.strength * (1 - d / (source.reach + 1))
}

function source(id: string, owner: string, strength: number, tiles: ControlSource['tiles']) {
  return { id, owner, strength, reach: controlReach(strength), tiles }
}

/**
 * Everything projecting control (`CONTEXT.md`: Territory). A city projects from its finished city
 * buildings, by size (its residents) and garrison (its armed residents standing in its area). A
 * finished workplace projects for each holder guarding it: an armed resident of the holder stands
 * on it or next to it. Its strength counts the holder's workers there and those guards. `size` is
 * the map's.
 */
export function controlSources(world: WorldState, size: number): ControlSource[] {
  const out: ControlSource[] = []
  for (const city of world.cities) {
    const tiles = world.buildings
      .filter((b) => b.cityId === city.id && isCityBuilding(b))
      .flatMap((b) => footprintTiles(b, size).map(([x, y]) => ({ x, y })))
    if (tiles.length === 0) continue
    let strength = TERRITORY_CITY_BASE
    for (const r of world.residents) {
      if (r.cityId !== city.id) continue
      strength += TERRITORY_PER_RESIDENT
      if (isArmed(r) && inCityArea(world, city, r.x, r.y, size)) strength += TERRITORY_PER_ARMED
    }
    out.push(source(city.id, cityOrganization(city), strength, tiles))
  }
  for (const b of world.buildings) {
    if (MAX_WORKERS[b.kind] === undefined || b.site) continue
    const guards = new Map<string, number>()
    for (const r of world.residents) {
      if (r.owner === null || !isArmed(r)) continue
      if (!nearFootprint(b, r, 1, size)) continue
      guards.set(r.owner, (guards.get(r.owner) ?? 0) + 1)
    }
    if (guards.size === 0) continue
    const workers = new Map<string, number>()
    for (const r of workersOf(world, b)) {
      if (r.owner !== null) workers.set(r.owner, (workers.get(r.owner) ?? 0) + 1)
    }
    // Only holders (realms working it) can guard it; a passing soldier of another realm doesn't.
    for (const [owner, n] of [...workers].sort(([a], [b]) => a.localeCompare(b))) {
      const g = guards.get(owner) ?? 0
      if (g === 0) continue
      const strength =
        TERRITORY_WORKPLACE_BASE + n * TERRITORY_PER_RESIDENT + g * TERRITORY_PER_ARMED
      out.push(
        source(
          b.id,
          owner,
          strength,
          footprintTiles(b, size).map(([x, y]) => ({ x, y })),
        ),
      )
    }
  }
  return out
}

/**
 * Works out territory (`CONTEXT.md`: Territory): each tile goes to the Organization projecting
 * the most control onto it (an Organization's control there is that of its strongest source). A
 * tie between Organizations leaves the tile to nobody. `size` is the map's.
 */
export function computeTerritory(world: WorldState, size: number): Territory {
  const best = new Map<string, { owner: string | null; control: number }>()
  for (const s of controlSources(world, size)) {
    // A source with several tiles projects from the nearest of them.
    const reached = new Map<string, number>()
    for (const [key, d] of nearestWithin(s.tiles, s.reach, size)) {
      const c = controlAt(s, d)
      if (c > 0) reached.set(key, c)
    }
    for (const [key, c] of reached) {
      const here = best.get(key)
      if (!here || c > here.control) best.set(key, { owner: s.owner, control: c })
      else if (c === here.control && here.owner !== s.owner) here.owner = null
    }
  }
  const owners = new Map<string, string>()
  for (const [key, { owner }] of best) if (owner !== null) owners.set(key, owner)
  return { tick: world.tick, owners }
}

/**
 * Every tile within `reach` of the nearest of `tiles` (straight line, the short way round), with
 * that distance, by "x,y" key: an exact distance transform over the box round the tiles, so a
 * source of many tiles costs about its box rather than its tiles times its reach.
 */
function nearestWithin(
  tiles: readonly { x: number; y: number }[],
  reach: number,
  size: number,
): Map<string, number> {
  const out = new Map<string, number>()
  if (tiles.length === 0) return out
  // Tiles as steps from the first, the short way round, and the box round them plus the reach.
  const first = tiles[0]!
  const at = tiles.map((t) => [wrapDelta(first.x, t.x, size), wrapDelta(first.y, t.y, size)])
  const x0 = Math.min(...at.map(([x]) => x!)) - reach
  const y0 = Math.min(...at.map(([, y]) => y!)) - reach
  const w = Math.min(size, Math.max(...at.map(([x]) => x!)) + reach - x0 + 1)
  const h = Math.min(size, Math.max(...at.map(([, y]) => y!)) + reach - y0 + 1)
  const far = (w + h) ** 2
  const grid = new Float64Array(w * h).fill(far)
  for (const [x, y] of at) {
    const gx = x! - x0
    const gy = y! - y0
    if (gx >= 0 && gy >= 0 && gx < w && gy < h) grid[gy * w + gx] = 0
  }
  // Squared distances along each column, then along each row (Felzenszwalb and Huttenlocher).
  const column = new Float64Array(Math.max(w, h))
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) column[y] = grid[y * w + x]!
    const d = transform1d(column, h)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]!
  }
  for (let y = 0; y < h; y++) {
    const d = transform1d(grid.subarray(y * w, (y + 1) * w), w)
    for (let x = 0; x < w; x++) {
      const dist = Math.sqrt(d[x]!)
      if (dist <= reach)
        out.set(`${wrap(first.x + x0 + x, size)},${wrap(first.y + y0 + y, size)}`, dist)
    }
  }
  return out
}

/** The 1D squared distance transform of the first `n` values of `f` (0 where a source is). */
function transform1d(f: ArrayLike<number>, n: number): Float64Array {
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    while (s <= z[k]!) {
      k--
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++
    d[q] = (q - v[k]!) ** 2 + f[v[k]!]!
  }
  return d
}

/** The Organization holding a tile, if any. */
export function territoryOwner(territory: Territory, x: number, y: number): string | undefined {
  return territory.owners.get(`${x},${y}`)
}
