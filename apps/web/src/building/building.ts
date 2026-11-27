// Buildings and construction sites as the client draws and lists them. Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import { isAt } from './footprint.js'
import {
  BUILD_MENU_GROUPS,
  BUILDING_KINDS,
  BUILDING_SPECS,
  MACHINE_SPECS,
  type BuildingSpec,
  MAP_SIZE,
} from '@csp/balance'
import { WORKPLACE_MAX_WORKERS } from '../world/narrowed.js'
import type { Recipe } from '@csp/lang-wasm'
import { tileIndex, wrap, wrapDelta } from '../world/terrain.js'
import type {
  Building,
  BuildingKind,
  Good,
  Resident,
  ResidentOrder,
  WallMaterial,
  WorldState,
} from '@csp/shared-types'

/** World queries about buildings and construction sites (ADR 0002: the game API orders and scripts share). */

/** The kinds whose spec passes, in the order of the specs. */
function kindsWhere(passes: (spec: BuildingSpec, kind: BuildingKind) => boolean): BuildingKind[] {
  return BUILDING_KINDS.filter((kind) => passes(BUILDING_SPECS[kind], kind))
}

/**
 * Kinds of building that can be built (`CONTEXT.md`: Build menu), in the order of the Build menu:
 * its groups, and the kinds in each.
 */
export const BUILDABLE: readonly BuildingKind[] = BUILD_MENU_GROUPS.flatMap((group) =>
  kindsWhere((spec) => spec.buildMenu?.group === group).sort(
    (a, b) => BUILDING_SPECS[a].buildMenu!.place - BUILDING_SPECS[b].buildMenu!.place,
  ),
)

/**
 * Kinds that share a tile with a building rather than taking it (`CONTEXT.md`: Road, Carriage,
 * Building a boat, Building a ship, Siege machine): roads, carriage, boat, ship, ram and
 * catapult sites, one of each per tile at most.
 */
export const SHARES_A_TILE: readonly BuildingKind[] = kindsWhere((spec) => spec.sharesATile)

/**
 * Sites of what is no building once finished but moves off: carriages, boats, ships and siege
 * machines. Every kind that shares a tile but the road.
 */
export const SITES_OF_MOVERS: readonly BuildingKind[] = SHARES_A_TILE.filter((k) => k !== 'road')

/** The good a recipe makes. */
export function recipeGood(recipe: Recipe): Good {
  return (Object.keys(recipe.output) as Good[])[0]!
}

/**
 * Kinds of building that keep goods in a storage of their own: storages, the Trade
 * Organization's warehouses (`CONTEXT.md`: Warehouse), stables' Food, and havens (`CONTEXT.md`:
 * Haven).
 */
export const KEEPS_GOODS: readonly BuildingKind[] = kindsWhere((spec) => spec.keepsGoods)

/** The kinds of site siege machines are built as (`MACHINE_SPECS`): ram and catapult sites. */
const SIEGE_SITES: readonly BuildingKind[] = Object.values(MACHINE_SPECS).map(
  (m) => m.builtAs,
)

/** Whether a kind is the site of a siege machine. */
export const isSiegeSite = (kind: BuildingKind) => SIEGE_SITES.includes(kind)

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

/** Whether a building of `kind` of `material` is of stone: only a wall, gate or tower can be. */
export function isStone(kind: BuildingKind, material?: WallMaterial | null): boolean {
  return material === 'stone' && (kind === 'wall' || kind === 'gate' || kind === 'tower')
}

/** Most workers each kind of workplace takes, for the kinds residents can work so far. */
export const MAX_WORKERS: Partial<Record<BuildingKind, number>> = WORKPLACE_MAX_WORKERS

/**
 * Whether a realm can keep Workplace settings for the building (`CONTEXT.md`: Workplace
 * settings): a workplace, or a construction site of a workplace kind.
 */
export function takesWorkSettings(b: Pick<Building, 'kind'>): boolean {
  return WORKPLACE_MAX_WORKERS[b.kind] !== undefined
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

/** A road line or wall line order, with its kind (`LineOrder` is what both hold). */
export type LineBuildOrder = Extract<ResidentOrder, { kind: 'roadLine' | 'wallLine' }>

/** Whether an order is one along a line, a road line or a wall line. */
export function isLineOrder(o: ResidentOrder | null | undefined): o is LineBuildOrder {
  return o?.kind === 'roadLine' || o?.kind === 'wallLine'
}

/**
 * Whether a stone wall or gate of `kind` may be laid out on (x, y) over the finished wooden one of
 * its kind there, which stands until the stone one is finished (`CONTEXT.md`: Wood or stone): no
 * wall or gate site there yet.
 */
export function stoneOverAt(
  world: { buildings: readonly Pick<Building, 'kind' | 'x' | 'y' | 'site' | 'material'>[] },
  x: number,
  y: number,
  kind: BuildingKind,
): boolean {
  if (kind !== 'wall' && kind !== 'gate') return false
  const here = world.buildings.filter((b) => b.x === x && b.y === y)
  const wooden = here.some((b) => b.kind === kind && !b.site && b.material !== 'stone')
  const site = here.some((b) => (b.kind === 'wall' || b.kind === 'gate') && b.site)
  return wooden && !site
}
