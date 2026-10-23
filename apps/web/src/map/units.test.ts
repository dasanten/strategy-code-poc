import { describe, expect, it } from 'vitest'
import { armyBanners, entityRelationship, residentGroups, type Known } from './units.js'
import type { Relationship } from './tokens.js'

const viewer = { realmId: 'r1', allies: new Set(['r2']) }
const known: Known = {
  cities: new Map([
    ['npc', { realmId: null }],
    ['post', { realmId: null, tradeOrg: 'post' as const }],
    ['mine', { realmId: 'r1' }],
  ]),
  caravan: new Set(['crew', 'wagon']),
}

describe('entityRelationship', () => {
  it('tells a resident of each kind of owner apart', () => {
    const r = (id: string, owner: string | null, cityId: string | null = null) =>
      entityRelationship({ id, owner, cityId }, viewer, known)
    expect(r('a', 'r1', 'mine')).toBe('own')
    expect(r('b', 'r2')).toBe('alliance')
    expect(r('c', 'r3')).toBe('other')
    expect(r('d', null, 'npc')).toBe('npc')
    expect(r('e', null, 'post')).toBe('trade')
    expect(r('f', null)).toBeUndefined()
  })

  it("makes a Trade Org caravan's carriage and crew the Trade Organization's", () => {
    expect(entityRelationship({ id: 'crew', owner: null, cityId: 'npc' }, viewer, known)).toBe(
      'trade',
    )
    expect(entityRelationship({ id: 'wagon', realmId: null, cityId: null }, viewer, known)).toBe(
      'trade',
    )
  })

  it('reads horses, carriages and armies by their realm or city', () => {
    expect(entityRelationship({ id: 'h', realmId: 'r2', cityId: null }, viewer, known)).toBe(
      'alliance',
    )
    expect(entityRelationship({ id: 'k', realmId: null, cityId: 'npc' }, viewer, known)).toBe('npc')
    expect(entityRelationship({ id: 'army', realmId: 'r1' }, viewer, known)).toBe('own')
    // The admin map has no viewer: each realm in its own colour, cities and caravans as ever.
    const admin = { ...viewer, realmColour: (id: string) => (id === 'r1' ? 0xabcdef : 0x123456) }
    expect(entityRelationship({ id: 'army', realmId: 'r1' }, admin, known)).toBe(0xabcdef)
    expect(entityRelationship({ id: 'h', realmId: 'r2', cityId: null }, admin, known)).toBe(
      0x123456,
    )
    expect(entityRelationship({ id: 'k', realmId: null, cityId: 'npc' }, admin, known)).toBe('npc')
    expect(entityRelationship({ id: 'wagon', realmId: null, cityId: null }, admin, known)).toBe(
      'trade',
    )
    // A city out of sight: nothing to go by.
    expect(
      entityRelationship({ id: 'k2', realmId: null, cityId: 'far' }, viewer, known),
    ).toBeUndefined()
  })
})

describe('residentGroups', () => {
  const rels: Record<string, Relationship | undefined> = {
    me: 'own',
    me2: 'own',
    ally: 'alliance',
    o1: 'other',
    o2: 'other',
    o3: 'other',
    stray: undefined,
  }
  const at = (id: string, x: number, y: number) => ({ id, x, y })
  const relOf = (id: string) => rels[id]

  it('makes one token per tile with everyone on it, coloured by the largest group', () => {
    const groups = residentGroups(
      [at('me', 1, 1), at('o1', 1, 1), at('o2', 1, 1), at('ally', 2, 1), at('o3', 1, 1)],
      relOf,
      undefined,
    )
    expect(groups).toHaveLength(2)
    const first = groups.find((g) => g.x === 1)!
    expect(first.ids).toEqual(['me', 'o1', 'o2', 'o3'])
    expect(first.rel).toBe('other')
    expect(groups.find((g) => g.x === 2)).toMatchObject({ ids: ['ally'], rel: 'alliance' })
  })

  it("breaks a tie in the viewer's favour, then alliance, then others", () => {
    const [g] = residentGroups([at('o1', 0, 0), at('me', 0, 0)], relOf, undefined)
    expect(g!.rel).toBe('own')
    const [h] = residentGroups([at('o1', 0, 0), at('ally', 0, 0)], relOf, undefined)
    expect(h!.rel).toBe('alliance')
    const [s] = residentGroups([at('stray', 0, 0)], relOf, undefined)
    expect(s!.rel).toBeUndefined()
  })

  it('crowns the tile with your Leader and leaves out soldiers under a banner', () => {
    const groups = residentGroups(
      [at('me', 0, 0), at('me2', 0, 0), at('o1', 5, 5)],
      relOf,
      'me',
      new Set(['me2']),
    )
    expect(groups.find((g) => g.x === 0)).toMatchObject({ ids: ['me'], leader: true })
    expect(groups.find((g) => g.x === 5)!.leader).toBe(false)
  })

  it('on the admin map, colours by realm and crowns every Leader', () => {
    const tones: Record<string, number | 'npc'> = { a: 0x111111, a2: 0x111111, b: 0x222222 }
    const groups = residentGroups(
      [at('a', 0, 0), at('a2', 0, 0), at('b', 0, 0), at('b', 3, 3)],
      (id) => tones[id],
      new Set(['b']),
    )
    expect(groups.find((g) => g.x === 0)).toMatchObject({ rel: 0x111111, leader: true })
    // A realm's colour ranks like another realm: an NPC city's resident doesn't win a tie.
    const [tie] = residentGroups(
      [at('n', 0, 0), at('b', 0, 0)],
      (id) => (id === 'n' ? 'npc' : 0x222222),
      undefined,
    )
    expect(tie!.rel).toBe(0x222222)
  })
})

describe('armyBanners', () => {
  it('stands on the tile most members in sight are on and counts every soldier', () => {
    const banners = armyBanners(
      [
        { id: 'a1', memberIds: ['s1', 's2', 's3', 's4'] },
        { id: 'gone', memberIds: ['away'] },
      ],
      [
        { id: 's1', x: 3, y: 3 },
        { id: 's2', x: 4, y: 3 },
        { id: 's3', x: 4, y: 3 },
        { id: 's4', x: 4, y: 3 },
      ],
    )
    expect(banners).toEqual([{ armyId: 'a1', x: 4, y: 3, soldiers: 4, under: ['s2', 's3', 's4'] }])
  })
})
