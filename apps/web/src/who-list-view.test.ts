import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_YEAR } from '@csp/balance'
import type { Stock } from '@csp/shared-types'
import {
  NO_WAY_THERE,
  WHO_SUGGESTS,
  afterOffered,
  keptTicks,
  realmRequests,
  searched,
  startsWhen,
  suggested,
  tickedAfter,
  tickedHidden,
  whenOf,
  whoNote,
  whoRows,
  whoTitle,
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
    expect(whoNote(list, 1)).toBe('1 ticked: 1 now.')
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

describe('Now or After', () => {
  const row = (id: string, more: Partial<WhoRow> = {}): WhoRow => ({
    id,
    name: id,
    idle: false,
    tiles: 1,
    ...more,
  })
  // On the queue's work step: a queue's step is their order.
  const working = {
    ...busy,
    queue: {
      realmId: 'r1',
      items: [{ id: 1, order: { kind: 'task', task: 'work', workplaceId: 'f1' } }],
      current: 1,
      startedAt: 0,
      loop: false,
      nextStepId: 2,
    },
  } as Partial<WhoResident>
  const scripted = { script: { scriptId: 3 } } as Partial<WhoResident>

  const hauling = { order: { kind: 'haul' } } as unknown as Partial<WhoResident>
  const storing = { order: { kind: 'store' } } as unknown as Partial<WhoResident>

  it('offers After only where appending keeps what they do: a queue, or a walk of their own', () => {
    expect(afterOffered(resident('q', 0, 0, working))).toBe(true)
    expect(afterOffered(resident('w', 0, 0, busy))).toBe(true)
    // A queue order would end the script, the haul or the order at once (#1444).
    expect(afterOffered(resident('s', 0, 0, scripted))).toBe(false)
    expect(afterOffered(resident('s', 0, 0, { ...busy, ...scripted }))).toBe(false)
    expect(afterOffered(resident('h', 0, 0, hauling))).toBe(false)
    expect(afterOffered(resident('o', 0, 0, storing))).toBe(false)
  })

  it('starts on After for those running a queue, else on Now; Now only where After isn’t offered', () => {
    const list = rows([
      resident('idle', 10, 10),
      resident('walking', 10, 11, busy),
      resident('queued', 10, 12, working),
      resident('scripted', 10, 13, scripted),
      resident('hauling', 10, 14, hauling),
    ])
    expect(Object.fromEntries(list.map((r) => [r.id, startsWhen(r)]))).toEqual({
      idle: undefined,
      walking: 'now',
      queued: 'after',
      scripted: 'now',
      hauling: 'now',
    })
    expect(list.filter((r) => r.noAfter).map((r) => r.id)).toEqual(['scripted', 'hauling'])
    expect(
      whenOf(
        list.find((r) => r.id === 'scripted')!,
        { scripted: 'after' },
      ),
    ).toBe('now')
  })

  it('takes the Player’s choice over where it starts, and none for the idle', () => {
    expect(whenOf(row('a', { keeps: true }), { a: 'now' })).toBe('now')
    expect(whenOf(row('a'), {})).toBe('now')
    expect(whenOf(row('a', { idle: true }), { a: 'after' })).toBeUndefined()
    const list = [
      row('q', { keeps: true }),
      row('w'),
      row('i', { idle: true }),
      row('n', { keeps: true }),
    ]
    expect(tickedAfter(list, ['w', 'q', 'i', 'n'], { n: 'now', w: 'after' })).toEqual(['q', 'w'])
  })

  it('sums up who is ticked now and after', () => {
    const list = [row('a', { idle: true }), row('b')]
    expect(whoNote(list, 3, 1)).toBe('3 ticked: 2 now, 1 after.')
    expect(whoNote(list, 2, 2)).toBe('2 ticked: 2 after.')
    expect(whoNote(list, 1)).toBe('1 ticked: 1 now.')
  })

  const sendCtx = { ...ctx, free: () => true }

  it('Now replaces what they do: a working resident drops it and goes to build', () => {
    const worker = resident('w', 3, 3, working)
    const { requests, skipped } = realmRequests(house, [worker], new Set(), sendCtx)
    expect(skipped).toEqual([])
    expect(requests).toEqual([
      {
        residentId: 'w',
        order: { kind: 'task', task: 'build', building: 'house', at: house.at, residentId: 'w' },
      },
    ])
  })

  it('After appends the build to the end of their queue, finishing nothing early', () => {
    const worker = resident('w', 3, 3, working)
    const { requests } = realmRequests(house, [worker], new Set(['w']), sendCtx)
    const order = requests[0]!.order as { kind: string; steps: { id?: number; order: object }[] }
    expect(order.kind).toBe('editQueue')
    // The work they are on stays first, by its id; the build comes last.
    expect(order.steps[0]).toMatchObject({ id: 1, order: { task: 'work' } })
    expect(order.steps.at(-1)!.order).toMatchObject({ kind: 'task', task: 'build', at: house.at })
  })

  it('sends each ticked one theirs, in the list’s order, now and after mixed', () => {
    const to = [resident('a', 1, 1), resident('b', 2, 2, working), resident('c', 3, 3, busy)]
    const { requests } = realmRequests(house, to, new Set(['b']), sendCtx)
    expect(requests.map((q) => [q.residentId, q.order.kind])).toEqual([
      ['a', 'task'],
      ['b', 'editQueue'],
      ['c', 'task'],
    ])
  })

  it('gives those walking now and after different tiles', () => {
    const to = [resident('a', 1, 1), resident('b', 2, 2, working)]
    const walk = { kind: 'walkTo', x: 10, y: 10 } as const
    const { requests } = realmRequests(walk, to, new Set(['b']), sendCtx)
    const now = requests[0]!.order as unknown as { x: number; y: number }
    const after = requests[1]!.order as unknown as { steps: { order: { x: number; y: number } }[] }
    const last = after.steps.at(-1)!.order
    expect([now.x, now.y]).not.toEqual([last.x, last.y])
  })
})

describe('the who-list’s filters', () => {
  it('counts the ticked the search and filters hide', () => {
    expect(tickedHidden(['a', 'b', 'c'], [{ id: 'b' }])).toBe(2)
    expect(tickedHidden(['a'], [{ id: 'a' }, { id: 'b' }])).toBe(0)
  })
})
