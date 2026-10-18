import { BUILD_MATERIALS, BUILD_WORK, FARM_MAX_WORKERS } from './balance.js'
import {
  NODE_WORKPLACE,
  isWallTile,
  type Building,
  type BuildingKind,
  type Good,
  type Resident,
  type Stock,
  type WorldState,
} from './world.js'

/** World queries about buildings and construction sites (ADR 0002: the game API orders and scripts share). */

/** Kinds of building that can be built so far: the workplaces on resource nodes. */
export const BUILDABLE: readonly BuildingKind[] = ['lumberCamp', 'quarry', 'mine']

/** The building or construction site on a tile, if there is one (one per tile). */
export function buildingAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.x === x && b.y === y)
}

/** Materials a construction site still needs before it can become the building. */
export function materialsNeeded(site: Building): Stock {
  const out: Stock = {}
  for (const [good, units] of Object.entries(BUILD_MATERIALS[site.kind] ?? {}) as [
    Good,
    number,
  ][]) {
    const left = units - (site.site?.delivered[good] ?? 0)
    if (left > 0) out[good] = left
  }
  return out
}

/** Work a construction site still needs. */
export function workNeeded(site: Building): number {
  return Math.max(0, (BUILD_WORK[site.kind] ?? 0) - (site.site?.work ?? 0))
}

/**
 * Why a building of this kind can't be laid out on the tile (`CONTEXT.md`: Where buildings go),
 * or undefined if it can: workplaces go on a resource node of their kind, one building per tile,
 * never on a city wall.
 */
export function buildProblem(
  world: WorldState,
  x: number,
  y: number,
  kind: BuildingKind,
): string | undefined {
  if (!BUILDABLE.includes(kind)) return `a ${kind} can't be built yet`
  const node = world.nodes.find((n) => n.x === x && n.y === y)
  if (!node || NODE_WORKPLACE[node.kind] !== kind)
    return `a ${kind} goes on a fitting resource node`
  if (buildingAt(world, x, y)) return 'there is already a building on this tile'
  if (world.cities.some((c) => isWallTile(c, x, y))) return 'nothing can be built on a wall'
  return undefined
}

/** Most workers each kind of workplace takes, for the kinds residents can work so far. */
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = { farm: FARM_MAX_WORKERS }

/** The residents working a workplace: holding a work-at order for it and standing on it. */
export function workersOf(world: WorldState, workplace: Building): Resident[] {
  return world.residents.filter(
    (r) =>
      r.order?.kind === 'workAt' &&
      r.order.buildingId === workplace.id &&
      r.x === workplace.x &&
      r.y === workplace.y,
  )
}

/**
 * Why a resident can't start working the building on their tile, or undefined if they can: it
 * has to be a finished workplace residents can work, with room for one more worker.
 */
export function workProblem(world: WorldState, resident: Resident): string | undefined {
  const here = buildingAt(world, resident.x, resident.y)
  const max = here && MAX_WORKERS[here.kind]
  if (!here || max === undefined) return 'there is no workplace to work here'
  if (here.site) return 'it is still a construction site'
  if (resident.order?.kind === 'workAt' && resident.order.buildingId === here.id) {
    return 'already working here'
  }
  if (workersOf(world, here).length >= max) return `it already has ${max} workers`
  return undefined
}
