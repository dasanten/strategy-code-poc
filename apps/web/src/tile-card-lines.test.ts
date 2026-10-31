import { describe, expect, it } from 'vitest'
import {
  BUILD_WORK,
  FOOD_PER_DAY,
  HOUSING_ROOM,
  MOUNTAIN_ROAD_WORK_FACTOR,
  TICKS_PER_GAME_YEAR,
  Terrain,
  UNEXPLORED,
  hungerFactor,
  teardownWork,
  type Pile,
  type Resident,
  type SeenBuilding,
} from '@csp/shared'
import { describeTile, tileActions, type TileThings } from './selection-view.js'
import { GOOD_LABELS } from './Residents.js'

const building = (b: Partial<SeenBuilding> & Pick<SeenBuilding, 'kind'>): SeenBuilding => ({
  id: `b-${b.kind}`,
  cityId: null,
  x: 5,
  y: 5,
  ...b,
})
const pile = (goods: Pile['goods']): Pile => ({ id: 'p1', x: 5, y: 5, goods })
const resident = (more: Partial<Resident>): Resident =>
  ({
    id: 'r',
    name: 'Brann',
    owner: 'them',
    cityId: null,
    x: 5,
    y: 5,
    carried: {},
    order: null,
    ...more,
  }) as Resident

const tile = (more: Partial<TileThings> = {}) =>
  describeTile(
    {
      x: 5,
      y: 5,
      buildings: [],
      carriages: [],
      horses: [],
      piles: [],
      node: undefined,
      strangers: [],
      cities: [{ id: 'c-me', name: 'Eastmere', realmId: 'me' }],
      viewer: { realmId: 'me', allies: new Set() },
      workers: () => 1,
      ...more,
    },
    GOOD_LABELS,
  )
const linesOf = (more: Partial<TileThings>) => tile(more).lines

describe('the terrain on a tile’s card', () => {
  it('says how it walks and feeds, and names open ground after it', () => {
    const card = tile({ terrain: Terrain.Hills })
    expect(card.title).toBe('Hills')
    expect(card.lines).toContain('Hills · speed ~70% · food 130%')
    expect(linesOf({ terrain: Terrain.Plains })).toContain('Plains · speed 100% · food 100%')
    expect(linesOf({ terrain: Terrain.Lake })).toContain('Lake · impassable')
    expect(tile({ terrain: UNEXPLORED }).title).toBe('Open ground')
    expect(tile().title).toBe('Open ground')
  })

  it('gives a road its own speed, on whatever it lies on', () => {
    const card = tile({ terrain: Terrain.Hills, buildings: [building({ kind: 'road' })] })
    expect(card.title).toBe('Road')
    expect(card.lines).toContain('Road on hills · speed ~130% · food 100%')
    expect(card.lines).not.toContain('Hills · speed ~70% · food 130%')
    const site = building({ kind: 'road', site: { work: 0, delivered: {} } })
    expect(linesOf({ terrain: Terrain.Hills, buildings: [site] })).toEqual(
      expect.arrayContaining(['Road site · 0% of the work done', 'Hills · speed ~70% · food 130%']),
    )
  })

  it('says a road site on Mountain takes more work', () => {
    const work = (BUILD_WORK.road ?? 0) / 2
    const site = building({ kind: 'road', site: { work, delivered: {} } })
    expect(linesOf({ terrain: Terrain.Mountain, buildings: [site] })).toContain(
      `Road site · 50% of the work done · ${MOUNTAIN_ROAD_WORK_FACTOR}× the work on Mountain`,
    )
  })
})

