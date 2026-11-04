import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DemandView, SeenCity } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  demandNoticeLine,
  demandSides,
  goodsOfLines,
  handOverQuestion,
  knownCitiesOf,
  termsLine,
} from './demand-view.js'
import { DemandsPanel } from './Demands.js'
import type { LastSeenCity } from './last-seen.js'
import { describeEvent } from './realm-log.js'

const demand = (
  id: string,
  from: string,
  to: string,
  over: Partial<DemandView> = {},
): DemandView => ({
  id,
  from: { realmId: from, realm: from.toUpperCase() },
  to: { realmId: to, realm: to.toUpperCase() },
  terms: { kind: 'goods', goods: { coins: 20, ironOre: 2 } },
  note: 'Pay up',
  sentAt: 0,
  deadline: 1440,
  ...over,
})
const noSet = new Set<string>()

describe('what a demand asks for', () => {
  it('names the city or the goods', () => {
    expect(termsLine({ kind: 'city', cityId: 'c', cityName: 'Ashford' })).toBe('Ashford')
    expect(termsLine({ kind: 'goods', goods: { coins: 20, ironOre: 2 } })).toBe(
      '20 Coins, 2 Iron Ore',
    )
  })
})

describe('the two sides', () => {
  it('splits what was sent to the realm from what it sent', () => {
    const { incoming, sent } = demandSides([demand('a', 'r2', 'r1'), demand('b', 'r1', 'r2')], 'r1')
    expect(incoming.map((d) => d.id)).toEqual(['a'])
    expect(sent.map((d) => d.id)).toEqual(['b'])
  })
})

describe('the notice', () => {
  it('tells of the newest demand sent to the realm, and how many more', () => {
    const one = [demand('a', 'r2', 'r1')]
    expect(demandNoticeLine(one, 'r1', noSet, false)).toBe(
      'The realm of R2 demands 20 Coins, 2 Iron Ore of you',
    )
    const two = [
      ...one,
      demand('b', 'r3', 'r1', { terms: { kind: 'city', cityId: 'c', cityName: 'Ashford' } }),
    ]
    expect(demandNoticeLine(two, 'r1', noSet, false)).toBe(
      'The realm of R3 demands Ashford of you, and 1 more',
    )
  })

  it('stays quiet for the sender, for what is put away and while the drawer is open', () => {
    const one = [demand('a', 'r2', 'r1')]
    expect(demandNoticeLine(one, 'r2', noSet, false)).toBeUndefined()
    expect(demandNoticeLine(one, 'r1', new Set(['a']), false)).toBeUndefined()
    expect(demandNoticeLine(one, 'r1', noSet, true)).toBeUndefined()
    expect(demandNoticeLine([], 'r1', noSet, false)).toBeUndefined()
  })

  it('comes back for a new demand after the last was put away', () => {
    const two = [demand('a', 'r2', 'r1'), demand('b', 'r2', 'r1')]
    expect(demandNoticeLine(two, 'r1', new Set(['a']), false)).toBe(
      'The realm of R2 demands 20 Coins, 2 Iron Ore of you',
    )
  })
})

describe('the cities known of a realm', () => {
  const city = (id: string, name: string, realmId: string | null) =>
    ({ id, name, realmId }) as unknown as SeenCity
  const seen = (id: string, name: string, realmId: string | null) =>
    ({ id, name, realmId, seenAt: 0 }) as unknown as LastSeenCity

  it('takes those in sight and those last seen as theirs, by name', () => {
    expect(
      knownCitiesOf(
        'r2',
        [city('c1', 'Zell', 'r2'), city('c9', 'Other', 'r3')],
        [seen('c2', 'Ashford', 'r2'), seen('c3', 'Theirs before', 'r3')],
      ),
    ).toEqual([
      { id: 'c2', name: 'Ashford' },
      { id: 'c1', name: 'Zell' },
    ])
  })

  it('goes by what is in sight over what is remembered', () => {
    expect(knownCitiesOf('r2', [city('c2', 'Taken', 'r3')], [seen('c2', 'Ashford', 'r2')])).toEqual(
      [],
    )
    expect(knownCitiesOf('r2', [city('c2', 'New', 'r2')], [seen('c2', 'Old', 'r2')])).toEqual([
      { id: 'c2', name: 'New' },
    ])
  })
})

