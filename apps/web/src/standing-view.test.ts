import {
  TRADE_ORG,
  TRADE_ORG_NAME,
  type RealmEvent,
  type SeenBuilding,
  type SeenCity,
  type StandingView,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  formatMove,
  formatStanding,
  standingName,
  standingRelationship,
  standingWord,
  tradeStandingLine,
} from './standing-view.js'

describe('standing in the Trade section', () => {
  const at = { x: 4, y: 5, seq: 1, tick: 1, userId: 7 }
  const trade = (org: string, by: number): RealmEvent => ({
    kind: 'traded',
    residentId: 'p1',
    name: 'Ada',
    side: 'buy',
    good: 'wood',
    units: 3,
    wanted: 3,
    coins: 12,
    atStorage: true,
    standing: { org, name: org, by },
    ...at,
  })
  const cityOf = (c: Partial<SeenCity>) => c as SeenCity
  const buildingOf = (b: Partial<SeenBuilding>) => b as SeenBuilding
  const npc = cityOf({ id: 'c1', name: 'Alder', realmId: null, trade: [] })
  const storage = buildingOf({ id: 's1', kind: 'storage', cityId: 'c1' })
  const seen = { cities: [npc], buildings: [storage], traders: [] }
  const standing = { org: 'c1', theirs: 12 } as StandingView

  it('says what an NPC city holds the Player at, and how far the last trade moved it', () => {
    expect(tradeStandingLine(npc, seen, [], [standing], [])).toBe(
      'Standing with Alder: friendly +12.',
    )
    expect(tradeStandingLine(npc, seen, [], [standing], [trade('c1', 1.2), trade('c1', 2.4)])).toBe(
      'Standing with Alder: friendly +12. Your last trade moved it +2.4.',
    )
  })

  it('is neutral with no standing yet, and ignores trades with anyone else', () => {
    expect(tradeStandingLine(npc, seen, [], [], [trade('c9', 2)])).toBe(
      'Standing with Alder: neutral 0.',
    )
  })

  it('names the Trade Organization at a warehouse, and nobody where nobody trades', () => {
    const post = cityOf({ id: 't1', name: 'Post', realmId: null, tradeOrg: 'post' })
    const warehouse = buildingOf({
      id: 'w1',
      kind: 'warehouse',
      cityId: 't1',
      prices: [{ good: 'wood', buy: 1, sell: 2 }] as SeenBuilding['prices'],
    })
    expect(tradeStandingLine(post, { cities: [post], buildings: [warehouse] }, [], [], [])).toBe(
      `Standing with ${TRADE_ORG_NAME}: neutral 0.`,
    )
    const own = cityOf({ id: 'c2', name: 'Home', realmId: 'r1' })
    expect(tradeStandingLine(own, { cities: [own], buildings: [] }, [], [], [])).toBeUndefined()
  })

  it('writes a move to one place, or two when it is very small', () => {
    expect(formatMove(2.4)).toBe('+2.4')
    expect(formatMove(0.02)).toBe('+0.02')
  })
})

describe('standing in the UI', () => {
  it('puts a standing in words', () => {
    expect(standingWord(-100)).toBe('hostile')
    expect(standingWord(-20)).toBe('wary')
    expect(standingWord(0)).toBe('neutral')
    expect(standingWord(9)).toBe('neutral')
    expect(standingWord(30)).toBe('friendly')
    expect(standingWord(100)).toBe('trusted')
  })

  it('signs the points', () => {
    expect(formatStanding(12)).toBe('+12')
    expect(formatStanding(-30)).toBe('−30')
    expect(formatStanding(0)).toBe('0')
  })

  it('names realms by their Leader and others by their own name', () => {
    const view = { theirs: 0, yours: 0 }
    expect(standingName({ ...view, org: 'r1', name: 'Mara', is: 'realm' })).toBe(
      'the realm of Mara',
    )
    expect(standingName({ ...view, org: 'c1', name: 'Oakford', is: 'city' })).toBe('Oakford')
    expect(standingName({ ...view, org: TRADE_ORG, name: TRADE_ORG_NAME, is: 'tradeOrg' })).toBe(
      TRADE_ORG_NAME,
    )
  })

  it('colours realms, NPC cities and the Trade Organization each their own way', () => {
    const view = { theirs: 0, yours: 0, org: 'x', name: 'X' }
    expect(standingRelationship({ ...view, is: 'realm' })).toBe('otherRealm')
    expect(standingRelationship({ ...view, is: 'city' })).toBe('npcCity')
    expect(standingRelationship({ ...view, is: 'tradeOrg' })).toBe('tradeOrg')
  })
})
