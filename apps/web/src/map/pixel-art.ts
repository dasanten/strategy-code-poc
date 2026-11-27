import type { BuildingKind, Good, ResourceKind } from '@csp/shared-types'
import { FOOTPRINT } from '../building/footprint.js'
import type { GearMarks } from './figures.js'
import { PIXEL_SLICES } from './pixel-slices.js'

/**
 * The pixel art registry (`docs/art.md`: Pixel art, ADR 0047): which slice of which exported sheet
 * draws each game kind. A slice with nothing drawn in it yet is left out of the atlas when it
 * loads, so whoever draws asks the atlas first and falls back to the painted look.
 */

/** The sheets `scripts/pixel-art.mjs` exports. */
export type PixelSheet = keyof typeof PIXEL_SLICES

/** A rectangle on a sheet as [x, y, width, height], in pixels. */
export type SliceRect = readonly [number, number, number, number]

/** Pixels per tile in the art. */
export const PIXEL_TILE = 16

/** The atlas key of a slice of a sheet. */
export const pixelArt = (sheet: PixelSheet, slice: string) => `pixel/${sheet}/${slice}`

/** The atlas key of the part of a slice drawn in the owner's colour (the sheet's `tint` layer). */
export const pixelTint = (key: string) => `${key}#tint`

/** Where a slice lies on its sheet, if the sheet has it. */
export function pixelSlice(sheet: PixelSheet, slice: string): SliceRect | undefined {
  return (PIXEL_SLICES[sheet].slices as Readonly<Record<string, SliceRect>>)[slice]
}

/** The URL of every file in `assets/pixel/`, by file name. */
export const PIXEL_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../assets/pixel/*.png', {
      query: '?url',
      import: 'default',
      eager: true,
    }),
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
)

const BUILDING_SLICE: Partial<Record<BuildingKind, string>> = {
  townHall: 'town-hall',
  house: 'house',
  storage: 'storage',
  warehouse: 'warehouse',
  farm: 'farm',
  stable: 'stable',
  mine: 'mine',
  quarry: 'quarry',
  lumberCamp: 'lumber-camp',
  smelter: 'smelter',
  mint: 'mint',
  smithy: 'smithy',
  trainingGround: 'training-ground',
  haven: 'haven',
}

/**
 * The atlas key a building draws with in pixel art: its own slice, a tower's by its material, or
 * while it is a site the site slice of its footprint. Walls, gates and roads have pieces of their
 * own (`pixelWall`, `pixelGate`, `pixelRoad`).
 */
export function pixelBuilding(
  kind: BuildingKind,
  isSite: boolean,
  stone: boolean,
): string | undefined {
  if (kind === 'wall' || kind === 'gate' || kind === 'road') return undefined
  const side = FOOTPRINT[kind]
  if (isSite) return pixelArt('buildings', `site-${side}x${side}`)
  if (kind === 'tower') return pixelArt('buildings', stone ? 'tower-stone' : 'tower-wood')
  const slice = BUILDING_SLICE[kind]
  return slice === undefined ? undefined : pixelArt('buildings', slice)
}

/** Which sides of a wall or road tile touch another of its kind. */
export interface Sides {
  left: boolean
  right: boolean
  up: boolean
  down: boolean
}

/** The six pieces a wall or a road is drawn from. */
export type Piece = 'single' | 'end' | 'straight' | 'corner' | 't' | 'cross'

/**
 * The piece for a tile joined on these sides, and how many quarter turns clockwise it is drawn
 * turned. Each piece is drawn once in the art: the end joins right, the straight left and right,
 * the corner right and down, the T left, right and down.
 */
