import {
  BUILD_MATERIALS,
  BUILD_WORK,
  RECIPES,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  WORKPLACE_MAX_WORKERS,
  type Recipe,
} from './balance.js'
import {
  NODE_WORKPLACE,
  type Building,
  type BuildingKind,
  type Good,
  type Resident,
  type ResourceKind,
  type Stock,
  type WorldState,
} from './world.js'
import { Terrain, isPassableTerrain, terrainAt, tileIndex, type TerrainMap } from './terrain.js'

/** World queries about buildings and construction sites (ADR 0002: the game API orders and scripts share). */

/**
 * Kinds of building that can be built so far: the workplaces on resource nodes, stables, smelters,
 * mints and smithies, town halls, walls and gates (`CONTEXT.md`: Town hall, Wall / Gate), and
 * roads (`CONTEXT.md`: Road).
 */
export const BUILDABLE: readonly BuildingKind[] = [
  'lumberCamp',
  'quarry',
  'mine',
  'stable',
  'smelter',
  'mint',
  'smithy',
  'townHall',
  'wall',
  'gate',
  'road',
]

/** Workplaces that turn goods into other goods (`RECIPES`): smelters, mints and smithies. */
export const PROCESSING = Object.keys(RECIPES) as readonly BuildingKind[]

/** The good a recipe makes. */
export function recipeGood(recipe: Recipe): Good {
  return (Object.keys(recipe.output) as Good[])[0]!
}

/**
 * The recipe a worker follows at a workplace that processes goods (`RECIPES`): the one that makes
 * `makes`, or with no `makes` the workplace's only recipe. Undefined for a workplace that
 * processes nothing, a good it can't make, or a smithy with no `makes` (it has more than one).
 */
export function recipeFor(kind: BuildingKind, makes?: Good): Recipe | undefined {
  const recipes = RECIPES[kind] ?? []
  if (makes === undefined) return recipes.length === 1 ? recipes[0] : undefined
  return recipes.find((r) => recipeGood(r) === makes)
}

/** Whether a workplace has more than one recipe, so its workers say what they make (a smithy). */
export function hasChoice(kind: BuildingKind): boolean {
  return (RECIPES[kind]?.length ?? 0) > 1
}
/**
 * Buildable kinds that go on any passable terrain but Mountain, off any resource node
 * (`CONTEXT.md`: Where buildings go).
 */
export const OFF_NODES: readonly BuildingKind[] = [...PROCESSING, 'townHall', 'wall', 'gate']

/** Kinds of building that keep goods in a storage of their own: storages, and stables' Food. */
export const KEEPS_GOODS: readonly BuildingKind[] = ['storage', 'stable']

/**
 * The building or construction site on a tile, if there is one (one per tile). A road is not one
 * of them: it may share the tile with a building (`roadAt`).
 */
export function buildingAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.x === x && b.y === y && b.kind !== 'road')
}

/** The road or road construction site on a tile, if there is one (`CONTEXT.md`: Road). */
export function roadAt(world: WorldState, x: number, y: number): Building | undefined {
  return world.buildings.find((b) => b.x === x && b.y === y && b.kind === 'road')
}

/** What of `kind` stands on a tile, finished or not: its road for a road, else its building. */
export function constructionAt(
  world: WorldState,
  x: number,
  y: number,
  kind: BuildingKind,
): Building | undefined {
  return kind === 'road' ? roadAt(world, x, y) : buildingAt(world, x, y)
}

/**
 * The tiles with a finished road, as tile indices on a map `size` across, for `groundAt`. Road
 * construction sites don't count: nobody moves faster on them yet.
 */
