import { describe, expect, it } from 'vitest'
import {
  MAX_WORKERS,
  TICKS_PER_GAME_YEAR,
  type Building,
  type Carriage,
  type City,
  type ContractView,
  type Diplomacy,
  type Pile,
  type Resident,
} from '@csp/shared'
import {
  actionForKey,
  describeTile,
  makeLeaderProblem,
  residentActions,
  tileActions,
  type ResidentHere,
  type TileThings,
} from './selection-view.js'
import { GOOD_LABELS } from './Residents.js'

const building = (b: Partial<Building> & Pick<Building, 'kind'>): Building => ({
  id: `b-${b.kind}`,
  cityId: null,
  x: 5,
  y: 5,
  ...b,
})
const carriage: Carriage = {
  id: 'k1',
  realmId: 'me',
  cityId: null,
  x: 5,
  y: 5,
  horseId: 'h1',
  load: { wood: 10 },
}
const pile: Pile = { id: 'p1', x: 5, y: 5, goods: { stone: 4 } }

/** An idle adult on open ground with nothing about, nobody in sight. */
const here = (more: Partial<ResidentHere> = {}): ResidentHere => ({
  adult: true,
  busy: false,
  inCity: true,
  carrying: false,
  othersInSight: 0,
  wallsInSight: 0,
  picking: false,
  ...more,
})
const ids = (h: ResidentHere) => residentActions(h).map((a) => a.id)

