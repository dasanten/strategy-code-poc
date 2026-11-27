import { BUILD_GROUPS } from './building-info.js'
import { TICKS_PER_GAME_DAY, TICKS_PER_GAME_HOUR } from '@csp/balance'
import { SITES_OF_MOVERS } from './building.js'
import { buildMenu } from '@csp/lang-wasm'
import type { BuildingKind, ResourceNode } from '@csp/shared-types'
import { BUILDING_NAMES } from '../map/palette.js'
import { pixelBuilding, pixelSlice, type PixelSheet, type SliceRect } from '../map/pixel-art.js'

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
 * workplace is only offered standing on that node, as `buildMenu` says; roads, carriages, boats,
 * ships and rams go by `problem` alone. With `anywhere` no tile is picked yet (realm control
 * mode, `CONTEXT.md`: Realm order): every kind is offered, and judged once the tile is picked.
 */
export function buildMenuGroups(
  node: Pick<ResourceNode, 'kind'> | undefined,
  problem: (kind: BuildingKind) => string | undefined,
  anywhere = false,
): BuildMenuGroup[] {
  const offered: readonly BuildingKind[] = anywhere
    ? BUILD_GROUPS.flatMap((g) => g.kinds)
    : [...buildMenu(node), 'road', ...(node ? [] : SITES_OF_MOVERS)]
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

/**
 * Why a kind can't go on a tile, as the Build menu on that tile would say it: the placement rule
 * (`problem`), or a node's workplace off its node. For a kind picked before its tile (realm
 * control mode), judged once the tile is picked.
 */
export function kindProblemOn(
  kind: BuildingKind,
  node: Pick<ResourceNode, 'kind'> | undefined,
  problem: (kind: BuildingKind) => string | undefined,
): string | undefined {
  return buildMenuGroups(node, problem)
    .flatMap((g) => g.kinds)
    .find((k) => k.kind === kind)?.problem
}

/** Where a kind's pixel sprite lies: which sheet, which slice, and its rectangle there. */
export interface BuildingSprite {
  sheet: PixelSheet
  slice: string
  rect: SliceRect
}

/** The kinds drawn on the units sheet, by their slice there (as `pixelUnit` draws them). */
const UNIT_KINDS: Partial<Record<BuildingKind, string>> = {
  carriage: 'carriage',
  boat: 'boat',
  ship: 'ship',
  ram: 'ram',
  catapult: 'catapult',
}

/** Walls, gates and roads are drawn from tile pieces: the one that reads best on its own. */
const TILE_KINDS: Partial<Record<BuildingKind, string>> = {
  wall: 'wall-wood-straight',
  gate: 'gate-wood-ew',
  road: 'road-straight',
}

/**
 * The pixel sprite (`docs/art.md`: Pixel art, ADR 0047) the Build menu shows for a kind: the map's
 * own slice for it, a tower, wall or gate by the material picked, a carriage, vessel or siege
 * machine from the units sheet, and a wall, gate or road as one of its pieces. Undefined when the
 * registry has no slice for it; whether a slice has anything drawn in it yet is only known once
 * the sheet has loaded (`BuildingSprite` in BuildMenu.tsx).
 */
export function buildingSprite(
  kind: BuildingKind,
  material?: 'wood' | 'stone',
): BuildingSprite | undefined {
  const at = (sheet: PixelSheet, slice: string) => {
    const rect = pixelSlice(sheet, slice)
    return rect ? { sheet, slice, rect } : undefined
  }
  const unit = UNIT_KINDS[kind]
  if (unit) return at('units', unit)
  const tile = TILE_KINDS[kind]
  if (tile) return at('tiles', material === 'stone' ? tile.replace('wood', 'stone') : tile)
  const key = pixelBuilding(kind, false, material === 'stone')
  return key === undefined ? undefined : at('buildings', key.slice('pixel/buildings/'.length))
}
