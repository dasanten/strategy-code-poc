import { describe, expect, it } from 'vitest'
import {
  CARRIAGE_CAPACITY,
  FOOTPRINT,
  MAP_SIZE,
  MAX_HEALTH,
  MAX_HUNGER,
  MAX_WORKERS,
  STABLE_BREED_DAYS,
  STABLE_CAPACITY,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  BUILD_MATERIALS,
  BUILD_WORK,
  NODE_GOOD,
  NODE_WORKPLACE,
  PASSENGER_WEIGHT,
  stockWeight,
  Terrain,
  UNEXPLORED,
  WORK_OUTPUT_PER_DAY,
  buildMenu,
  ticksForAge,
  footprintTiles,
  type Building,
  type Carriage,
  type City,
  type ContractView,
  type Diplomacy,
  type Horse,
  type Pile,
  type Resident,
  type SeenResident,
  type SeenHorse,
} from '@csp/shared'
import { BUILDING_NAMES } from './map/palette.js'
import {
  actionForKey,
  buildHereProblem,
  describeTile,
  makeLeaderProblem,
  nodeFit,
  groupOrders,
  residentActions,
  riddenHorseLine,
  tileActions,
  unhitcherOf,
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
  othersInSight: 0,
  wallsInSight: 0,
  picking: false,
  ...more,
})
const ids = (h: ResidentHere) => residentActions(h).map((a) => a.id)

