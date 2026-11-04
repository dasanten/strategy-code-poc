import type { DirectOfferView } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { incomingItems, incomingNoticeLine } from './incoming-view.js'

const offer = (id: string, fromId = 'r1', toId = 'r2'): DirectOfferView => ({
  id,
  realmId: fromId,
  storageId: 's1',
  x: 6,
  y: 6,
  gives: 'wood',
  givesUnits: 10,
  wants: 'stone',
  wantsUnits: 5,
  times: 2,
  rate: 0.5,
  direct: { toId, lapsesAt: 500 },
  from: { realmId: fromId, realm: 'Mara' },
  to: { realmId: toId, realm: 'Bo' },
  city: 'Oakford',
})

describe('what was sent to the Player', () => {
  it('lists what is sent to the realm, and not what it sent', () => {
    const items = incomingItems({ directOffers: [offer('o1'), offer('o2', 'r2', 'r1')] }, 'r2')
    expect(items).toEqual([
      {
        kind: 'directOffer',
        id: 'o1',
        line: 'The realm of Mara offers: gives 10 wood, wants 5 stone',
        lapsesAt: 500,
        offer: offer('o1'),
      },
    ])
  })
})

describe('the notice of what was sent', () => {
  const items = incomingItems({ directOffers: [offer('o1'), offer('o2')] }, 'r2')

  it('says the newest and how many more', () => {
    expect(incomingNoticeLine(items, new Set(), false)).toBe(
      'The realm of Mara offers: gives 10 wood, wants 5 stone, and 1 more',
    )
    expect(incomingNoticeLine(items, new Set(['o1']), false)).toBe(
      'The realm of Mara offers: gives 10 wood, wants 5 stone',
    )
  })

  it('goes once put away, while the drawer is open, and with nothing sent', () => {
    expect(incomingNoticeLine(items, new Set(['o1', 'o2']), false)).toBeUndefined()
    expect(incomingNoticeLine(items, new Set(), true)).toBeUndefined()
    expect(incomingNoticeLine([], new Set(), false)).toBeUndefined()
  })
})
