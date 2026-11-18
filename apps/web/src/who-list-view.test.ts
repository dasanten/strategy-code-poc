import { describe, expect, it } from 'vitest'
import { ROAD_LINE_MAX_TILES, TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Stock } from '@csp/shared-types'
import {
  NO_WAY_THERE,
  WHO_SUGGESTS,
  keptTicks,
  lineProblem,
  searched,
  suggested,
  wayTarget,
  whoNote,
  whoRows,
  whoTitle,
  whoWhere,
  whyNot,
  type WhoOrder,
  type WhoResident,
  type WhoRow,
  type WhoWay,
} from './who-list-view.js'

const TICK = 100 * TICKS_PER_GAME_YEAR
const SIZE = 64
const ctx = { tick: TICK, size: SIZE }

const resident = (id: string, x: number, y: number, more: Partial<WhoResident> = {}) =>
  ({
    id,
    name: id.toUpperCase(),
    x,
    y,
    bornAt: TICK - 30 * TICKS_PER_GAME_YEAR,
    carried: {} as Stock,
    owner: 'r1',
    cityId: null,
    ...more,
  }) as WhoResident
const busy = {
  order: { kind: 'walkTo', target: { x: 0, y: 0 }, progress: 0 },
} as Partial<WhoResident>
const child = { bornAt: TICK } as Partial<WhoResident>
const carrying = { carrying: { partnerName: 'P', since: 0 } } as Partial<WhoResident>

const house: WhoOrder = { kind: 'build', building: 'house', at: { x: 10, y: 10 } }
/** As the crow flies when no way is known; `none` for those in `noWay`. */
const ways =
  (noWay: string[] = [], known: Record<string, WhoWay> = {}) =>
  (r: WhoResident): WhoWay =>
    noWay.includes(r.id) ? 'none' : known[r.id]
const rows = (rs: WhoResident[], wayOf = ways()) => whoRows(house, rs, house.at, wayOf, ctx)

describe('who can take a realm order', () => {
  it('turns down children and a partner carrying a child, saying why', () => {
    expect(whyNot(house, resident('a', 0, 0, child), undefined, ctx)).toBe('a child')
    expect(whyNot(house, resident('a', 0, 0, carrying), undefined, ctx)).toMatch(/carrying/)
  })

  it('turns down those with no way there, but not those standing far off', () => {
    expect(whyNot(house, resident('a', 40, 40), 'none', ctx)).toBe(NO_WAY_THERE)
    expect(whyNot(house, resident('a', 40, 40), undefined, ctx)).toBeUndefined()
    expect(whyNot(house, resident('a', 40, 40), { tiles: 30 }, ctx)).toBeUndefined()
  })
})

describe('the who-list’s rows', () => {
  it('lists the nearest to the target first, by the way’s tiles where known', () => {
    const list = rows(
      [resident('far', 30, 10), resident('near', 12, 10), resident('mid', 10, 20)],
      ways([], { far: { tiles: 5, ticks: 300 } }),
    )
    expect(list.map((r) => r.id)).toEqual(['near', 'far', 'mid'])
    expect(list[1]).toMatchObject({ tiles: 5, ticks: 300 })
    expect(list[0]).toMatchObject({ tiles: 2 })
  })

  it('lists those who can’t take it last, greyed out with why, nearest first too', () => {
    const list = rows(
      [
        resident('kid', 10, 11, child),
        resident('island', 10, 12),
        resident('a', 20, 10),
        resident('b', 15, 10),
      ],
      ways(['island']),
    )
    expect(list.map((r) => [r.id, r.why])).toEqual([
      ['b', undefined],
      ['a', undefined],
      ['kid', 'a child'],
      ['island', NO_WAY_THERE],
    ])
  })

  it('measures the short way round the map', () => {
    const list = rows([resident('a', 62, 10), resident('b', 25, 10)])
    expect(list[0]).toMatchObject({ id: 'a', tiles: 12 })
  })

  it('tells idle residents from busy ones', () => {
    const list = rows([resident('a', 10, 10), resident('b', 11, 10, busy)])
    expect(list.map((r) => r.idle)).toEqual([true, false])
  })
})

