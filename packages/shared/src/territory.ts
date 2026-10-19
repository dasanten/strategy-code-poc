import {
  TERRITORY_CITY_BASE,
  TERRITORY_MAX_REACH,
  TERRITORY_PER_ARMED,
  TERRITORY_PER_RESIDENT,
  TERRITORY_REACH_PER_ROOT,
  TERRITORY_WORKPLACE_BASE,
} from './balance.js'
import { MAX_WORKERS, workersOf } from './building.js'
import { inCityArea, isCityBuilding } from './city.js'
import { wrap, wrapDelta } from './terrain.js'
import { isArmed, type City, type WorldState } from './world.js'

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

/** The Organization a city projects control for: its realm, or itself when it has none. */
export function cityOrganization(city: City): string {
  return city.realmId ?? city.id
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
    const tiles = world.buildings.filter((b) => b.cityId === city.id && isCityBuilding(b))
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
      if (Math.abs(wrapDelta(b.x, r.x, size)) > 1 || Math.abs(wrapDelta(b.y, r.y, size)) > 1)
        continue
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
      out.push(source(b.id, owner, strength, [{ x: b.x, y: b.y }]))
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
    for (const t of s.tiles) {
      for (let dy = -s.reach; dy <= s.reach; dy++) {
        for (let dx = -s.reach; dx <= s.reach; dx++) {
          const c = controlAt(s, Math.hypot(dx, dy))
          if (c <= 0) continue
          const key = `${wrap(t.x + dx, size)},${wrap(t.y + dy, size)}`
          if (c > (reached.get(key) ?? 0)) reached.set(key, c)
        }
      }
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

/** The Organization holding a tile, if any. */
export function territoryOwner(territory: Territory, x: number, y: number): string | undefined {
  return territory.owners.get(`${x},${y}`)
}
