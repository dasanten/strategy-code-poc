import { describe, expect, it } from 'vitest'
import { GOODS } from '../shared/world.js'
import { FOOTPRINT } from '../shared/footprint.js'
import { SHARES_A_TILE } from '../shared/building.js'
import { NODE_KINDS } from '../shared/chunks.js'
import { BUILDING_NAMES } from './palette.js'
import {
  PIXEL_FILES,
  PIXEL_GOOD,
  PIXEL_PILE,
  ROAD_PIECES,
  isDrawn,
  joinedPiece,
  packSlices,
  pixelArt,
  pixelBuilding,
  pixelGate,
  pixelNode,
  pixelRoad,
  pixelSlice,
  pixelTint,
  pixelUnit,
  pixelUnitSize,
  pixelWall,
  type PixelSheet,
  type Sides,
} from './pixel-art.js'
import { PIXEL_SLICES } from './pixel-slices.js'

const sides = (on: string): Sides => ({
  left: on.includes('l'),
  right: on.includes('r'),
  up: on.includes('u'),
  down: on.includes('d'),
})
const ALL_SIDES = ['', 'l', 'r', 'u', 'd', 'lr', 'ud', 'lu', 'ld', 'ru', 'rd', 'lru', 'lrd', 'lud', 'rud', 'lrud'] // prettier-ignore

/** Whether an atlas key names a slice the export has. */
const exported = (key: string) => {
  const [, sheet, slice] = key.split('/')
  return pixelSlice(sheet as PixelSheet, slice!) !== undefined
}

describe('joined pieces', () => {
  it('picks the piece by how many sides join', () => {
    expect(joinedPiece(sides('')).piece).toBe('single')
    expect(joinedPiece(sides('r')).piece).toBe('end')
    expect(joinedPiece(sides('lr')).piece).toBe('straight')
    expect(joinedPiece(sides('rd')).piece).toBe('corner')
    expect(joinedPiece(sides('lrd')).piece).toBe('t')
    expect(joinedPiece(sides('lrud')).piece).toBe('cross')
  })

  it('draws each piece unturned the way it is drawn in the art', () => {
    for (const on of ['', 'r', 'lr', 'rd', 'lrd', 'lrud'])
      expect(joinedPiece(sides(on)).turns, on).toBe(0)
  })

  it('turns a piece clockwise until its joins are where the neighbours are', () => {
    // A quarter turn clockwise moves right to down, down to left, left to up, up to right.
    const turn = (s: Sides): Sides => ({ down: s.right, left: s.down, up: s.left, right: s.up })
    const drawn: Record<string, Sides> = {
      single: sides(''),
      end: sides('r'),
      straight: sides('lr'),
      corner: sides('rd'),
      t: sides('lrd'),
      cross: sides('lrud'),
    }
    for (const on of ALL_SIDES) {
      const { piece, turns } = joinedPiece(sides(on))
      let s = drawn[piece]!
      for (let i = 0; i < turns; i++) s = turn(s)
      expect(s, on).toEqual(sides(on))
    }
  })
})

describe('pixel art registry', () => {
  it('has a slice for every wall, gate and road piece', () => {
    for (const on of ALL_SIDES)
      for (const stone of [false, true]) {
        expect(exported(pixelWall(stone, sides(on)).key), `wall ${on}`).toBe(true)
        expect(exported(pixelRoad(sides(on)).key), `road ${on}`).toBe(true)
        for (const closed of [false, true])
          expect(exported(pixelGate(stone, closed, sides(on))), `gate ${on}`).toBe(true)
      }
    expect(ROAD_PIECES.every(exported)).toBe(true)
  })

  it('draws a gate along its wall, open or closed, of wood or stone', () => {
    expect(pixelGate(false, true, sides('lr'))).toBe(pixelArt('tiles', 'gate-wood-ew'))
    expect(pixelGate(true, false, sides('ud'))).toBe(pixelArt('tiles', 'gate-stone-open-ns'))
    // Standing alone, or joined both ways, it is drawn as in an east–west wall.
    expect(pixelGate(false, true, sides(''))).toBe(pixelArt('tiles', 'gate-wood-ew'))
    expect(pixelGate(false, true, sides('lu'))).toBe(pixelArt('tiles', 'gate-wood-ew'))
  })

  it('has a slice for every building that isn’t a wall, gate, road or vehicle site', () => {
    const pieces = ['wall', 'gate', 'road']
    // Roads and the sites of what moves off: a site's slice, but none of their own.
    const vehicles: readonly string[] = SHARES_A_TILE
    for (const kind of Object.keys(BUILDING_NAMES) as (keyof typeof BUILDING_NAMES)[]) {
      const key = pixelBuilding(kind, false, false)
      if (pieces.includes(kind)) expect(key, kind).toBeUndefined()
      else if (vehicles.includes(kind)) expect(key, kind).toBeUndefined()
      else expect(key !== undefined && exported(key), kind).toBe(true)
      if (!pieces.includes(kind)) {
        const site = pixelBuilding(kind, true, false)
        expect(site, kind).toBe(pixelArt('buildings', `site-${FOOTPRINT[kind]}x${FOOTPRINT[kind]}`))
        expect(exported(site!), kind).toBe(true)
      }
    }
    expect(pixelBuilding('tower', false, true)).toBe(pixelArt('buildings', 'tower-stone'))
  })

  it('has a slice for every node, the pile and every good but tools', () => {
    for (const kind of NODE_KINDS) expect(exported(pixelNode(kind)), kind).toBe(true)
    expect(exported(PIXEL_PILE)).toBe(true)
    for (const good of GOODS) {
      const slice = PIXEL_GOOD[good]
      if (good === 'tools') expect(slice).toBeUndefined()
      else expect(slice && pixelSlice('goods', slice), good).toBeDefined()
    }
  })

  it('has every sheet’s image, and its tint image if it has a tint layer', () => {
    for (const [name, sheet] of Object.entries(PIXEL_SLICES)) {
      expect(PIXEL_FILES[`${name}.png`], name).toBeDefined()
      expect(PIXEL_FILES[`${name}-tint.png`] !== undefined, name).toBe(sheet.tint)
    }
  })
})

