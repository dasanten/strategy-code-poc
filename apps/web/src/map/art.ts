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

/** Residents, carriages, horses, Trade Org caravans and armies; your Leader gets the crown. */
export const UNIT_ART = {
  person: 'person.svg',
  leader: 'crown.svg',
  carriage: 'cart.svg',
  horse: 'horse.svg',
  caravan: 'caravan.svg',
  army: 'army-banner.svg',
} as const

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
    ...Object.values(BASE_ART),
    ...Object.values(CITY_ART),
  ]),
]
