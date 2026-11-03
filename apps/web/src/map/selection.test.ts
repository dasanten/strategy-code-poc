import { describe, expect, it } from 'vitest'
import {
  inBox,
  mapPickAt,
  pickKey,
  pickableAt,
  pickables,
  toggled,
  type PickWorld,
} from './selection.js'
import type { Spot } from './unit-tokens.js'

// A camera of 10 pixels per tile with tile (0, 0) at the screen's corner.
const place = (x: number, y: number) => [x * 10, y * 10] as const

const residents = [
  { id: 'a', owner: 'me', x: 1, y: 1 },
  { id: 'b', owner: 'me', x: 3, y: 2 },
  { id: 'c', owner: 'me', x: 8, y: 8 },
  { id: 'stranger', owner: 'them', x: 2, y: 2 },
]

describe('selecting residents on the map', () => {
  const list = pickables(residents, 'me', new Map(), place, 10, false)

  it('only offers the Player’s own residents', () => {
    expect(list.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('boxes the own residents inside, dragged either way', () => {
    expect(inBox(list, { x: 0, y: 0 }, { x: 40, y: 30 })).toEqual(['a', 'b'])
    expect(inBox(list, { x: 40, y: 30 }, { x: 0, y: 0 })).toEqual(['a', 'b'])
    // The stranger at (2, 2) is inside too, but not the Player's.
    expect(inBox(list, { x: 20, y: 20 }, { x: 30, y: 30 })).toEqual([])
  })

  it('clicks the nearest own resident in reach, never a stranger', () => {
    expect(pickableAt(list, 16, 16)?.id).toBe('a')
    expect(pickableAt(list, 25, 28)).toBe(undefined)
  })

  it('Shift-click adds a resident or takes them out', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggled(['a', 'b'], 'a')).toEqual(['b'])
    // A stack: added unless all are in already, then taken out.
    expect(toggled(['a'], ['a', 'b'])).toEqual(['a', 'b'])
    expect(toggled(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c'])
  })

  it('up close, only residents drawn as a figure can be picked, where it was drawn', () => {
    const spots = new Map([['b', { x: 100, y: 100, r: 10 }]])
    const close = pickables(residents, 'me', spots, place, 40, true)
    expect(close).toEqual([{ id: 'b', x: 100, y: 100, reach: 14 }])
    expect(inBox(close, { x: 0, y: 0 }, { x: 200, y: 200 })).toEqual(['b'])
  })

  it('boxes a passenger at their carriage, but a click there is the carriage’s', () => {
    const spots = new Map([['p', { x: 50, y: 50, r: 10 }]])
    const aboard = [{ id: 'p', owner: 'me', x: 5, y: 5, aboard: 'k1' }]
    const list = pickables(aboard, 'me', spots, place, 40, true)
    expect(pickableAt(list, 50, 50)).toBeUndefined()
    expect(inBox(list, { x: 0, y: 0 }, { x: 100, y: 100 })).toEqual(['p'])
  })
})

describe('what a click on the map picks (CONTEXT.md: Picking on the map)', () => {
  // Tile (5, 5) on screen runs from pixel 50 to 60; a house covers (5, 5) to (6, 6).
  const house = { id: 'house', kind: 'house' as const, x: 5, y: 5, cityId: null }
  const world = (more: Partial<PickWorld> = {}): PickWorld => ({
    realmId: 'me',
    size: 64,
    residents: [],
    buildings: [house],
    carriages: [],
    horses: [],
    ...more,
  })
  const own = (w: PickWorld, spots: Map<string, Spot>) =>
    pickables(w.residents, 'me', spots, place, 10, true)
  /** A click at a pixel, on the tile under it. */
  const click = (w: PickWorld, spots: Map<string, Spot>, sx: number, sy: number) =>
    mapPickAt(own(w, spots), sx, sy, Math.floor(sx / 10), Math.floor(sy / 10), w)

  it('shows the tile card beside the Player’s tokens on another realm’s carriage', () => {
    const k = { id: 'k', realmId: 'them', x: 8, y: 8, horseId: null }
    const ana = { id: 'ana', owner: 'me', x: 8, y: 8 }
    const bo = { id: 'bo', owner: 'me', x: 8, y: 8 }
    const spots = new Map<string, Spot>([['ana', { x: 89, y: 89, r: 2 }]])
    const w = world({ carriages: [k], residents: [ana] })
    expect(click(w, spots, 81, 81)).toEqual({ kind: 'tile', x: 8, y: 8 })
    // The token itself still picks the resident, whose card offers it too.
    expect(click(w, spots, 89, 89)).toEqual({ kind: 'resident', id: 'ana' })
    const two = world({ carriages: [k], residents: [ana, bo] })
    expect(click(two, new Map(), 81, 81)).toEqual({ kind: 'tile', x: 8, y: 8 })
    // Beside them on the Player's own carriage, they are picked as ever.
    const mine = world({ carriages: [{ ...k, realmId: 'me' }], residents: [ana] })
    expect(click(mine, new Map(), 81, 81)).toEqual({ kind: 'resident', id: 'ana' })
  })
  const horse = { id: 'h', realmId: 'me', x: 5, y: 5 }

  it('on a tile with a resident, a building and a horse, the resident wins', () => {
    const w = world({ residents: [{ id: 'a', owner: 'me', x: 5, y: 5 }], horses: [horse] })
    // The resident's token stands aside, at the tile's lower right.
    const spots = new Map([['a', { x: 58, y: 58, r: 3 }]])
    expect(click(w, spots, 58, 58)).toEqual({ kind: 'resident', id: 'a' })
    // Off their token but on their tile, still them: never the building under them.
    expect(click(w, spots, 51, 51)).toEqual({ kind: 'resident', id: 'a' })
  })

  it('a building wins over a horse, and a horse of the Player’s over the bare tile', () => {
    const w = world({ horses: [horse] })
    expect(click(w, new Map(), 51, 51)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'building', building: house },
    })
    const open = world({ buildings: [], horses: [horse] })
    expect(click(open, new Map(), 51, 51)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'horse', id: 'h' },
    })
  })

  it('a ridden horse is its rider’s, and someone else’s horse is the bare tile', () => {
    const ridden = world({
      buildings: [],
      horses: [horse],
      residents: [{ id: 'a', owner: 'me', x: 9, y: 9, riding: 'h' }],
    })
    expect(click(ridden, new Map(), 51, 51)).toEqual({ kind: 'tile', x: 5, y: 5 })
    const theirs = world({ buildings: [], horses: [{ ...horse, realmId: 'them' }] })
    expect(click(theirs, new Map(), 51, 51)).toEqual({ kind: 'tile', x: 5, y: 5 })
  })

  it('a carriage of the Player’s counts like a building, its passengers inside it', () => {
    const w = world({
      buildings: [],
      carriages: [{ id: 'k', realmId: 'me', x: 5, y: 5, horseId: 'h' }],
      horses: [horse],
      residents: [{ id: 'p', owner: 'me', x: 5, y: 5, aboard: 'k' }],
    })
    const spots = new Map([['p', { x: 55, y: 55, r: 4 }]])
    expect(click(w, spots, 55, 55)).toEqual({
      kind: 'tile',
      x: 5,
      y: 5,
      on: { kind: 'carriage', id: 'k' },
    })
  })

  it('a stack of the Player’s residents picks them all as a group, on the token or the tile', () => {
    const ids = ['a', 'b', 'c']
    const w = world({ residents: ids.map((id) => ({ id, owner: 'me', x: 5, y: 5 })) })
    const stack = { x: 58, y: 58, r: 3, stack: ids }
    const spots = new Map(ids.map((id) => [id, stack]))
    expect(click(w, spots, 58, 58)).toEqual({ kind: 'group', ids })
    expect(click(w, spots, 51, 51)).toEqual({ kind: 'group', ids })
  })

  it('up close a figure picks just them, the "+N" badge the whole stack', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const w = world({ residents: ids.map((id) => ({ id, owner: 'me', x: 5, y: 5 })) })
    const badge = { x: 58, y: 58, r: 2, stack: ids }
    const spots = new Map<string, Spot>([
      ['a', { x: 52, y: 52, r: 2 }],
      ['b', { x: 55, y: 52, r: 2 }],
      ['c', { x: 52, y: 55, r: 2 }],
      ['d', badge],
      ['e', badge],
    ])
    expect(click(w, spots, 52, 52)).toEqual({ kind: 'resident', id: 'a' })
    expect(click(w, spots, 58, 58)).toEqual({ kind: 'group', ids })
  })

  it('a stack with someone else’s resident in it shows the tile card instead', () => {
    const w = world({
      buildings: [],
      residents: [
        { id: 'a', owner: 'me', x: 5, y: 5 },
        { id: 'z', owner: 'them', x: 5, y: 5 },
      ],
    })
    const stack = { x: 55, y: 55, r: 3, stack: ['a', 'z'] }
    const spots = new Map([['a', stack]])
    expect(click(w, spots, 55, 55)).toEqual({ kind: 'tile', x: 5, y: 5 })
    // The same off the token: the tile card lists them both.
    expect(click(w, spots, 51, 51)).toEqual({ kind: 'tile', x: 5, y: 5 })
    // Clicked from the next tile over, the token's own tile is the one carded.
    const reaching = new Map([['a', { ...stack, x: 61, y: 55 }]])
    expect(click(w, reaching, 62, 55)).toEqual({ kind: 'tile', x: 5, y: 5 })
  })

  it('wraps the tile round the map’s edge', () => {
    expect(click(world({ buildings: [] }), new Map(), -5, 5)).toEqual({ kind: 'tile', x: 63, y: 0 })
  })

  it('tells hovers apart by what they would pick', () => {
    expect(pickKey({ kind: 'resident', id: 'a' })).not.toBe(pickKey({ kind: 'group', ids: ['a'] }))
    expect(pickKey({ kind: 'tile', x: 1, y: 2 })).toBe(pickKey({ kind: 'tile', x: 1, y: 2 }))
    expect(pickKey(undefined)).toBe('')
  })
})