describe('units in pixel art', () => {
  const all = () => true
  const resident = (name: string) => pixelArt('resident', name)

  it('draws a vehicle from its slice, a carriage with its horse when hitched', () => {
    expect(pixelUnit('horse.svg', {}, all)?.layers).toEqual([pixelArt('units', 'horse')])
    expect(pixelUnit('cart.svg', {}, all)?.layers).toEqual([pixelArt('units', 'carriage')])
    expect(pixelUnit('cart.svg', { hitched: true }, all)?.layers).toEqual([
      pixelArt('units', 'carriage-hitched'),
    ])
    // A caravan has no hitched image, so it keeps its own.
    const noHitched = (key: string) => !key.endsWith('caravan-hitched')
    expect(pixelUnit('caravan.svg', { hitched: true }, noHitched)?.layers).toEqual([
      pixelArt('units', 'caravan'),
    ])
  })

  it('is undefined for art not drawn yet, so the painted look stays', () => {
    expect(pixelUnit('horse.svg', {}, () => false)).toBeUndefined()
    expect(pixelUnit('person.svg', {}, () => false)).toBeUndefined()
    expect(pixelUnit('activity-walking.svg', {}, all)).toBeUndefined()
  })

  it('stacks a resident’s gear over the body, the crown on a Leader', () => {
    const gear = {
      armour: 'iron',
      shield: 'steel',
      weapon: { kind: 'sword', metal: 'iron' },
    } as const
    expect(pixelUnit('crown.svg', { gear }, all)).toEqual({
      layers: ['body', 'armour', 'leader-crown', 'steel-shield', 'sword'].map(resident),
      unshown: {},
    })
    expect(pixelUnit('person.svg', {}, all)?.layers).toEqual([resident('body')])
  })

  it('shows steel gear with the iron layer while it has none, and leaves the rest to the marks', () => {
    const drawn = new Set(['body', 'armour', 'sword'].map(resident))
    const gear = {
      armour: 'steel',
      shield: 'iron',
      weapon: { kind: 'spear', metal: 'iron' },
    } as const
    expect(pixelUnit('person.svg', { gear }, (k) => drawn.has(k))).toEqual({
      layers: [resident('body'), resident('armour')],
      unshown: { shield: 'iron', weapon: { kind: 'spear', metal: 'iron' } },
    })
  })

  it('draws a one-tile figure across its token and bigger art a little under that scale', () => {
    expect(pixelUnitSize(16, 16, 10)).toEqual([20, 20])
    expect(pixelUnitSize(32, 16, 10)).toEqual([32, 16])
  })

  it('names the tint of a slice after it', () => {
    expect(pixelTint(pixelArt('units', 'caravan'))).toBe('pixel/units/caravan#tint')
  })
})

describe('the pixel art atlas', () => {
  it('packs slices in rows with their padding, none overlapping', () => {
    const sizes = [[16, 16], [32, 32], [48, 48], [16, 16], [64, 64], [32, 16]] as const // prettier-ignore
    const { width, height, at } = packSlices(sizes, 128, 8)
    const boxes = at.map(([x, y], i) => [x - 8, y - 8, x + sizes[i]![0] + 8, y + sizes[i]![1] + 8])
    for (const [x0, y0, x1, y1] of boxes) {
      expect(x0).toBeGreaterThanOrEqual(0)
      expect(y0).toBeGreaterThanOrEqual(0)
      expect(x1).toBeLessThanOrEqual(width)
      expect(y1).toBeLessThanOrEqual(height)
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!]
        const apart = a[2]! <= b[0]! || b[2]! <= a[0]! || a[3]! <= b[1]! || b[3]! <= a[1]!
        expect(apart, `${i} and ${j}`).toBe(true)
      }
  })

  it('tells a drawn slice from an empty one', () => {
    // 4×2 pixels, only the one at (3, 1) drawn.
    const pixels = new Uint8ClampedArray(4 * 2 * 4)
    pixels[(1 * 4 + 3) * 4 + 3] = 255
    expect(isDrawn(pixels, 4, [0, 0, 2, 2])).toBe(false)
    expect(isDrawn(pixels, 4, [2, 0, 2, 2])).toBe(true)
  })
})
