import { describe, expect, it } from 'vitest'
import {
  CARRIAGE_CAPACITY,
  OCCUPATION_GAME_DAYS,
  MAP_SIZE,
  MAX_HEALTH,
  MAX_HUNGER,
  STABLE_BREED_DAYS,
  STABLE_CAPACITY,
  STABLE_FEED_DAYS,
  HORSE_FOOD_PER_DAY,
  horseFoodFactor,
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_YEAR,
  PASSENGER_WEIGHT,
  BOAT_CAPACITY,
  SHIP_CAPACITY,
  ticksForAge,
} from '@csp/balance'
import { FOOTPRINT, footprintTiles } from './shared/footprint.js'
import { MAX_WORKERS, NODE_GOOD, buildMenu } from './shared/building.js'
import { TICKS_PER_GAME_HOUR } from './shared/time.js'
import { aboutTime, timeLeft } from './shared/estimates.js'
import {
  BUILD_MATERIALS,
  BUILD_WORK,
  WORK_OUTPUT_PER_DAY,
  AVERAGE_HORSE_STATS,
} from './shared/narrowed.js'
import { NODE_WORKPLACE, type HaulOrder } from './shared/world.js'
import { stockWeight } from './shared/stats.js'
import { Terrain, UNEXPLORED } from './shared/terrain.js'
import type {
  Building,
  Carriage,
  City,
  ContractView,
  Diplomacy,
  Horse,
  CarriageHorse,
  Pile,
  Resident,
  SeenResident,
  SeenHorse,
} from '@csp/shared-types'
import { BUILDING_NAMES } from './map/palette.js'
import {
  ACTION_KEYS,
  actionForKey,
  buildHereProblem,
  describeTile,
  escapeStep,
  keepRows,
  makeLeaderProblem,
  nodeFit,
  groupOrders,
  orderGroupOf,
  residentActions,
  residentOrders,
  DOWN_NO_ORDERS,
  HORSE_DOWN_NO_DRIVE,
  riddenHorseLine,
  rowGroups,
  feedTargetLabel,
  feedTargets,
  tileActions,
  commandedCarriages,
  strangersCarriage,
  thiefAmong,
  thiefOf,
  hitchChoice,
  unhitcherOf,
  boaterOf,
  type ActionId,
  HAUL_STARTS_ASHORE,
  type CardAction,
  type ResidentHere,
  type TileCard,
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
  it('offers walking, exploring, building, a road, a wall, pairing and scripts to an idle adult on open ground', () => {
    expect(ids(here())).toEqual(['walk', 'explore', 'build', 'roadTo', 'wallTo', 'pair', 'script'])
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

  it('offers teaching and training on a finished training ground on their tile, to the grown', () => {
    const ground = building({ kind: 'trainingGround' })
    const site = building({ kind: 'trainingGround', site: { work: 0, delivered: {} } })
    for (const id of ['teach', 'train']) {
      expect(ids(here({ building: ground }))).toContain(id)
      expect(ids(here({ building: site }))).not.toContain(id)
      // Off the ground's footprint there is no ground on their tile.
      expect(ids(here({ building: building({ kind: 'farm' }) }))).not.toContain(id)
      expect(ids(here({}))).not.toContain(id)
      expect(ids(here({ building: ground, adult: false }))).not.toContain(id)
    }
    const teach = residentActions(here({ building: ground })).find((a) => a.id === 'teach')!
    expect(teach.opens).toBe(true)
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
    // What someone Down on the tile carries (`CONTEXT.md`: Down).
    expect(ids(here({ downCarrying: [{ stone: 2 }] }))).toContain('goods')
    expect(ids(here({ adult: false, downCarrying: [{ stone: 2 }] }))).not.toContain('goods')
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
    expect(ids(carrying)).toEqual(['walk', 'drive', 'explore', 'goods', 'script'])
  })

  it('shows a grown resident every order that fits their tile', () => {
    const stable = building({ kind: 'stable' })
    expect(ids(here({ carriage, carries: true, building: stable }))).toEqual([
      'walk',
      'drive',
      'haul',
      'explore',
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

  it('offers Build line for road and wall, picking its start and then its end', () => {
    const line = (picking: ResidentHere['picking']) =>
      residentActions(here({ picking })).find((a) => a.id === 'wallTo')!
    expect(line(false)).toMatchObject({ label: 'Build line: wall' })
    expect(line('wallFrom')).toMatchObject({ active: true, label: 'Pick the start…' })
    expect(line('wallTo')).toMatchObject({ active: true, label: 'Pick the end…' })
    expect(line('roadFrom')).not.toHaveProperty('active')
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

  it('never offers driving or hauling another realm’s carriage, only Drive off on its own row', () => {
    const theirs = here({ carriage, carriageTheirs: true })
    expect(ids(theirs)).not.toContain('drive')
    expect(ids(theirs)).not.toContain('haul')
    expect(residentOrders(theirs).missing.drive).toBe('no carriage of yours here')
    const off = here({ carriage, carriageTheirs: true, driveOff: { problem: undefined } })
    expect(residentActions(off).find((a) => a.id === 'driveOff')).toEqual({
      id: 'driveOff',
      label: 'Drive off (theft)',
      key: 'D',
    })
    const refused = here({ carriageTheirs: true, driveOff: { problem: 'guarded' } })
    expect(residentActions(refused).find((a) => a.id === 'driveOff')).toMatchObject({
      disabled: true,
      reason: 'guarded',
    })
    const picking = here({ driveOff: { problem: undefined }, picking: 'driveOff' })
    expect(residentActions(picking).find((a) => a.id === 'driveOff')).toMatchObject({
      label: 'Pick a tile…',
      active: true,
    })
    expect(residentOrders(here()).missing.driveOff).toBe('no carriage of another realm here')
    // A rival's boat beside them likewise, on a row of its own (`CONTEXT.md`: its vessel part).
    const rowOff = (h: ResidentHere) => residentActions(h).find((a) => a.id === 'rowOff')
    expect(rowOff(here({ rowOff: { problem: undefined } }))).toEqual({
      id: 'rowOff',
      label: 'Row off (theft)',
      key: 'D',
    })
    expect(rowOff(here({ rowOff: { problem: 'someone is aboard that boat' } }))).toMatchObject({
      disabled: true,
      reason: 'someone is aboard that boat',
    })
    expect(residentOrders(here()).missing.rowOff).toBe('no boat of another realm beside them')
    const mount = (h: ResidentHere) => residentActions(h).find((a) => a.id === 'stealHorse')
    expect(mount(here({ stealHorse: { problem: undefined } }))).toEqual({
      id: 'stealHorse',
      label: 'Mount their horse (theft)',
      key: 'M',
    })
    expect(mount(here({ stealHorse: { problem: 'guarded' } }))).toMatchObject({
      disabled: true,
      reason: 'guarded',
    })
    expect(residentOrders(here()).missing.stealHorse).toBe('no free horse of another realm here')
    const hitch = (h: ResidentHere) => residentActions(h).find((a) => a.id === 'hitchOff')
    expect(hitch(here({ hitchOff: { problem: undefined } }))).toMatchObject({
      label: 'Drive with their horse (theft)',
    })
    expect(hitch(here({ hitchOff: { problem: 'guarded' } }))).toMatchObject({
      disabled: true,
      reason: 'guarded',
    })
  })

  it('offers hitching with a carriage and a free horse on their tile to grown-ups', () => {
    expect(ids(here({ carriage }))).not.toContain('hitch')
    const hitch = residentActions(here({ horseToHitch: true })).find((a) => a.id === 'hitch')
    expect(hitch).toMatchObject({ label: 'Hitch horse…', key: 'J', opens: true })
    expect(ids(here({ horseToHitch: true, adult: false }))).not.toContain('hitch')
    expect(residentOrders(here({ adult: false })).missing.hitch).toBe('children can’t hitch')
  })

  it('lists the horses to hitch to the carriage on their tile, also when only one stands there', () => {
    const horse = (id: string, more: object = {}) =>
      ({
        id,
        realmId: 'r1',
        cityId: null,
        x: 2,
        y: 2,
        ...more,
      }) as unknown as CarriageHorse
    const k = { id: 'k1', realmId: 'r1', cityId: null, x: 2, y: 2, horseId: 'h1' }
    const r = { x: 2, y: 2, owner: 'r1', cityId: 'c1' }
    const free = horse('h2')
    const world = {
      carriages: [{ ...k, id: 'k0', realmId: 'r2' }, k, { ...k, id: 'k2', horseId: 'h3', x: 5 }],
      residents: [{ riding: 'h4' }, {}],
      horses: [
        horse('h1'),
        free,
        horse('h3', { x: 5 }),
        horse('h4'),
        horse('h5', { down: true }),
        horse('h6', { realmId: 'r2' }),
        horse('h7', { x: 3 }),
      ],
    } as unknown as Parameters<typeof hitchChoice>[0]
    expect(hitchChoice(world, r)).toEqual({ carriageId: 'k1', horses: [free] })
    expect(hitchChoice(world, { ...r, x: 3 })).toBeUndefined()
    expect(hitchChoice({ ...world, horses: [horse('h1')] }, r)).toBeUndefined()
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

  it('offers rowing a boat of theirs to a picked tile, to grown residents on foot', () => {
    const rowRow = (h: Parameters<typeof here>[0]) =>
      residentActions(here(h)).filter((a) => a.id === 'row')
    expect(rowRow({ boatToRow: {} })).toEqual([
      expect.objectContaining({ label: 'Row boat to', key: 'D' }),
    ])
    expect(rowRow({ boatToRow: {}, picking: 'row' })[0]).toMatchObject({
      label: 'Pick a tile…',
      active: true,
    })
    expect(rowRow({ boatToRow: {}, adult: false })[0]).toMatchObject({
      disabled: true,
      reason: 'children can’t row',
    })
    expect(rowRow({ boatToRow: { problem: 'the boat is full' } })[0]).toMatchObject({
      disabled: true,
      reason: 'the boat is full',
    })
    expect(residentOrders(here()).missing.row).toBe('no boat of yours here')
  })

  it('offers a haul route by boat from the shore beside it (`CONTEXT.md`: Haul route by water)', () => {
    const haul = (h: Parameters<typeof here>[0]) =>
      residentActions(here(h)).filter((a) => a.id === 'haul')
    expect(haul({ boatToRow: {} })).toEqual([
      expect.objectContaining({ label: 'Haul route…', opens: true }),
    ])
    expect(haul({ boatToRow: {}, picking: 'haul' })[0]).toMatchObject({
      label: 'Pick the other stop…',
    })
    // Aboard, the route can't start: its first stop is the shore they stand on.
    expect(haul({ boatToRow: {}, aboard: true })).toEqual([])
    expect(residentOrders(here({ boatToRow: {}, aboard: true })).missing.haul).toBe(
      HAUL_STARTS_ASHORE,
    )
    expect(residentOrders(here({ boatToRow: { problem: 'the boat is full' } })).missing.haul).toBe(
      'the boat is full',
    )
    expect(haul({ boatToRow: {}, adult: false })).toEqual([])
  })

  it('offers boarding a boat of the realm beside them, never on horseback', () => {
    const board = (h: Parameters<typeof here>[0]) =>
      residentActions(here(h)).filter((a) => a.id === 'board')
    expect(board({ boatToBoard: true })).toEqual([
      expect.objectContaining({ label: 'Board boat', key: 'K' }),
    ])
    expect(board({ boatToBoard: true, riding: true })).toEqual([
      expect.objectContaining({ disabled: true, reason: 'no horse goes aboard: dismount first' }),
    ])
    expect(board({ aboard: true, boatToBoard: true }).map((a) => a.label)).toEqual(['Get off'])
    expect(residentOrders(here()).missing.board).toBe('no carriage or boat of yours here')
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
      relocate: { problem: undefined },
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

  it('offers Relocate for an own resident, a child too, off with the reason when it can’t go', () => {
    expect(ids(here())).not.toContain('relocate')
    const a = residentActions(here({ adult: false, relocate: { problem: undefined } }))
    expect(a.find((x) => x.id === 'relocate')).toMatchObject({
      label: 'Relocate…',
      key: 'V',
      opens: true,
    })
    const problem = 'carrying a child'
    expect(
      residentActions(here({ relocate: { problem } })).find((x) => x.id === 'relocate'),
    ).toMatchObject({ disabled: true, reason: problem })
    expect(
      groupOrders(a)
        .find((g) => g.group === 'move')
        ?.actions.map((x) => x.id),
    ).toContain('relocate')
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
    expect(actionForKey(a, 'j')).toBeUndefined()
  })
})

describe('the Orders tab', () => {
  it('groups the orders by kind: Move, Work & build, Goods, Scripts, then the rest', () => {
    const a = residentActions(
      here({ busy: true, carriage, carries: true, othersInSight: 1, renamable: true }),
    )
    expect(groupOrders(a).map((g) => [g.label, g.actions.map((x) => x.id)])).toEqual([
      ['Move', ['walk', 'stop', 'drive', 'haul', 'explore']],
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

describe('the rows of a card that stays open', () => {
  const farm = building({ kind: 'farm' })
  /** The rows after the card showed `before` and the resident is now as `now` says. */
  const keep = (before: ResidentHere | undefined, now: ResidentHere) => {
    const kept = before && keepRows(undefined, residentActions(before), {}, orderGroupOf)
    const { actions, missing } = residentOrders(now)
    return keepRows(kept, actions, missing, orderGroupOf)
  }
  const ids = (rows: CardAction[]) => rows.map((a) => a.id)

  it('are sorted afresh, by kind, when nothing is kept: something else was picked', () => {
    const rows = keep(undefined, here({ building: farm, busy: true }))
    expect(ids(rows)).toEqual(
      groupOrders(residentActions(here({ building: farm, busy: true }))).flatMap((g) =>
        ids(g.actions),
      ),
    )
    expect(ids(rows).at(-1)).toBe('pair')
  })

  it('keep an order that stops being possible in its slot, greyed with why', () => {
    // At the farm and working; then they walk off it.
    const before = here({ building: farm, busy: true })
    const rows = keep(before, here({ busy: true }))
    expect(ids(rows)).toEqual(ids(keep(undefined, before)))
    expect(rows.find((a) => a.id === 'work')).toMatchObject({
      label: 'Work at the farm…',
      disabled: true,
      reason: 'not on a workplace',
    })
    // A greyed row runs on no key.
    expect(actionForKey(rows, 'e')).toBeUndefined()
    expect(actionForKey(rows, 'w')?.id).toBe('walk')
  })

  it('add an order that becomes possible at the end of its kind', () => {
    const before = here()
    const rows = keep(before, here({ busy: true, building: farm }))
    expect(rowGroups(rows, orderGroupOf).map((g) => [g.group, ids(g.actions)])).toEqual([
      ['move', ['walk', 'explore', 'stop']],
      ['work', ['build', 'roadTo', 'wallTo', 'work', 'tearDown']],
      ['scripts', ['script']],
      ['other', ['pair']],
    ])
  })

  it('put a kind that comes up while open below the others, so no row moves', () => {
    const before = here()
    const rows = keep(before, here({ carries: true }))
    const groups = rowGroups(rows, orderGroupOf).map((g) => g.group)
    expect(groups).toEqual(['move', 'work', 'scripts', 'other', 'goods'])
    expect(ids(rows).slice(0, -1)).toEqual(ids(keep(undefined, before)))
  })

  it('keep a slot through a change of label, and drop pick mode from a greyed row', () => {
    const riding = keep(here({ horseToRide: true }), here({ riding: true }))
    expect(riding.find((a) => a.id === 'ride')?.label).toBe('Dismount')
    const kept = keepRows(
      undefined,
      residentActions(here({ carriage, picking: 'drive' })),
      {},
      orderGroupOf,
    )
    expect(kept.find((a) => a.id === 'drive')?.active).toBe(true)
    const { actions, missing } = residentOrders(here())
    const drive = keepRows(kept, actions, missing, orderGroupOf).find((a) => a.id === 'drive')
    expect(drive).toMatchObject({ disabled: true, reason: 'no carriage here' })
    expect(drive?.active).toBeUndefined()
  })

  it('grey Drive and leave out Haul route for a carriage whose horse is Down (`CONTEXT.md`: Down)', () => {
    const { actions, missing } = residentOrders(here({ carriage, carriageHorseDown: true }))
    expect(actions.find((a) => a.id === 'drive')).toMatchObject({
      disabled: true,
      reason: HORSE_DOWN_NO_DRIVE,
    })
    expect(actions.some((a) => a.id === 'haul')).toBe(false)
    expect(missing.haul).toBe(HORSE_DOWN_NO_DRIVE)
  })

  it('offer someone Down no orders, and say why on a card left open (`CONTEXT.md`: Down)', () => {
    const { actions, missing } = residentOrders(here({ down: true, carries: true }))
    expect(actions).toEqual([])
    expect(missing.walk).toBe(DOWN_NO_ORDERS)
    const kept = keepRows(undefined, residentActions(here()), {}, orderGroupOf)
    const rows = keepRows(kept, actions, missing, orderGroupOf)
    expect(rows.length).toBe(kept.length)
    expect(rows.every((a) => a.disabled && a.reason === DOWN_NO_ORDERS)).toBe(true)
  })

  it('offer Feed with someone Down nearby, greyed for a child or without Food (`CONTEXT.md`: Reviving)', () => {
    const feed = (h: ResidentHere) => residentActions(h).find((a) => a.id === 'feed')
    expect(feed(here({ toFeedNear: 1, carriesFood: true }))).toEqual({
      id: 'feed',
      label: 'Feed…',
      key: ACTION_KEYS.feed,
      opens: true,
    })
    expect(feed(here({ toFeedNear: 1 }))).toMatchObject({
      disabled: true,
      reason: 'no Food in hand',
    })
    expect(feed(here({ toFeedNear: 1, carriesFood: true, adult: false }))).toMatchObject({
      disabled: true,
      reason: 'children can’t feed others',
    })
    expect(feed(here({ carriesFood: true }))).toBeUndefined()
    expect(residentOrders(here()).missing.feed).toBe('nobody to feed nearby')
  })

  it('say why for every order a resident card can leave out', () => {
    const offered = new Set(ids(residentActions(here())))
    const { missing } = residentOrders(here())
    for (const id of Object.keys(ACTION_KEYS) as ActionId[]) {
      if (offered.has(id)) continue
      // The tile card's actions and the own resident's orders never come and go on a card.
      const tileCard = [
        'sendHere',
        'gate',
        'openCity',
        'tradeHere',
        'renameCity',
        'renameHorse',
        'addWaypoint',
      ]
      if (tileCard.includes(id)) continue
      if (['relocate', 'makeLeader', 'rename'].includes(id)) continue
      expect(missing[id], id).toBeTruthy()
    }
    expect(residentOrders(here({ adult: false })).missing.work).toBe('children can’t work')
    expect(residentOrders(here({ carrying: true })).missing.build).toBe('carrying a child')
    expect(residentOrders(here({ inCity: false })).missing.pair).toBe('homeless')
  })
})

describe('Escape', () => {
  it('leaves the top-most thing first: pick mode, a panel, the tile card, the card, the drawer', () => {
    const all = { pick: true, panel: true, tile: true, card: true, drawer: true }
    expect(escapeStep(all)).toBe('pick')
    expect(escapeStep({ ...all, pick: false })).toBe('panel')
    expect(escapeStep({ ...all, pick: false, panel: false })).toBe('tile')
    expect(escapeStep({ card: true, drawer: true })).toBe('card')
    expect(escapeStep({ drawer: true })).toBe('drawer')
    expect(escapeStep({})).toBeUndefined()
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
  it('shows a boat on the water with its owner and load, what it holds only to its own realm', () => {
    const boat = {
      id: 'v1',
      kind: 'boat' as const,
      realmId: 'me',
      x: 5,
      y: 5,
      loadLevel: 'light' as const,
      passengerIds: [],
    }
    const ours = tile({ vessels: [{ ...boat, load: { wood: 10 } }] })
    expect(ours).toMatchObject({ title: 'Boat', rel: 'own', what: 'carriage' })
    expect(ours.lines[0]).toBe('Yours')
    expect(ours.carriage).toMatchObject({ title: 'Boat (yours)', goods: { wood: 10 } })
    expect(ours.carriage?.load.text).toMatch(new RegExp(`/ ${BOAT_CAPACITY} kg$`))
    const theirs = tile({ vessels: [{ ...boat, realmId: 'r2' }] })
    expect(theirs.carriage?.load).toEqual({ text: 'Lightly loaded' })
    expect(theirs.carriage?.goods).toBeUndefined()
  })

  it('shows a ship on a card of its own, its load against what a ship holds', () => {
    const ship = {
      id: 'ship1',
      kind: 'ship' as const,
      realmId: 'me',
      x: 5,
      y: 5,
      loadLevel: 'empty' as const,
      load: {},
      passengerIds: [],
    }
    const ours = tile({ vessels: [ship] })
    expect(ours).toMatchObject({ title: 'Ship', rel: 'own', what: 'carriage' })
    expect(ours.carriage).toMatchObject({ title: 'Ship (yours)' })
    expect(ours.carriage?.load.text).toBe(`0 / ${SHIP_CAPACITY} kg`)
    // Nobody boards it from the shore: that waits for docking at a haven.
    const ana = { id: 'ana', name: 'ana', owner: 'me', x: 4, y: 5, order: null } as SeenResident
    expect(tile({ vessels: [ship], residents: [ana] }).boat).toBeUndefined()
  })

  it('shows a ship site on its haven’s card under a head of its own', () => {
    const haven = { id: 'h1', kind: 'haven', x: 3, y: 3, cityId: null } as Building
    const site = {
      id: 's1',
      kind: 'ship',
      x: 5,
      y: 5,
      site: { delivered: {}, work: 0 },
    } as unknown as Building
    const card = tile({ buildings: [haven, site] })
    expect(card.sites?.map((s) => s.title)).toContain('Ship site')
    expect(tile({ buildings: [site] }).title).toBe('Ship site')
  })

  it('names a boat’s passengers, counted against what it holds', () => {
    const ana = { id: 'ana', name: 'Ana', x: 5, y: 5, aboard: 'boat1' } as SeenResident
    const boat = {
      id: 'boat1',
      kind: 'boat' as const,
      realmId: 'me',
      x: 5,
      y: 5,
      loadLevel: 'light' as const,
      load: { wood: 10 },
      passengerIds: ['ana'],
    }
    const card = tile({ vessels: [boat], residents: [ana] })
    expect(card.carriage?.passengers).toEqual({
      residents: [{ id: 'ana', name: 'Ana', pick: true }],
      weight: `${PASSENGER_WEIGHT} kg of it people`,
    })
    expect(card.carriage?.load.text).toBe(`${10 + PASSENGER_WEIGHT} / ${BOAT_CAPACITY} kg`)
    // Its rower is named on a row of their own and weighs nothing against it.
    const bo = { id: 'bo', name: 'Bo', x: 5, y: 5, aboard: 'boat1' } as SeenResident
    const rowed = tile({ vessels: [{ ...boat, rowerId: 'bo' }], residents: [ana, bo] })
    expect(rowed.carriage?.rower).toEqual({ id: 'bo', name: 'Bo', pick: true })
    expect(rowed.carriage?.load.text).toBe(`${10 + PASSENGER_WEIGHT} / ${BOAT_CAPACITY} kg`)
  })

  it('lets the Player’s residents beside their boat board it, and its passengers get off', () => {
    const at = (id: string, x: number, more: Partial<SeenResident> = {}) =>
      ({ id, name: id, owner: 'me', x, y: 5, order: null, ...more }) as SeenResident
    const boat = {
      id: 'boat1',
      kind: 'boat' as const,
      realmId: 'me',
      x: 5,
      y: 5,
      loadLevel: 'empty' as const,
      load: {},
      passengerIds: ['cid'],
    }
    const ana = at('ana', 4)
    const bo = at('bo', 6, { riding: 'h1' })
    const cid = at('cid', 5, { aboard: 'boat1' })
    const far = at('far', 2)
    const card = tile({ vessels: [boat], residents: [ana, bo, cid, far] })
    expect(card.boat).toEqual({
      vesselId: 'boat1',
      board: [
        { id: 'ana', name: 'ana', problem: undefined },
        { id: 'bo', name: 'bo', problem: 'no horse goes aboard: dismount first' },
      ],
      getOff: [{ id: 'cid', name: 'cid' }],
    })
    const action = (actor?: SeenResident) =>
      tileActions(card, actor as unknown as Resident).find((a) => a.id === 'board')
    expect(action(ana)).toMatchObject({ label: 'Board boat', key: ACTION_KEYS.board })
    expect(action(bo)).toMatchObject({
      disabled: true,
      reason: 'no horse goes aboard: dismount first',
    })
    expect(action(cid)?.label).toBe('Get off')
    expect(boaterOf(card, cid)).toEqual({ id: 'cid', getOff: true, problem: undefined })
    // Someone else's boat offers nothing.
    expect(tile({ vessels: [{ ...boat, realmId: 'r2' }], residents: [ana] }).boat).toBeUndefined()
  })

  it('shows a boat site on a haven under a head of its own', () => {
    const haven = building({ kind: 'haven', cityId: 'c-me', x: 4, y: 4 })
    const site = building({ kind: 'boat', site: { delivered: {}, work: 0 } })
    const card = tile({ buildings: [haven, site] })
    expect(card.title).toBe('Eastmere haven')
    expect(card.sites?.[0]).toMatchObject({ title: 'Boat site' })
  })

  it('says who occupies a town hall in sight and the game days left (`CONTEXT.md`: Occupying a town hall)', () => {
    const hall = (cityId: string) => building({ kind: 'townHall', cityId, x: 4, y: 4 })
    const cities = [
      { id: 'c-me', name: 'Eastmere', realmId: 'me', occupation: { realmId: 'r2', since: 0 } },
      { id: 'c-npc', name: 'Oakhollow', realmId: null, occupation: { realmId: 'me', since: 0 } },
    ]
    const realms = [{ realmId: 'r2', realm: 'Northmarch' }]
    const mine = tile({ buildings: [hall('c-me')], cities, realms, tick: 0 })
    expect(mine.occupation).toEqual({
      text: `Occupied by Northmarch, ${OCCUPATION_GAME_DAYS} game days left`,
      warning: true,
      realmId: 'r2',
    })
    const theirs = tile({ buildings: [hall('c-npc')], cities, realms, tick: 0 })
    expect(theirs.occupation).toMatchObject({ warning: false })
    expect(theirs.occupation?.text).toMatch(/^Occupied by you,/)
    // Not occupied, or another building of an occupied city: nothing.
    expect(tile({ buildings: [hall('c-npc')] }).occupation).toBeUndefined()
    const farm = building({ kind: 'farm', cityId: 'c-me' })
    expect(tile({ buildings: [farm], cities, realms }).occupation).toBeUndefined()
  })

  it('is named after a building on it, in its owner’s colour', () => {
    const card = tile({ buildings: [building({ kind: 'farm', cityId: 'c-me' })] })
    expect(card).toMatchObject({ title: 'Eastmere farm', rel: 'own', what: 'building' })
    expect(card.lists?.[0]).toMatchObject({ title: 'Crew', count: `1 / ${MAX_WORKERS.farm}` })
  })

  it('lists a farm’s crew in sight as rows with their meters, the Player’s own to open', () => {
    const farm = building({ kind: 'farm', cityId: 'c-me' })
    const working = { kind: 'workAt', buildingId: farm.id }
    const ana = {
      id: 'ana',
      name: 'Ana',
      owner: 'me',
      cityId: 'c-me',
      order: working,
      health: MAX_HEALTH,
      hunger: MAX_HUNGER / 2,
      stats: { strength: { base: 10, trained: 0 } },
      skills: {},
      bornAt: 0,
    } as unknown as SeenResident
    // As sight sends another realm's worker: without how they fare.
    const cid = { id: 'cid', name: 'Cid', owner: 'them', cityId: null, carried: {}, order: working }
    const idle = { ...ana, id: 'bo', name: 'Bo', order: null }
    const card = tile({
      buildings: [farm],
      residents: [ana, cid as unknown as SeenResident, idle],
      strangers: [cid as unknown as SeenResident],
      workers: () => 2,
    })
    expect(card.lists?.[0]).toEqual({
      title: 'Crew',
      count: `2 / ${MAX_WORKERS.farm}`,
      empty: 'Nobody works here',
      meters: ['Health', 'Hunger'],
      rows: [
        { id: 'ana', name: 'Ana', detail: 'Working', shares: [1, 0.5], opens: 'resident' },
        { id: 'cid', name: 'Cid', detail: 'Working · Another realm' },
      ],
    })
    // Nobody at it: an empty list.
    const none = tile({ buildings: [farm], workers: () => 0 })
    expect(none.lists?.[0]).toMatchObject({ count: `0 / ${MAX_WORKERS.farm}`, rows: [] })
    expect(card.lines.some((l) => l.includes('workers'))).toBe(false)
  })

  it('counts the Player’s own away for the workplace among its crew, saying what they do', () => {
    const smelter = building({ kind: 'smelter', cityId: 'c-me' })
    const crew = (id: string, order: unknown) =>
      ({
        id,
        name: id,
        owner: 'me',
        cityId: 'c-me',
        order,
        script: { scriptId: 1, params: { workplace: smelter.id } },
        stats: { strength: { base: 10, trained: 0 } },
        skills: {},
        bornAt: 0,
      }) as unknown as SeenResident
    const walk = { kind: 'walkTo', target: { x: 0, y: 0 }, path: null, progress: 0 }
    const fetching = { ...walk, kind: 'fetch', goods: { ironOre: 10 }, phase: 'walking' }
    const residents = [
      crew('Ana', { kind: 'workAt', buildingId: smelter.id }),
      crew('Bo', { ...walk, kind: 'store', goods: { iron: null }, phase: 'walking' }),
      crew('Cy', fetching),
      crew('Di', walk),
      crew('Ed', null),
      // Working elsewhere, by another script: not of its crew.
      { ...crew('Fy', walk), script: { scriptId: 2, params: { workplace: 'b-farm' } } },
    ]
    const card = tile({ buildings: [smelter], residents, workers: () => 1 })
    const list = card.lists?.find((l) => l.title === 'Crew')
    expect(list?.count).toBe(`1 / ${MAX_WORKERS.smelter} · 4 away`)
    expect(list?.rows.map((r) => [r.name, r.detail])).toEqual([
      ['Ana', 'Working'],
      ['Bo', 'Carrying a load'],
      ['Cy', 'Fetching iron ore'],
      ['Di', 'On the way'],
      ['Ed', 'Idle'],
    ])
  })

  it('shows a storage’s goods as the goods grid, and what they weigh', () => {
    const storage = building({ kind: 'storage', cityId: 'c-me', stock: { wood: 5, food: 3 } })
    const card = tile({ buildings: [storage] })
    expect(card.lists).toEqual([
      {
        title: 'Goods',
        count: `${Math.round(stockWeight({ wood: 5, food: 3 }))} kg`,
        empty: 'Nothing in it',
        meters: [],
        rows: [],
        goods: { wood: 5, food: 3 },
      },
    ])
    expect(card.lines.some((l) => l.includes('wood'))).toBe(false)
    const empty = tile({ buildings: [{ ...storage, stock: {} }] })
    expect(empty.lists?.[0]).toMatchObject({ title: 'Goods', goods: {} })
  })

  it('names an outpost storage’s realm (`CONTEXT.md`: Outpost storage)', () => {
    const mine = building({ kind: 'storage', realmId: 'me', stock: { food: 3 } })
    expect(tile({ buildings: [mine] })).toMatchObject({ title: 'Outpost storage', rel: 'own' })
    expect(tile({ buildings: [mine] }).lines).toContain('Yours')
    expect(tile({ buildings: [mine] }).lists?.[0]?.goods).toEqual({ food: 3 })
    // As sight sends another realm's: without what it holds.
    const theirs = building({ kind: 'storage', realmId: 'r-other' })
    const card = tile({ buildings: [theirs] })
    expect(card).toMatchObject({ title: 'Outpost storage', rel: 'otherRealm' })
    expect(card.lines).toContain('Another realm')
    expect(card.lists).toBeUndefined()
    expect(tile({ buildings: [building({ kind: 'storage' })] }).lines).toContain('Nobody’s')
  })

  it('says how far a construction site has come', () => {
    const site = building({ kind: 'house', site: { work: 0, delivered: { wood: 2 } } })
    const card = tile({ buildings: [site] })
    expect(card.title).toBe('House site')
    expect(card.sites).toEqual([
      {
        work: { text: '0%', share: 0 },
        materials: [{ good: 'wood', have: 2, need: BUILD_MATERIALS.house!.wood }],
      },
    ])
    expect(card.lists).toBeUndefined()
  })

  it('says how long a site’s work is left at the pace of those building it', () => {
    const site = building({ kind: 'house', site: { work: 0, delivered: {} } })
    expect(tile({ buildings: [site], tick: 0 }).sites?.[0]?.work.left).toBe('nobody is building')
    const builder = {
      id: 'ana',
      name: 'Ana',
      owner: 'me',
      cityId: 'c-me',
      x: 5,
      y: 5,
      bornAt: -ticksForAge(30),
      stats: { strength: { base: 10, trained: 0 } },
      skills: {},
      order: { kind: 'build', building: 'house', at: { x: 5, y: 5 }, siteId: site.id },
    } as unknown as SeenResident
    const left = tile({ buildings: [site], residents: [builder], tick: 0 }).sites?.[0]?.work.left
    expect(left).toMatch(/ left$/)
  })

  it('shows a carriage, a pile and a node when there is no building', () => {
    expect(tile({ carriages: [carriage] })).toMatchObject({ what: 'carriage', rel: 'own' })
    // Its load for the goods grid (`CONTEXT.md`: Goods on cards).
    expect(tile({ carriages: [carriage] }).carriage?.goods).toEqual(carriage.load)
    expect(tile({ piles: [pile] })).toMatchObject({ what: 'pile' })
    expect(tile({ piles: [pile] }).lists).toEqual([
      {
        title: 'On the ground',
        count: `${Math.round(stockWeight({ stone: 4 }))} kg`,
        empty: 'Nothing',
        meters: [],
        rows: [],
        goods: { stone: 4 },
      },
    ])
    const node = { kind: 'ironOre' as const, x: 5, y: 5 }
    expect(tile({ node })).toMatchObject({ what: 'node', title: 'Iron ore node' })
  })

  it('lists a carriage’s passengers, its load counting them in', () => {
    const ana = { id: 'ana', name: 'Ana' } as SeenResident
    const bo = { id: 'bo', name: 'Bo' } as SeenResident
    const cid = { id: 'cid', name: 'Cid', owner: 'them', cityId: null, carried: {} } as Resident
    const k = { ...carriage, passengerIds: ['ana', 'bo', 'cid'] }
    const card = tile({ carriages: [k], residents: [ana, bo, cid], strangers: [cid] })
    const people = 3 * PASSENGER_WEIGHT
    const weight = stockWeight(carriage.load) + people
    expect(card.carriage?.load).toEqual({
      text: `${Math.round(weight)} / ${CARRIAGE_CAPACITY} kg`,
      share: weight / CARRIAGE_CAPACITY,
    })
    // Each a link to pick them, but the stranger.
    expect(card.carriage?.passengers).toEqual({
      residents: [
        { id: 'ana', name: 'Ana', pick: true },
        { id: 'bo', name: 'Bo', pick: true },
        { id: 'cid', name: 'Cid', pick: false },
      ],
      weight: `${people} kg of it people`,
    })
    // No sentence about it any more (`CONTEXT.md`: Goods on cards).
    expect(card.lines.some((l) => l.startsWith('Passengers') || l.includes(' kg'))).toBe(false)
    // None aboard: no row.
    expect(tile({ carriages: [carriage] }).carriage?.passengers).toBeUndefined()
  })

  it('lists everything on the tile under the building it is named after', () => {
    const card = tile({
      buildings: [building({ kind: 'storage', cityId: 'c-me', stock: { food: 3 } })],
      carriages: [carriage],
      piles: [pile],
    })
    expect(card.what).toBe('building')
    expect(card.lines).toContain('Tile 5, 5')
    expect(card.lists?.map((l) => l.title)).toEqual(['Goods', 'Pile'])
    // The carriage as a section of its own, named with its owner.
    expect(card.carriage?.title).toBe('Carriage (yours)')
    expect(card.lines.some((l) => l.startsWith('Carriage'))).toBe(false)
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
    expect(card.lists).toBeUndefined()
    expect(card.carriage).toMatchObject({
      title: 'Carriage (another realm)',
      load: { text: 'Half loaded' },
    })
    expect(card.carriage?.load.share).toBeUndefined()
    expect(card.carriage?.goods).toBeUndefined()
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
        expect(card.lists?.find((l) => l.title === 'Pile')?.goods).toEqual(pile.goods)
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
    expect(card.lists?.[0]?.goods).toEqual({ food: 3 })
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
      lines: ['NPC city'],
      lists: [expect.objectContaining({ title: 'Goods', goods: { food: 3 } })],
    })
    // What is in sight there now stays apart from it.
    expect(card.lines).toEqual(['Tile 5, 5'])
    expect(card.lists?.map(({ title, goods }) => ({ title, goods }))).toEqual([
      { title: 'Pile', goods: pile.goods },
    ])
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
    name: 'Rowan',
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
  it('shows the own carriage’s horse as a row with its meters, and how long the Food on board feeds it', () => {
    const fed = tile({ carriages: [{ ...carriage, load: { food: 6 } }], horses: [horse()] })
    expect(fed.carriage?.horse).toEqual({
      title: 'Horse',
      count: 'Food on board for 8 game days',
      meters: ['Health', 'Hunger'],
      rows: [
        {
          id: 'h1',
          name: 'Rowan',
          detail: 'Speed 12, Strength 8, Endurance 10',
          shares: [1, 1],
          opens: 'horse',
        },
      ],
    })
    const hungry = tile({
      carriages: [carriage],
      horses: [horse({ hunger: 10, health: MAX_HEALTH - 5 })],
    })
    expect(hungry.carriage?.horse).toMatchObject({ count: 'No Food on board' })
    expect(hungry.carriage?.horse?.rows[0]?.shares).toEqual([
      (MAX_HEALTH - 5) / MAX_HEALTH,
      10 / MAX_HUNGER,
    ])
    const crumbs = tile({ carriages: [{ ...carriage, load: { food: 0.1 } }], horses: [horse()] })
    expect(crumbs.carriage?.horse?.count).toBe('Food on board for less than a game day')
    // A hitched horse is not a loose one.
    expect(fed.lists).toBeUndefined()
  })

  it('shows a stranger’s carriage’s horse without how it fares, or only whether it has one', () => {
    const { id, x, y } = carriage
    const theirs = { id, x, y, realmId: 'r-other', cityId: null, loadLevel: 'empty' as const }
    const hitched = tile({
      carriages: [{ ...theirs, horseId: 'h1' }],
      horses: [unknown({ realmId: 'r-other' })],
    })
    expect(hitched.carriage?.horse).toEqual({
      title: 'Horse',
      count: '',
      meters: ['Health', 'Hunger'],
      rows: [{ id: 'h1', name: 'Rowan', detail: 'Speed 12, Strength 8, Endurance 10' }],
    })
    // With its horse out of sight, only that one is hitched.
    const unseen = tile({ carriages: [{ ...theirs, horseId: 'h1' }] })
    expect(unseen.carriage).toMatchObject({ noHorse: 'Horse hitched' })
    expect(unseen.carriage?.horse).toBeUndefined()
    const bare = tile({ carriages: [{ ...theirs, horseId: null }] })
    expect(bare.carriage?.noHorse).toBe('No horse')
    const mine = tile({ carriages: [{ ...carriage, horseId: null }] })
    expect(mine.carriage?.noHorse).toBe('No horse hitched')
  })

  it('lists a rider’s horse on their card with its stats, age and how it fares', () => {
    const at = 5 * TICKS_PER_GAME_YEAR + 100
    const ridden = horse({ id: 'h2', hunger: 10, health: MAX_HEALTH - 5 })
    const horses = [horse(), ridden]
    expect(riddenHorseLine({ riding: 'h2' }, horses, at)).toBe(
      'Horse: Rowan · Speed 12, Strength 8, Endurance 10 · 5 years old · hungry, hurt · a resident with Food can Feed it · eats from your spare Food',
    )
    expect(riddenHorseLine({}, horses, at)).toBeUndefined()
    // A horse not in sight shows nothing.
    expect(riddenHorseLine({ riding: 'h9' }, horses, at)).toBeUndefined()
  })

  it('shows each horse’s stats, age and how it fares, and how much its carriage holds', () => {
    const at = 5 * TICKS_PER_GAME_YEAR + 100
    const strong = horse({ stats: { speed: 9, strength: 15, endurance: 13 }, hunger: 10 })
    const card = tile({ horses: [strong], tick: at })
    expect(card.lists?.[0]?.rows).toEqual([
      {
        id: 'h1',
        name: 'Rowan',
        detail:
          'Hungry · a resident with Food can Feed it · Speed 9, Strength 15, Endurance 13 · 5 years old',
        shares: [1, 10 / MAX_HUNGER],
        opens: 'horse',
      },
    ])
    const foal = horse({ bornAt: at - 3 * TICKS_PER_GAME_DAY })
    expect(tile({ horses: [foal], tick: at }).lists?.[0]?.rows[0]?.detail).toBe(
      'Speed 12, Strength 8, Endurance 10 · 3 game days old',
    )
    // A stranger's horse shows its stats and age, but not how it fares, and isn't in the drawer.
    const theirs = unknown({ realmId: 'r-other', bornAt: at - TICKS_PER_GAME_YEAR })
    expect(tile({ horses: [theirs], tick: at }).lists?.[0]?.rows).toEqual([
      { id: 'h1', name: 'Rowan', detail: 'Speed 12, Strength 8, Endurance 10 · 1 year old' },
    ])
    // Strength 15 is 5 above average: the carriage it pulls holds a fifth more.
    const k = { ...carriage, horseId: strong.id, load: { stone: 4 } }
    const pulled = tile({ carriages: [k], horses: [strong], tick: at })
    expect(pulled.carriage?.load.text).toContain(`/ ${CARRIAGE_CAPACITY * 1.2} kg`)
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
    expect(card.lists?.map(({ title, count }) => ({ title, count }))).toEqual([
      { title: 'Horses (yours)', count: '2 · 1 hungry' },
      { title: 'Horse (another realm)', count: '1' },
    ])
    expect(tile({ horses: [horse()] })).toMatchObject({ title: 'Horse', what: 'horses' })
  })

  it('says a Down horse is Down, how long it has left only for the Player’s own (`CONTEXT.md`: Down)', () => {
    const tick = 1000
    const down = horse({ id: 'h2', hunger: 0, health: 0, downUntil: tick + 23 * 3600 })
    const card = tile({ horses: [horse(), { ...down, down: true }], tick })
    expect(card.lists?.[0]).toMatchObject({ title: 'Horses (yours)', count: '2 · 1 Down' })
    expect(card.lists?.[0]?.rows[1]?.detail).toBe(
      `Down from hunger: ${timeLeft(23 * 3600)} · a resident with Food can Feed it · Speed 12, Strength 8, Endurance 10 · 0 game days old`,
    )
    // As sight sends a stranger's Down horse: Down, but not when it dies.
    const seen = unknown({ ...down, realmId: 'r-other' })
    delete seen.downUntil
    const theirs = tile({ horses: [{ ...seen, down: true }], tick })
    expect(theirs.lists?.[0]?.rows[0]?.detail).toMatch(
      /^Down from hunger · a resident with Food can Feed it · Speed 12/,
    )
    // Hitched, the carriage's horse row says so too.
    const hitched = tile({ carriages: [{ ...carriage, horseId: 'h2' }], horses: [down], tick })
    expect(hitched.carriage?.horse?.rows[0]?.detail).toBe(
      `Down from hunger: ${timeLeft(23 * 3600)} · a resident with Food can Feed it · Speed 12, Strength 8, Endurance 10 · 0 game days old`,
    )
  })

  it('offers the resident picked last to Feed a horse that isn’t full (`CONTEXT.md`: Feeding a horse)', () => {
    const tick = 100 * TICKS_PER_GAME_YEAR
    const feeder = (more: object) =>
      ({ id: 'r1', name: 'Ada', x: 6, y: 5, bornAt: 0, carried: { food: 2 }, ...more }) as Resident
    const down = horse({
      id: 'h2',
      name: 'Star',
      x: 5,
      y: 5,
      hunger: 0,
      health: 0,
      downUntil: tick,
    })
    const card = tile({ horses: [down], tick })
    expect(card.horsesToFeed).toEqual([{ id: 'h2', name: 'Star', x: 5, y: 5, down: true }])
    const feed = (r: Resident) => tileActions(card, r, tick, 64).find((a) => a.id === 'feed')
    expect(feed(feeder({}))).toEqual({
      id: 'feed',
      label: 'Feed Star…',
      key: ACTION_KEYS.feed,
      opens: true,
    })
    expect(feed(feeder({ x: 9 }))).toMatchObject({
      disabled: true,
      reason: 'stand on or next to its tile to feed it',
    })
    expect(feed(feeder({ carried: {} }))).toMatchObject({ reason: 'no Food in hand' })
    expect(feed(feeder({ bornAt: tick }))).toMatchObject({ reason: 'children can’t feed others' })
    // A full horse is no one to feed; a stranger's, of unknown hunger, is offered.
    const full = tile({ horses: [horse({ x: 5, y: 5, hunger: MAX_HUNGER })], tick })
    expect(full.horsesToFeed).toBeUndefined()
    // Nor is one with room for less than a whole unit (`CONTEXT.md`: Feeding a horse).
    const nearlyFull = tile({ horses: [horse({ x: 5, y: 5, hunger: MAX_HUNGER - 1 })], tick })
    expect(nearlyFull.horsesToFeed).toBeUndefined()
    const theirs = tile({ horses: [unknown({ x: 5, y: 5, realmId: 'r-other' })], tick })
    expect(theirs.horsesToFeed).toEqual([{ id: 'h1', name: 'Rowan', x: 5, y: 5 }])
    // With more than one the row doesn't name them; the block lists them, Down residents first.
    const ana = { id: 'ana', name: 'Ana', x: 5, y: 5, down: true as const }
    const both = { ...card, downHere: [ana] }
    expect(tileActions(both, feeder({}), tick, 64).find((a) => a.id === 'feed')?.label).toBe(
      'Feed…',
    )
    expect(feedTargets(both, feeder({})).map((t) => [t.id, t.horse])).toEqual([
      ['ana', undefined],
      ['h2', true],
    ])
  })

  it('lists the horses to Feed most in need first, and says which are Down', () => {
    const card = tile({
      horses: [
        unknown({ id: 'stranger', x: 5, y: 5, realmId: 'r-other' }),
        horse({ id: 'full', x: 5, y: 5, hunger: MAX_HUNGER }),
        horse({ id: 'hungry', x: 5, y: 5, hunger: 10 }),
        horse({ id: 'down', x: 5, y: 5, hunger: 0, downUntil: 500 }),
        { ...unknown({ id: 'stranger-down', x: 5, y: 5, realmId: 'r-other' }), down: true },
      ],
    })
    const targets = feedTargets(card, { id: 'a1' })
    expect(targets.map((t) => t.id)).toEqual(['down', 'stranger-down', 'hungry', 'stranger'])
    expect(targets.map((t) => t.down)).toEqual([true, true, undefined, undefined])
    expect(feedTargetLabel({ name: 'Rowan', horse: true, down: true })).toBe('Rowan (horse, Down)')
    expect(feedTargetLabel({ name: 'Rowan', horse: true })).toBe('Rowan (horse)')
    expect(feedTargetLabel({ name: 'Ana', down: true })).toBe('Ana')
  })

  it('offers renaming the Player’s own horses on the card, by name (`CONTEXT.md`: Renaming a horse)', () => {
    const one = tile({ horses: [horse({ name: 'Ember' })] })
    expect(one.renameHorses).toEqual([{ id: 'h1', name: 'Ember' }])
    expect(tileActions(one, undefined).find((a) => a.id === 'renameHorse')).toMatchObject({
      label: 'Rename Ember…',
      key: 'N',
      opens: true,
    })
    const mixed = tile({
      horses: [
        horse({ id: 'h1', name: 'Ember' }),
        horse({ id: 'h2', name: 'Flint' }),
        unknown({ id: 'h3', realmId: 'r-other' }),
      ],
    })
    // Only her own: another realm's horse keeps its name.
    expect(mixed.renameHorses?.map((h) => h.id)).toEqual(['h1', 'h2'])
    expect(tileActions(mixed, undefined).find((a) => a.id === 'renameHorse')?.label).toBe(
      'Rename a horse…',
    )
    const theirs = tile({ horses: [unknown({ realmId: 'r-other' })] })
    expect(theirs.renameHorses).toBeUndefined()
    expect(tileActions(theirs, undefined).some((a) => a.id === 'renameHorse')).toBe(false)
    // In a stable, every own horse in it can be renamed.
    const stable = building({ kind: 'stable', cityId: 'c-me' })
    const pair = [horse({ id: 'h1' }), horse({ id: 'h2', x: 6, y: 6 })]
    expect(tile({ buildings: [stable], horses: pair }).renameHorses).toHaveLength(2)
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
        `Room for ${STABLE_CAPACITY - 2} more horses`,
        `Breeding: a foal in about ${STABLE_BREED_DAYS - 3} game days`,
      ]),
    )
    // Its horses as rows with meters, each to open in the Horses drawer.
    expect(card.lists).toEqual([
      expect.objectContaining({
        title: 'Horses (yours)',
        count: '2',
        meters: ['Health', 'Hunger'],
        rows: [
          expect.objectContaining({ id: 'h1', shares: [1, 1], opens: 'horse' }),
          expect.objectContaining({ id: 'h2', shares: [1, 1], opens: 'horse' }),
        ],
      }),
    ])
    // Its Food as a meter of how long it lasts them, full at what Feed the stable keeps.
    const perDay = 2 * HORSE_FOOD_PER_DAY * horseFoodFactor(pair[0]!)
    expect(card.stableFood).toEqual({
      units: 30,
      share: Math.min(1, 30 / perDay / STABLE_FEED_DAYS),
      lasts: `about ${Math.floor(30 / perDay)} game days for its horses`,
    })
    expect(card.lists?.some((l) => l.goods)).toBe(false)
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
    expect(paused.lines[at + 1]).toMatch(/^· Rowan · Speed/)
    expect(paused.lines[at + 2]).toMatch(/^· Rowan · Speed/)
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
    expect(card.stableFood).toBeUndefined()
    expect(card.lines.some((l) => l.startsWith('Breeding'))).toBe(false)
    expect(card.lists).toEqual([
      expect.objectContaining({
        title: 'Horses (another realm)',
        count: '2',
        rows: [
          expect.not.objectContaining({ shares: expect.anything() }),
          expect.not.objectContaining({ shares: expect.anything() }),
        ],
      }),
    ])
  })
})

describe('the actions on a tile’s card', () => {
  const actor = { id: 'r1', name: 'Ada' } as Resident

  describe('another realm’s carriage on the tile (`CONTEXT.md`: Stealing a carriage or horse)', () => {
    const tick = 100 * TICKS_PER_GAME_YEAR
    const person = (id: string, more: object = {}) =>
      ({
        id,
        name: id,
        owner: 'me',
        cityId: null,
        x: 5,
        y: 5,
        bornAt: 0,
        carried: {},
        order: null,
        ...more,
      }) as unknown as SeenResident
    const theirs = { ...carriage, realmId: 'them' }
    const horse = {
      id: 'h1',
      realmId: 'them',
      cityId: null,
      x: 5,
      y: 5,
      name: 'Rowan',
      stats: { ...AVERAGE_HORSE_STATS },
      bornAt: 0,
    } as unknown as SeenHorse
    const thing = (residents: SeenResident[], more: Partial<TileThings> = {}) => {
      const strangers = residents.filter((r) => r.owner !== 'me')
      return tile({
        carriages: [{ ...theirs, horseId: 'h1' }],
        horses: [horse],
        residents,
        strangers,
        tick,
        ...more,
      })
    }
    const row = (card: TileCard, actor?: { id: string }) =>
      tileActions(card, actor as Resident).find((a) => a.id === 'driveOff')

    it('offers Drive off, which says it is theft, with a resident of the Player’s there', () => {
      const card = thing([person('ada')])
      expect(card.driveOff).toEqual({
        carriageId: 'k1',
        residents: [{ id: 'ada', name: 'ada', problem: undefined }],
      })
      expect(row(card)).toEqual({ id: 'driveOff', label: 'Drive off (theft)', key: 'D' })
    })

    it('offers nothing with nobody of theirs on the tile, or on their own carriage', () => {
      expect(thing([person('away', { x: 6 })]).driveOff).toBeUndefined()
      expect(thing([person('st', { owner: 'them' })]).driveOff).toBeUndefined()
      expect(thing([person('ada')], { carriages: [carriage] }).driveOff).toBeUndefined()
    })

    it('offers nothing on a carriage of the alliance army they command', () => {
      const commanded = new Set(['k1'])
      expect(thing([person('ada')], { commandedCarriages: commanded }).driveOff).toBeUndefined()
      expect(
        commandedCarriages({ leaderId: 'me', army: [{ is: 'carriage', id: 'k1' }] }, 'me'),
      ).toEqual(commanded)
      expect(
        commandedCarriages({ leaderId: 'them', army: [{ is: 'carriage', id: 'k1' }] }, 'me').size,
      ).toBe(0)
    })

    it('greys it with the reason while it can’t be taken', () => {
      const reason = (...residents: SeenResident[]) => row(thing(residents))?.reason
      const armed = person('st', { owner: 'them', carried: { spear: 1 } })
      expect(reason(person('ada'), armed)).toBe('an armed resident guards that carriage')
      expect(row(thing([person('ada'), armed]))?.disabled).toBe(true)
      // One of theirs armed there too lifts the guard.
      expect(reason(person('ada'), armed, person('bo', { carried: { sword: 1 } }))).toBeUndefined()
      expect(reason(person('ada'), person('st', { owner: 'them', aboard: 'k1' }))).toBe(
        'someone is aboard that carriage',
      )
      const driving = {
        kind: 'drive',
        carriageId: 'k1',
        target: { x: 9, y: 5 },
        path: null,
        progress: 0,
      }
      expect(reason(person('ada'), person('st', { owner: 'them', order: driving }))).toBe(
        'someone is driving that carriage',
      )
      expect(reason(person('kid', { bornAt: tick }))).toBe('children can’t steal')
      const caravans = [{ carriageId: 'k1', driverId: 'drv', escortIds: ['esc'] }]
      const crew = (id: string, carried = {}) => person(id, { owner: null, carried })
      const offering = (...others: ReturnType<typeof person>[]) =>
        row(thing([person('ada'), ...others], { caravans }))?.reason
      expect(offering()).toBeUndefined()
      expect(offering(crew('drv'))).toBe('its driver is still with that caravan’s carriage')
      expect(offering(crew('esc'))).toBeUndefined()
      expect(offering(crew('esc', { sword: 1 }))).toBe('its escort guards that caravan’s carriage')
      const down = { ...horse, down: true as const }
      expect(row(thing([person('ada')], { horses: [down] }))?.reason).toBe('its horse is Down')
    })

    it('goes by what strangers see, with no horse hitched or none free', () => {
      const bare = { carriages: [{ ...theirs, horseId: null }] }
      expect(row(thing([person('ada')], { ...bare, horses: [] }))?.reason).toBe(
        'no horse here to pull that carriage',
      )
      // Their free horse goes with it, stolen too.
      expect(row(thing([person('ada')], { ...bare, horses: [horse] }))?.reason).toBeUndefined()
      const own = { ...horse, id: 'h2', realmId: 'me' }
      expect(row(thing([person('ada')], { ...bare, horses: [horse, own] }))?.reason).toBeUndefined()
    })

    describe('another realm’s free horse', () => {
      const loose = (residents: SeenResident[], more: Partial<TileThings> = {}) =>
        thing(residents, { carriages: [], ...more })
      const mount = (card: TileCard, actor?: { id: string }) =>
        tileActions(card, actor as Resident).find((a) => a.id === 'stealHorse')

      it('offers Mount, which says it is theft, with a resident of the Player’s there', () => {
        const card = loose([person('ada')])
        expect(card.stealHorse).toEqual({
          horseId: 'h1',
          residents: [{ id: 'ada', name: 'ada', problem: undefined }],
        })
        expect(mount(card)).toEqual({
          id: 'stealHorse',
          label: 'Mount their horse (theft)',
          key: 'M',
        })
      })

      it('offers nothing with nobody of theirs there, nor on their own or a hitched or ridden one', () => {
        expect(loose([person('away', { x: 6 })]).stealHorse).toBeUndefined()
        expect(loose([person('st', { owner: 'them' })]).stealHorse).toBeUndefined()
        const own = { ...horse, realmId: 'me' }
        expect(loose([person('ada')], { horses: [own] }).stealHorse).toBeUndefined()
        expect(thing([person('ada')]).stealHorse).toBeUndefined()
        const rider = person('st', { owner: 'them', riding: 'h1' })
        expect(loose([person('ada'), rider]).stealHorse).toBeUndefined()
      })

      it('greys it with the reason while it can’t be taken', () => {
        const reason = (card: TileCard) => mount(card)?.reason
        const armed = person('st', { owner: 'them', carried: { spear: 1 } })
        expect(reason(loose([person('ada'), armed]))).toBe('an armed resident guards that horse')
        expect(mount(loose([person('ada'), armed]))?.disabled).toBe(true)
        expect(
          reason(loose([person('ada'), armed, person('bo', { carried: { sword: 1 } })])),
        ).toBeUndefined()
        const down = { ...horse, down: true as const }
        expect(reason(loose([person('ada')], { horses: [down] }))).toBe('that horse is Down')
        expect(reason(loose([person('kid', { bornAt: tick })]))).toBe('children can’t steal')
      })

      it('offers the one that can be taken of several, and the one picked last does it', () => {
        const down = { ...horse, id: 'h9', down: true as const }
        const card = loose([person('kid', { bornAt: tick }), person('ada')], {
          horses: [down, horse],
        })
        expect(card.stealHorse?.horseId).toBe('h1')
        expect(thiefAmong(card.stealHorse?.residents, { id: 'nobody' })?.id).toBe('ada')
        expect(thiefAmong(card.stealHorse?.residents, { id: 'kid' })?.problem).toBe(
          'children can’t steal',
        )
      })
    })

    describe('another realm’s horse by the Player’s own carriage', () => {
      const mine = { carriages: [{ ...carriage, horseId: null }] }
      const hitch = (card: TileCard) =>
        tileActions(card, undefined).find((a) => a.id === 'hitchOff')

      it('says it is theft before it steals', () => {
        const card = thing([person('ada')], mine)
        expect(card.hitchOff).toEqual({
          carriageId: carriage.id,
          horseId: 'h1',
          residents: [{ id: 'ada', name: 'ada', problem: undefined }],
        })
        expect(hitch(card)).toEqual({
          id: 'hitchOff',
          label: 'Drive with their horse (theft)',
          key: 'D',
        })
      })

      it('offers nothing with a horse of their own there or hitched', () => {
        const own = { ...horse, id: 'h2', realmId: 'me' }
        expect(thing([person('ada')], { ...mine, horses: [horse, own] }).hitchOff).toBeUndefined()
        const hitched = { carriages: [{ ...carriage, horseId: 'h2' }], horses: [horse, own] }
        expect(thing([person('ada')], hitched).hitchOff).toBeUndefined()
      })

      it('greys it with the reason while the horse is guarded', () => {
        const armed = person('st', { owner: 'them', carried: { spear: 1 } })
        expect(hitch(thing([person('ada'), armed], mine))?.reason).toBe(
          'an armed resident guards that horse',
        )
      })
    })

    it('has the resident picked last do it when they are there, else the first who can', () => {
      const card = thing([person('kid', { bornAt: tick }), person('ada'), person('bo')])
      expect(thiefOf(card, { id: 'bo' })?.id).toBe('bo')
      expect(thiefOf(card, { id: 'nobody' })?.id).toBe('ada')
      expect(thiefOf(card, { id: 'kid' })?.problem).toBe('children can’t steal')
    })

    it('tells a stranger’s carriage from the Player’s', () => {
      expect(strangersCarriage(theirs, 'me')).toBe(true)
      expect(strangersCarriage(carriage, 'me')).toBe(false)
      expect(strangersCarriage(theirs, 'me', new Set(['k1']))).toBe(false)
      expect(strangersCarriage({ id: 'k9', realmId: null }, 'me')).toBe(true)
    })
  })

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
    expect(tileActions(card, undefined).map((a) => a.label)).toEqual([
      'Unhitch horse',
      'Add waypoint…',
    ])
    // The resident picked last when they may, else the first who may.
    expect(unhitcherOf(card, bo)).toBe('bo')
    expect(unhitcherOf(card, kid)).toBe('ada')
    // Nobody to do it, or no horse hitched: no button.
    expect(tile({ carriages: [carriage], residents: [kid], tick }).unhitch).toBeUndefined()
    const bare = tile({ carriages: [{ ...carriage, horseId: null }], residents, tick })
    expect(bare.unhitch).toBeUndefined()
  })

  it('lists someone Down on it and offers the resident picked last to Feed them', () => {
    const tick = 100 * TICKS_PER_GAME_YEAR
    const ana = { id: 'ana', name: 'Ana', owner: 'them', cityId: null, x: 5, y: 5, carried: {} }
    const down = { ...ana, down: true as const } as unknown as SeenResident
    const card = tile({ strangers: [down], residents: [down], tick })
    expect(card.lines).toContain('Ana · Another realm · Down')
    expect(card.downHere).toEqual([{ id: 'ana', name: 'Ana', x: 5, y: 5, down: true }])
    const feeder = (more: object) =>
      ({ id: 'r1', name: 'Ada', x: 6, y: 5, bornAt: 0, carried: { food: 2 }, ...more }) as Resident
    const feed = (r: Resident) => tileActions(card, r, tick, 64).find((a) => a.id === 'feed')
    expect(feed(feeder({}))).toEqual({
      id: 'feed',
      label: 'Feed Ana…',
      key: ACTION_KEYS.feed,
      opens: true,
    })
    expect(feed(feeder({ x: 9 }))).toMatchObject({
      disabled: true,
      reason: 'stand on or next to their tile to feed them',
    })
    expect(feed(feeder({ carried: {} }))).toMatchObject({ reason: 'no Food in hand' })
    expect(tileActions(card, undefined).some((a) => a.id === 'feed')).toBe(false)
  })

  it('shows what someone Down on it carries, for the realm’s residents there to take', () => {
    const at = (id: string, more: object = {}) =>
      ({ id, name: id, owner: 'me', cityId: null, x: 5, y: 5, carried: {}, ...more }) as Resident
    const ana = at('ana', { owner: 'them', down: true, carried: { stone: 3, food: 0 } })
    const empty = at('cid', { down: true })
    const ada = at('ada')
    const lying = at('bo', { down: true })
    const away = at('away', { x: 6 })
    const stranger = at('st', { owner: 'them' })
    const residents = [ana, empty, ada, lying, away, stranger]
    const card = tile({ residents, strangers: [ana, stranger] })
    // Someone Down carrying nothing is left out; nobody Down takes anything, nor anyone off the
    // tile or of another realm.
    expect(card.downGoods).toEqual([
      { residentId: 'ana', name: 'ana', goods: { stone: 3, food: 0 }, takers: [ada] },
    ])
    expect(card.lines).toContain('2 residents of other realms · 1 Down')
    expect(tile({ residents: [ana], strangers: [ana] }).lines[0]).toBe('ana · Another realm · Down')
    expect(tile({ residents: [ada] }).downGoods).toBeUndefined()
  })

  it('sends the resident picked last there', () => {
    const card = tile()
    expect(tileActions(card, actor).map((a) => a.label)).toEqual(['Send Ada here', 'Add waypoint…'])
    expect(tileActions(card, undefined).map((a) => a.id)).toEqual(['addWaypoint'])
  })

  it('opens or closes a gate of the Player’s own city, not another’s', () => {
    const own = tile({ buildings: [building({ kind: 'gate', cityId: 'c-me', closed: true })] })
    expect(tileActions(own, undefined).map((a) => a.label)).toEqual([
      'Open the gate',
      'Add waypoint…',
    ])
    const theirs = tile({ buildings: [building({ kind: 'gate', cityId: 'c-npc' })] })
    expect(tileActions(theirs, undefined).map((a) => a.id)).toEqual(['addWaypoint'])
  })

  it('offers nothing to do with a building only remembered, but still sends there', () => {
    const gate = { ...building({ kind: 'gate', cityId: 'c-me', closed: true }), seenAt: 0 }
    const card = tile({ lastSeen: { buildings: [gate], tick: 10 } })
    expect(tileActions(card, actor).map((a) => a.label)).toEqual(['Send Ada here', 'Add waypoint…'])
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
    cities: [
      { id: 'c1', name: 'Ashford', realmId: 'me', townHallId: 'hall', occupation: null },
    ] as City[],
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

describe('a carriage on the tile card (`CONTEXT.md`: Goods on cards)', () => {
  const storage = building({ id: 'b-store', kind: 'storage', cityId: 'c-me', x: 1, y: 1 })
  const route = (more: Partial<HaulOrder> = {}): HaulOrder => ({
    kind: 'haul',
    carriageId: carriage.id,
    from: { x: 1, y: 1 },
    to: { x: 20, y: 20 },
    goods: ['stone'],
    returnGoods: [],
    keepFood: 2,
    stop: 'to',
    phase: 'driving',
    path: [
      [6, 6],
      [7, 7],
    ],
    progress: 0,
    moving: null,
    ...more,
  })
  const ana = (order: HaulOrder | null) =>
    ({ id: 'ana', name: 'Ana', x: 5, y: 5, order }) as SeenResident

  it('names its owner on its own card, and only its section otherwise', () => {
    const card = tile({ carriages: [carriage] })
    expect(card.lines[0]).toBe('Yours')
    expect(card.carriage?.title).toBe('Carriage (yours)')
  })

  it('shows its driver, the haul route by its stops, the leg it is on and when it arrives', () => {
    const r = ana(route())
    const card = tile({
      carriages: [carriage],
      buildings: [storage],
      residents: [r],
      arrivesIn: (x) => (x.id === 'ana' ? 3 * TICKS_PER_GAME_HOUR : undefined),
    })
    expect(card.carriage?.driver).toEqual({ id: 'ana', name: 'Ana', pick: true })
    expect(card.carriage?.route).toEqual({
      stops: 'Eastmere storage → 20, 20',
      leg: `Leg 1 of 2 · ${aboutTime(3 * TICKS_PER_GAME_HOUR)}`,
    })
    // Back to the first stop, the second leg; without an estimate, the tiles to go.
    const back = tile({
      carriages: [carriage],
      buildings: [storage],
      residents: [ana(route({ stop: 'from' }))],
    })
    expect(back.carriage?.route?.leg).toBe('Leg 2 of 2 · 2 tiles to go')
    const finding = tile({ carriages: [carriage], residents: [ana(route({ path: null }))] })
    expect(finding.carriage?.route?.leg).toBe('Leg 1 of 2 · finding the way')
  })

  it('says what is done at a stop, and names an army the route supplies', () => {
    const at = (more: Partial<HaulOrder>) =>
      tile({ carriages: [carriage], buildings: [storage], residents: [ana(route(more))] }).carriage
        ?.route?.leg
    expect(at({ stop: 'from', phase: 'loading' })).toBe('Loading at Eastmere storage')
    expect(at({ stop: 'to', phase: 'loading' })).toBe('Unloading at 20, 20')
    expect(at({ stop: 'to', phase: 'loading', returnGoods: ['food'] })).toBe(
      'Unloading and loading at 20, 20',
    )
    const army = tile({
      carriages: [carriage],
      residents: [ana(route({ toArmy: 'a1' }))],
      armies: [{ id: 'a1', name: 'Vanguard' }],
    })
    expect(army.carriage?.route?.stops).toBe('1, 1 → Vanguard')
  })

  it('has no driver or route standing idle', () => {
    const card = tile({ carriages: [carriage], residents: [ana(null)] })
    expect(card.carriage?.driver).toBeUndefined()
    expect(card.carriage?.route).toBeUndefined()
    // Someone else's order on another carriage doesn't make them its driver.
    const other = tile({ carriages: [carriage], residents: [ana(route({ carriageId: 'k9' }))] })
    expect(other.carriage?.driver).toBeUndefined()
  })

  it('shows another realm’s carriage only by how heavily it is loaded, its driver by name, no route', () => {
    const { id, x, y, horseId } = carriage
    const theirs = {
      id,
      x,
      y,
      horseId,
      realmId: 'r-other',
      cityId: null,
      loadLevel: 'heavy' as const,
    }
    const cid = {
      ...ana(route()),
      id: 'cid',
      name: 'Cid',
      owner: 'r-other',
      carried: {},
    } as SeenResident
    const card = tile({ carriages: [theirs], residents: [cid], strangers: [cid] })
    expect(card.lines[0]).toBe('Another realm')
    expect(card.carriage).toEqual({
      title: 'Carriage (another realm)',
      load: { text: 'Heavily loaded' },
      noHorse: 'Horse hitched',
      driver: { id: 'cid', name: 'Cid', pick: false },
    })
  })
})
