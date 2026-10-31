import {
  PAIRING_WAIT_DAYS,
  PAIRING_WAIT_TICKS,
  TICKS_PER_GAME_DAY,
  type ContractView,
  type Diplomacy,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import {
  GROUP_LIST_MAX,
  carriedShort,
  carryLine,
  groupCard,
  groupResidents,
  pairingDaysLeft,
  ARMY_TABS,
  GROUP_TABS,
  rememberTab,
  rememberTabOf,
  rememberedTabOf,
  statLine,
  scriptsRun,
  supplyLines,
  rememberedTab,
  type ResidentGroup,
} from './residents-view.js'
import { GOOD_LABELS } from './Residents.js'

const r = (id: string, cityId: string | null) => ({ id, cityId })
const cities = [
  { id: 'c1', name: 'Oakford', realmId: 'me' },
  { id: 'c2', name: 'Ashby', realmId: 'me' },
  { id: 'c3', name: 'Brindle', realmId: 'me' },
  { id: 'x', name: 'Elsewhere', realmId: 'them' },
]
const noDiplomacy: Pick<Diplomacy, 'alliance' | 'contracts'> = { alliance: null, contracts: [] }
const options = {
  cities,
  realmId: 'me',
  homeCityId: 'c1',
  leaderId: 'lead',
  diplomacy: noDiplomacy,
}
const shape = (groups: ResidentGroup<{ id: string }>[]) =>
  groups.map((g) => [g.label, g.residents.map((x) => x.id)])

describe('Residents drawer groups', () => {
  it('puts the home city first, the other cities by name, the homeless last', () => {
    const groups = groupResidents(
      [r('a', 'c3'), r('b', null), r('c', 'c2'), r('d', 'c1'), r('e', 'c3')],
      options,
    )
    expect(shape(groups)).toEqual([
      ['Oakford', ['d']],
      ['Ashby', ['c']],
      ['Brindle', ['a', 'e']],
      ['Homeless', ['b']],
    ])
  })

  it('puts the Leader first in their group and keeps the rest in order', () => {
    const groups = groupResidents([r('a', 'c1'), r('b', 'c1'), r('lead', 'c1')], options)
    expect(shape(groups)).toEqual([['Oakford', ['lead', 'a', 'b']]])
  })

  it('leaves out empty groups', () => {
    expect(shape(groupResidents([r('a', 'c2')], options))).toEqual([['Ashby', ['a']]])
    expect(groupResidents([], options)).toEqual([])
  })

  it('groups hired mercenaries and the alliance army apart from the cities', () => {
    const contract = (hirer: string, startedAt: number | null, ids: string[]) =>
      ({
        hirer: { realmId: hirer, realm: hirer },
        startedAt,
        residents: ids.map((id) => ({ id, name: id })),
      }) as ContractView
    const diplomacy = {
      contracts: [contract('me', 5, ['merc']), contract('me', null, ['offered'])],
      alliance: {
        army: [{ is: 'resident', id: 'lent', realmId: 'r2', realm: 'r2', recallAt: null }],
      },
    } as Pick<Diplomacy, 'alliance' | 'contracts'>
    const groups = groupResidents(
      [r('merc', 'x'), r('lent', 'y'), r('home', 'c1'), r('offered', 'c1')],
      { ...options, diplomacy },
    )
    expect(shape(groups)).toEqual([
      ['Oakford', ['home', 'offered']],
      ['Hired', ['merc']],
      ['Alliance army', ['lent']],
    ])
  })

  it('takes a resident of a city that is not the Player’s as homeless', () => {
    expect(shape(groupResidents([r('a', 'x')], options))).toEqual([['Homeless', ['a']]])
  })
})

describe('Carry line', () => {
  it('reads carried weight over carry capacity', () => {
    expect(carryLine(12, 30)).toBe('12 / 30 kg')
    expect(carryLine(0, 28)).toBe('0 / 28 kg')
    expect(carryLine(1.25, 30.04)).toBe('1.3 / 30 kg')
  })
})

describe('Group card', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }))

  it('counts the residents and names the first few', () => {
    expect(groupCard(named('Ada', 'Bo'))).toMatchObject({
      title: '2 residents',
      names: 'Ada and Bo',
    })
    expect(groupCard(named('Ada', 'Bo', 'Cy')).names).toBe('Ada, Bo and Cy')
    expect(groupCard(named('Ada', 'Bo', 'Cy', 'Di', 'Ed')).names).toBe('Ada, Bo, Cy and 2 more')
  })

  it('lists a few one per row and says how many more', () => {
    const many = named(...Array.from({ length: GROUP_LIST_MAX + 3 }, (_, i) => `R${i}`))
    const card = groupCard(many)
    expect(card.rows).toHaveLength(GROUP_LIST_MAX)
    expect(card.more).toBe(3)
    expect(groupCard(named('Ada', 'Bo')).more).toBe(0)
  })
})

