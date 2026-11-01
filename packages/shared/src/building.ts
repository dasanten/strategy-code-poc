import {
  BUILD_MATERIALS,
  MAP_SIZE,
  BUILD_WORK,
  MOUNTAIN_ROAD_WORK_FACTOR,
  RECIPES,
  TEARDOWN_MATERIALS_RETURNED,
  TEARDOWN_WORK_SHARE,
  TRAINING_GROUND_MAX_TRAINEES,
  WORKPLACE_MAX_WORKERS,
  buildWork,
  canWork,
  carriageCanEnter,
  type Recipe,
} from './balance.js'
import { citiesAt } from './city.js'
import { FOOTPRINT, covers, footprintTiles, isAt } from './footprint.js'
import {
  CARRYING_A_CHILD,
  NODE_WORKPLACE,
  type Building,
  type BuildingKind,
  type Good,
  type LineOrder,
  type Pile,
  type Resident,
  type ResidentOrder,
  type ResourceKind,
  type ResourceNode,
  type Stock,
  type WorldState,
  isTrainingSubject,
} from './world.js'
import {
  Terrain,
  isPassableTerrain,
  terrainAt,
  tileIndex,
  wrap,
  wrapDelta,
  type TerrainMap,
} from './terrain.js'

/** World queries about buildings and construction sites (ADR 0002: the game API orders and scripts share). */

/**
 * Kinds of building that can be built so far: the workplaces on resource nodes, stables, smelters,
 * mints and smithies, town halls, storages, walls and gates (`CONTEXT.md`: Town hall, Storage,
 * Wall / Gate), houses and farms (`CONTEXT.md`: House, Farm), training grounds (`CONTEXT.md`:
 * Training ground), roads (`CONTEXT.md`: Road), and carriages, whose site becomes a carriage
 * (`CONTEXT.md`: Carriage).
 */
export const BUILDABLE: readonly BuildingKind[] = [
  'lumberCamp',
  'quarry',
  'mine',
  'stable',
  'farm',
  'house',
  'smelter',
  'mint',
  'smithy',
  'townHall',
  'storage',
  'trainingGround',
  'wall',
  'gate',
  'road',
  'carriage',
]

/**
 * Kinds that share a tile with a building rather than taking it (`CONTEXT.md`: Road, Carriage):
 * roads and carriage sites, one of each per tile at most.
 */
export const SHARES_A_TILE: readonly BuildingKind[] = ['road', 'carriage']

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
 * (`CONTEXT.md`: Where buildings go): the processing workplaces, the city buildings and training
 * grounds (`CONTEXT.md`: Training ground).
 */
export const OFF_NODES: readonly BuildingKind[] = [
  ...PROCESSING,
  'townHall',
  'house',
  'storage',
  'wall',
  'gate',
  'trainingGround',
]

/** Buildable kinds that go on Plains, off any resource node: stables and farms. */
export const ON_PLAINS: readonly BuildingKind[] = ['stable', 'farm']

/**
 * Buildable kinds that go only in a city's area, every tile of their footprint: houses
 * (`CONTEXT.md`: House). A storage goes anywhere, outside a city as an outpost storage
 * (`CONTEXT.md`: Outpost storage).
 */
export const IN_CITY_AREA: readonly BuildingKind[] = ['house']

/**
 * What a build menu offers off any resource node, in its order: every buildable kind but the
 * nodes' workplaces and roads (which have their own), city buildings first.
 */
export const OFF_NODE_BUILDS: readonly BuildingKind[] = [
  ...OFF_NODES.filter((k) => !PROCESSING.includes(k)),
  ...ON_PLAINS,
  ...PROCESSING,
]

/**
 * What a build menu offers a resident on a tile: the workplace of the resource node there, or
 * with none every kind that goes off a node (`OFF_NODE_BUILDS`).
 */
export function buildMenu(node: Pick<ResourceNode, 'kind'> | undefined): BuildingKind[] {
  return node ? [NODE_WORKPLACE[node.kind]] : [...OFF_NODE_BUILDS]
}

/**
 * Kinds of building that keep goods in a storage of their own: storages, the Trade
 * Organization's warehouses (`CONTEXT.md`: Warehouse), and stables' Food.
 */
export const KEEPS_GOODS: readonly BuildingKind[] = ['storage', 'warehouse', 'stable']

