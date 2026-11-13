import { describe, expect, it } from 'vitest'
import { TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building, City } from '@csp/shared-types'
import {
  CITY_SCALE,
  cityLists,
  cityOverview,
  citySections,
  cityStock,
  cityPlace,
  cityScale,
  type CitiesKnown,
} from './cities-drawer-view.js'
import { showBeside } from './hud-view.js'
import { FAR_SCALE, zoomTier } from './map/camera.js'
import { HOUSING_ROOM } from './shared/narrowed.js'

const town = (
  id: string,
  name: string,
  realmId: string | null,
  more: Partial<City> = {},
): City => ({
  id,
  name,
  realmId,
  townHallId: `${id}-hall`,
  occupation: null,
  ...more,
})
const building = (id: string, kind: Building['kind'], cityId: string, more = {}): Building => ({
  id,
  kind,
  cityId,
  x: 0,
  y: 0,
  ...more,
})
const viewer = { realmId: 'me', allies: new Set(['friend']) }
const realms = [
  { realmId: 'friend', realm: 'Ostmark' },
  { realmId: 'rival', realm: 'Vael' },
]
const tick = 10 * TICKS_PER_GAME_DAY
const known = (more: Partial<CitiesKnown> = {}): CitiesKnown => ({
  cities: [],
  buildings: [],
  residents: [],
  lastSeen: { cities: [], buildings: [] },
  ...more,
})

describe('the Cities drawer’s lists', () => {
  it('sorts cities into Your cities, Others in sight and Last seen, by name', () => {
    const lists = cityLists(
      known({
        cities: [
          town('c2', 'Brightwater', 'me'),
          town('c1', 'Ashford', 'me'),
          town('n1', 'Millbrook', null),
          town('a1', 'Eastholm', 'friend'),
        ],
        lastSeen: {
          cities: [{ ...town('r1', 'Vaelgard', 'rival'), seenAt: tick - 3 * TICKS_PER_GAME_DAY }],
          buildings: [],
        },
      }),
      viewer,
      realms,
      tick,
    )
    expect(lists.map((l) => [l.title, l.rows.map((r) => r.name)])).toEqual([
      ['Your cities', ['Ashford', 'Brightwater']],
      ['Others in sight', ['Eastholm', 'Millbrook']],
      ['Last seen', ['Vaelgard']],
    ])
  })

  it('leaves out a list with no cities', () => {
    const lists = cityLists(known({ cities: [town('c1', 'Ashford', 'me')] }), viewer, realms, tick)
    expect(lists.map((l) => l.id)).toEqual(['own'])
    expect(cityLists(known(), viewer, realms, tick)).toEqual([])
  })

  it('shows an own city’s residents against housing and the key goods in its storages', () => {
    const [own] = cityLists(
      known({
        cities: [town('c1', 'Ashford', 'me')],
        buildings: [
          building('h1', 'house', 'c1'),
          building('h2', 'house', 'c1'),
          building('s1', 'storage', 'c1', { stock: { food: 12, wood: 5, iron: 3 } }),
          building('s2', 'storage', 'c1', { stock: { food: 1, coins: 4 } }),
          building('s3', 'storage', 'other', { stock: { food: 99 } }),
        ],
        residents: [{ cityId: 'c1' }, { cityId: 'c1' }, { cityId: 'c1' }, { cityId: 'other' }],
      }),
      viewer,
      realms,
      tick,
    )
    expect(own!.rows[0]).toEqual({
      id: 'c1',
      name: 'Ashford',
      whose: 'Your city',
      rel: 'own',
      housing: { residents: 3, room: 2 * HOUSING_ROOM.house! + (HOUSING_ROOM.storage ?? 0) * 2 },
      goods: [
        { good: 'food', amount: 13 },
        { good: 'wood', amount: 5 },
        { good: 'stone', amount: 0 },
        { good: 'coins', amount: 4 },
      ],
    })
  })

  it('colours an allied, an NPC and a Trade Org city by their relation, with no goods', () => {
    const [others] = cityLists(
      known({
        cities: [
          town('a1', 'Eastholm', 'friend'),
          town('n1', 'Millbrook', null),
          town('t1', 'Saltgate', null, { tradeOrg: 'post' }),
          town('r1', 'Vaelgard', 'rival'),
        ],
      }),
      viewer,
      realms,
      tick,
    )
    expect(others!.rows).toEqual([
      { id: 'a1', name: 'Eastholm', whose: 'City of the realm of Ostmark', rel: 'alliance' },
      { id: 'n1', name: 'Millbrook', whose: 'NPC city', rel: 'npcCity' },
      { id: 't1', name: 'Saltgate', whose: 'Trading post', rel: 'tradeOrg' },
      { id: 'r1', name: 'Vaelgard', whose: 'City of the realm of Vael', rel: 'otherRealm' },
    ])
  })

  it('says how long ago a last-seen city was seen', () => {
    const [last] = cityLists(
      known({
        lastSeen: {
          cities: [{ ...town('n1', 'Millbrook', null), seenAt: tick - 3 * TICKS_PER_GAME_DAY }],
          buildings: [],
        },
      }),
      viewer,
      realms,
      tick,
    )
    expect(last!.rows).toEqual([
      { id: 'n1', name: 'Millbrook', whose: 'NPC city', rel: 'npcCity', ago: '3 days ago' },
    ])
  })

  it('keeps an occupation on the row, a warning on the Player’s own city', () => {
    const occupation = { realmId: 'rival', since: tick }
    const [own] = cityLists(
      known({ cities: [town('c1', 'Ashford', 'me', { occupation })] }),
      viewer,
      realms,
      tick,
    )
    expect(own!.rows[0]!.occupation).toMatchObject({ warning: true, realmId: 'rival' })
  })
})

