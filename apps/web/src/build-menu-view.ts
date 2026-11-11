import { BUILD_GROUPS } from './shared/building-info.js'
import { TICKS_PER_GAME_DAY } from '@csp/balance'
import { TICKS_PER_GAME_HOUR } from './shared/time.js'
import { buildMenu } from './shared/building.js'
import type { BuildingKind, ResourceNode } from '@csp/shared-types'
import { BUILDING_NAMES } from './map/palette.js'

/** Work in ticks as a span of game time: "2 game days", "1.5 game hours". */
export const workSpan = (ticks: number) => {
  const [n, unit] =
    ticks >= TICKS_PER_GAME_DAY
      ? [ticks / TICKS_PER_GAME_DAY, 'game day']
      : [ticks / TICKS_PER_GAME_HOUR, 'game hour']
  const rounded = Math.round(n * 10) / 10
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`
}

/** One icon of the Build menu: dimmed when `problem` says why the kind can't go on this tile. */
export interface BuildMenuKind {
  kind: BuildingKind
  name: string
  problem?: string
  /** False for what never goes on this tile's ground: a node's workplace off it, others on one. */
  offered: boolean
}

export interface BuildMenuGroup {
  name: string
  kinds: BuildMenuKind[]
}

/**
 * Every buildable kind under its group (`CONTEXT.md`: Build menu), with why it can't go on this
 * tile. `problem` is the placement rule as far as the Player knows. On top of it, a node's
 * workplace is only offered standing on that node, as `buildMenu` says; roads, carriages and boats
 * go by `problem` alone.
 */
export function buildMenuGroups(
  node: Pick<ResourceNode, 'kind'> | undefined,
  problem: (kind: BuildingKind) => string | undefined,
): BuildMenuGroup[] {
  const offered: readonly BuildingKind[] = [
    ...buildMenu(node),
    'road',
    ...(node ? [] : (['carriage', 'boat'] as const)),
  ]
  return BUILD_GROUPS.map((group) => ({
    name: group.name,
    kinds: group.kinds.map((kind) => {
      const name = BUILDING_NAMES[kind]
      const lower = name.toLowerCase()
      // The placement rule words a kind by its id ("a lumberCamp goes ..."), the menu by its name.
      const isOffered = offered.includes(kind)
      const why =
        problem(kind)?.replace(kind, lower) ??
        (isOffered ? undefined : `a ${lower} is built standing on its resource node`)
      return why === undefined
        ? { kind, name, offered: isOffered }
        : { kind, name, problem: why, offered: isOffered }
    }),
  }))
}

/**
 * Whether the tapped kind can be chosen. Built now, it must fit the tile now. Planned ahead
 * (`CONTEXT.md`: Planning ahead) whether it can start is checked when its turn comes, so what the
 * tile lacks today (a city's area, a finished stable) doesn't stop it: only what the ground rules
 * out, as the planner's list did.
 */
export const canChooseKind = (item: BuildMenuKind, planning: boolean) =>
  planning ? item.offered : item.problem === undefined