export function joinedPiece(s: Sides): { piece: Piece; turns: number } {
  // Clockwise from right, so one more turn moves a join one place on.
  const joined = [s.right, s.down, s.left, s.up]
  const count = joined.filter(Boolean).length
  if (count === 0) return { piece: 'single', turns: 0 }
  if (count === 4) return { piece: 'cross', turns: 0 }
  if (count === 1) return { piece: 'end', turns: joined.indexOf(true) }
  if (count === 3) {
    // Drawn with up free: turned until the free side is where it is here.
    return { piece: 't', turns: (joined.indexOf(false) + 1) % 4 }
  }
  if (s.left && s.right) return { piece: 'straight', turns: 0 }
  if (s.up && s.down) return { piece: 'straight', turns: 1 }
  // A corner joins two sides next to each other: turned to the first of the two, clockwise.
  const first = joined.findIndex((on, i) => on && joined[(i + 1) % 4])
  return { piece: 'corner', turns: first }
}

/** A piece to draw: its atlas key and how far it is turned, in radians. */
export interface TurnedArt {
  key: string
  rotation: number
}

const turned = (slice: string, turns: number): TurnedArt => ({
  key: pixelArt('tiles', slice),
  rotation: (turns * Math.PI) / 2,
})

/** A wall tile's piece, of wood or stone (`CONTEXT.md`: Wall / Gate, Wood or stone). */
export function pixelWall(stone: boolean, sides: Sides): TurnedArt {
  const { piece, turns } = joinedPiece(sides)
  return turned(`wall-${stone ? 'stone' : 'wood'}-${piece === 'single' ? 'post' : piece}`, turns)
}

/** A road tile's piece (`CONTEXT.md`: Road). */
export function pixelRoad(sides: Sides): TurnedArt {
  const { piece, turns } = joinedPiece(sides)
  return turned(`road-${piece}`, turns)
}

/** Every piece a road can be, so the map draws roads in pixel art only when all are there. */
export const ROAD_PIECES: readonly string[] = (
  ['single', 'end', 'straight', 'corner', 't', 'cross'] as const
).map((p) => pixelArt('tiles', `road-${p}`))

/**
 * A gate's image: of wood or stone, open or closed, and with its wall running east–west or
 * north–south. Both directions are drawn in the art, so it is never turned.
 */
export function pixelGate(stone: boolean, closed: boolean, sides: Sides): string {
  const along = !sides.left && !sides.right && (sides.up || sides.down) ? 'ns' : 'ew'
  return pixelArt('tiles', `gate-${stone ? 'stone' : 'wood'}${closed ? '' : '-open'}-${along}`)
}

const NODE_SLICE: Record<ResourceKind, string> = {
  forest: 'node-forest',
  stone: 'node-stone',
  ironOre: 'node-iron-ore',
  goldOre: 'node-gold-ore',
  coal: 'node-coal',
}

/** A resource node's image. */
export const pixelNode = (kind: ResourceKind) => pixelArt('tiles', NODE_SLICE[kind])

/** A pile of goods on the ground. */
export const PIXEL_PILE = pixelArt('tiles', 'pile')

/** The slice of the units sheet drawn in place of each unit glyph (`UNIT_ART`'s files). */
const UNIT_SLICE: Readonly<Record<string, string>> = {
  'cart.svg': 'carriage',
  'horse.svg': 'horse',
  'caravan.svg': 'caravan',
  'army-banner.svg': 'army-banner',
  'boat.svg': 'boat',
  'ship.svg': 'ship',
  'ram.svg': 'ram',
  'catapult.svg': 'catapult',
}

/** What of a unit changes its image. */
export interface UnitLook {
  /** A carriage with its horse hitched (`CONTEXT.md`: Hitched horse). */
  hitched?: boolean
  /** What a resident has equipped (`CONTEXT.md`: Equipment), shown as layers over the body. */
  gear?: GearMarks
}

/** A unit in pixel art: its layers bottom to top, and the gear they leave to the old marks. */
export interface PixelUnit {
  layers: string[]
  /** Equipped gear with no layer drawn for it yet. */
  unshown: GearMarks
}

/**
 * The layers a unit glyph (`UNIT_ART`) is drawn from in pixel art, given which atlas keys exist
 * (`has`), or undefined when its image isn't drawn yet. A resident is the body with the armour,
 * the Leader's crown, the shield and the weapon over it; steel gear falls back to the iron layer
 * while it has none of its own.
 */
