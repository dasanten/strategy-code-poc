import { describe, expect, it } from 'vitest'
import type { AdminPlaces } from '@csp/shared'
import { ADMIN_JUMP_FIGURE_SCALE, jumpList, jumpScale } from './admin-jump.js'
import { ADMIN_LINK_SCALE } from './admin-map.js'

const places: AdminPlaces = {
  tick: 7,
  realms: [
    {
      id: 'realm-b',
      account: 'bob',
      name: 'Bertha',
      alliance: { id: 'al-1', name: 'North' },
      leader: { id: 'res-bertha', name: 'Bertha', x: 40, y: 41 },
      cities: [
        { id: 'city-oak', name: 'Oakford', x: 42, y: 40 },
        { id: 'city-ash', name: 'Ashby', x: 90, y: 12 },
      ],
    },
    {
      id: 'realm-a',
      account: 'alice',
      name: 'Arnulf',
      alliance: null,
      leader: null,
      cities: [{ id: 'city-elm', name: 'Elmstead', x: 300, y: 310 }],
    },
    { id: 'realm-c', account: null, name: 'Cuno', alliance: null, leader: null, cities: [] },
  ],
  npcCities: [
    { id: 'npc-1', name: 'Wendby', x: 5, y: 6, selfManaged: false, alliance: null },
    {
      id: 'npc-2',
      name: 'Ashmoor',
      x: 7,
      y: 8,
      selfManaged: true,
      alliance: { id: 'al-1', name: 'North' },
    },
  ],
  tradeOrg: {
    hq: { id: 'hq', name: 'Trade Org HQ', x: 320, y: 320 },
    posts: [{ id: 'post-1', name: 'Saltmarsh', x: 100, y: 100 }],
    caravans: [{ id: 'car-1', name: 'Saltmarsh', x: 200, y: 210, postId: 'post-1', heading: 'hq' }],
  },
  armies: [{ id: 'army-1', name: 'Iron Band', x: 44, y: 45, realmId: 'realm-b', realm: 'Bertha' }],
}

const names = (search: string) =>
  jumpList(places, search).map((g) => [g.title, g.entries.map((e) => e.name)])

describe('admin map jump list', () => {
  it('groups realms with their Leader and cities, NPC cities, the Trade Org and armies', () => {
    expect(names('')).toEqual([
      ['Realms', ['Arnulf', 'Elmstead', 'Bertha', 'Bertha', 'Ashby', 'Oakford', 'Cuno']],
      ['NPC cities', ['Ashmoor', 'Wendby']],
      ['Trade Organization', ['Trade Org HQ', 'Saltmarsh', 'Saltmarsh']],
      ['Armies', ['Iron Band']],
    ])
    const realms = jumpList(places, '')[0]!.entries
    expect(realms.map((e) => [e.kind, e.nested])).toEqual([
      ['realm', false],
      ['city', true],
      ['realm', false],
      ['leader', true],
      ['city', true],
      ['city', true],
      ['realm', false],
    ])
    expect(realms[2]).toMatchObject({ detail: 'bob [North]', at: { x: 40, y: 41 } })
    // Without a Leader a realm lands on its first city; with neither, nowhere.
    expect(realms[0]).toMatchObject({ detail: 'alice', at: { x: 300, y: 310 } })
    expect(realms[6]).toMatchObject({ detail: 'account gone', at: null })
    const trade = jumpList(places, '')[2]!.entries
    expect(trade.map((e) => [e.kind, e.detail, e.at])).toEqual([
      ['hq', 'HQ', { x: 320, y: 320 }],
      ['post', 'trading post', { x: 100, y: 100 }],
      ['caravan', 'caravan to the HQ', { x: 200, y: 210 }],
    ])
    expect(jumpList(places, '')[1]!.entries[0]!.detail).toBe('self-managed [North]')
  })

  it('gives every entry its own key', () => {
    const keys = jumpList(places, '').flatMap((g) => g.entries.map((e) => e.key))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('searches by account, realm, city and army name, in any case', () => {
    // A realm found by its account keeps everything under it.
    expect(names('ALICE')).toEqual([['Realms', ['Arnulf', 'Elmstead']]])
    // A city alone brings its realm along, without the realm's other cities.
    expect(names('oakf')).toEqual([['Realms', ['Bertha', 'Oakford']]])
    expect(names('ash')).toEqual([
      ['Realms', ['Bertha', 'Ashby']],
      ['NPC cities', ['Ashmoor']],
    ])
    // An army by its own name or its realm's.
    expect(names('iron')).toEqual([['Armies', ['Iron Band']]])
    expect(names('north')).toEqual([
      ['Realms', ['Bertha', 'Bertha', 'Ashby', 'Oakford']],
      ['NPC cities', ['Ashmoor']],
    ])
    expect(names('trade org')).toEqual([['Trade Organization', ['Trade Org HQ']]])
    expect(names('  salt ')).toEqual([['Trade Organization', ['Saltmarsh', 'Saltmarsh']]])
    expect(names('nobody')).toEqual([])
  })

  it('lands on a city in the middle tier and on a figure close up', () => {
    expect(jumpScale('city')).toBe(ADMIN_LINK_SCALE)
    expect(jumpScale('hq')).toBe(ADMIN_LINK_SCALE)
    expect(jumpScale('leader')).toBe(ADMIN_JUMP_FIGURE_SCALE)
    expect(jumpScale('army')).toBe(ADMIN_JUMP_FIGURE_SCALE)
  })
})
