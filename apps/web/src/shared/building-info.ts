// Ported from packages/shared/src/building-info.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { BUILD_MENU_GROUPS, BUILDING_KINDS, BUILDING_SPECS } from '@csp/balance'
import { BUILDABLE, NODE_GOOD } from './building.js'
import { FOOTPRINT } from './footprint.js'
import {
  BUILD_MATERIALS,
  BUILD_WORK,
  RECIPES,
  WORKPLACE_MAX_WORKERS,
  WORKPLACE_SKILL,
} from './narrowed.js'
import { type Recipe } from './stats.js'
import { NODE_WORKPLACE } from './world.js'
import type { BuildingKind, Good, ResourceKind, SkillName, Stock } from '@csp/shared-types'

/**
 * What each kind of building is for, in words (`CONTEXT.md`: each building's own entry): the one
 * description the Build menu and the building card's ⓘ share. Its spec's, with the numbers in it
 * from the balance.
 */
export const BUILDING_PURPOSE: Record<BuildingKind, string> = Object.fromEntries(
  BUILDING_KINDS.map((kind) => [kind, BUILDING_SPECS[kind].purpose]),
) as Record<BuildingKind, string>

/**
 * The groups of the Build menu and the kinds in each, in the order it shows them (`CONTEXT.md`:
 * Build menu). Every buildable kind is in exactly one.
 */
export const BUILD_GROUPS: readonly { name: string; kinds: readonly BuildingKind[] }[] =
  BUILD_MENU_GROUPS.map((name) => ({
    name,
    kinds: BUILDABLE.filter((kind) => BUILDING_SPECS[kind].buildMenu?.group === name),
  }))

/** Everything the ⓘ on a building's card says about its kind, numbers from the balance. */
export interface BuildingInfo {
  kind: BuildingKind
  purpose: string
  /** What a workplace that processes goods turns into what (`RECIPES`); empty elsewhere. */
  recipes: readonly Recipe[]
  /**
   * What a workplace makes from nothing: Food on a farm, on a node what the node yields (a mine
   * either ore, until its node is known). Empty elsewhere.
   */
  yields: Good[]
  /** The skill working here teaches (`WORKPLACE_SKILL`). */
  skill?: SkillName
  /** Up to how many residents can work here (`WORKPLACE_MAX_WORKERS`). */
  maxWorkers?: number
  /** Its footprint's side, in tiles (`FOOTPRINT`). */
  footprint: number
  /** Materials it takes to build (`BUILD_MATERIALS`). */
  materials: Stock
  /** Work it takes to build, in ticks of one unskilled resident of average Strength (`BUILD_WORK`). */
  work: number
}

/**
 * What a kind of building is and does, for the ⓘ on its card or a node's (`CONTEXT.md`:
 * Workplace, Footprint, Construction site). `node` is the node a node's workplace stands on, if
 * known, which picks what a mine yields.
 */
export function buildingInfo(kind: BuildingKind, node?: ResourceKind): BuildingInfo {
  const nodes = node ? [node] : (Object.keys(NODE_WORKPLACE) as ResourceKind[])
  const fromNodes = nodes.filter((n) => NODE_WORKPLACE[n] === kind).map((n) => NODE_GOOD[n])
  return {
    kind,
    purpose: BUILDING_PURPOSE[kind],
    recipes: RECIPES[kind] ?? [],
    yields: kind === 'farm' ? ['food'] : [...new Set(fromNodes)],
    skill: WORKPLACE_SKILL[kind],
    maxWorkers: WORKPLACE_MAX_WORKERS[kind],
    footprint: FOOTPRINT[kind],
    materials: BUILD_MATERIALS[kind] ?? {},
    work: BUILD_WORK[kind] ?? 0,
  }
}
