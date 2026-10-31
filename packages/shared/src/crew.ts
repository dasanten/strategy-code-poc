import { MAP_SIZE } from './balance.js'
import { covers, footprintTiles } from './footprint.js'
import { wrapDistance } from './terrain.js'
import type { Building, Resident, WorldState } from './world.js'

/**
 * Where a resident stands at a building they are sent to work, build or breed at (`CONTEXT.md`:
 * Spreading over the footprint): the footprint tile with the fewest of the crew on it, the
 * nearest to them on ties. So one already on the footprint stays put while their tile is among
 * the fewest, and six sent to a 2x2 workplace stand two to a tile at most.
 *
 * The crew are the residents `ofCrew` picks out (a realm's own), other than `me`: those holding
 * a work-at, build or breed order at the building, counted on the tile they stand on, and those
 * on their way there, counted on the tile they walk to, which their running script keeps as
 * `memory.at` (the Work, Build and Breed horses defaults). Counting those on their way lets a
 * crew sent together spread out, each picking after the one before, instead of all picking the
 * same empty tile. Which tile they stand on changes nothing else.
 */
export function crewTile(
  world: Pick<WorldState, 'residents'>,
  building: Building,
  me: { id: string; x: number; y: number },
  ofCrew: (r: Resident) => boolean,
  size = MAP_SIZE,
): { x: number; y: number } {
  const tiles = footprintTiles(building, size)
  const counts = new Map<string, number>(tiles.map(([x, y]) => [`${x},${y}`, 0]))
  for (const r of world.residents) {
    if (r.id === me.id || !ofCrew(r)) continue
    const at = standsAt(r, building, size)
    if (!at) continue
    const key = `${at.x},${at.y}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = { x: tiles[0]![0], y: tiles[0]![1] }
  let bestCount = Infinity
  let bestDistance = Infinity
  for (const [x, y] of tiles) {
    const count = counts.get(`${x},${y}`)!
    const distance = wrapDistance(size, me, { x, y })
    if (count < bestCount || (count === bestCount && distance < bestDistance)) {
      best = { x, y }
      bestCount = count
      bestDistance = distance
    }
  }
  return best
}

/**
 * The footprint tile a resident counts on as one of a building's crew (`crewTile`): where their
 * script sends them, if on the footprint, else where they stand holding an order at the building;
 * undefined for one not of its crew.
 */
function standsAt(
  r: Resident,
  building: Building,
  size: number,
): { x: number; y: number } | undefined {
  const at = r.script?.memory.at
  if (
    typeof at === 'object' &&
    at !== null &&
    !Array.isArray(at) &&
    typeof at.x === 'number' &&
    typeof at.y === 'number' &&
    covers(building, at.x, at.y, size)
  ) {
    return { x: at.x, y: at.y }
  }
  const o = r.order
  const there =
    (o?.kind === 'workAt' && o.buildingId === building.id) ||
    (o?.kind === 'build' && o.siteId === building.id) ||
    (o?.kind === 'breed' && o.stableId === building.id)
  return there && covers(building, r.x, r.y, size) ? { x: r.x, y: r.y } : undefined
}
