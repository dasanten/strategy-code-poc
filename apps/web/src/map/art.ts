import type { BuildingKind, ResourceKind } from '@csp/shared'
import type { Activity } from './figures.js'

/**
 * The map's art registry (ADR 0008): which file in `assets/map/` draws each game kind. Glyphs are
 * white line art, so the map tints them; bases are the token shapes under them. Painted sprites
 * can replace the SVGs later by changing only what this points to.
 */
export const BUILDING_ART: Record<BuildingKind, string> = {
  townHall: 'town-hall.svg',
  house: 'house.svg',
  storage: 'storage.svg',
  warehouse: 'warehouse.svg',
  wall: 'wall.svg',
  gate: 'gate.svg',
  farm: 'farm.svg',
  stable: 'stable.svg',
  mine: 'mine.svg',
  quarry: 'quarry.svg',
  lumberCamp: 'lumber-camp.svg',
  smelter: 'smelter.svg',
  mint: 'mint.svg',
  smithy: 'smithy.svg',
  road: 'road.svg',
  carriage: 'cart.svg',
}

/**
 * The painted sprite sheet drawn in place of tokens (`docs/art.md`): equal square cells on flat
 * magenta, which is made transparent when it loads. Cells count from 0, top left, row by row.
 */
export const PAINTED_SHEET = { file: 'sheet.webp', columns: 6 } as const

/** The atlas key of one cell of the painted sheet. */
export const paintedCell = (cell: number) => `${PAINTED_SHEET.file}#${cell}`

/** The sheet's cell for each building kind drawn painted; walls, gates and roads stay lines. */
export const PAINTED_BUILDING_ART: Partial<Record<BuildingKind, number>> = {
  townHall: 0,
  house: 1,
  storage: 2,
  warehouse: 3,
  farm: 4,
  stable: 5,
  mine: 6,
  quarry: 7,
  lumberCamp: 8,
  smelter: 9,
  mint: 10,
  smithy: 11,
  /** Only ever a site, drawn as the 1×1 site cell (`PAINTED_SITE_ART`). */
  carriage: 31,
}

/** A construction site's cell by its building's footprint, 1×1 to 4×4 (`CONTEXT.md`: Footprint). */
export const PAINTED_SITE_ART = [25, 26, 27, 28] as const

/** The sheet's cell drawn in place of a unit glyph (`UNIT_ART`). */
export const PAINTED_UNIT_ART: Readonly<Record<string, number>> = {
  'person.svg': 29,
  'crown.svg': 30,
  'cart.svg': 31,
  'horse.svg': 32,
  'caravan.svg': 33,
  'army-banner.svg': 34,
}

/** Every cell of the sheet the map draws, once. */
export const paintedCellsInUse = (): number[] => [
  ...new Set([
    ...Object.values(PAINTED_BUILDING_ART),
    ...PAINTED_SITE_ART,
    ...Object.values(PAINTED_UNIT_ART),
  ]),
]

/** The URL of every file in `assets/painted/`, by file name. */
export const PAINTED_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/painted/*', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
)

export const NODE_ART: Record<ResourceKind, string> = {
  forest: 'node-forest.svg',
  stone: 'node-stone.svg',
  ironOre: 'node-iron-ore.svg',
  goldOre: 'node-gold-ore.svg',
}

/** Residents, carriages, horses, Trade Org caravans and armies; your Leader gets the crown. */
export const UNIT_ART = {
  person: 'person.svg',
  leader: 'crown.svg',
  carriage: 'cart.svg',
  horse: 'horse.svg',
  caravan: 'caravan.svg',
  army: 'army-banner.svg',
} as const

/** The small icon by a resident's figure at close zoom: what they are doing (`figures.ts`). */
export const ACTIVITY_ART: Record<Activity, string> = {
  walking: 'activity-walking.svg',
  riding: 'activity-riding.svg',
  carrying: 'activity-carrying.svg',
  working: 'activity-working.svg',
  fighting: 'activity-fighting.svg',
}

/**
 * Token bases: a building's dark hex badge and its ring (tinted per owner), a unit's dark round
 * badge and its ring, a node's diamond.
 */
export const BASE_ART = {
  hex: 'base-hex.svg',
  hexRing: 'base-hex-ring.svg',
  round: 'base-round.svg',
  roundRing: 'base-round-ring.svg',
  diamond: 'base-diamond.svg',
} as const

/** A city's emblem in the far zoom tier: a castle on the dark hex badge, with a wider ring. */
export const CITY_ART = {
  glyph: 'city.svg',
  ring: 'base-hex-ring-wide.svg',
} as const

/** The SVG source of every file in `assets/map/`, by file name. */
export const ART_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/map/*.svg', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1), svg]),
)

/** Every file the registry points to, once. */
export const artInUse = (): string[] => [
  ...new Set([
    ...Object.values(BUILDING_ART),
    ...Object.values(NODE_ART),
    ...Object.values(UNIT_ART),
    ...Object.values(ACTIVITY_ART),
    ...Object.values(BASE_ART),
    ...Object.values(CITY_ART),
  ]),
]