export function pixelUnit(
  file: string,
  look: UnitLook,
  has: (key: string) => boolean,
): PixelUnit | undefined {
  const person = file === 'person.svg' || file === 'crown.svg'
  if (!person) {
    const slice = UNIT_SLICE[file]
    if (slice === undefined) return undefined
    const hitched = pixelArt('units', `${slice}-hitched`)
    const key = look.hitched && has(hitched) ? hitched : pixelArt('units', slice)
    return has(key) ? { layers: [key], unshown: {} } : undefined
  }
  const body = pixelArt('resident', 'body')
  if (!has(body)) return undefined
  const layer = (name: string, metal: 'iron' | 'steel'): string | undefined => {
    const own = pixelArt('resident', metal === 'steel' ? `steel-${name}` : name)
    const iron = pixelArt('resident', name)
    return has(own) ? own : has(iron) ? iron : undefined
  }
  const { armour, shield, weapon } = look.gear ?? {}
  const layers = [body]
  const unshown: GearMarks = {}
  const add = (key: string | undefined, otherwise: () => void) => {
    if (key === undefined) otherwise()
    else layers.push(key)
  }
  if (armour) add(layer('armour', armour), () => (unshown.armour = armour))
  const crown = pixelArt('resident', 'leader-crown')
  if (file === 'crown.svg' && has(crown)) layers.push(crown)
  if (shield) add(layer('shield', shield), () => (unshown.shield = shield))
  if (weapon) add(layer(weapon.kind, weapon.metal), () => (unshown.weapon = weapon))
  return { layers, unshown }
}

/** The slice of the goods sheet for each good drawn in pixel art; the rest keep their line art. */
export const PIXEL_GOOD: Partial<Record<Good, string>> = {
  food: 'food',
  wood: 'wood',
  stone: 'stone',
  ironOre: 'iron-ore',
  iron: 'iron',
  goldOre: 'gold-ore',
  coal: 'coal',
  steel: 'steel',
  coins: 'coins',
  spear: 'spear',
  sword: 'sword',
  shield: 'shield',
  armour: 'armour',
  steelSword: 'steel-sword',
  steelShield: 'steel-shield',
  steelArmour: 'steel-armour',
  bow: 'bow',
  crossbow: 'crossbow',
  arrows: 'arrows',
}

/** Where slices sit packed in the atlas: each with `pad` pixels of its own edge around it. */
export interface Packed {
  width: number
  height: number
  /** Each slice's top left corner, in the order given. */
  at: [number, number][]
}

/**
 * Packs rectangles of the given sizes in rows no wider than `width`, `pad` pixels around each, so
 * a slice scaled down never blends with its neighbour.
 */
export function packSlices(
  sizes: readonly (readonly [number, number])[],
  width: number,
  pad: number,
): Packed {
  const at: [number, number][] = []
  let [x, y, row] = [0, 0, 0]
  for (const [w, h] of sizes) {
    if (x > 0 && x + w + 2 * pad > width) {
      y += row
      x = row = 0
    }
    at.push([x + pad, y + pad])
    x += w + 2 * pad
    row = Math.max(row, h + 2 * pad)
  }
  return { width, height: y + row, at }
}

/** Whether anything is drawn in a rectangle of RGBA `pixels`, `stride` pixels a row. */
export function isDrawn(pixels: Uint8ClampedArray, stride: number, rect: SliceRect): boolean {
  const [x, y, w, h] = rect
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) if (pixels[(py * stride + px) * 4 + 3]! > 0) return true
  return false
}

/**
 * How big a unit's pixel art is drawn, as [width, height] on screen, for a token of radius `r`:
 * a one-tile figure spans the token, and a bigger image (a hitched carriage, a siege machine) is
 * drawn a little under that scale so it doesn't cover its neighbours.
 */
export function pixelUnitSize(width: number, height: number, r: number): [number, number] {
  const big = Math.max(width, height) > PIXEL_TILE
  const perTile = 2 * r * (big ? 0.8 : 1)
  return [(width / PIXEL_TILE) * perTile, (height / PIXEL_TILE) * perTile]
}