const cities = [
  { id: 'c1', townHallId: 'h1' },
  { id: 'c2', townHallId: 'h2' },
]

describe('opening a city in the Cities drawer', () => {
  it('centres on its town hall, in sight or last seen', () => {
    const inSight = [{ id: 'h1', x: 10, y: 20 }]
    const lastSeen = [{ id: 'h2', x: 90, y: 5 }]
    expect(cityPlace('c1', cities, [...inSight, ...lastSeen])).toEqual({ x: 10, y: 20 })
    expect(cityPlace('c2', cities, [...inSight, ...lastSeen])).toEqual({ x: 90, y: 5 })
  })

  it('has no place without a known town hall or city', () => {
    expect(cityPlace('c2', cities, [{ id: 'h1', x: 1, y: 1 }])).toBeUndefined()
    expect(cityPlace('c9', cities, [{ id: 'h1', x: 1, y: 1 }])).toBeUndefined()
  })

  it('zooms out to the far tier, where the city is outlined, and no further', () => {
    expect(zoomTier(CITY_SCALE)).toBe('far')
    expect(cityScale(20)).toBe(CITY_SCALE)
    expect(cityScale(FAR_SCALE)).toBe(CITY_SCALE)
    expect(cityScale(3)).toBe(3)
  })

  it('centres in the map left free beside the open drawer', () => {
    // The drawer covers the left; the city shows in the map beside it.
    expect(showBeside(1280, 428, 0)).toEqual({ left: 428, right: 0, closeDrawer: false })
    // A phone has no map beside the drawer: it closes so the city shows.
    expect(showBeside(375, 375, 0)).toEqual({ left: 0, right: 0, closeDrawer: true })
  })
})

describe('an opened city’s sections', () => {
  const ids = (facts: Parameters<typeof citySections>[0]) => citySections(facts).map((s) => s.title)

  it('gives an own city Overview, Stock, Trade and Gates', () => {
    expect(ids({ own: true, stock: 3, trade: true, gates: 2 })).toEqual([
      'Overview',
      'Stock',
      'Trade',
      'Gates',
    ])
  })

  it('leaves out an own city’s sections with nothing to show', () => {
    expect(ids({ own: true, stock: 0, trade: false, gates: 0 })).toEqual(['Overview'])
  })

  it('gives an NPC city Overview and Trade, never Stock or Gates', () => {
    expect(ids({ own: false, stock: 4, trade: true, gates: 1 })).toEqual(['Overview', 'Trade'])
  })

  it('gives a last-seen city its Overview, and Trade only with prices remembered', () => {
    expect(ids({ own: false, stock: 0, trade: true, gates: 0 })).toEqual(['Overview', 'Trade'])
    expect(ids({ own: false, stock: 0, trade: false, gates: 0 })).toEqual(['Overview'])
  })
})

describe('an opened city’s Overview and Stock', () => {
  const buildings = [
    building('t', 'townHall', 'c1'),
    building('h1', 'house', 'c1'),
    building('h2', 'house', 'c1'),
    building('h3', 'house', 'c1', { site: { needs: {}, has: {} } }),
    building('w1', 'wall', 'c1'),
    building('r1', 'road', 'c1'),
    building('s1', 'storage', 'c1', { stock: { food: 4, iron: 2 } }),
    building('s2', 'warehouse', 'c1', { stock: { food: 1, coins: 9 } }),
    building('st', 'stable', 'c1', { stock: { food: 50 } }),
    building('x', 'storage', 'c2', { stock: { wood: 7 } }),
  ]

  it('counts residents, housing and finished buildings by kind, without walls and roads', () => {
    const o = cityOverview(
      { id: 'c1' },
      { residents: [{ cityId: 'c1' }, { cityId: 'c2' }], buildings: buildings as Building[] },
    )
    expect(o.residents).toBe(1)
    expect(o.housing).toBe(
      ['townHall', 'house', 'house', 'storage', 'warehouse', 'stable', 'wall', 'road'].reduce(
        (n, k) => n + (HOUSING_ROOM[k as Building['kind']] ?? 0),
        0,
      ),
    )
    expect(o.buildings).toEqual([
      ['house', 2],
      ['townHall', 1],
      ['storage', 1],
      ['warehouse', 1],
      ['stable', 1],
    ])
  })

  it('adds up every good in the city’s storages and warehouses, not its stable', () => {
    expect(cityStock({ id: 'c1' }, buildings as Building[])).toEqual([
      { good: 'food', amount: 5 },
      { good: 'iron', amount: 2 },
      { good: 'coins', amount: 9 },
    ])
  })
})