describe('buildings on a tile’s card', () => {
  it('says what a construction site still needs', () => {
    const mine = (delivered: SeenBuilding['stock'] & object) =>
      building({ kind: 'mine', site: { work: 0, delivered } })
    expect(linesOf({ buildings: [mine({ wood: 10 })] })).toContain('Still needs 30 wood, 20 stone')
    expect(linesOf({ buildings: [mine({ wood: 40, stone: 20 })] })).toContain(
      'All materials delivered',
    )
    const farm = building({ kind: 'farm', site: { work: 0, delivered: {} } })
    expect(linesOf({ buildings: [farm] })).toContain('Needs no materials, only work')
  })

  it('says what a workplace makes and how much lies in its pile', () => {
    const farm = building({ kind: 'farm', cityId: 'c-me' })
    expect(linesOf({ buildings: [farm], piles: [pile({ food: 7 })] })).toContain(
      'Makes food · 7 in its pile',
    )
    // A mine's node lies on one tile of its footprint, not necessarily the one clicked.
    const nodeAt = (x: number, y: number) =>
      x === 6 && y === 6 ? { kind: 'goldOre' as const, x, y } : undefined
    expect(linesOf({ buildings: [building({ kind: 'mine' })], nodeAt })).toContain(
      'Makes gold ore · 0 in its pile',
    )
    expect(linesOf({ buildings: [building({ kind: 'smelter' })] })).toContain(
      'Makes iron · 0 in its pile',
    )
    const house = linesOf({ buildings: [building({ kind: 'house', cityId: 'c-me' })] })
    expect(house.some((l) => l.startsWith('Makes'))).toBe(false)
  })

  it('says what a smithy’s workers are making', () => {
    const smithy = building({ kind: 'smithy' })
    const at = (id: string, makes: 'sword' | 'shield') =>
      resident({
        id,
        order: { kind: 'workAt', buildingId: smithy.id, at: { x: 5, y: 5 }, progress: 0, makes },
      })
    const card = tile({
      buildings: [smithy],
      residents: [at('a', 'sword'), at('b', 'sword'), at('c', 'shield')],
      piles: [pile({ sword: 3, iron: 5 })],
    })
    expect(card.lines).toContain('Its workers make sword (2), shield (1) · in its pile: 3 sword')
    expect(linesOf({ buildings: [smithy] })).toContain(
      'Makes weapons and armour, nobody at it · in its pile: nothing made',
    )
  })

  it('says nobody teaches at a finished training ground yet, and nothing of the kind at its site', () => {
    const ground = building({ kind: 'trainingGround' })
    const lines = linesOf({ buildings: [ground] })
    expect(lines).toContain('Nobody teaches here yet')
    expect(lines.some((l) => l.startsWith('Makes') || l.includes('workers'))).toBe(false)
    const site = building({ kind: 'trainingGround', site: { work: 0, delivered: {} } })
    expect(linesOf({ buildings: [site] })).not.toContain('Nobody teaches here yet')
  })

  it('names who teaches what at a training ground, while they stand on it', () => {
    const ground = building({ id: 'g1', kind: 'trainingGround', x: 4, y: 4 })
    const ann = resident({
      name: 'Ann',
      order: { kind: 'teach', buildingId: 'g1', subject: 'strength' },
    })
    expect(linesOf({ buildings: [ground], residents: [ann] })).toContain('Ann teaches Strength')
    const off = { ...ann, x: 9 }
    expect(linesOf({ buildings: [ground], residents: [off] })).toContain('Nobody teaches here yet')
  })

  it('links a warehouse and a trading NPC city’s storage to their prices', () => {
    const cities = [
      { id: 'c-post', name: 'Saltgate', realmId: null, tradeOrg: 'post' as const },
      { id: 'c-npc', name: 'Oakhollow', realmId: null, trade: [{ good: 'food' as const }] },
      { id: 'c-shut', name: 'Thornby', realmId: null },
    ] as TileThings['cities']
    const warehouse = building({
      kind: 'warehouse',
      cityId: 'c-post',
      prices: [{ good: 'food' }] as SeenBuilding['prices'],
    })
    const card = tile({ buildings: [warehouse], cities })
    expect(card.lines).toContain('Buys and sells here · prices in the city inspector')
    expect(card.city?.id).toBe('c-post')
    expect(tileActions(card, undefined).map((a) => [a.id, a.key])).toEqual([['openCity', 'C']])
    const npc = tile({ buildings: [building({ kind: 'storage', cityId: 'c-npc' })], cities })
    expect(npc.city?.id).toBe('c-npc')
    // No prices shown to the Player (it won't trade with them): nothing to link to.
    const shut = tile({ buildings: [building({ kind: 'storage', cityId: 'c-shut' })], cities })
    expect(shut.city).toBeUndefined()
    expect(shut.lines.some((l) => l.includes('prices'))).toBe(false)
  })

  it('says how an own or allied city lives at its town hall, and links an own one', () => {
    const tick = 0
    const stat = { base: 10, trained: 0 }
    const fed = (id: string, cityId: string, owner: string) =>
      resident({
        id,
        cityId,
        owner,
        hunger: 100,
        health: 100,
        bornAt: -30 * TICKS_PER_GAME_YEAR,
        lifespan: 60,
        stats: { strength: stat, endurance: stat, agility: stat, intellect: stat },
      })
    const cities = [
      { id: 'c-me', name: 'Eastmere', realmId: 'me' },
      { id: 'c-ally', name: 'Westholm', realmId: 'ally' },
      { id: 'c-them', name: 'Farreach', realmId: 'them' },
    ]
    const city = (cityId: string) => [
      building({ id: `th-${cityId}`, kind: 'townHall', cityId }),
      building({ id: `h1-${cityId}`, kind: 'house', cityId, x: 20 }),
      building({ id: `h2-${cityId}`, kind: 'house', cityId, x: 30 }),
      building({ id: `s-${cityId}`, kind: 'storage', cityId, x: 40, stock: { food: 33 } }),
    ]
    const residents = [1, 2, 3].flatMap((i) => [
      fed(`m${i}`, 'c-me', 'me'),
      fed(`a${i}`, 'c-ally', 'ally'),
    ])
    const at = (cityId: string) =>
      tile({
        buildings: city(cityId),
        residents,
        cities,
        viewer: { realmId: 'me', allies: new Set(['ally']) },
        tick,
      })
    const perDay = 3 * FOOD_PER_DAY * hungerFactor(residents[0]!, tick)
    const own = at('c-me')
    expect(own.lines).toEqual(
      expect.arrayContaining([
        `3 residents · ${2 * HOUSING_ROOM.house! - 3} free housing`,
        `Food for ${Math.floor(33 / perDay)} game days`,
      ]),
    )
    expect(own.city).toEqual({ id: 'c-me', label: 'Open Eastmere in the city inspector' })
    const ally = at('c-ally')
    expect(ally.lines.some((l) => l.startsWith('3 residents'))).toBe(true)
    expect(ally.city).toBeUndefined()
    // Another realm's town hall tells nothing of how its city lives.
    const theirs = at('c-them')
    expect(theirs.lines.some((l) => l.includes('residents') || l.startsWith('Food'))).toBe(false)
  })

  it('says a house’s room, and how its city is housed where the Player may know', () => {
    const cities = [
      { id: 'c-me', name: 'Eastmere', realmId: 'me' },
      { id: 'c-them', name: 'Farreach', realmId: 'them' },
    ]
    const houses = (cityId: string) => [
      building({ id: `h1-${cityId}`, kind: 'house', cityId }),
      building({ id: `h2-${cityId}`, kind: 'house', cityId, x: 30 }),
    ]
    const residents = ['c-me', 'c-me', 'c-me', 'c-them'].map((cityId, i) =>
      resident({ id: `r${i}`, cityId, owner: cityId === 'c-me' ? 'me' : 'them' }),
    )
    const viewer = { realmId: 'me', allies: new Set<string>() }
    const room = HOUSING_ROOM.house!
    expect(linesOf({ buildings: houses('c-me'), residents, cities, viewer })).toContain(
      `Room for ${room} residents · Eastmere: 3 residents · ${2 * room - 3} free housing`,
    )
    // Another realm's house says its room, nothing of how its city lives.
    expect(linesOf({ buildings: houses('c-them'), residents, cities, viewer })).toContain(
      `Room for ${room} residents`,
    )
    // A house site houses nobody yet.
    const site = {
      ...building({ kind: 'house', cityId: 'c-me' }),
      site: { work: 0, delivered: {} },
    }
    expect(linesOf({ buildings: [site], cities, viewer }).some((l) => l.startsWith('Room'))).toBe(
      false,
    )
  })

  it('offers renaming only an own city, at its town hall in sight', () => {
    const cities = [
      { id: 'c-me', name: 'Eastmere', realmId: 'me' },
      { id: 'c-npc', name: 'Oakhollow', realmId: null },
    ]
    const hall = (cityId: string) => building({ id: `th-${cityId}`, kind: 'townHall', cityId })
    const viewer = { realmId: 'me', allies: new Set<string>() }
    const own = tile({ buildings: [hall('c-me')], cities, viewer })
    expect(own.renameCity).toEqual({ id: 'c-me', name: 'Eastmere' })
    expect(tileActions(own, undefined).find((a) => a.id === 'renameCity')).toMatchObject({
      label: 'Rename the city…',
      key: 'N',
      opens: true,
    })
    expect(tile({ buildings: [hall('c-npc')], cities, viewer }).renameCity).toBeUndefined()
    // Nor another of the city's buildings, nor its town hall only remembered.
    const house = building({ kind: 'house', cityId: 'c-me' })
    expect(tile({ buildings: [house], cities, viewer }).renameCity).toBeUndefined()
    const remembered = tile({
      buildings: [],
      cities,
      viewer,
      lastSeen: { buildings: [{ ...hall('c-me'), seenAt: 0 }], tick: 10 },
    })
    expect(remembered.title).toContain('Eastmere')
    expect(remembered.renameCity).toBeUndefined()
  })

  it('says how far tearing down a building or a road has come', () => {
    const house = building({ kind: 'house', cityId: 'c-me' })
    const half = { ...house, teardown: teardownWork(house) / 2 }
    expect(linesOf({ buildings: [half] })).toContain('Being torn down · 50% done')
    expect(linesOf({ buildings: [house] }).some((l) => l.startsWith('Being torn'))).toBe(false)
    const road = building({ kind: 'road', teardown: teardownWork(building({ kind: 'road' })) })
    expect(linesOf({ buildings: [road] })).toContain('Being torn down · 100% done')
  })
})