describe('accepting a demand for a city', () => {
  const city = (id: string, name: string, realmId: string) =>
    ({ id, name, realmId }) as unknown as SeenCity
  const forAshford = demand('a', 'r2', 'r1', {
    terms: { kind: 'city', cityId: 'c1', cityName: 'Ashford' },
  })

  it('asks first, and says so when it is the realm’s last', () => {
    const own = city('c1', 'Ashford', 'r1')
    const two = handOverQuestion(forAshford, 'r1', [own, city('c2', 'Zell', 'r1')])
    expect(two).toMatch(/^Hand Ashford over to the realm of R2,/)
    expect(two).not.toMatch(/last city/)
    expect(handOverQuestion(forAshford, 'r1', [own])).toMatch(/It is your last city\.$/)
  })

  it('doesn’t ask for goods, or for a city no longer theirs, which the server refuses', () => {
    expect(handOverQuestion(demand('a', 'r2', 'r1'), 'r1', [])).toBeUndefined()
    expect(handOverQuestion(forAshford, 'r1', [city('c1', 'Ashford', 'r3')])).toBeUndefined()
  })
})

describe('the realm log of an accepted demand for goods', () => {
  it('says only that it was accepted', () => {
    const line = (mine: boolean) =>
      describeEvent({
        kind: 'demand',
        demandId: 'd',
        what: 'accepted',
        mine,
        other: 'Tobin',
        terms: { kind: 'goods', goods: { coins: 20 } },
        seq: 1,
        tick: 0,
        userId: 1,
      } as never).text
    expect(line(true)).toBe('The realm of Tobin accepted your demand for 20 Coins.')
    expect(line(false)).toBe('You accepted the demand of the realm of Tobin for 20 Coins.')
  })
})

describe('goods on the form', () => {
  it('adds up a good named twice and leaves out what isn’t a whole number', () => {
    expect(
      goodsOfLines([
        { good: 'food', units: 2 },
        { good: 'food', units: 3 },
        { good: 'coins', units: 0 },
        { good: 'wood', units: 1.5 },
      ]),
    ).toEqual({ food: 5 })
  })
})

describe('the Demands drawer', () => {
  const panel = (demands: DemandView[]) =>
    renderToStaticMarkup(
      createElement(DemandsPanel, {
        demands,
        realmId: 'r1',
        knownRealms: [{ realmId: 'r2', realm: 'R2' }],
        cities: [],
        lastSeen: [],
        tick: 0,
        sendOrder: async () => undefined,
      }),
    )

  it('never renders a note as markup, on either side', () => {
    const note = '<img src=x onerror=alert(1)><script>alert(2)</script><b>bold</b>'
    for (const d of [demand('a', 'r2', 'r1', { note }), demand('b', 'r1', 'r2', { note })]) {
      const html = panel([d])
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('<script')
      expect(html).not.toContain('<b>')
    }
  })

  it('offers an answer only for what was sent to the realm', () => {
    expect(panel([demand('a', 'r2', 'r1')])).toContain('Accept')
    expect(panel([demand('a', 'r2', 'r1')])).toContain('Decline')
    expect(panel([demand('b', 'r1', 'r2')])).not.toContain('Accept')
  })
})

describe('the realm log', () => {
  const line = (what: string, mine: boolean, leaderDied?: 'sender' | 'receiver') =>
    describeEvent({
      kind: 'demand',
      demandId: 'd',
      what,
      mine,
      other: 'Tobin',
      terms: { kind: 'city', cityId: 'c', cityName: 'Ashford' },
      leaderDied,
      seq: 1,
      tick: 0,
      userId: 1,
    } as never).text

  it('says what happened on each side', () => {
    expect(line('sent', true)).toBe('You demanded Ashford of the realm of Tobin.')
    expect(line('received', false)).toBe('The realm of Tobin demands Ashford of you.')
    expect(line('accepted', true)).toBe(
      'The realm of Tobin accepted your demand: Ashford joined your realm.',
    )
    expect(line('accepted', false)).toBe(
      'You accepted the demand of the realm of Tobin: Ashford joined their realm.',
    )
    expect(line('declined', true)).toBe('The realm of Tobin declined your demand for Ashford.')
    expect(line('declined', false)).toBe(
      'You declined the demand of the realm of Tobin for Ashford.',
    )
  })

  it('says a demand lapsed, and why when a Leader died', () => {
    expect(line('lapsed', true)).toBe(
      'Your demand on the realm of Tobin for Ashford lapsed unanswered.',
    )
    expect(line('lapsed', false)).toBe(
      'The demand of the realm of Tobin for Ashford lapsed unanswered.',
    )
    expect(line('lapsed', true, 'sender')).toMatch(/lapsed: your Leader died\.$/)
    expect(line('lapsed', true, 'receiver')).toMatch(
      /lapsed: the Leader of the realm of Tobin died\.$/,
    )
    expect(line('lapsed', false, 'receiver')).toMatch(/lapsed: your Leader died\.$/)
  })
})
