import type { BuildingKind, ResourceKind } from '@csp/shared'

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
}

export const NODE_ART: Record<ResourceKind, string> = {
  forest: 'node-forest.svg',
  stone: 'node-stone.svg',
  ironOre: 'node-iron-ore.svg',
  goldOre: 'node-gold-ore.svg',
}

/** Token bases: a building's dark hex badge, its ring (tinted per owner), a node's diamond. */
export const BASE_ART = {
  hex: 'base-hex.svg',
  hexRing: 'base-hex-ring.svg',
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
    ...Object.values(BASE_ART),
    ...Object.values(CITY_ART),
  ]),
]