describe('the actions on a resident’s card', () => {
  it('offers walking, building, a road, pairing and scripts to an idle adult on open ground', () => {
    expect(ids(here())).toEqual(['walk', 'build', 'roadTo', 'pair', 'script'])
  })

  it('offers stop only while they have an order or run a script', () => {
    expect(ids(here())).not.toContain('stop')
    expect(ids(here({ busy: true }))).toContain('stop')
  })

  it('offers driving and a haul route with a carriage on their tile, and goods on it', () => {
    const a = ids(here({ carriage }))
    expect(a).toEqual(expect.arrayContaining(['drive', 'haul', 'goods']))
  })

  it('offers work at a finished workplace, not at a site or a house', () => {
    expect(ids(here({ building: building({ kind: 'farm' }) }))).toContain('work')
    const node = { kind: 'stone' as const, x: 5, y: 5 }
    expect(ids(here({ building: building({ kind: 'quarry' }), node }))).toContain('work')
    expect(ids(here({ building: building({ kind: 'smithy' }) }))).toContain('work')
    const site = building({ kind: 'farm', site: { work: 0, delivered: {} } })
    expect(ids(here({ building: site }))).not.toContain('work')
    expect(ids(here({ building: building({ kind: 'house' }) }))).not.toContain('work')
  })

  it('names the site to help build on one', () => {
    const site = building({ kind: 'farm', site: { work: 0, delivered: {} } })
    const build = residentActions(here({ building: site })).find((a) => a.id === 'build')
    expect(build?.label).toBe('Help build the farm…')
  })

  it('offers tearing down what was built on their tile, but not a warehouse', () => {
    expect(ids(here({ building: building({ kind: 'farm' }) }))).toContain('tearDown')
    expect(ids(here({ road: building({ kind: 'road' }) }))).toContain('tearDown')
    expect(ids(here({ building: building({ kind: 'warehouse' }) }))).not.toContain('tearDown')
  })

  it('offers goods while they carry some or there are goods or a site on their tile', () => {
    expect(ids(here())).not.toContain('goods')
    expect(ids(here({ carrying: true }))).toContain('goods')
    expect(ids(here({ pile }))).toContain('goods')
    expect(ids(here({ storage: building({ kind: 'storage' }) }))).toContain('goods')
    const site = building({ kind: 'house', site: { work: 0, delivered: {} } })
    expect(ids(here({ building: site }))).toContain('goods')
  })

  it('offers attacking only with someone of another realm in sight', () => {
    expect(ids(here())).not.toContain('attack')
    expect(ids(here({ othersInSight: 2 }))).toContain('attack')
  })

  it('offers breaking or climbing only with another realm’s wall in sight', () => {
    expect(ids(here())).not.toContain('walls')
    expect(ids(here({ wallsInSight: 1 }))).toContain('walls')
  })

  it('does not offer pairing to a child or to someone of no city', () => {
    expect(ids(here({ adult: false }))).not.toContain('pair')
    expect(ids(here({ inCity: false }))).not.toContain('pair')
  })

  it('keeps a child’s driving and road building in sight but turned off', () => {
    const a = residentActions(here({ adult: false, carriage }))
    expect(a.find((x) => x.id === 'drive')?.disabled).toBe(true)
    expect(a.find((x) => x.id === 'roadTo')?.disabled).toBe(true)
    expect(a.find((x) => x.id === 'walk')?.disabled).toBeUndefined()
  })

  it('shows which action the map is picking a tile for', () => {
    const walk = residentActions(here({ picking: 'walk' })).find((a) => a.id === 'walk')!
    expect(walk).toMatchObject({ active: true, label: 'Pick a tile…' })
  })

  it('gives every shown action its own key', () => {
    const all = here({
      busy: true,
      carrying: true,
      carriage,
      pile,
      building: building({ kind: 'farm' }),
      road: building({ kind: 'road' }),
      othersInSight: 1,
      wallsInSight: 1,
      makeLeader: { problem: undefined },
    })
    const keys = residentActions(all).map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('offers Make Leader only for an own resident who isn’t the Leader', () => {
    expect(ids(here())).not.toContain('makeLeader')
    const make = residentActions(here({ makeLeader: { problem: undefined } })).find(
      (a) => a.id === 'makeLeader',
    )
    expect(make).toMatchObject({ label: 'Make Leader…', key: 'L', opens: true })
    expect(make?.disabled).toBeUndefined()
  })

  it('turns Make Leader off with the reason when the handover would be refused', () => {
    const problem = 'Ana must stand in the same city as your Leader'
    const a = residentActions(here({ makeLeader: { problem } }))
    expect(a.find((x) => x.id === 'makeLeader')).toMatchObject({ disabled: true, reason: problem })
    expect(actionForKey(a, 'l')).toBeUndefined()
  })
})

describe('whether a resident can be made Leader', () => {
  const realm = { id: 'me', leaderId: 'lead' }
  const grown = -30 * TICKS_PER_GAME_YEAR
  const person = (r: Partial<Resident> & Pick<Resident, 'id' | 'name'>): Resident =>
    ({ owner: 'me', health: 100, bornAt: grown, x: 10, y: 10, cityId: 'c1', ...r }) as Resident
  const leader = person({ id: 'lead', name: 'Old Bram' })
  const ana = person({ id: 'ana', name: 'Ana', x: 11 })
  const city = { id: 'c1', name: 'Oakford', realmId: 'me' } as City
  const contract = (startedAt: number | null): ContractView =>
    ({
      id: 'k1',
      lender: { realmId: 'me', realm: 'Me' },
      hirer: { realmId: 'them', realm: 'Them' },
      offeredBy: 'hirer',
      residents: [{ id: 'ana', name: 'Ana' }],
      days: 10,
      pricePerWeek: 5,
      storage: null,
      startedAt,
      endsAt: null,
      weeks: 0,
      paidWeeks: 0,
      payBy: null,
    }) as ContractView
  const seen = (diplomacy: Partial<Pick<Diplomacy, 'alliance' | 'contracts'>> = {}) => ({
    tick: 0,
    diplomacy: { alliance: null, contracts: [], ...diplomacy },
    cities: [city],
    buildings: [building({ id: 'th', kind: 'townHall', cityId: 'c1', x: 10, y: 10 })],
    mapSize: 256,
  })

  it('can when both stand in the same city of the realm and the resident serves no one', () => {
    expect(makeLeaderProblem(seen(), realm, leader, ana)).toBeUndefined()
  })

  it('can’t while the Leader is out of the city', () => {
    const away = { ...leader, x: 60, y: 60 }
    expect(makeLeaderProblem(seen(), realm, away, ana)).toBe(
      'Ana must stand in the same city as your Leader',
    )
  })

  it('can’t make a child Leader', () => {
    const child = { ...ana, bornAt: 0 }
    expect(makeLeaderProblem(seen(), realm, leader, child)).toBe('Ana is a child')
  })

  it('can’t make someone in a mercenary contract or named in an offer Leader', () => {
    expect(makeLeaderProblem(seen({ contracts: [contract(0)] }), realm, leader, ana)).toBe(
      'Ana is in a mercenary contract',
    )
    expect(makeLeaderProblem(seen({ contracts: [contract(null)] }), realm, leader, ana)).toBe(
      'Ana is named in a mercenary contract offer',
    )
  })

  it('can’t make someone in the alliance army Leader', () => {
    const alliance = {
      id: 'a1',
      name: 'North',
      leaderId: 'them',
      members: [],
      invites: [],
      army: [{ realmId: 'me', realm: 'Me', is: 'resident' as const, id: 'ana', recallAt: null }],
    }
    expect(makeLeaderProblem(seen({ alliance }), realm, leader, ana)).toBe(
      'Ana is in the alliance army',
    )
  })

  it('can’t make another realm’s resident Leader', () => {
    const theirs = { ...ana, owner: 'them' }
    expect(makeLeaderProblem(seen(), realm, leader, theirs)).toBe('not one of your residents')
  })
})

describe('keys', () => {
  it('run the action with that key, in either case, unless it is turned off', () => {
    const a = residentActions(here({ adult: false, carriage }))
    expect(actionForKey(a, 'w')?.id).toBe('walk')
    expect(actionForKey(a, 'W')?.id).toBe('walk')
    expect(actionForKey(a, 'd')).toBeUndefined()
    expect(actionForKey(a, 'z')).toBeUndefined()
  })
})

const things = (more: Partial<TileThings> = {}): TileThings => ({
  x: 5,
  y: 5,
  buildings: [],
  carriages: [],
  piles: [],
  node: undefined,
  strangers: [],
  cities: [
    { id: 'c-me', name: 'Eastmere', realmId: 'me' },
    { id: 'c-npc', name: 'Oakhollow', realmId: null },
  ],
  viewer: { realmId: 'me', allies: new Set() },
  workers: () => 1,
  ...more,
})
const tile = (more: Partial<TileThings> = {}) => describeTile(things(more), GOOD_LABELS)

describe('the card for a tile', () => {
  it('is named after a building on it, in its owner’s colour', () => {
    const card = tile({ buildings: [building({ kind: 'farm', cityId: 'c-me' })] })
    expect(card).toMatchObject({ title: 'Eastmere farm', rel: 'own', what: 'building' })
    expect(card.lines).toContain(`1 / ${MAX_WORKERS.farm} workers`)
  })

  it('says how far a construction site has come', () => {
    const site = building({ kind: 'house', site: { work: 0, delivered: { wood: 2 } } })
    const card = tile({ buildings: [site] })
    expect(card.title).toBe('House site')
    expect(card.lines.some((l) => l.startsWith('0% of the work done · delivered 2 wood'))).toBe(
      true,
    )
  })

  it('shows a carriage, a pile and a node when there is no building', () => {
    expect(tile({ carriages: [carriage] })).toMatchObject({ what: 'carriage', rel: 'own' })
    expect(tile({ piles: [pile] })).toMatchObject({ what: 'pile' })
    expect(tile({ piles: [pile] }).lines).toContain('On the ground: 4 stone')
    const node = { kind: 'ironOre' as const, x: 5, y: 5 }
    expect(tile({ node })).toMatchObject({ what: 'node', title: 'Iron ore node' })
  })

  it('lists everything on the tile under the building it is named after', () => {
    const card = tile({
      buildings: [building({ kind: 'storage', cityId: 'c-me', stock: { food: 3 } })],
      carriages: [carriage],
      piles: [pile],
    })
    expect(card.what).toBe('building')
    expect(card.lines).toEqual(
      expect.arrayContaining(['Holds 3 food', 'On the ground: 4 stone', 'Tile 5, 5']),
    )
    expect(card.lines.some((l) => l.startsWith('Carriage'))).toBe(true)
  })

  it('ignores what stands on other tiles', () => {
    const far = { ...carriage, x: 6 }
    expect(tile({ carriages: [far] })).toMatchObject({ what: 'tile', title: 'Open ground' })
  })

  it('shows strangers on it in their realm’s colour', () => {
    const r = { name: 'Brann', owner: 'them', cityId: null } as Resident
    expect(tile({ strangers: [r] })).toMatchObject({ title: 'Brann', rel: 'otherRealm' })
  })
})

describe('the actions on a tile’s card', () => {
  const actor = { id: 'r1', name: 'Ada' } as Resident

  it('sends the resident picked last there', () => {
    const card = tile()
    expect(tileActions(card, actor).map((a) => a.label)).toEqual(['Send Ada here'])
    expect(tileActions(card, undefined)).toEqual([])
  })

  it('opens or closes a gate of the Player’s own city, not another’s', () => {
    const own = tile({ buildings: [building({ kind: 'gate', cityId: 'c-me', closed: true })] })
    expect(tileActions(own, undefined).map((a) => a.label)).toEqual(['Open the gate'])
    const theirs = tile({ buildings: [building({ kind: 'gate', cityId: 'c-npc' })] })
    expect(tileActions(theirs, undefined)).toEqual([])
  })
})