describe('Resident card header', () => {
  it('says what they carry, the most first, a few kinds and then how many more', () => {
    expect(carriedShort({}, GOOD_LABELS)).toBe('Carrying nothing')
    expect(carriedShort({ wood: 4, food: 6 }, GOOD_LABELS)).toBe('Carrying 6 Food, 4 Wood')
    expect(carriedShort({ wood: 4, food: 6, stone: 1, iron: 2, coins: 3 }, GOOD_LABELS)).toBe(
      'Carrying 6 Food, 4 Wood, 3 Coins and 2 more',
    )
  })
})

describe('Resident card tab', () => {
  const memory = () => {
    const kept = new Map<string, string>()
    return {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    }
  }

  it('opens on Orders until another tab was opened in this browser', () => {
    const storage = memory()
    expect(rememberedTab(() => storage)).toBe('orders')
    rememberTab('stats', () => storage)
    expect(rememberedTab(() => storage)).toBe('stats')
  })

  it('opens on Orders when storage is off or holds something else', () => {
    const off = () => {
      throw new Error('storage is off')
    }
    expect(rememberedTab(off)).toBe('orders')
    expect(() => rememberTab('queue', off)).not.toThrow()
    const storage = memory()
    storage.setItem('csp.cardTab', 'goods')
    expect(rememberedTab(() => storage)).toBe('orders')
  })
})

describe('Group and army card tabs', () => {
  const memory = () => {
    const kept = new Map<string, string>()
    return {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
    }
  }

  it('remembers each kind of card on its own', () => {
    const storage = memory()
    expect(rememberedTabOf('group', GROUP_TABS, () => storage)).toBe('orders')
    rememberTabOf('group', 'members', () => storage)
    rememberTabOf('army', 'supply', () => storage)
    expect(rememberedTabOf('group', GROUP_TABS, () => storage)).toBe('members')
    expect(rememberedTabOf('army', ARMY_TABS, () => storage)).toBe('supply')
    expect(rememberedTab(() => storage)).toBe('orders')
  })

  it('opens on the first tab when the remembered one is not the card’s', () => {
    const storage = memory()
    rememberTabOf('group', 'supply', () => storage)
    expect(rememberedTabOf('group', GROUP_TABS, () => storage)).toBe('orders')
  })
})

describe('scriptsRun', () => {
  it('counts the scripts, most run first, then those running none', () => {
    expect(scriptsRun(['Fish', undefined, 'Chop', 'Chop', undefined])).toEqual([
      '2 run Chop',
      '1 runs Fish',
      '2 run no script',
    ])
    expect(scriptsRun([undefined])).toEqual(['1 runs no script'])
  })
})

describe('supplyLines', () => {
  it('says who drives each supply wagon, how, and the Food to take', () => {
    const food: Record<string, number> = { c1: 12.7, c2: 0 }
    expect(
      supplyLines(
        [
          { name: 'Ada', carriageId: 'c1', haul: false },
          { name: 'Bo', carriageId: 'c2', haul: true },
        ],
        (id) => food[id]!,
      ),
    ).toEqual(['Ada · following · 12 Food to take', 'Bo · haul route · 0 Food to take'])
  })
})

describe('pairingDaysLeft', () => {
  const since = 50 * TICKS_PER_GAME_DAY

  it('counts the pairing wait down from when they paired', () => {
    expect(pairingDaysLeft(since, since)).toBe(PAIRING_WAIT_DAYS)
    expect(pairingDaysLeft(since, since + TICKS_PER_GAME_DAY)).toBe(PAIRING_WAIT_DAYS - 1)
    expect(pairingDaysLeft(since, since + PAIRING_WAIT_TICKS - 1)).toBe(1)
  })

  it('is 0 ("Now") once the pairing wait has passed', () => {
    expect(pairingDaysLeft(since, since + PAIRING_WAIT_TICKS)).toBe(0)
    expect(pairingDaysLeft(since, since + 10 * PAIRING_WAIT_TICKS)).toBe(0)
  })
})

describe('a stat on the Stats tab', () => {
  it('shows a trained bonus to a tenth, never rounded up to its cap', () => {
    expect(statLine(10, 0, 5)).toBe('10 + 0 (5)')
    expect(statLine(10, 2.3456, 5)).toBe('10 + 2.3 (5)')
    expect(statLine(10, 4.99, 5)).toBe('10 + 4.9 (5)')
    expect(statLine(10, 5, 5)).toBe('10 + 5 (5)')
  })
})
