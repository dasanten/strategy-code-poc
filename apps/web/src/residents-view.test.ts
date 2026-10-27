import type { ContractView, Diplomacy } from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { carryLine, groupResidents, type ResidentGroup } from './residents-view.js'

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
