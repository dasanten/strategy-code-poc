import { describe, expect, it } from 'vitest'
import type { ContractView, DemandView, DirectOfferView } from '@csp/shared-types'
import {
  NOTHING_SEEN,
  newestLine,
  rememberLogSeen,
  rememberedLogSeen,
  seeTab,
  sentToRealm,
  unseenMarks,
} from './unseen-view.js'

const us = 'r1'
const them = { realmId: 'r2', realm: 'Other' }
const me = { realmId: us, realm: 'Us' }

const demand = (id: string, to = me, from = them) =>
  ({
    id,
    from,
    to,
    terms: { kind: 'goods', goods: { food: 5 } },
    note: '',
    sentAt: 0,
    deadline: 9,
  }) as DemandView
const offer = (id: string, toId = us) => ({ id, direct: { toId } }) as unknown as DirectOfferView
const contract = (id: string, offeredBy: 'lender' | 'hirer', startedAt: number | null = null) =>
  ({ id, lender: them, hirer: me, offeredBy, startedAt }) as unknown as ContractView

const noLines: { seq: number }[] = []

describe('unseen marks', () => {
  it('marks the Demands tab and the Diplomacy button for a demand sent to the realm', () => {
    const sent = sentToRealm({ contracts: [], demands: [demand('d1')], directOffers: [] }, us)
    const marks = unseenMarks(sent, NOTHING_SEEN, noLines, 0)
    expect([...marks.tabs]).toEqual(['demands'])
    expect([...marks.rail]).toEqual(['diplomacy'])
  })

  it('marks the Direct offers tab for a direct offer sent to the realm, not one it sent', () => {
    const sent = sentToRealm(
      {
        contracts: [],
        demands: [demand('d2', them, me)],
        directOffers: [offer('o1'), offer('o2', 'r2')],
      },
      us,
    )
    expect(sent.directOffers).toEqual(['o1'])
    expect(sent.demands).toEqual([])
    expect([...unseenMarks(sent, NOTHING_SEEN, noLines, 0).tabs]).toEqual(['directOffers'])
  })

  it('marks the Contracts tab for a contract the other side offered, until it starts', () => {
    const offered = sentToRealm(
      {
        contracts: [contract('c1', 'lender'), contract('c2', 'hirer'), contract('c3', 'lender', 5)],
        demands: [],
        directOffers: [],
      },
      us,
    )
    expect(offered.contracts).toEqual(['c1'])
    expect([...unseenMarks(offered, NOTHING_SEEN, noLines, 0).tabs]).toEqual(['contracts'])
  })

  it('clears a tab once it was open, and marks it again for something newer', () => {
    let sent = sentToRealm({ contracts: [], demands: [demand('d1')], directOffers: [] }, us)
    const seen = seeTab(NOTHING_SEEN, 'demands', sent.demands)
    expect(unseenMarks(sent, seen, noLines, 0).rail.size).toBe(0)
    expect(seeTab(seen, 'demands', sent.demands)).toBe(seen)
    sent = sentToRealm(
      { contracts: [], demands: [demand('d1'), demand('d3')], directOffers: [] },
      us,
    )
    expect([...unseenMarks(sent, seen, noLines, 0).tabs]).toEqual(['demands'])
  })

  it('keeps the Diplomacy button marked while another tab still holds something unseen', () => {
    const sent = sentToRealm(
      { contracts: [], demands: [demand('d1')], directOffers: [offer('o1')] },
      us,
    )
    const seen = seeTab(NOTHING_SEEN, 'demands', sent.demands)
    const marks = unseenMarks(sent, seen, noLines, 0)
    expect([...marks.tabs]).toEqual(['directOffers'])
    expect([...marks.rail]).toEqual(['diplomacy'])
  })

  it('marks the Realm log button for lines newer than when it was last open', () => {
    const sent = sentToRealm({ contracts: [], demands: [], directOffers: [] }, us)
    const log = [{ seq: 3 }, { seq: 4 }]
    expect([...unseenMarks(sent, NOTHING_SEEN, log, 3).rail]).toEqual(['realmLog'])
    // Opening the log sees it up to its newest line, which clears the mark.
    const upTo = newestLine(log)
    expect(upTo).toBe(4)
    expect(unseenMarks(sent, NOTHING_SEEN, log, upTo).rail.size).toBe(0)
    expect(unseenMarks(sent, NOTHING_SEEN, [...log, { seq: 5 }], upTo).rail.has('realmLog')).toBe(
      true,
    )
  })

  it('marks no log lines before it knows what was seen', () => {
    const sent = sentToRealm({ contracts: [], demands: [], directOffers: [] }, us)
    expect(unseenMarks(sent, NOTHING_SEEN, [{ seq: 1 }], null).rail.size).toBe(0)
    expect(newestLine([])).toBeNull()
  })

  it('remembers the last log line seen per realm, and goes without storage', () => {
    const store = new Map<string, string>()
    const storage = () => ({
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    expect(rememberedLogSeen(us, storage)).toBeNull()
    rememberLogSeen(us, 12, storage)
    expect(rememberedLogSeen(us, storage)).toBe(12)
    expect(rememberedLogSeen('r2', storage)).toBeNull()
    const broken = () => {
      throw new Error('off')
    }
    expect(rememberedLogSeen(us, broken)).toBeNull()
    expect(() => rememberLogSeen(us, 1, broken)).not.toThrow()
  })
})
