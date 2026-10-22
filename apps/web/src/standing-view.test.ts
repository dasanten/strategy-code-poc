import { TRADE_ORG, TRADE_ORG_NAME } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  formatStanding,
  standingName,
  standingRelationship,
  standingWord,
} from './standing-view.js'

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
