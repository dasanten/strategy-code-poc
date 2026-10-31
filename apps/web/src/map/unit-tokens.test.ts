import { describe, expect, it } from 'vitest'
import type { ResidentOrder, SeenResident } from '@csp/shared'
import { ACTIVITY_ART, PAINTED_UNIT_ART, UNIT_ART, paintedCell } from './art.js'
import { CLOSE_SCALE, FAR_SCALE, type Camera } from './camera.js'
import { RELATIONSHIP_COLORS, type BadgeLayer, type TokenLayer } from './tokens.js'
import { drawUnits, mountSpot, type UnitWorld, type Where } from './unit-tokens.js'

interface Placed {
  file: string
  x: number
  y: number
  size: number
  tint?: number
}

const view = { width: 800, height: 600 }
const viewer = { realmId: 'r1', allies: new Set<string>() }
const walkTo = (x: number, y: number): ResidentOrder => ({
  kind: 'walkTo',
  target: { x, y },
  path: null,
  progress: 0,
})

const resident = (
  id: string,
  owner: string,
  more: { riding?: string; order?: ResidentOrder } = {},
): SeenResident =>
  ({ id, owner, cityId: null, x: 10, y: 10, carried: {}, order: null, ...more }) as SeenResident

/**
 * Draws the residents at a zoom and returns every sprite placed, in drawing order; `where` puts
 * tokens on their way between tiles (`Motion`), by default in place.
 */
function draw(residents: SeenResident[], scale: number, where?: Where) {
  const placed: Placed[] = []
  const tokens = {
    place: (file: string, x: number, y: number, size: number, tint?: number) =>
      placed.push({ file, x, y, size, tint }),
  } as unknown as TokenLayer
  const badges = { place: () => {} } as unknown as BadgeLayer
  const world: UnitWorld = {
    map: { size: 64 },
    residents,
    horses: residents.flatMap((r) =>
      r.riding ? [{ id: r.riding, realmId: r.owner, cityId: null, x: r.x, y: r.y }] : [],
    ) as unknown as UnitWorld['horses'],
    carriages: [],
    armies: [],
    caravans: [],
    cities: [],
    buildings: [],
  }
  const cam: Camera = { x: 10.5, y: 10.5, scale }
  const spots = drawUnits(tokens, badges, cam, view, world, viewer, null, where)
  return { placed, spots }
}

const HORSE = paintedCell(PAINTED_UNIT_ART[UNIT_ART.horse]!)
const PERSON = paintedCell(PAINTED_UNIT_ART[UNIT_ART.person]!)
const horses = (placed: Placed[]) => placed.filter((p) => p.file === HORSE)
/** The tint of a painted token is on its ring, placed just before the figure. */
const ringTint = (placed: Placed[], p: Placed) => placed[placed.indexOf(p) - 1]!.tint

const MIDDLE = (FAR_SCALE + CLOSE_SCALE) / 2
const CLOSE = 30