describe('the actions on a resident’s card', () => {
  it('offers walking, building, a road, a wall, pairing and scripts to an idle adult on open ground', () => {
    expect(ids(here())).toEqual(['walk', 'build', 'roadTo', 'wallTo', 'pair', 'script'])
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

  it('offers feeding a finished stable on their tile', () => {
    expect(ids(here({ building: building({ kind: 'stable' }) }))).toContain('feedStable')
    const site = building({ kind: 'stable', site: { work: 0, delivered: {} } })
    expect(ids(here({ building: site }))).not.toContain('feedStable')
    expect(ids(here({ building: building({ kind: 'storage' }) }))).not.toContain('feedStable')
  })

  it('offers training on a finished training ground on their tile, to the grown', () => {
    const ground = building({ kind: 'trainingGround' })
    expect(ids(here({ building: ground }))).toContain('train')
    const site = building({ kind: 'trainingGround', site: { work: 0, delivered: {} } })
    expect(ids(here({ building: site }))).not.toContain('train')
    expect(ids(here({ building: building({ kind: 'farm' }) }))).not.toContain('train')
    expect(ids(here({ building: ground, adult: false }))).not.toContain('train')
  })

  it('offers tearing down what was built on their tile, but not a warehouse', () => {
    expect(ids(here({ building: building({ kind: 'farm' }) }))).toContain('tearDown')
    expect(ids(here({ road: building({ kind: 'road' }) }))).toContain('tearDown')
    expect(ids(here({ building: building({ kind: 'warehouse' }) }))).not.toContain('tearDown')
  })

  it('offers breeding horses at a finished stable', () => {
    const stable = building({ kind: 'stable' })
    expect(ids(here({ building: stable }))).toContain('breed')
    expect(ids(here({ building: { ...stable, site: { work: 0, delivered: {} } } }))).not.toContain(
      'breed',
    )
    expect(ids(here({ building: building({ kind: 'farm' }) }))).not.toContain('breed')
  })

  it('offers goods only with something carried or something on their tile to pick up', () => {
    expect(ids(here())).not.toContain('goods')
    expect(ids(here({ carries: true }))).toContain('goods')
    expect(ids(here({ pile }))).toContain('goods')
    expect(ids(here({ pile: { ...pile, goods: {} } }))).not.toContain('goods')
    expect(ids(here({ storage: building({ kind: 'storage', stock: { food: 2 } }) }))).toContain(
      'goods',
    )
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

  it('shows a child only the orders they can take: walking, riding, goods, scripts, attacking', () => {
    const stable = building({ kind: 'stable' })
    const child = here({
      adult: false,
      carriage,
      pile,
      carries: true,
      building: stable,
      horseToRide: true,
      othersInSight: 1,
      renamable: true,
    })
    expect(ids(child)).toEqual(['walk', 'ride', 'goods', 'attack', 'script', 'rename'])
    expect(residentActions(child).some((a) => a.disabled)).toBe(false)
  })

  it('offers a child Goods only with Food carried or on their tile', () => {
    const child = (more: Partial<ResidentHere>) => ids(here({ adult: false, ...more }))
    expect(child({ pile })).not.toContain('goods')
    expect(child({ storage: building({ kind: 'storage', stock: { wood: 9 } }) })).not.toContain(
      'goods',
    )
    expect(child({ storage: building({ kind: 'storage', stock: { food: 9 } }) })).toContain('goods')
    expect(child({ pile: { ...pile, goods: { food: 1 } } })).toContain('goods')
    expect(ids(here({ pile }))).toContain('goods')
  })

  it('hides work, building, hauling and pairing from someone carrying a child', () => {
    const carrying = here({
      carrying: true,
      carriage,
      carries: true,
      building: building({ kind: 'farm' }),
    })
    expect(ids(carrying)).toEqual(['walk', 'drive', 'goods', 'script'])
  })

  it('shows a grown resident every order that fits their tile', () => {
    const stable = building({ kind: 'stable' })
    expect(ids(here({ carriage, carries: true, building: stable }))).toEqual([
      'walk',
      'drive',
      'haul',
      'feedStable',
      'build',
      'roadTo',
      'wallTo',
      'tearDown',
      'breed',
      'goods',
      'pair',
      'script',
    ])
  })

  it('shows which action the map is picking a tile for', () => {
    const walk = residentActions(here({ picking: 'walk' })).find((a) => a.id === 'walk')!
    expect(walk).toMatchObject({ active: true, label: 'Pick a tile…' })
  })

  it('offers mounting with a free horse on their tile, and dismounting while they ride', () => {
    expect(ids(here())).not.toContain('ride')
    const mount = residentActions(here({ horseToRide: true })).find((a) => a.id === 'ride')
    expect(mount?.label).toBe('Mount horse')
    const off = residentActions(here({ riding: true, horseToRide: true })).filter(
      (a) => a.id === 'ride',
    )
    expect(off.map((a) => a.label)).toEqual(['Dismount'])
    const drive = residentActions(here({ riding: true, carriage })).find((a) => a.id === 'drive')
    expect(drive).toMatchObject({ disabled: true, reason: 'dismount first to drive' })
  })

  it('offers unhitching a hitched carriage of the realm on their tile to grown-ups', () => {
    expect(ids(here({ carriage }))).not.toContain('unhitch')
    const unhitch = residentActions(here({ carriageToUnhitch: true })).find(
      (a) => a.id === 'unhitch',
    )
    expect(unhitch).toMatchObject({ label: 'Unhitch horse', key: 'U' })
    expect(ids(here({ carriageToUnhitch: true, adult: false }))).not.toContain('unhitch')
  })

  it('offers boarding a carriage of the realm on their tile, children too, and getting off aboard', () => {
    expect(ids(here())).not.toContain('board')
    const board = (h: Parameters<typeof here>[0]) =>
      residentActions(here(h)).filter((a) => a.id === 'board')
    expect(board({ carriageToBoard: true, adult: false })).toEqual([
      expect.objectContaining({ label: 'Board carriage', key: 'K' }),
    ])
    expect(board({ carriageToBoard: true, riding: true })).toEqual([
      expect.objectContaining({ disabled: true, reason: 'dismount first to board' }),
    ])
    expect(board({ carriageToBoard: true, driving: true })).toEqual([
      expect.objectContaining({ disabled: true, reason: 'the driver can’t board' }),
    ])
    expect(board({ aboard: true, carriageToBoard: true }).map((a) => a.label)).toEqual(['Get off'])
  })

  it('gives every shown action its own key', () => {
    const all = here({
      busy: true,
      carriage,
      pile,
      building: building({ kind: 'farm' }),
      road: building({ kind: 'road' }),
      othersInSight: 1,
      wallsInSight: 1,
      makeLeader: { problem: undefined },
      renamable: true,
      horseToRide: true,
      carriageToBoard: true,
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

  it('offers Rename only for an own resident', () => {
    expect(ids(here())).not.toContain('rename')
    const a = residentActions(here({ renamable: true })).find((x) => x.id === 'rename')
    expect(a).toMatchObject({ label: 'Rename…', key: 'N', opens: true })
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
    const a = residentActions(here({ riding: true, carriage }))
    expect(actionForKey(a, 'w')?.id).toBe('walk')
    expect(actionForKey(a, 'W')?.id).toBe('walk')
    expect(actionForKey(a, 'd')).toBeUndefined()
    expect(actionForKey(a, 'z')).toBeUndefined()
  })
})

describe('the Orders tab', () => {
  it('groups the orders by kind: Move, Work & build, Goods, Scripts, then the rest', () => {
    const a = residentActions(
      here({ busy: true, carriage, carries: true, othersInSight: 1, renamable: true }),
    )
    expect(groupOrders(a).map((g) => [g.label, g.actions.map((x) => x.id)])).toEqual([
      ['Move', ['walk', 'stop', 'drive', 'haul']],
      ['Work & build', ['build', 'roadTo', 'wallTo']],
      ['Goods', ['goods']],
      ['Scripts', ['script']],
      ['Other', ['pair', 'attack', 'rename']],
    ])
  })

  it('leaves out kinds with no order a child can take', () => {
    expect(groupOrders(residentActions(here({ adult: false }))).map((g) => g.label)).toEqual([
      'Move',
      'Scripts',
    ])
  })
})

const things = (more: Partial<TileThings> = {}): TileThings => ({
  x: 5,
  y: 5,
  buildings: [],
  carriages: [],
  horses: [],
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

  it('names an outpost storage’s realm (`CONTEXT.md`: Outpost storage)', () => {
    const mine = building({ kind: 'storage', realmId: 'me', stock: { food: 3 } })
    expect(tile({ buildings: [mine] })).toMatchObject({ title: 'Outpost storage', rel: 'own' })
    expect(tile({ buildings: [mine] }).lines).toEqual(
      expect.arrayContaining(['Yours', 'Holds 3 food']),
    )
    // As sight sends another realm's: without what it holds.
    const theirs = building({ kind: 'storage', realmId: 'r-other' })
    const card = tile({ buildings: [theirs] })
    expect(card).toMatchObject({ title: 'Outpost storage', rel: 'otherRealm' })
    expect(card.lines).toContain('Another realm')
    expect(card.lines.some((l) => l.startsWith('Holds'))).toBe(false)
    expect(tile({ buildings: [building({ kind: 'storage' })] }).lines).toContain('Nobody’s')
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

  it('lists a carriage’s passengers under its load, and how much of it is people', () => {
    const ana = { id: 'ana', name: 'Ana' } as SeenResident
    const bo = { id: 'bo', name: 'Bo' } as SeenResident
    const cid = { id: 'cid', name: 'Cid', owner: 'them', cityId: null, carried: {} } as Resident
    const k = { ...carriage, passengerIds: ['ana', 'bo', 'cid'] }
    const card = tile({ carriages: [k], residents: [ana, bo, cid], strangers: [cid] })
    const people = 3 * PASSENGER_WEIGHT
    const weight = Math.round(stockWeight(carriage.load) + people)
    expect(card.lines[0]).toContain(`${weight} / ${CARRIAGE_CAPACITY} kg`)
    expect(card.lines[1]).toBe(`Passengers: Ana, Bo, Cid · ${people} kg of it people`)
    // Each a link to pick them, but the stranger.
    expect(card.passengers).toEqual({
      line: 1,
      residents: [
        { id: 'ana', name: 'Ana', pick: true },
        { id: 'bo', name: 'Bo', pick: true },
        { id: 'cid', name: 'Cid', pick: false },
      ],
      weight: `${people} kg of it people`,
    })
    // Under a building's card it follows the carriage's line there.
    const under = tile({
      buildings: [building({ kind: 'farm', cityId: 'c-me' })],
      carriages: [k],
      residents: [ana],
    })
    const at = under.lines.findIndex((l) => l.startsWith('Carriage'))
    expect(under.passengers?.line).toBe(at + 1)
    expect(under.lines[at + 1]).toBe(`Passengers: Ana · ${PASSENGER_WEIGHT} kg of it people`)
    // None aboard: no line, no list.
    expect(tile({ carriages: [carriage] }).passengers).toBeUndefined()
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

  it('says only how heavily loaded a carriage is, and nothing of what a storage holds, when it can’t see inside', () => {
    // As sight sends them to a stranger (`CONTEXT.md`: Seeing inside a storage).
    const { id, x, y, horseId } = carriage
    const theirs = {
      id,
      x,
      y,
      horseId,
      realmId: 'r-other',
      cityId: null,
      loadLevel: 'half' as const,
    }
    const card = tile({
      buildings: [building({ kind: 'storage', cityId: 'c-other' })],
      carriages: [theirs],
    })
    expect(card.lines.some((l) => l.startsWith('Holds'))).toBe(false)
    expect(card.lines.find((l) => l.startsWith('Carriage'))).toContain('· half loaded')
    expect(card.lines.find((l) => l.startsWith('Carriage'))).not.toContain('kg')
  })

  it('ignores what stands on other tiles', () => {
    const far = { ...carriage, x: 6 }
    expect(tile({ carriages: [far] })).toMatchObject({ what: 'tile', title: 'Open ground' })
  })

  it('shows a building and its pile on every tile of its footprint, and not beside it', () => {
    for (const kind of ['gate', 'storage', 'townHall', 'farm'] as const) {
      const b = building({ kind, cityId: 'c-me' })
      for (const [x, y] of footprintTiles(b)) {
        const card = tile({ x, y, buildings: [b], piles: [pile] })
        expect(card).toMatchObject({
          what: 'building',
          title: `Eastmere ${BUILDING_NAMES[kind].toLowerCase()}`,
        })
        expect(card.lines).toContain('On the ground: 4 stone')
      }
      const side = FOOTPRINT[kind]
      expect(tile({ x: 5 + side, y: 5, buildings: [b] }).what).toBe('tile')
      expect(tile({ x: 5, y: 5 + side, buildings: [b] }).what).toBe('tile')
    }
  })

  it('finds a building across the map’s join', () => {
    const b = building({
      kind: 'storage',
      cityId: 'c-me',
      x: MAP_SIZE - 1,
      y: MAP_SIZE - 1,
      stock: { food: 3 },
    })
    const card = tile({ x: 0, y: 0, buildings: [b] })
    expect(card.what).toBe('building')
    expect(card.lines).toContain('Holds 3 food')
  })

  it('shows strangers on it in their realm’s colour', () => {
    const r = { name: 'Brann', owner: 'them', cityId: null, carried: {} } as Resident
    expect(tile({ strangers: [r] })).toMatchObject({ title: 'Brann', rel: 'otherRealm' })
  })

  it('shows a building only remembered as last seen, apart from what is there now', () => {
    const storage = building({ kind: 'storage', cityId: 'c-npc', stock: { food: 3 } })
    const card = tile({
      lastSeen: { buildings: [{ ...storage, seenAt: 0 }], tick: 3 * TICKS_PER_GAME_DAY },
      piles: [pile],
    })
    expect(card).toMatchObject({ title: 'Oakhollow storage', rel: 'npcCity', what: 'building' })
    expect(card.lastSeen).toEqual({
      when: 'Last seen: day 1, 00:00 (3 days ago)',
      lines: ['NPC city', 'Holds 3 food'],
    })
    // What is in sight there now stays apart from it.
    expect(card.lines).toEqual(['On the ground: 4 stone', 'Tile 5, 5'])
    // A building in sight wins over a memory of the tile.
    const now = tile({
      buildings: [building({ kind: 'farm', cityId: 'c-me' })],
      lastSeen: { buildings: [{ ...storage, seenAt: 0 }], tick: 10 },
    })
    expect(now.title).toBe('Eastmere farm')
    expect(now.lastSeen).toBeUndefined()
  })
})

describe('horses on the tile card', () => {
  const horse = (h: Partial<Horse> = {}): Horse => ({
    id: 'h1',
    realmId: 'me',
    cityId: null,
    x: 5,
    y: 5,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: { speed: 12, strength: 8, endurance: 10 },
    bornAt: 0,
    ...h,
  })
  /** As sight sends a stranger's horse: without its hunger and health. */
  const unknown = (h: Partial<Horse>): SeenHorse => {
    const seen: SeenHorse = horse(h)
    delete seen.hunger
    delete seen.health
    return seen
  }
  const horseLine = (lines: string[]) => lines.find((l) => l.startsWith('Horse:'))

  it('tells how the own carriage’s horse fares and how long the Food on board feeds it', () => {
    const fed = tile({ carriages: [{ ...carriage, load: { food: 6 } }], horses: [horse()] })
    expect(horseLine(fed.lines)).toBe(
      'Horse: Speed 12, Strength 8, Endurance 10 · fed, healthy · Food on board for 8 game days',
    )
    const hungry = tile({
      carriages: [carriage],
      horses: [horse({ hunger: 10, health: MAX_HEALTH - 5 })],
    })
    expect(horseLine(hungry.lines)).toBe(
      'Horse: Speed 12, Strength 8, Endurance 10 · hungry, hurt · no Food on board',
    )
    const starving = tile({ carriages: [carriage], horses: [horse({ hunger: 0 })] })
    expect(horseLine(starving.lines)).toContain('· starving, healthy')
    // A hitched horse is not a loose one.
    expect(fed.lines.some((l) => l.includes('1 horse ('))).toBe(false)
  })

  it('says only whether a stranger’s carriage has a horse, and its horse’s stats', () => {
    const { id, x, y } = carriage
    const theirs = { id, x, y, realmId: 'r-other', cityId: null, loadLevel: 'empty' as const }
    const hitched = tile({
      carriages: [{ ...theirs, horseId: 'h1' }],
      horses: [unknown({ realmId: 'r-other' })],
    })
    expect(hitched.lines.find((l) => l.startsWith('Carriage'))).toBe(
      'Carriage (another realm) · empty · horse hitched',
    )
    expect(horseLine(hitched.lines)).toBe('Horse: Speed 12, Strength 8, Endurance 10')
    const bare = tile({ carriages: [{ ...theirs, horseId: null }] })
    expect(bare.lines.find((l) => l.startsWith('Carriage'))).toBe(
      'Carriage (another realm) · empty · no horse',
    )
    const mine = tile({ carriages: [{ ...carriage, horseId: null }] })
    expect(mine.lines.find((l) => l.startsWith('Carriage'))).toContain('· no horse hitched')
  })

  it('lists a rider’s horse on their card with its stats, age and how it fares', () => {
    const at = 5 * TICKS_PER_GAME_YEAR + 100
    const ridden = horse({ id: 'h2', hunger: 10, health: MAX_HEALTH - 5 })
    const horses = [horse(), ridden]
    expect(riddenHorseLine({ riding: 'h2' }, horses, at)).toBe(
      'Horse: Speed 12, Strength 8, Endurance 10 · 5 years old · hungry, hurt · eats from your spare Food',
    )
    expect(riddenHorseLine({}, horses, at)).toBeUndefined()
    // A horse not in sight shows nothing.
    expect(riddenHorseLine({ riding: 'h9' }, horses, at)).toBeUndefined()
  })

  it('shows each horse’s stats, age and how it fares, and how much its carriage holds', () => {
    const at = 5 * TICKS_PER_GAME_YEAR + 100
    const strong = horse({ stats: { speed: 9, strength: 15, endurance: 13 }, hunger: 10 })
    const card = tile({ horses: [strong], tick: at })
    expect(card.lines).toContain(
      '· Speed 9, Strength 15, Endurance 13 · 5 years old · hungry, healthy',
    )
    const foal = horse({ bornAt: at - 3 * TICKS_PER_GAME_DAY })
    expect(tile({ horses: [foal], tick: at }).lines).toContain(
      '· Speed 12, Strength 8, Endurance 10 · 3 game days old · fed, healthy',
    )
    // A stranger's horse shows its stats and age, but not how it fares.
    const theirs = unknown({ realmId: 'r-other', bornAt: at - TICKS_PER_GAME_YEAR })
    expect(tile({ horses: [theirs], tick: at }).lines).toContain(
      '· Speed 12, Strength 8, Endurance 10 · 1 year old',
    )
    // Strength 15 is 5 above average: the carriage it pulls holds a fifth more.
    const k = { ...carriage, horseId: strong.id, load: { stone: 4 } }
    const pulled = tile({ carriages: [k], horses: [strong], tick: at })
    expect(pulled.lines.find((l) => l.startsWith('Carriage'))).toContain(
      `/ ${CARRIAGE_CAPACITY * 1.2} kg`,
    )
  })

  it('counts loose horses on a tile, how they fare only for the Player’s own, and is named after them', () => {
    const card = tile({
      horses: [
        horse({ id: 'h1' }),
        horse({ id: 'h2', hunger: 5 }),
        unknown({ id: 'h3', realmId: 'r-other' }),
      ],
    })
    expect(card).toMatchObject({ title: '3 horses', what: 'horses', rel: 'own' })
    expect(card.lines).toEqual(
      expect.arrayContaining(['2 horses (yours) · 1 hungry', '1 horse (another realm)']),
    )
    expect(tile({ horses: [horse()] })).toMatchObject({ title: 'Horse', what: 'horses' })
    expect(tile({ horses: [horse({ x: 6 })] }).what).toBe('tile')
  })

  it('shows a stable’s horses, room, Food and how long until the foal while a resident breeds', () => {
    const stable = building({ kind: 'stable', cityId: 'c-me', stock: { food: 30 } })
    // The carriage's hitched horse stands in the stable too, and can be bred.
    const pair = [horse({ id: 'h1' }), horse({ id: 'h2', x: 6, y: 6 })]
    const breeder = {
      id: 'ana',
      name: 'Ana',
      x: 5,
      y: 5,
      order: {
        kind: 'breed',
        stableId: stable.id,
        horseIds: ['h1', 'h2'],
        at: { x: 5, y: 5 },
        progress: 3 * TICKS_PER_GAME_DAY,
      },
    } as unknown as SeenResident
    const card = tile({
      buildings: [stable],
      horses: pair,
      carriages: [carriage],
      residents: [breeder],
    })
    expect(card.what).toBe('building')
    expect(card.lines).toEqual(
      expect.arrayContaining([
        '2 horses (yours)',
        `Room for ${STABLE_CAPACITY - 2} more horses`,
        'Holds 30 food',
        `Breeding: a foal in about ${STABLE_BREED_DAYS - 3} game days`,
      ]),
    )
    // Fed horses alone breed no foal.
    const alone = tile({ buildings: [stable], horses: pair })
    expect(alone.lines.some((l) => l.startsWith('Breeding'))).toBe(false)
    // A breeding the stable keeps: paused while nobody tends the pair, with the two horses.
    const kept = {
      ...stable,
      breedings: [{ horseIds: ['h1', 'h2'] as [string, string], progress: 4 * TICKS_PER_GAME_DAY }],
    }
    const paused = tile({ buildings: [kept], horses: pair })
    const pct = Math.floor((4 / STABLE_BREED_DAYS) * 100)
    const at = paused.lines.indexOf(`Breeding paused: ${pct}% of the way to a foal`)
    expect(at).toBeGreaterThan(-1)
    expect(paused.lines[at + 1]).toMatch(/^· Speed/)
    expect(paused.lines[at + 2]).toMatch(/^· Speed/)
    const tended = tile({ buildings: [kept], horses: pair, residents: [breeder] })
    expect(tended.lines.some((l) => l.startsWith('Breeding paused'))).toBe(false)
    const empty = tile({ buildings: [{ ...stable, stock: {} }] })
    expect(empty.lines).toEqual(
      expect.arrayContaining(['No horses in it', `Room for ${STABLE_CAPACITY} more horses`]),
    )
  })

  it('keeps a stranger’s stable’s Food and its horses’ condition hidden', () => {
    const theirs = building({ kind: 'stable', cityId: 'c-other' })
    const card = tile({
      buildings: [theirs],
      horses: [
        unknown({ id: 'h1', realmId: 'r-other' }),
        unknown({ id: 'h2', realmId: 'r-other' }),
      ],
    })
    expect(card.lines.some((l) => l.startsWith('Holds'))).toBe(false)
    expect(card.lines.some((l) => l.startsWith('Breeding'))).toBe(false)
    expect(card.lines).toContain('2 horses (another realm)')
  })
})

describe('the actions on a tile’s card', () => {
  const actor = { id: 'r1', name: 'Ada' } as Resident

  it('unhitches a carriage’s horse by a grown resident of the realm on its tile', () => {
    const grown = (id: string, more: object = {}) =>
      ({
        id,
        name: id,
        owner: 'me',
        cityId: null,
        x: 5,
        y: 5,
        bornAt: 0,
        carried: {},
        ...more,
      }) as Resident
    const tick = 100 * TICKS_PER_GAME_YEAR
    const ada = grown('ada')
    const bo = grown('bo')
    const kid = grown('kid', { bornAt: tick })
    const away = grown('away', { x: 6 })
    const stranger = grown('st', { owner: 'them' })
    const residents = [kid, away, stranger, ada, bo]
    const card = tile({ carriages: [carriage], residents, strangers: [stranger], tick })
    expect(card.unhitch).toEqual({
      carriageId: 'k1',
      residents: [
        { id: 'ada', name: 'ada' },
        { id: 'bo', name: 'bo' },
      ],
    })
    expect(tileActions(card, undefined).map((a) => a.label)).toEqual(['Unhitch horse'])
    // The resident picked last when they may, else the first who may.
    expect(unhitcherOf(card, bo)).toBe('bo')
    expect(unhitcherOf(card, kid)).toBe('ada')
    // Nobody to do it, or no horse hitched: no button.
    expect(tile({ carriages: [carriage], residents: [kid], tick }).unhitch).toBeUndefined()
    const bare = tile({ carriages: [{ ...carriage, horseId: null }], residents, tick })
    expect(bare.unhitch).toBeUndefined()
  })

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

  it('offers nothing to do with a building only remembered, but still sends there', () => {
    const gate = { ...building({ kind: 'gate', cityId: 'c-me', closed: true }), seenAt: 0 }
    const card = tile({ lastSeen: { buildings: [gate], tick: 10 } })
    expect(tileActions(card, actor).map((a) => a.label)).toEqual(['Send Ada here'])
  })
})

describe('the card for a resource node', () => {
  const kinds = [
    ['forest', 'lumber camp', 'Lumber camp', 'wood', 'Woodcutting'],
    ['stone', 'quarry', 'Quarry', 'stone', 'Mining'],
    ['ironOre', 'mine', 'Mine', 'iron ore', 'Mining'],
    ['goldOre', 'mine', 'Mine', 'gold ore', 'Mining'],
  ] as const
  const fit = { x: 4, y: 5 }

  it.each(kinds)('says a %s node’s workplace can be built there when it fits', (k, name) => {
    const kind = NODE_WORKPLACE[k]
    const card = tile({ node: { kind: k, x: 5, y: 5 }, nodeFit: fit })
    expect(card.what).toBe('node')
    expect(card.lines[0]).toBe(`A ${name} can be built here`)
    const work = BUILD_WORK[kind]! / TICKS_PER_GAME_DAY
    const materials = Object.keys(BUILD_MATERIALS[kind]!).length > 0
    expect(card.lines[1]).toMatch(materials ? /^Needs \d+ \w+/ : /^Needs no materials/)
    expect(card.lines[1]).toContain(`${work} game days of one resident’s work`)
    expect(card.buildHere).toEqual({ kind, at: fit })
  })

  it.each(kinds)('says what a %s node’s workplace makes, teaches and takes', (k, ...rest) => {
    const [, , good, skill] = rest
    const kind = NODE_WORKPLACE[k]
    const card = tile({ node: { kind: k, x: 5, y: 5 }, nodeFit: fit })
    expect(card.lines).toContain(`Makes ${good} · teaches ${skill}`)
    expect(card.lines).toContain(
      `Up to ${MAX_WORKERS[kind]} workers · about ${WORK_OUTPUT_PER_DAY[NODE_GOOD[k]]} ${good} each a game day at average Strength`,
    )
  })

  it.each(kinds)('says there is no room on a %s node where it doesn’t fit', (k, name) => {
    const card = tile({ node: { kind: k, x: 5, y: 5 } })
    expect(card.lines[0]).toBe(`No room for a ${name} here`)
    expect(card.buildHere).toEqual({ kind: NODE_WORKPLACE[k], at: undefined })
  })

  it.each(kinds)('keeps the short line on a %s node built over', (k) => {
    const workplace = building({ kind: NODE_WORKPLACE[k], cityId: null })
    const card = tile({ node: { kind: k, x: 5, y: 5 }, buildings: [workplace], nodeFit: fit })
    expect(card.what).toBe('building')
    const words = {
      forest: 'a forest',
      stone: 'a stone',
      ironOre: 'an iron ore',
      goldOre: 'a gold ore',
    }[k]
    expect(card.lines).toContain(`On ${words} node`)
    expect(card.lines.some((l) => l.includes('can be built'))).toBe(false)
    expect(card.buildHere).toBeUndefined()
  })

  it('is named after the node’s kind', () => {
    expect(tile({ node: { kind: 'forest', x: 5, y: 5 } }).title).toBe('Forest node')
    expect(tile({ node: { kind: 'ironOre', x: 5, y: 5 } }).title).toBe('Iron ore node')
  })
})

describe('where a node’s workplace fits on what the Player knows', () => {
  const SIZE = 64
  const seen = { buildings: [] as Building[], cities: [] as City[] }
  const forest = { kind: 'forest' as const, x: 10, y: 10 }
  const nodes = [forest]
  const nodeAt = (x: number, y: number) => nodes.find((n) => n.x === x && n.y === y)
  const lookup = (at: (x: number, y: number) => number) => ({ size: SIZE, at })

  it('lays it out with the node’s own tile north-west on open, explored land', () => {
    expect(
      nodeFit(
        forest,
        seen,
        nodeAt,
        lookup(() => Terrain.Forest),
      ),
    ).toEqual({ x: 10, y: 10 })
  })

  it('moves the footprint round a building in the way, and finds none when it is boxed in', () => {
    const east = building({ kind: 'house', x: 11, y: 9 })
    const within = { ...seen, buildings: [east] }
    expect(
      nodeFit(
        forest,
        within,
        nodeAt,
        lookup(() => Terrain.Forest),
      ),
    ).toEqual({ x: 9, y: 10 })
    const water = lookup((x, y) => (x === 9 && y === 11 ? Terrain.Lake : Terrain.Forest))
    const boxed = { ...seen, buildings: [east, building({ kind: 'house', x: 9, y: 8 })] }
    expect(nodeFit(forest, boxed, nodeAt, water)).toBeUndefined()
  })

  it('doesn’t lay it out on unexplored land', () => {
    expect(
      nodeFit(
        forest,
        seen,
        nodeAt,
        lookup(() => UNEXPLORED),
      ),
    ).toBeUndefined()
  })
})

describe('what the build menu offers off a node, and why a kind can’t go here', () => {
  const SIZE = 64
  const plains = { size: SIZE, at: () => Terrain.Plains }
  const hall = building({ id: 'hall', kind: 'townHall', cityId: 'c1', x: 20, y: 20 })
  const seen = {
    buildings: [hall],
    cities: [{ id: 'c1', name: 'Ashford', realmId: 'me', townHallId: 'hall' }] as City[],
  }
  const noNodes = () => undefined

  it('lists town hall, storage, wall and gate with everything else that goes off a node', () => {
    const menu = buildMenu(undefined)
    expect(menu).toEqual(expect.arrayContaining(['townHall', 'house', 'storage', 'wall', 'gate']))
    expect(menu).toEqual(expect.arrayContaining(['farm', 'stable', 'smelter', 'mint', 'smithy']))
    expect(menu).not.toContain('road')
    expect(buildMenu({ kind: 'forest' })).toEqual(['lumberCamp'])
  })

  it('says a house goes in a city’s area, and lets a storage go outside one', () => {
    expect(buildHereProblem('house', 23, 20, seen, noNodes, plains)).toBeUndefined()
    expect(buildHereProblem('house', 50, 50, seen, noNodes, plains)).toBe(
      'a house goes in a city’s area',
    )
    // An outpost storage (`CONTEXT.md`: Outpost storage).
    expect(buildHereProblem('storage', 50, 50, seen, noNodes, plains)).toBeUndefined()
    // Walls and gates go anywhere off Mountain and nodes.
    expect(buildHereProblem('wall', 50, 50, seen, noNodes, plains)).toBeUndefined()
    expect(buildHereProblem('gate', 50, 50, seen, noNodes, plains)).toBeUndefined()
  })

  it('says why on taken tiles, nodes and Mountain', () => {
    expect(buildHereProblem('wall', 21, 21, seen, noNodes, plains)).toBe(
      'there is already a building there',
    )
    const forestAt = (x: number, y: number) =>
      x === 51 && y === 51 ? { kind: 'forest' as const, x, y } : undefined
    expect(buildHereProblem('townHall', 50, 50, seen, forestAt, plains)).toBe(
      'a townHall goes off any resource node, and not on Mountain',
    )
    const mountain = { size: SIZE, at: () => Terrain.Mountain }
    expect(buildHereProblem('gate', 50, 50, seen, noNodes, mountain)).toBe(
      'a gate goes off any resource node, and not on Mountain',
    )
  })
})

describe('Build a … here on a node’s card', () => {
  const adult = { id: 'r1', name: 'Ada', bornAt: -ticksForAge(30) } as Resident
  const child = { id: 'r2', name: 'Pip', bornAt: -ticksForAge(5) } as Resident
  const node = { kind: 'forest' as const, x: 5, y: 5 }
  const build = (card: ReturnType<typeof tile>, actor: Resident | undefined) =>
    tileActions(card, actor, 0).find((a) => a.id === 'build')

  it('has the resident picked last build there, on key B', () => {
    const a = build(tile({ node, nodeFit: { x: 5, y: 5 } }), adult)
    expect(a).toMatchObject({ label: 'Build a lumber camp here', key: 'B' })
    expect(a?.disabled).toBeUndefined()
    expect(build(tile({ node, nodeFit: { x: 5, y: 5 } }), undefined)).toBeUndefined()
  })

  it('is turned off with the reason where it doesn’t fit or for a child', () => {
    expect(build(tile({ node }), adult)).toMatchObject({
      disabled: true,
      reason: 'no room for a lumber camp here',
    })
    expect(build(tile({ node, nodeFit: { x: 5, y: 5 } }), child)).toMatchObject({
      disabled: true,
      reason: 'children can’t build',
    })
  })

  it('isn’t offered on a node built over', () => {
    const camp = building({ kind: 'lumberCamp' })
    expect(build(tile({ node, buildings: [camp], nodeFit: { x: 5, y: 5 } }), adult)).toBeUndefined()
  })
})
