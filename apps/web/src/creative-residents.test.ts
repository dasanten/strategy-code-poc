import { describe, expect, it } from 'vitest'
import { ADULT_AGE, CHILD_YEAR_DAYS, MAX_HEALTH, TICKS_PER_GAME_DAY } from '@csp/balance'
import {
  citiesFromPlaces,
  creativeCities,
  creativeProblem,
  defaultCreativeCity,
  pickedNumber,
  residentActions,
} from './creative-section.js'

const cities = [
  { id: 'n1', name: 'Dunmere', realmId: null },
  { id: 'p2', name: 'Brindle', realmId: 'r2' },
  { id: 'h1', name: 'Harbourgate', realmId: null, tradeOrg: { hq: true } },
  { id: 'c1', name: 'Ashford', realmId: 'r1' },
] as unknown as Parameters<typeof creativeCities>[0]

describe('adding a Resident or horse in creative mode', () => {
  it("lists the admin's own cities first, then the rest by name, with whose each is", () => {
    expect(creativeCities(cities, 'r1')).toEqual([
      { id: 'c1', label: 'Ashford (your realm)' },
      { id: 'p2', label: 'Brindle (a Player’s realm)' },
      { id: 'n1', label: 'Dunmere (NPC city)' },
      { id: 'h1', label: 'Harbourgate (Trade Organization)' },
    ])
  })

  it("picks the tile's city first, then the admin's home city", () => {
    const listed = creativeCities(cities, 'r1')
    expect(defaultCreativeCity(listed, 'n1', 'c1')).toBe('n1')
    expect(defaultCreativeCity(listed, undefined, 'c1')).toBe('c1')
    expect(defaultCreativeCity(listed, 'gone', undefined)).toBe('c1')
    expect(defaultCreativeCity([], undefined, 'c1')).toBeUndefined()
  })

  it('lists every city of the world from the jump list, the admin’s own first', () => {
    const place = (id: string, name: string) => ({ id, name, x: 0, y: 0 })
    const realm = (id: string, name: string, cities: ReturnType<typeof place>[]) => ({
      id,
      name,
      account: null,
      alliance: null,
      leader: null,
      cities,
    })
    const places = {
      realms: [
        realm('r2', 'Northmarch', [place('p2', 'Brindle')]),
        realm('r1', 'Mine', [place('c1', 'Ashford')]),
      ],
      npcCities: [{ ...place('n1', 'Dunmere'), selfManaged: false, alliance: null }],
      tradeOrg: {
        hq: place('h1', 'Coldwater'),
        posts: [place('t1', 'Rookpost')],
        caravans: [],
        traders: [],
      },
    }
    expect(citiesFromPlaces(places, 'r1')).toEqual([
      { id: 'c1', label: 'Ashford (your realm)' },
      { id: 'p2', label: 'Brindle (Northmarch)' },
      { id: 'n1', label: 'Dunmere (NPC city)' },
      { id: 'h1', label: 'Coldwater (Trade Organization)' },
      { id: 't1', label: 'Rookpost (Trade Organization)' },
    ])
  })

  it('takes a number in range, or nothing for an empty field', () => {
    expect(pickedNumber(' 12 ', 1, 30)).toBe(12)
    expect(pickedNumber('2.5', 0, 10)).toBe(2.5)
    for (const bad of ['', 'x', '31', '0']) expect(pickedNumber(bad, 1, 30)).toBeUndefined()
  })
})

describe("a Resident's Creative section", () => {
  const childhood = ADULT_AGE * CHILD_YEAR_DAYS * TICKS_PER_GAME_DAY
  it('heals only the hurt or Down, and grows up only a child', () => {
    const tick = childhood * 2
    const adult = { bornAt: 0, health: MAX_HEALTH }
    expect(residentActions(adult, tick)).toEqual({ heal: false, growUp: false })
    expect(residentActions({ ...adult, health: 40 }, tick).heal).toBe(true)
    expect(residentActions({ ...adult, health: 0, downUntil: tick + 5 }, tick).heal).toBe(true)
    expect(residentActions({ bornAt: tick - 10, health: MAX_HEALTH }, tick).growUp).toBe(true)
  })
})

describe('a creative action done', () => {
  it('says nothing more when it broke no invariant, and names what it broke otherwise', () => {
    expect(creativeProblem({ message: 'Ana stands on (3, 4).', violations: [] })).toBeUndefined()
    expect(creativeProblem({ message: 'Done.', violations: ['a: b', 'c: d'] })).toBe(
      'Done. Invariants broken: a: b; c: d',
    )
  })
})