describe('drawUnits: riders (CONTEXT.md: Riding)', () => {
  it('draws no horse under a walker, at any zoom', () => {
    for (const scale of [FAR_SCALE / 2, MIDDLE, CLOSE]) {
      expect(horses(draw([resident('a', 'r1')], scale).placed), `${scale}`).toEqual([])
    }
  })

  it('sits a rider on a horse token the size of theirs, beneath it, at every zoom', () => {
    for (const scale of [FAR_SCALE / 2, MIDDLE, CLOSE]) {
      const { placed, spots } = draw([resident('a', 'r1', { riding: 'h' })], scale)
      const [horse, ...others] = horses(placed)
      expect(others, `${scale}`).toEqual([])
      const rider = placed.find((p) => p.file === PERSON)!
      expect(horse!.size, `${scale}`).toBe(rider.size)
      expect(placed.indexOf(horse!), `${scale}`).toBeLessThan(placed.indexOf(rider))
      const spot = spots.get('a')!
      const mount = mountSpot(spot)
      expect([horse!.x, horse!.y], `${scale}`).toEqual([mount.x, mount.y])
      expect(ringTint(placed, horse!), `${scale}`).toBe(RELATIONSHIP_COLORS.own)
    }
  })

  it("puts the horse under a group token in the rider's colour", () => {
    // Two of the viewer's own walkers and another realm's rider on one tile.
    const { placed } = draw(
      [resident('a', 'r1'), resident('b', 'r1'), resident('c', 'r3', { riding: 'h' })],
      MIDDLE,
    )
    const [horse, ...others] = horses(placed)
    expect(others).toEqual([])
    expect(ringTint(placed, horse!)).toBe(RELATIONSHIP_COLORS.other)
    const group = placed.find((p) => p.file === PERSON)!
    expect(ringTint(placed, group)).toBe(RELATIONSHIP_COLORS.own)
  })

  it('draws only the riders on horses among single figures up close', () => {
    const { placed, spots } = draw(
      [resident('a', 'r1'), resident('b', 'r1', { riding: 'h' }), resident('c', 'r1')],
      CLOSE,
    )
    const mount = mountSpot(spots.get('b')!)
    expect(horses(placed).map((h) => [h.x, h.y])).toEqual([[mount.x, mount.y]])
  })

  it('shows the riding icon by a rider on the way, the walking icon by a walker', () => {
    const { placed } = draw(
      [
        resident('a', 'r1', { order: walkTo(20, 20) }),
        resident('b', 'r1', { riding: 'h', order: walkTo(20, 20) }),
      ],
      CLOSE,
    )
    const icons = placed.filter((p) => Object.values(ACTIVITY_ART).includes(p.file))
    expect(icons.map((p) => p.file).sort()).toEqual(
      [ACTIVITY_ART.riding, ACTIVITY_ART.walking].sort(),
    )
  })
})

describe('drawUnits: tokens on their way (CONTEXT.md: Motion on the map)', () => {
  // Resident `a` is half a tile short of the tile it stepped onto, from the left.
  const halfway: Where = (id, x, y) => (id === 'a' ? [x - 0.5, y] : [x, y])
  /** The screen x of a tile x, the view centred on tile 10. */
  const screenX = (tx: number, scale: number) => view.width / 2 + (tx - 10) * scale

  it('draws a lone token where it is on its way', () => {
    const { spots } = draw([resident('a', 'r1')], MIDDLE, halfway)
    expect(spots.get('a')!.x).toBeCloseTo(screenX(9.5, MIDDLE))
    expect(spots.get('a')!.y).toBeCloseTo(view.height / 2)
  })

  it('draws a group token at the mean of where its members are', () => {
    const { spots } = draw([resident('a', 'r1'), resident('b', 'r1')], MIDDLE, halfway)
    expect(spots.get('a')).toBe(spots.get('b'))
    expect(spots.get('a')!.x).toBeCloseTo(screenX(9.75, MIDDLE))
  })

  it('draws each figure where it is on its way up close, the others in place', () => {
    const inPlace = draw([resident('a', 'r1'), resident('b', 'r1')], CLOSE)
    const moving = draw([resident('a', 'r1'), resident('b', 'r1')], CLOSE, halfway)
    expect(moving.spots.get('a')!.x).toBeCloseTo(inPlace.spots.get('a')!.x - 0.5 * CLOSE)
    expect(moving.spots.get('a')!.y).toBeCloseTo(inPlace.spots.get('a')!.y)
    expect(moving.spots.get('b')).toEqual(inPlace.spots.get('b'))
  })

  it('draws a rider and their horse as one, on their way together', () => {
    const { placed, spots } = draw([resident('a', 'r1', { riding: 'h' })], MIDDLE, halfway)
    const mount = mountSpot(spots.get('a')!)
    expect(horses(placed).map((h) => [h.x, h.y])).toEqual([[mount.x, mount.y]])
  })
})

describe('mountSpot', () => {
  it('is a token the size of the rider, behind it to the lower left', () => {
    const m = mountSpot({ x: 100, y: 100, r: 10 })
    expect(m.r).toBe(10)
    expect(m.x).toBeLessThan(100)
    expect(m.y).toBeGreaterThan(100)
  })
})
