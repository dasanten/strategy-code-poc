import type { Building, City } from '@csp/shared-types'
import { cityAreaTiles } from '../shared/city.js'
import { footprintKeys } from '../shared/footprint.js'
import { wrapDelta } from '../shared/terrain.js'

/**
 * What the map draws buildings and city areas from, worked out once for each list of buildings
 * rather than every frame. The lists in sight change at most once a tick, and Last seen only when
 * what the Player remembers changes, so a frame costs what is on screen, not everything the Player
 * has ever seen.
 */
export interface Structures {
  /** Roads by tile, `x,y`. */
  roads: ReadonlyMap<string, Building>
  /** Tiles with a wall or a gate, `x,y`. */
  walls: ReadonlySet<string>
  /** Tiles under a footprint of anything but a road, `x,y`: a node there shows as the building. */
  built: ReadonlySet<string>
  /** Each city's area (`CONTEXT.md`: City area), by city id. */
  areas: ReadonlyMap<string, CityArea>
}

/** A city's area: its tiles, and a square around them to tell whether any is on screen. */
export interface CityArea {
  /** The tiles as x, y pairs. */
  tiles: Int32Array
  /** A tile of the area, and how many tiles from it, along either side, the area reaches. */
  x: number
  y: number
  reach: number
}

const cache = new WeakMap<readonly Building[], { size: number; structures: Structures }>()

/** The `Structures` of these buildings on a map `size` tiles across, kept while the list is. */
export function structuresOf(buildings: readonly Building[], size: number): Structures {
  const kept = cache.get(buildings)
  if (kept?.size === size) return kept.structures
  const structures = workOut(buildings, size)
  cache.set(buildings, { size, structures })
  return structures
}

function workOut(buildings: readonly Building[], size: number): Structures {
  const roads = new Map<string, Building>()
  const walls = new Set<string>()
  const built = new Set<string>()
  const byCity = new Map<string, Building[]>()
  for (const b of buildings) {
    if (b.kind === 'road') roads.set(`${b.x},${b.y}`, b)
    else for (const k of footprintKeys(b, size)) built.add(k)
    if (b.kind === 'wall' || b.kind === 'gate') walls.add(`${b.x},${b.y}`)
    if (b.cityId !== null) {
      const list = byCity.get(b.cityId) ?? []
      list.push(b)
      byCity.set(b.cityId, list)
    }
  }
  const areas = new Map<string, CityArea>()
  for (const [id, list] of byCity) {
    const keys = cityAreaTiles({ buildings: list }, { id } as City, size)
    if (keys.size === 0) continue
    const tiles = new Int32Array(keys.size * 2)
    let at = 0
    for (const key of keys) {
      const comma = key.indexOf(',')
      tiles[at++] = Number(key.slice(0, comma))
      tiles[at++] = Number(key.slice(comma + 1))
    }
    const [x, y] = [tiles[0]!, tiles[1]!]
    let reach = 0
    for (let i = 0; i < tiles.length; i += 2) {
      const d = Math.max(
        Math.abs(wrapDelta(x, tiles[i]!, size)),
        Math.abs(wrapDelta(y, tiles[i + 1]!, size)),
      )
      reach = Math.max(reach, d)
    }
    areas.set(id, { tiles, x, y, reach })
  }
  return { roads, walls, built, areas }
}
