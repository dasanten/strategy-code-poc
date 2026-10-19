import {
  BUILD_MATERIALS,
  BUILD_WORK,
  RECIPES,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  WORKPLACE_MAX_WORKERS,
} from './balance.js'
import {
  NODE_WORKPLACE,
  isWallTile,
  type Building,
  type BuildingKind,
  type Good,
  type Resident,
  type ResourceKind,
  type Stock,
  type WorldState,
} from './world.js'
import { Terrain, terrainAt, type TerrainMap } from './terrain.js'

/** World queries about buildings and construction sites (ADR 0002: the game API orders and scripts share). */

/**
 * Kinds of building that can be built so far: the workplaces on resource nodes, stables, smelters
 * and mints.
 */
export const BUILDABLE: readonly BuildingKind[] = [
  'lumberCamp',
  'quarry',
  'mine',
  'stable',
  'smelter',
  'mint',
]

/** Workplaces that turn one good into another (`RECIPES`): smelters and mints. */
export const PROCESSING = Object.keys(RECIPES) as readonly BuildingKind[]

/** Kinds of building that keep goods in a storage of their own: storages, and stables' Food. */
export const KEEPS_GOODS: readonly BuildingKind[] = ['storage', 'stable']

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
 * or undefined if it can: workplaces go on a resource node of their kind, stables on Plains off
 * any node, smelters and mints off any node and off Mountain, one building per tile, never on a
 * city wall. Without `terrain` the Plains and Mountain rules are not checked.
 */
export function buildProblem(
  world: WorldState,
  x: number,
  y: number,
  kind: BuildingKind,
  terrain?: TerrainMap,
): string | undefined {
  if (!BUILDABLE.includes(kind)) return `a ${kind} can't be built yet`
  const node = world.nodes.find((n) => n.x === x && n.y === y)
  if (kind === 'stable') {
    if (node || (terrain && terrainAt(terrain, x, y) !== Terrain.Plains))
      return 'a stable goes on Plains, off any resource node'
  } else if (PROCESSING.includes(kind)) {
    if (node || (terrain && terrainAt(terrain, x, y) === Terrain.Mountain))
      return `a ${kind} goes off any resource node, and not on Mountain`
  } else if (!node || NODE_WORKPLACE[node.kind] !== kind)
    return `a ${kind} goes on a fitting resource node`
  if (buildingAt(world, x, y)) return 'there is already a building on this tile'
  if (world.cities.some((c) => isWallTile(c, x, y))) return 'nothing can be built on a wall'
  return undefined
}

/** Most workers each kind of workplace takes, for the kinds residents can work so far. */
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = WORKPLACE_MAX_WORKERS

/** The good each kind of node yields once worked (`CONTEXT.md`: Resource node). */
export const NODE_GOOD: Record<ResourceKind, Good> = {
  forest: 'wood',
  stone: 'stone',
  ironOre: 'ironOre',
  goldOre: 'goldOre',
}

/**
 * The good a workplace makes (`CONTEXT.md`: Workplace): Food on a farm; on a resource node, what
 * the node yields, so a mine makes iron ore or gold ore by the node it stands on; at a smelter or
 * mint, what its recipe makes (Iron, Coins).
 */
export function workplaceGood(world: WorldState, workplace: Building): Good | undefined {
  if (workplace.kind === 'farm') return 'food'
  if (MAX_WORKERS[workplace.kind] === undefined) return undefined
  const recipe = RECIPES[workplace.kind]
  if (recipe) return (Object.keys(recipe.output) as Good[])[0]
  const node = world.nodes.find((n) => n.x === workplace.x && n.y === workplace.y)
  return node ? NODE_GOOD[node.kind] : undefined
}

/**
 * The goods a smelter or mint can use up for its next batch (`CONTEXT.md`: Smelter): the
 * recipe's input that its workers carry and that lies in the pile on its tile.
 */
