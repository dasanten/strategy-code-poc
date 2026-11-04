import {
  TRADE_ORG,
  TRADE_ORG_NAME,
  CONTRACT_MAX_DAYS,
  type ContractView,
  type Diplomacy,
  type RealmEvent,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { commandsSeen } from './alliance-army.js'
import {
  contractStatus,
  namesText,
  offerSummary,
  sideName,
  storageName,
  type OfferDraft,
} from './contract-view.js'
import { describeEvent } from './realm-log.js'

const contract: ContractView = {
  id: 'contract1',
  lender: { realmId: 'r1', realm: 'Mara' },
  hirer: { realmId: 'r2', realm: 'Tobin' },
  offeredBy: 'lender',
  residents: [{ id: 'm1', name: 'Wren' }],
  days: 10,
  pricePerWeek: 5,
  storage: { id: 's1', x: 11, y: 10 },
  startedAt: null,
  endsAt: null,
  weeks: 2,
  paidWeeks: 0,
  payBy: null,
}

const resident = (id: string, owner: string) => ({ id, owner })

const diplomacy = (contracts: ContractView[]): Diplomacy => ({
  alliance: null,
  invitations: [],
  realmsInSight: [],
  standings: [],
  joinRequests: [],
  directives: [],
  contracts,
  deliveries: [],
  demands: [],
  knownRealms: [],
})

describe('mercenary contracts in the UI', () => {
  it('gives the hirer the orders of mercenaries in force, not before', () => {
    const residents = [resident('a1', 'r1'), resident('m1', 'r1'), resident('b1', 'r2')]
    const ids = (cs: ContractView[], realm: string) =>
      residents.filter((r) => commandsSeen(diplomacy(cs), realm, r)).map((r) => r.id)
    expect(ids([contract], 'r1')).toEqual(['a1', 'm1'])
    expect(ids([contract], 'r2')).toEqual(['b1'])
    const inForce = { ...contract, startedAt: 0 }
    expect(ids([inForce], 'r1')).toEqual(['a1'])
    expect(ids([inForce], 'r2')).toEqual(['m1', 'b1'])
  })

  it('says where a contract stands', () => {
    expect(contractStatus(contract, 'r1')).toBe('Waiting for them to accept')
    expect(contractStatus(contract, 'r2')).toBe('Offered to you')
    const inForce = { ...contract, startedAt: 0, endsAt: 36000, paidWeeks: 1, payBy: 36000 }
    expect(contractStatus(inForce, 'r2')).toBe(
      '1 of 2 weeks paid · next week due by Year 1 · Day 26 · 00:00',
    )
  })

  it('tells both sides what happened in the realm log', () => {
    const e = {
      kind: 'contract',
      contractId: 'contract1',
      lender: false,
      other: 'Mara',
      residents: 2,
      seq: 1,
      tick: 0,
      userId: 1,
    } as const
    const text = (what: Partial<RealmEvent>) => describeEvent({ ...e, ...what } as RealmEvent).text
    expect(text({ what: 'offered' })).toBe('The realm of Mara offers you 2 mercenaries for hire.')
    expect(text({ what: 'started' })).toBe('You hired 2 mercenaries from the realm of Mara.')
    expect(text({ what: 'paid', weeks: 1 })).toBe(
      'You paid the realm of Mara 1 week for 2 mercenaries.',
    )
    expect(text({ what: 'broken', lender: true, residents: 1 })).toBe(
      'The realm of Mara left a week unpaid: your 1 mercenary walks home.',
    )
  })

  it('calls the Trade Organization by its name, not as a realm', () => {
    expect(sideName({ realmId: 'r1', realm: 'Mara' })).toBe('the realm of Mara')
    expect(sideName({ realmId: TRADE_ORG, realm: TRADE_ORG_NAME })).toBe('the Trade Organization')
    expect(sideName({ realmId: 'npc', realm: 'Dunmere' }, [{ id: 'npc' }])).toBe('Dunmere')
    const e = {
      kind: 'contract',
      contractId: 'contract1',
      lender: false,
      other: TRADE_ORG_NAME,
      residents: 2,
      seq: 1,
      tick: 0,
      userId: 1,
    } as const
    const text = (what: Partial<RealmEvent>) => describeEvent({ ...e, ...what } as RealmEvent).text
    expect(text({ what: 'declined' })).toBe(
      'The Trade Organization declined to rent you 2 mercenaries.',
    )
    expect(text({ what: 'offered', lender: true })).toBe(
      'The Trade Organization asks to hire 2 mercenaries from you.',
    )
  })
})

describe('the Contracts form’s summary line', () => {
  const draft = (d: Partial<OfferDraft> = {}): OfferDraft => ({
    hiring: false,
    side: { kind: 'realm', name: 'Testmark' },
    residents: ['Bram', 'Tobin', 'Corwin'],
    count: 1,
    days: 7,
    pricePerWeek: 10,
    storage: 'Ashford storage',
    ...d,
  })

  it('reads as the offer will be seen when renting out the Player’s own', () => {
    expect(offerSummary(draft())).toEqual({
      text: 'Rent out Bram, Tobin and Corwin to Testmark for 7 days at 10 coins a week, paid into Ashford storage',
      complete: true,
    })
  })

  it('reads as the ask when hiring a realm’s residents by name', () => {
    const ask = draft({ hiring: true, residents: ['Wren'], storage: 'Testby storage' })
    expect(offerSummary(ask).text).toBe(
      'Hire Wren from Testmark for 7 days at 10 coins a week, paid into Testby storage',
    )
  })

  it('counts the Trade Org army’s soldiers and an NPC city’s residents', () => {
    const army = draft({
      hiring: true,
      side: { kind: 'tradeOrg' },
      residents: [],
      count: 5,
      storage: 'Harbour warehouse',
    })
    expect(offerSummary(army)).toEqual({
      text: `Hire 5 soldiers from ${TRADE_ORG_NAME} for 7 days at 10 coins a week, paid into Harbour warehouse`,
      complete: true,
    })
    const npc = draft({
      hiring: true,
      side: { kind: 'npcCity', name: 'Oakvale' },
      residents: [],
      count: 1,
      days: 1,
      pricePerWeek: 1,
      storage: 'Oakvale storage',
    })
    expect(offerSummary(npc).text).toBe(
      'Hire 1 resident from Oakvale for 1 day at 1 coin a week, paid into Oakvale storage',
    )
  })

  it('shows what is missing and is not complete until nothing is', () => {
    const blank = offerSummary(draft({ side: undefined, residents: [], storage: undefined }))
    expect(blank).toEqual({
      text: 'Rent out … to … for 7 days at 10 coins a week, paid into …',
      complete: false,
    })
    expect(offerSummary(draft({ residents: [] })).complete).toBe(false)
    expect(offerSummary(draft({ storage: undefined })).complete).toBe(false)
    expect(offerSummary(draft({ days: 0 })).text).toContain('for … at')
    expect(offerSummary(draft({ days: CONTRACT_MAX_DAYS + 1 })).complete).toBe(false)
    expect(offerSummary(draft({ pricePerWeek: 0 })).complete).toBe(false)
    const none = draft({ hiring: true, side: { kind: 'tradeOrg' }, count: 0 })
    expect(offerSummary(none).complete).toBe(false)
  })

  it('joins names as a sentence does', () => {
    expect(namesText([])).toBe('')
    expect(namesText(['Bram'])).toBe('Bram')
    expect(namesText(['Bram', 'Tobin'])).toBe('Bram and Tobin')
  })

  it('names a storage by its city, and where it stands when the city has two', () => {
    const cities = [{ id: 'c1', name: 'Ashford' }]
    const a = { id: 's1', kind: 'storage' as const, cityId: 'c1', x: 3, y: 4 }
    const b = { ...a, id: 's2', x: 9, y: 9 }
    expect(storageName(a, cities, [a])).toBe('Ashford storage')
    expect(storageName(a, cities, [a, b])).toBe('Ashford storage at 3, 4')
    expect(storageName({ ...a, kind: 'warehouse' }, cities)).toBe('Ashford warehouse')
    expect(storageName({ ...a, cityId: null }, cities)).toBe('Storage at 3, 4')
  })
})
