import {
  TRADE_ORG,
  TRADE_ORG_NAME,
  type ContractView,
  type Diplomacy,
  type RealmEvent,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { commandsSeen } from './alliance-army.js'
import { contractStatus, sideName } from './contract-view.js'
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
      '1 of 2 weeks paid · next week due by Year 1 · Day 11 · 00:00',
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