export function inputAt(world: WorldState, workplace: Building): Stock {
  const out: Stock = {}
  const pile = world.piles.find((p) => p.x === workplace.x && p.y === workplace.y)
  for (const good of Object.keys(RECIPES[workplace.kind]?.input ?? {}) as Good[]) {
    const carried = workersOf(world, workplace).reduce((n, w) => n + (w.carried[good] ?? 0), 0)
    const units = carried + (pile?.goods[good] ?? 0)
    if (units > 0) out[good] = units
  }
  return out
}

/** Whether a smelter or mint has the input for one more batch (`inputAt`). */
export function hasInput(world: WorldState, workplace: Building): boolean {
  const at = inputAt(world, workplace)
  const input = RECIPES[workplace.kind]?.input ?? {}
  return (Object.entries(input) as [Good, number][]).every(([g, n]) => (at[g] ?? 0) >= n)
}

/** The residents working a workplace: holding a work-at order for it and standing on it. */
export function workersOf(world: Pick<WorldState, 'residents'>, workplace: Building): Resident[] {
  return world.residents.filter(
    (r) =>
      r.order?.kind === 'workAt' &&
      r.order.buildingId === workplace.id &&
      r.x === workplace.x &&
      r.y === workplace.y,
  )
}

/**
 * The realms holding a workplace (`CONTEXT.md`: Holding a workplace): those whose residents work
 * it, and so get its output. There is no ownership flag, and the city a farm was laid out for
 * doesn't count; nobody holds a workplace that nobody works.
 */
export function holdersOf(world: Pick<WorldState, 'residents'>, workplace: Building): string[] {
  const realms = workersOf(world, workplace).map((r) => r.owner)
  return [...new Set(realms.filter((id): id is string => id !== null))].sort()
}

/**
 * Why a resident can't start working the building on their tile, or undefined if they can: it
 * has to be a finished workplace residents can work, with room for one more worker.
 */
export function workProblem(world: WorldState, resident: Resident): string | undefined {
  const here = buildingAt(world, resident.x, resident.y)
  const max = here && MAX_WORKERS[here.kind]
  if (!here || max === undefined || !workplaceGood(world, here)) {
    return 'there is no workplace to work here'
  }
  if (here.site) return 'it is still a construction site'
  if (resident.order?.kind === 'workAt' && resident.order.buildingId === here.id) {
    return 'already working here'
  }
  if (workersOf(world, here).length >= max) return `it already has ${max} workers`
  return undefined
}

/**
 * Work it takes to tear down a building or construction site (`CONTEXT.md`: Tearing down):
 * `TEARDOWN_WORK_SHARE` of the building's work, or of the work put into the site so far.
 */
export function teardownWork(b: Building): number {
  const built = b.site ? b.site.work : (BUILD_WORK[b.kind] ?? 0)
  return built * TEARDOWN_WORK_SHARE
}

/** Work still needed to tear it down. */
export function teardownLeft(b: Building): number {
  return Math.max(0, teardownWork(b) - (b.teardown ?? 0))
}

/**
 * Goods left on the tile once it is torn down: all of a site's delivered materials, or
 * `TEARDOWN_MATERIALS_RETURNED` of a building's, in whole units. Never more than was built in.
 */
export function teardownReturns(b: Building): Stock {
  if (b.site) return { ...b.site.delivered }
  const out: Stock = {}
  for (const [good, units] of Object.entries(BUILD_MATERIALS[b.kind] ?? {}) as [Good, number][]) {
    const back = Math.floor(units * TEARDOWN_MATERIALS_RETURNED)
    if (back > 0) out[good] = back
  }
  return out
}

/**
 * Why the building or site can't be torn down by a resident on (x, y), or undefined if it can.
 * So far only what can be built can be torn down: workplaces and their sites.
 */
export function tearDownProblem(
  world: WorldState,
  x: number,
  y: number,
  buildingId: string,
): string | undefined {
  const b = world.buildings.find((c) => c.id === buildingId)
  if (!b || b.x !== x || b.y !== y) return 'that building is not on the resident’s tile'
  if (!BUILDABLE.includes(b.kind)) return `a ${b.kind} can’t be torn down yet`
  return undefined
}
