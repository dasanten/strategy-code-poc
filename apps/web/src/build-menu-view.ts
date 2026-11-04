import {
  BUILD_GROUPS,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_HOUR,
  buildMenu,
  type BuildingKind,
  type ResourceNode,
} from '@csp/shared'
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
}

export interface BuildMenuGroup {
  name: string
  kinds: BuildMenuKind[]
}

/**
 * Every buildable kind under its group (`CONTEXT.md`: Build menu), with why it can't go on this
 * tile. `problem` is the placement rule as far as the Player knows. On top of it, a node's
 * workplace is only offered standing on that node, as `buildMenu` says; roads and carriages go by
 * `problem` alone.
 */
export function buildMenuGroups(
  node: Pick<ResourceNode, 'kind'> | undefined,
  problem: (kind: BuildingKind) => string | undefined,
): BuildMenuGroup[] {
  const offered: readonly BuildingKind[] = [...buildMenu(node), 'road', 'carriage']
  return BUILD_GROUPS.map((group) => ({
    name: group.name,
    kinds: group.kinds.map((kind) => {
      const name = BUILDING_NAMES[kind]
      const lower = name.toLowerCase()
      // The placement rule words a kind by its id ("a lumberCamp goes ..."), the menu by its name.
      const why =
        problem(kind)?.replace(kind, lower) ??
        (offered.includes(kind) ? undefined : `a ${lower} is built standing on its resource node`)
      return why === undefined ? { kind, name } : { kind, name, problem: why }
    }),
  }))
}