export function roadTiles(world: Pick<WorldState, 'buildings'>, size: number): Set<number> {
  const out = new Set<number>()
  for (const b of world.buildings) {
    if (b.kind === 'road' && !b.site) out.add(tileIndex(size, b.x, b.y))
  }
  return out
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
 * any node, smelters, mints, smithies, town halls, walls and gates off any node and off Mountain,
 * one building per tile. A road goes on any passable land but Mountain, node or not, and next to
 * a building on its tile, but one road per tile (`CONTEXT.md`: Road). Without `terrain` the
 * terrain rules are not checked.
 */
export function buildProblem(
  world: WorldState,
  x: number,
  y: number,
  kind: BuildingKind,
  terrain?: TerrainMap,
): string | undefined {
  if (!BUILDABLE.includes(kind)) return `a ${kind} can't be built yet`
  if (kind === 'road') {
    const t = terrain && terrainAt(terrain, x, y)
    if (t !== undefined && (!isPassableTerrain(t) || t === Terrain.Mountain))
      return 'a road goes on passable land, not on Mountain'
    if (roadAt(world, x, y)) return 'there is already a road on this tile'
    return undefined
  }
  const node = world.nodes.find((n) => n.x === x && n.y === y)
  if (kind === 'stable') {
    if (node || (terrain && terrainAt(terrain, x, y) !== Terrain.Plains))
      return 'a stable goes on Plains, off any resource node'
  } else if (OFF_NODES.includes(kind)) {
    if (node || (terrain && terrainAt(terrain, x, y) === Terrain.Mountain))
      return `a ${kind} goes off any resource node, and not on Mountain`
  } else if (!node || NODE_WORKPLACE[node.kind] !== kind)
    return `a ${kind} goes on a fitting resource node`
  if (buildingAt(world, x, y)) return 'there is already a building on this tile'
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
 * mint, what its recipe makes (Iron, Coins); at a smithy, the weapon or armour `makes` names
 * (`recipeFor`), and nothing without it.
 */
export function workplaceGood(
  world: WorldState,
  workplace: Building,
  makes?: Good,
): Good | undefined {
  if (workplace.kind === 'farm') return 'food'
  if (MAX_WORKERS[workplace.kind] === undefined) return undefined
  if (RECIPES[workplace.kind]) {
    const recipe = recipeFor(workplace.kind, makes)
    return recipe && recipeGood(recipe)
  }
  const node = world.nodes.find((n) => n.x === workplace.x && n.y === workplace.y)
  return node ? NODE_GOOD[node.kind] : undefined
}

/**
 * The goods a workplace that processes goods can use up for its next batches (`CONTEXT.md`:
 * Smelter, Smithy): the input of any of its recipes that its workers carry and that lies in the
 * pile on its tile.
 */
export function inputAt(world: WorldState, workplace: Building): Stock {
  const out: Stock = {}
  const pile = world.piles.find((p) => p.x === workplace.x && p.y === workplace.y)
  const goods = new Set((RECIPES[workplace.kind] ?? []).flatMap((r) => Object.keys(r.input)))
  for (const good of goods as Set<Good>) {
    const carried = workersOf(world, workplace).reduce((n, w) => n + (w.carried[good] ?? 0), 0)
    const units = carried + (pile?.goods[good] ?? 0)
    if (units > 0) out[good] = units
  }
  return out
}

/** Whether a workplace has the input for one more batch of `recipe` (`inputAt`). */
export function hasInput(world: WorldState, workplace: Building, recipe: Recipe): boolean {
  const at = inputAt(world, workplace)
  return (Object.entries(recipe.input) as [Good, number][]).every(([g, n]) => (at[g] ?? 0) >= n)
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
 * has to be a finished workplace residents can work, with room for one more worker. At a smithy
 * `makes` names one of its recipes' goods (`recipeFor`); elsewhere it is left out. A worker there
 * can switch to making something else.
 */
export function workProblem(
  world: WorldState,
  resident: Resident,
  makes?: Good,
): string | undefined {
  const here = buildingAt(world, resident.x, resident.y)
  const max = here && MAX_WORKERS[here.kind]
  if (!here || max === undefined) return 'there is no workplace to work here'
  if (hasChoice(here.kind)) {
    if (makes === undefined) return `say what to make at the ${here.kind}`
    if (!recipeFor(here.kind, makes)) return `a ${here.kind} can't make ${makes}`
  } else if (makes !== undefined) return `nothing to choose at a ${here.kind}`
  if (!workplaceGood(world, here, makes)) return 'there is no workplace to work here'
  if (here.site) return 'it is still a construction site'
  const o = resident.order
  if (o?.kind === 'workAt' && o.buildingId === here.id) {
    if (o.makes === makes) return 'already working here'
    return undefined
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
 * So far only what can be built can be torn down, and its sites.
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