/**
 * The building or construction site whose footprint covers a tile, if there is one (one per
 * tile). A road or carriage site is not one of them: it may share the tile with a building
 * (`roadAt`, `carriageSiteAt`).
 */
export function buildingAt(
  world: Pick<WorldState, 'buildings'>,
  x: number,
  y: number,
  size = MAP_SIZE,
): Building | undefined {
  // A plain loop, footprint first: scripts ask this for every pile they look at.
  for (const b of world.buildings) {
    if (covers(b, x, y, size) && !SHARES_A_TILE.includes(b.kind)) return b
  }
  return undefined
}

/**
 * Where goods lying on (x, y) are kept (`CONTEXT.md`: A building's pile): on a building's
 * footprint, its north-west tile, so goods anywhere on it are one pile; elsewhere the tile itself.
 */
export function pileTile(
  world: Pick<WorldState, 'buildings'>,
  x: number,
  y: number,
  size = MAP_SIZE,
): { x: number; y: number } {
  const b = buildingAt(world, x, y, size)
  return b ? { x: b.x, y: b.y } : { x, y }
}

/** A building's pile (`CONTEXT.md`: A building's pile), if goods lie on its footprint. */
export function buildingPile(world: Pick<WorldState, 'piles'>, b: Building): Pile | undefined {
  return world.piles.find((p) => p.x === b.x && p.y === b.y)
}

/** The road or road construction site on a tile, if there is one (`CONTEXT.md`: Road). */
export function roadAt(
  world: Pick<WorldState, 'buildings'>,
  x: number,
  y: number,
): Building | undefined {
  return world.buildings.find((b) => b.x === x && b.y === y && b.kind === 'road')
}

/** The carriage site on a tile, if there is one (`CONTEXT.md`: Carriage). */
export function carriageSiteAt(
  world: Pick<WorldState, 'buildings'>,
  x: number,
  y: number,
): Building | undefined {
  return world.buildings.find((b) => b.x === x && b.y === y && b.kind === 'carriage')
}

/**
 * What of `kind` stands on a tile, finished or not: its road for a road, its carriage site for a
 * carriage, else its building.
 */
export function constructionAt(
  world: WorldState,
  x: number,
  y: number,
  kind: BuildingKind,
): Building | undefined {
  if (kind === 'road') return roadAt(world, x, y)
  if (kind === 'carriage') return carriageSiteAt(world, x, y)
  return buildingAt(world, x, y)
}

/**
 * The finished stable a carriage site on (x, y) is built at (`CONTEXT.md`: Carriage): one whose
 * footprint covers the tile or lies right next to it, the one covering it first.
 */
export function stableFor(
  world: Pick<WorldState, 'buildings'>,
  x: number,
  y: number,
  size = MAP_SIZE,
): Building | undefined {
  const here = buildingAt(world, x, y, size)
  if (here?.kind === 'stable' && !here.site) return here
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const b = buildingAt(world, wrap(x + dx, size), wrap(y + dy, size), size)
      if (b?.kind === 'stable' && !b.site) return b
    }
  }
  return undefined
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

/**
 * Whether a carriage, or a rider, can go onto (x, y) (`CONTEXT.md`: Carriage, Riding): passable
 * land, Mountain only where a finished road is.
 */
