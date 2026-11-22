import type { DiplomacyTab, SideTabId } from './hud-view.js'
import { type PixelSheet, type SliceRect, pixelArt } from './map/pixel-art.js'
import { PIXEL_SLICES } from './map/pixel-slices.js'

/**
 * The UI icons (`CONTEXT.md`: Pixel frontier, ADR 0044): each is a slice of a pixel sheet (the
 * `ui` sheet, or the goods, units or resident sheet for the things they show), and where that
 * slice isn't drawn yet, a cell of the placeholder sheet `assets/ui/sprites.svg` (16 px cells,
 * 10 × 4). The `Icon` component (`Icon.tsx`) draws them; nothing else in the UI does.
 */

/** A cell of the placeholder sheet as [column, row]. */
export type PlaceholderCell = readonly [number, number]

/** Where an icon's art comes from: a sheet's slice, a placeholder cell, or both. */
export interface UiIconArt {
  /** The sheet the slice is on; `ui` when left out. */
  sheet?: PixelSheet
  /** The slice's name on that sheet. */
  slice?: string
  placeholder?: PlaceholderCell
}

/** The placeholder sheet's size in cells, and pixels per cell. */
export const PLACEHOLDER_COLUMNS = 10
export const PLACEHOLDER_ROWS = 4
export const PLACEHOLDER_CELL = 16

/** Every UI icon by name; a `ui` slice of the same name unless it says otherwise. */
export const UI_ICONS = {
  // The sidebar's tabs and the Diplomacy tab's own tabs.
  residents: { slice: 'residents', placeholder: [1, 1] },
  horses: { slice: 'horses', placeholder: [3, 1] },
  armies: { slice: 'armies', placeholder: [5, 1] },
  diplomacy: { slice: 'diplomacy', placeholder: [7, 1] },
  cities: { slice: 'cities', placeholder: [6, 1] },
  waypoints: { slice: 'waypoints', placeholder: [7, 2] },
  scripts: { slice: 'scripts', placeholder: [0, 2] },
  'realm-log': { slice: 'realm-log', placeholder: [1, 2] },
  contracts: { slice: 'contracts', placeholder: [7, 1] },
  demands: { slice: 'demands', placeholder: [9, 2] },
  'direct-offers': { slice: 'direct-offers', placeholder: [7, 1] },
  alliance: { slice: 'alliance', placeholder: [8, 1] },
  standing: { slice: 'standing', placeholder: [9, 1] },
  // Orders, and the steps of a queue by the kind of order they are.
  walk: { slice: 'walk', placeholder: [0, 3] },
  gather: { slice: 'gather', placeholder: [1, 3] },
  build: { slice: 'build', placeholder: [2, 3] },
  goods: { slice: 'goods', placeholder: [3, 3] },
  script: { slice: 'script', placeholder: [0, 2] },
  // Actions and marks.
  close: { slice: 'close', placeholder: [5, 3] },
  add: { slice: 'add', placeholder: [4, 3] },
  check: { slice: 'check', placeholder: [6, 3] },
  warning: { slice: 'warning', placeholder: [9, 2] },
  loop: { slice: 'loop', placeholder: [7, 3] },
  run: { slice: 'run', placeholder: [8, 3] },
  stop: { slice: 'stop', placeholder: [9, 3] },
  clock: { slice: 'clock', placeholder: [4, 2] },
  find: { slice: 'find', placeholder: [3, 2] },
  settings: { slice: 'settings', placeholder: [5, 2] },
  sight: { slice: 'sight', placeholder: [6, 2] },
  map: { slice: 'map', placeholder: [7, 2] },
  health: { slice: 'health', placeholder: [8, 2] },
  crown: { slice: 'crown', placeholder: [2, 1] },
  banner: { slice: 'banner', placeholder: [5, 1] },
  city: { slice: 'city', placeholder: [6, 1] },
  key: { slice: 'key', placeholder: [2, 2] },
  book: { slice: 'book', placeholder: [1, 2] },
  // Things Daniel's other sheets already show.
  person: { sheet: 'resident', slice: 'body', placeholder: [1, 1] },
  horse: { sheet: 'units', slice: 'horse', placeholder: [3, 1] },
  cart: { sheet: 'units', slice: 'carriage', placeholder: [4, 1] },
  caravan: { sheet: 'units', slice: 'caravan', placeholder: [4, 1] },
  sword: { sheet: 'goods', slice: 'sword', placeholder: [8, 0] },
} as const satisfies Record<string, UiIconArt>

export type UiIconName = keyof typeof UI_ICONS

/** The sizes an icon is drawn at, in px: whole and quarter steps of the 16 px art. */
export type UiIconSize = 16 | 20 | 24 | 32 | 48

/** The icon of each sidebar tab and each Diplomacy tab. */
export const TAB_ICONS: Record<SideTabId | DiplomacyTab, UiIconName> = {
  residents: 'residents',
  horses: 'horses',
  armies: 'armies',
  diplomacy: 'diplomacy',
  cities: 'cities',
  waypoints: 'waypoints',
  scripts: 'scripts',
  realmLog: 'realm-log',
  contracts: 'contracts',
  demands: 'demands',
  directOffers: 'direct-offers',
  alliance: 'alliance',
  standing: 'standing',
}

/** What to draw: a rectangle of a sheet (`sheet`), or of the placeholder sheet. */
export type IconDrawing =
  { from: 'sheet'; sheet: PixelSheet; rect: SliceRect } | { from: 'placeholder'; rect: SliceRect }

/** The slices of each sheet, as `pixel-slices.ts` has them. */
export type SheetSlices = (sheet: PixelSheet) => Readonly<Record<string, SliceRect>>

const exportedSlices: SheetSlices = (sheet) =>
  PIXEL_SLICES[sheet].slices as Readonly<Record<string, SliceRect>>

/**
 * How to draw an icon: its slice when the sheet has it and something is drawn in it
 * (`drawn(atlas key)`), else its placeholder. Throws for a name with neither, which the tests
 * rule out for every name the UI uses.
 */
export function iconDrawing(
  name: string,
  drawn: (key: string) => boolean,
  slices: SheetSlices = exportedSlices,
): IconDrawing {
  const art = (UI_ICONS as Readonly<Record<string, UiIconArt>>)[name]
  if (art?.slice !== undefined) {
    const sheet = art.sheet ?? 'ui'
    const rect = slices(sheet)[art.slice]
    if (rect && drawn(pixelArt(sheet, art.slice))) return { from: 'sheet', sheet, rect }
  }
  if (art?.placeholder) {
    const [c, r] = art.placeholder
    return {
      from: 'placeholder',
      rect: [c * PLACEHOLDER_CELL, r * PLACEHOLDER_CELL, PLACEHOLDER_CELL, PLACEHOLDER_CELL],
    }
  }
  throw new Error(`UI icon "${name}" has neither a drawn slice nor a placeholder`)
}

/** Whether an icon has something to show: a slice on its sheet or a placeholder cell. */
export function iconHasArt(name: string, slices: SheetSlices = exportedSlices): boolean {
  const art = (UI_ICONS as Readonly<Record<string, UiIconArt>>)[name]
  if (!art) return false
  if (art.placeholder) return true
  return art.slice !== undefined && slices(art.sheet ?? 'ui')[art.slice] !== undefined
}

/** The sheets the UI icons draw from, to read which of their slices are drawn. */
export const ICON_SHEETS: readonly PixelSheet[] = [
  ...new Set(
    Object.values(UI_ICONS as Readonly<Record<string, UiIconArt>>).map((a) => a.sheet ?? 'ui'),
  ),
]