describe('strangers on a tile’s card', () => {
  it('says which weapons and armour a stranger carries, and nothing else they carry', () => {
    const armed = resident({ carried: { sword: 1, shield: 1, food: 3, coins: 50 } })
    expect(linesOf({ strangers: [armed] })).toContain(
      'Brann · Another realm · armed: sword, shield',
    )
    expect(linesOf({ strangers: [resident({ carried: { armour: 1 } })] })).toContain(
      'Brann · Another realm · unarmed, with armour',
    )
    expect(linesOf({ strangers: [resident({ carried: { food: 2 } })] })).toContain(
      'Brann · Another realm',
    )
  })

  it('counts an army of strangers on the tile as soldiers', () => {
    const marching = (id: string, carried: Resident['carried']) =>
      resident({
        id,
        carried,
        order: { kind: 'walkTo', target: { x: 9, y: 9 }, path: null, progress: 0, army: 'a1' },
      })
    const strangers = [
      ...Array.from({ length: 12 }, (_, i) => marching(`s${i}`, { spear: 1 })),
      marching('u', {}),
      resident({ id: 'x', carried: { sword: 1 } }),
      resident({ id: 'y' }),
    ]
    expect(linesOf({ strangers })).toEqual(
      expect.arrayContaining([
        'Army · 12 soldiers · 1 unarmed',
        '2 residents of other realms · 1 armed',
      ]),
    )
  })
})