export function carriageCanGoTo(
  world: Pick<WorldState, 'buildings'>,
  map: TerrainMap,
  x: number,
  y: number,
): boolean {
  const road = roadAt(world, x, y)
  return carriageCanEnter(road && !road.site ? Terrain.Road : terrainAt(map, x, y))
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

/**
 * How many times its `BUILD_WORK` a building of `kind` takes, with `under` the terrain beneath its
 * tile where known: `MOUNTAIN_ROAD_WORK_FACTOR` for a road on Mountain (`CONTEXT.md`: Road), 1
 * otherwise. A resident's work on it, building or tearing down, counts that much less
 * (`siteWorkOf`), so a site's work still runs up to `BUILD_WORK`.
 */
export function workFactor(kind: BuildingKind, under?: number): number {
  return kind === 'road' && under === Terrain.Mountain ? MOUNTAIN_ROAD_WORK_FACTOR : 1
}

/**
 * Work a building of `kind` takes in ticks of one unskilled resident of average Strength, with
 * `under` the terrain beneath it (`workFactor`): what a Player is shown.
 */
export function buildingWork(kind: BuildingKind, under?: number): number {
  return (BUILD_WORK[kind] ?? 0) * workFactor(kind, under)
}

/** How much `work` of a resident counts on a building of `kind` over `under` (`workFactor`). */
export function siteWorkOf(work: number, kind: BuildingKind, under?: number): number {
  return work / workFactor(kind, under)
}

/** Work a construction site still needs, out of its `BUILD_WORK` (`siteWorkOf`). */
export function workNeeded(site: Building): number {
  return Math.max(0, (BUILD_WORK[site.kind] ?? 0) - (site.site?.work ?? 0))
}

/**
 * The terrain of tiles as far as it is known, for checking where buildings go: the client knows
 * only its explored chunks and says `UNEXPLORED` for the rest, where no building goes.
 */
export interface TerrainLookup {
  size: number
  at: (x: number, y: number) => number
}

/** What `buildProblem` looks at: the buildings, the resource nodes, and the cities (`IN_CITY_AREA`). */
export type PlacingWorld = Pick<WorldState, 'buildings' | 'cities'> & {
  nodes: readonly Pick<ResourceNode, 'kind' | 'x' | 'y'>[]
}

function lookupOf(terrain: TerrainMap | TerrainLookup): (x: number, y: number) => Terrain {
  return 'tiles' in terrain
    ? (x, y) => terrainAt(terrain, x, y)
    : (x, y) => terrain.at(x, y) as Terrain
}

/**
 * Why a building of this kind can't be laid out with the north-west tile of its footprint on
 * (x, y) (`CONTEXT.md`: Where buildings go, Footprint), or undefined if it can: every tile of the
 * footprint passable and free of other buildings; workplaces with one tile on a resource node of
 * their kind, stables and farms wholly on Plains, smelters, mints, smithies, town halls, houses,
 * storages, training grounds, walls and gates off Mountain, a house only in a city’s area (`CONTEXT.md`:
 * House); only a node’s workplace covers a node. A road goes on any passable land, Mountain too, node or not, and
 * next to a building on its tile, but one road per tile (`CONTEXT.md`: Road). A carriage site
 * goes on a tile of a finished stable or right next to one, where a carriage can stand, off any
 * resource node and any other building, one per tile (`CONTEXT.md`: Carriage). Without `terrain`
 * the terrain rules are not checked.
 */
export function buildProblem(
  world: PlacingWorld,
  x: number,
  y: number,
  kind: BuildingKind,
  terrain?: TerrainMap | TerrainLookup,
): string | undefined {
  if (!BUILDABLE.includes(kind)) return `a ${kind} can't be built yet`
  const at = terrain && lookupOf(terrain)
  if (kind === 'road') {
    const t = at?.(x, y)
    if (t !== undefined && !isPassableTerrain(t)) return 'a road goes on passable land'
    if (roadAt(world, x, y)) return 'there is already a road on this tile'
    return undefined
  }
  const size = terrain?.size ?? MAP_SIZE
  if (kind === 'carriage') {
    const t = at?.(x, y)
    if (t !== undefined && !carriageCanEnter(t)) return 'a carriage can’t stand on this land'
    if (world.nodes.some((n) => n.x === x && n.y === y))
      return 'a carriage goes off any resource node'
    if (!stableFor(world, x, y, size)) return 'a carriage is built at a finished stable'
    const here = buildingAt(world, x, y, size)
    if (here && here.kind !== 'stable') return 'there is already a building there'
    if (carriageSiteAt(world, x, y)) return 'there is already a carriage site on this tile'
    return undefined
  }
  const placed = { kind, x, y }
  const tiles = footprintTiles(placed, size)
  const nodes = world.nodes.filter((n) => covers(placed, n.x, n.y, size))
  const all = (ok: (t: Terrain) => boolean) => !at || tiles.every(([tx, ty]) => ok(at(tx, ty)))
  if (!all(isPassableTerrain)) return `a ${kind} goes on passable land`
  if (ON_PLAINS.includes(kind)) {
    if (nodes.length > 0 || !all((t) => t === Terrain.Plains))
      return `a ${kind} goes wholly on Plains, off any resource node`
  } else if (OFF_NODES.includes(kind)) {
    if (nodes.length > 0 || !all((t) => t !== Terrain.Mountain))
      return `a ${kind} goes off any resource node, and not on Mountain`
    const inCity = (t: [number, number]) => citiesAt(world, t[0], t[1], size).length > 0
    if (IN_CITY_AREA.includes(kind) && !tiles.every(inCity))
      return `a ${kind} goes in a city’s area`
  } else if (nodes.length !== 1 || NODE_WORKPLACE[nodes[0]!.kind] !== kind)
    return `a ${kind} goes with one tile on a fitting resource node`
  if (tiles.some(([tx, ty]) => buildingAt(world, tx, ty, size)))
    return 'there is already a building there'
  return undefined
}

/**
 * The north-west tiles a footprint of `kind` may have so that it covers (x, y), the tile itself
 * first: where a resident standing there could lay it out (`CONTEXT.md`: At a building).
 */
export function cornersCovering(
  kind: BuildingKind,
  x: number,
  y: number,
  size = MAP_SIZE,
): [number, number][] {
  const side = FOOTPRINT[kind]
  const out: [number, number][] = []
  for (let dy = 0; dy < side; dy++) {
    for (let dx = 0; dx < side; dx++) out.push([wrap(x - dx, size), wrap(y - dy, size)])
  }
  return out
}

/**
 * Why resident `r` can't build `building` with the north-west tile of its footprint `at` once they
 * stand there, or undefined if they can: lay out a site there, or join the unfinished one of that
 * kind there (`CONTEXT.md`: Construction site, Child).
 */
export function buildAtProblem(
  world: WorldState,
  r: Resident,
  building: unknown,
  at: { x: number; y: number },
  terrain?: TerrainMap,
): string | undefined {
  if (!canWork(r, world.tick)) return 'children can’t build'
  if (r.carrying) return CARRYING_A_CHILD
  if (!BUILDABLE.includes(building as BuildingKind)) return 'that can’t be built'
  const kind = building as BuildingKind
  const here = constructionAt(world, at.x, at.y, kind)
  if (here?.site && here.kind === kind) return undefined
  return buildProblem(world, at.x, at.y, kind, terrain)
}

/**
 * Where a node's workplace can be laid out (`CONTEXT.md`: Where buildings go): the north-west
 * tile of a footprint that covers the node and fits, the node's own tile first; none when no
 * footprint over it fits.
 */
export function nodeCorner(
  world: PlacingWorld,
  terrain: TerrainMap | TerrainLookup,
  node: Pick<ResourceNode, 'kind' | 'x' | 'y'>,
): { x: number; y: number } | undefined {
  const kind = NODE_WORKPLACE[node.kind]
  for (const [x, y] of cornersCovering(kind, node.x, node.y, terrain.size)) {
    if (!buildProblem(world, x, y, kind, terrain)) return { x, y }
  }
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
  const node = world.nodes.find((n) => covers(workplace, n.x, n.y))
  return node ? NODE_GOOD[node.kind] : undefined
}

/**
 * The goods a workplace that processes goods can use up for its next batches (`CONTEXT.md`:
 * Smelter, Smithy): the input of any of its recipes that its workers carry and that lies in its
 * pile (`CONTEXT.md`: A building's pile).
 */
export function inputAt(world: WorldState, workplace: Building): Stock {
  const out: Stock = {}
  const pile = buildingPile(world, workplace)
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

/** The residents working a workplace: holding a work-at order for it and standing at it. */
export function workersOf<R extends Pick<Resident, 'order' | 'x' | 'y'>>(
  world: { residents: readonly R[] },
  workplace: Building,
): R[] {
  return world.residents.filter(
    (r) => r.order?.kind === 'workAt' && r.order.buildingId === workplace.id && isAt(r, workplace),
  )
}

/**
 * Who teaches at a training ground (`CONTEXT.md`: Teacher): the resident holding a teach order
 * for it and standing on its footprint, found from residents' orders as workers are; the ground
 * keeps no state of its own.
 */
export function teacherAt<R extends Pick<Resident, 'order' | 'x' | 'y'>>(
  ground: Building,
  residents: readonly R[],
  size = MAP_SIZE,
): R | undefined {
  return residents.find(
    (r) => r.order?.kind === 'teach' && r.order.buildingId === ground.id && isAt(r, ground, size),
  )
}

/**
 * Why a resident can't start teaching `subject` at the building on their tile, or undefined if
 * they can (`CONTEXT.md`: Teacher): it has to be a finished training ground nobody else teaches
 * at, and they grown. A teacher there may switch to another subject.
 */
export function teachProblem(
  world: WorldState,
  resident: Resident,
  subject: unknown,
): string | undefined {
  if (!canWork(resident, world.tick)) return 'children can’t teach'
  if (!isTrainingSubject(subject)) return 'teach a stat or a skill'
  const here = buildingAt(world, resident.x, resident.y)
  if (!here || here.kind !== 'trainingGround') return 'there is no training ground here'
  if (here.site) return 'it is still a construction site'
  const o = resident.order
  if (o?.kind === 'teach' && o.buildingId === here.id && o.subject === subject)
    return 'already teaching here'
  const teacher = teacherAt(here, world.residents)
  if (teacher && teacher !== resident) {
    const what = teacher.order?.kind === 'teach' ? teacher.order.subject : subject
    return `${teacher.name} teaches ${capitalised(what)} here`
  }
  return undefined
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Who trains at a training ground (`CONTEXT.md`: Trainee): the residents holding a train order for
 * it and standing on its footprint, found from residents' orders as its teacher is.
 */
export function traineesOf<R extends Pick<Resident, 'order' | 'x' | 'y'>>(
  ground: Building,
  residents: readonly R[],
  size = MAP_SIZE,
): R[] {
  return residents.filter(
    (r) => r.order?.kind === 'train' && r.order.buildingId === ground.id && isAt(r, ground, size),
  )
}

/**
 * Why a resident can't start training at the building on their tile, or undefined if they can
 * (`CONTEXT.md`: Trainee): it has to be a finished training ground with room for another
 * trainee, and they grown. They need no teacher there to start: without one they wait.
 */
export function trainProblem(world: WorldState, resident: Resident): string | undefined {
  if (!canWork(resident, world.tick)) return 'children can’t train'
  const here = buildingAt(world, resident.x, resident.y)
  if (!here || here.kind !== 'trainingGround') return 'there is no training ground here'
  if (here.site) return 'it is still a construction site'
  const o = resident.order
  if (o?.kind === 'train' && o.buildingId === here.id) return 'already training here'
  if (traineesOf(here, world.residents).length >= TRAINING_GROUND_MAX_TRAINEES)
    return `the training ground has room for ${TRAINING_GROUND_MAX_TRAINEES} trainees`
  return undefined
}

/**
 * The realms holding a workplace (`CONTEXT.md`: Holding a workplace): those whose residents work
 * it, and so get its output. There is no ownership flag, and the city a farm was laid out for
 * doesn't count; nobody holds a workplace that nobody works.
 */
export function holdersOf(
  world: { residents: readonly Pick<Resident, 'order' | 'x' | 'y' | 'owner'>[] },
  workplace: Building,
): string[] {
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
 * `TEARDOWN_WORK_SHARE` of the building's work, or of the work put into the site so far. Like
 * building, a resident's work on a road on Mountain counts less (`siteWorkOf`).
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
 * The residents working on a building or construction site now, standing on it: building it (a
 * build order or a line order on its site) or, with `tearingDown`, tearing it down.
 */
export function workingOn(
  b: Building,
  residents: readonly Resident[],
  tearingDown: boolean,
  size = MAP_SIZE,
): Resident[] {
  return residents.filter((r) => {
    const o = r.order
    const on = tearingDown
      ? o?.kind === 'tearDown' && o.buildingId === b.id
      : (o?.kind === 'build' || (isLineOrder(o) && o.phase === 'building')) && o.siteId === b.id
    return on && isAt(r, b, size)
  })
}

/**
 * Work a building or construction site gets a tick from these residents, building it or tearing
 * it down, as the server counts it (`buildWork`, `siteWorkOf`); `under` is the terrain beneath.
 */
export function workPace(
  b: Building,
  workers: readonly Resident[],
  tick: number,
  under?: number,
): number {
  return workers.reduce((sum, r) => sum + siteWorkOf(buildWork(r, tick), b.kind, under), 0)
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
 * Whether tearing down `b` would leave a carriage or ridden horse on Mountain without a road
 * (`CONTEXT.md`: Road): it is a finished road on Mountain with one standing on it.
 */
export function strandsOnMountain(
  world: Pick<WorldState, 'carriages' | 'horses' | 'residents'>,
  b: Building,
  terrain: TerrainMap,
): boolean {
  if (b.kind !== 'road' || b.site || terrainAt(terrain, b.x, b.y) !== Terrain.Mountain) return false
  const here = (k: { x: number; y: number }) => k.x === b.x && k.y === b.y
  const ridden = (h: { id: string }) => world.residents.some((r) => r.riding === h.id)
  return world.carriages.some(here) || world.horses.some((h) => here(h) && ridden(h))
}

/**
 * Why the building or site can't be torn down by a resident on (x, y), or undefined if it can:
 * they must stand at it. So far only what can be built can be torn down, and its sites. A road on
 * Mountain waits for carriages and ridden horses on it to leave (`strandsOnMountain`).
 */
export function tearDownProblem(
  world: WorldState,
  x: number,
  y: number,
  buildingId: string,
  terrain?: TerrainMap,
): string | undefined {
  const b = world.buildings.find((c) => c.id === buildingId)
  if (!b || !covers(b, x, y)) return 'the resident is not at that building'
  if (!BUILDABLE.includes(b.kind)) return `a ${b.kind} can’t be torn down yet`
  if (terrain && strandsOnMountain(world, b, terrain))
    return 'a carriage or rider on this mountain road would be stranded'
  return undefined
}

/**
 * The tiles of a road or wall along a straight line from `from` to `to`, both ends included, the
 * short way round on a map `size` across (`CONTEXT.md`: Road, Wall / Gate). Each tile is one step
 * on from the one before, straight or diagonal (`CONTEXT.md`: Step), the tile closest to the line,
 * so a line from (0, 0) to (5, 5) runs diagonally over 6 tiles.
 */
export function roadLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): [number, number][] {
  const dx = wrapDelta(from.x, to.x, size)
  const dy = wrapDelta(from.y, to.y, size)
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  // Step i goes i/steps of the way along `d`, rounded to the nearest tile, halves up.
  const along = (i: number, d: number) =>
    Math.sign(d) * Math.floor((2 * i * Math.abs(d) + steps) / (2 * steps))
  const out: [number, number][] = [[wrap(from.x, size), wrap(from.y, size)]]
  for (let i = 1; i <= steps; i++) {
    out.push([wrap(from.x + along(i, dx), size), wrap(from.y + along(i, dy), size)])
  }
  return out
}

/** What a line order builds on each of its tiles (`CONTEXT.md`: Road, Wall / Gate). */
export const LINE_BUILDING: Record<LineOrder['kind'], 'road' | 'wall'> = {
  roadLine: 'road',
  wallLine: 'wall',
}

/** Whether an order is one along a line, a road line or a wall line. */
export function isLineOrder(o: ResidentOrder | null | undefined): o is LineOrder {
  return o?.kind === 'roadLine' || o?.kind === 'wallLine'
}

/**
 * A Build line (`CONTEXT.md`: Build line; ADR 0018): road or wall from the `from` tile to the `to`
 * tile, straight or diagonal along `roadLine`. The Build line task keeps it as `memory.line`, so
 * it is a type, not an interface: plain data a script memory can hold.
 */
export type BuildLine = {
  building: 'road' | 'wall'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

/** A tile of a Build line still to build, with its construction site once one is laid out. */
export interface LineTile {
  x: number
  y: number
  siteId: string | null
}

/**
 * Tile (x, y) of a line of `building` as still to build (`CONTEXT.md`: Build line): with the
 * unfinished site of that kind on it, or none where one can be laid out. Undefined where the tile
 * has one already (a road, or a wall or gate) or can't take one, so the line skips it.
 */
export function lineTile(
  world: WorldState,
  building: BuildLine['building'],
  x: number,
  y: number,
  terrain?: TerrainMap | TerrainLookup,
): LineTile | undefined {
  const here = constructionAt(world, x, y, building)
  if (here?.site && here.kind === building) return { x, y, siteId: here.id }
  return buildProblem(world, x, y, building, terrain) ? undefined : { x, y, siteId: null }
}

/** The tiles of a Build line still to build (`lineTile`), from its start to its end. */
export function lineToBuild(world: WorldState, line: BuildLine, terrain?: TerrainMap): LineTile[] {
  const tiles = roadLine(line.from, line.to, terrain?.size ?? MAP_SIZE)
  return tiles.flatMap(([x, y]) => lineTile(world, line.building, x, y, terrain) ?? [])
}