describe('the suggestion', () => {
  const row = (id: string, more: Partial<WhoRow> = {}): WhoRow => ({
    id,
    name: id,
    idle: true,
    tiles: 1,
    ...more,
  })

  it('ticks the nearest idle ones who can take it, as many as the order wants', () => {
    const list = [
      row('busy', { idle: false }),
      row('a'),
      row('b'),
      row('c'),
      row('kid', { why: 'a child' }),
    ]
    expect(suggested(list, WHO_SUGGESTS.build)).toEqual(['a', 'b'])
    expect(suggested(list, 5)).toEqual(['a', 'b', 'c'])
  })

  it('ticks nobody when nobody is idle, and says so', () => {
    const list = [row('a', { idle: false }), row('b', { idle: false })]
    expect(suggested(list, 2)).toEqual([])
    expect(whoNote(list, 0)).toBe('Nobody is idle, so nobody is ticked: tick who should do it.')
    expect(whoNote(list, 1)).toBe('1 ticked.')
  })

  it('says when nobody can take the order at all', () => {
    expect(whoNote([row('kid', { why: 'a child' })], 0)).toBe('Nobody can take this order.')
    expect(whoNote([], 0)).toBe('Nobody can take this order.')
  })

  it('keeps ticks only for those still listed who can take it', () => {
    const list = [row('a'), row('kid', { why: 'a child' })]
    expect(keptTicks(['a', 'kid', 'gone'], list)).toEqual(['a'])
  })
})

describe('the who-list’s search and title', () => {
  it('finds rows by any part of the name, any case', () => {
    const list = rows([resident('anna', 0, 0), resident('bert', 0, 0)])
    expect(searched(list, 'NN').map((r) => r.id)).toEqual(['anna'])
    expect(searched(list, '  ')).toHaveLength(2)
  })

  it('says what is to be built', () => {
    expect(whoTitle(house)).toBe('Build a house')
    expect(whoTitle({ ...house, building: 'haven' })).toBe('Build a haven')
    expect(whoTitle({ ...house, building: 'wall', material: 'stone' })).toBe('Build a stone wall')
  })
})

describe('a road or wall line on the who-list', () => {
  const line: WhoOrder = {
    kind: 'line',
    building: 'road',
    from: { x: 10, y: 10 },
    to: { x: 16, y: 10 },
  }

  it('says what is to be built and where', () => {
    expect(whoTitle(line, SIZE)).toBe('Build a road line of 7 tiles')
    expect(whoTitle({ ...line, building: 'wall', material: 'stone', to: line.from }, SIZE)).toBe(
      'Build a stone wall line of 1 tile',
    )
    expect(whoWhere(line)).toBe('from 10, 10 to 16, 10')
    expect(whoWhere(house)).toBe('at 10, 10')
  })

  it('shows each resident the way to the line’s tile nearest them', () => {
    expect(wayTarget(line, { x: 20, y: 9 }, SIZE)).toEqual({ x: 16, y: 10 })
    expect(wayTarget(line, { x: 13, y: 12 }, SIZE)).toEqual({ x: 13, y: 10 })
    expect(wayTarget(house, { x: 40, y: 40 }, SIZE)).toEqual(house.at)
    const list = whoRows(
      line,
      [resident('a', 20, 10), resident('b', 13, 12)],
      (r) => wayTarget(line, r, SIZE),
      ways(),
      ctx,
    )
    expect(list.map((r) => [r.id, r.tiles])).toEqual([
      ['b', 2],
      ['a', 4],
    ])
  })

  it('ticks a few more for a line, which they share', () => {
    expect(WHO_SUGGESTS.line).toBeGreaterThan(WHO_SUGGESTS.build)
  })

  it('says why a line can’t be built before the who-list', () => {
    const anywhere = () => true
    expect(lineProblem(line, SIZE, anywhere)).toBeUndefined()
    const long = { ...line, to: { x: 10 + ROAD_LINE_MAX_TILES, y: 10 } }
    expect(lineProblem(long, 1024, anywhere)).toBe(
      `a line covers at most ${ROAD_LINE_MAX_TILES} tiles`,
    )
    expect(lineProblem(line, SIZE, () => false)).toBe('no road to build on that line')
    expect(lineProblem(line, SIZE, (x) => x === 16)).toBeUndefined()
  })

  it('turns down children for a line too', () => {
    expect(whyNot(line, resident('a', 0, 0, child), undefined, ctx)).toBe('a child')
  })
})
