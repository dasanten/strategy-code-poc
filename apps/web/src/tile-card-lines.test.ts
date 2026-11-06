import { describe, expect, it } from 'vitest'
import {
  BATCHES_PER_DAY,
  BUILD_MATERIALS,
  BUILD_WORK,
  FOOD_PER_DAY,
  GOODS,
  HOUSING_ROOM,
  MOUNTAIN_ROAD_WORK_FACTOR,
  RECIPES,
  TICKS_PER_GAME_YEAR,
  Terrain,
  UNEXPLORED,
  WORK_OUTPUT_PER_DAY,
  WORK_SKILL_EFFECT,
  WORK_STRENGTH_AVERAGE,
  hungerFactor,
  teardownWork,
  type Good,
  type Pile,
  type Resident,
  type SeenBuilding,
} from '@csp/shared'
import { describeTile, tileActions, tradesHere, type TileThings } from './selection-view.js'
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
  it('shows what a construction site has against what it needs, per good', () => {
    const mine = (delivered: SeenBuilding['stock'] & object, work = 0) =>
      building({ kind: 'mine', site: { work, delivered } })
    const half = tile({ buildings: [mine({ wood: 10 }, (BUILD_WORK.mine ?? 0) / 2)] })
    expect(half.sites).toEqual([
      {
        work: { text: '50%', share: 0.5 },
        materials: [
          { good: 'wood', have: 10, need: 40 },
          { good: 'stone', have: 0, need: 20 },
        ],
      },
    ])
    expect(half.lines.some((l) => /wood|work done|delivered/.test(l))).toBe(false)
    expect(half.lists).toBeUndefined()
    const full = tile({ buildings: [mine({ wood: 40, stone: 20 })] })
    expect(full.sites?.[0]?.materials.every((m) => m.have === m.need)).toBe(true)
    const farm = tile({ buildings: [building({ kind: 'farm', site: { work: 0, delivered: {} } })] })
    expect(farm.sites?.[0]?.materials).toEqual([])
  })

  it('shows a carriage site under a head of its own on its stable’s card', () => {
    const stable = building({ kind: 'stable', cityId: 'c-me', stock: {} })
    const carriage = building({ id: 'k', kind: 'carriage', site: { work: 0, delivered: {} } })
    const card = tile({ buildings: [stable, carriage] })
    expect(card.title).toBe('Eastmere stable')
    expect(card.sites).toEqual([
      expect.objectContaining({ title: 'Carriage site', work: { text: '0%', share: 0 } }),
    ])
    expect(card.sites?.[0]?.materials.map((m) => m.good)).toEqual(
      Object.keys(BUILD_MATERIALS.carriage ?? {}).sort(
        (a, b) => GOODS.indexOf(a as Good) - GOODS.indexOf(b as Good),
      ),
    )
    // On a card of its own, the card's head names it.
    const alone = tile({ buildings: [carriage] })
    expect(alone.title).toBe('Carriage site')
    expect(alone.sites?.[0]?.title).toBeUndefined()
  })

  it('says what a workplace makes, and shows its pile as a goods grid', () => {
    const farm = building({ kind: 'farm', cityId: 'c-me' })
    const card = tile({ buildings: [farm], piles: [pile({ food: 7 })] })
    expect(card.lines).toContain('Makes food')
    expect(card.lists?.find((l) => l.title === 'Pile')?.goods).toEqual({ food: 7 })
    // A mine's node lies on one tile of its footprint, not necessarily the one clicked.
    const nodeAt = (x: number, y: number) =>
      x === 6 && y === 6 ? { kind: 'goldOre' as const, x, y } : undefined
    expect(linesOf({ buildings: [building({ kind: 'mine' })], nodeAt })).toContain('Makes gold ore')
    expect(linesOf({ buildings: [building({ kind: 'smelter' })] })).toContain('Makes iron')
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
    expect(card.lines).toContain('Its workers make sword (2), shield (1)')
    expect(card.lists?.find((l) => l.title === 'Pile')?.goods).toEqual({ sword: 3, iron: 5 })
    expect(linesOf({ buildings: [smithy] })).toContain('Makes weapons and armour, nobody at it')
  })

  describe('how much is made at a workplace (`CONTEXT.md`: Workplace amounts)', () => {
    /** A worker of realm `me` at Strength `strength` with `skill` of the workplace's skill. */
    const worker = (
      b: SeenBuilding,
      id: string,
      strength: number,
      skills: Resident['skills'] = {},
      makes?: Good,
      owner = 'me',
    ) =>
      resident({
        id,
        name: id,
        owner,
        bornAt: 0,
        skills,
        stats: { strength: { base: strength, trained: 0 } } as Resident['stats'],
        order: {
          kind: 'workAt',
          buildingId: b.id,
          at: { x: b.x, y: b.y },
          progress: 0,
          ...(makes ? { makes } : {}),
        },
      })
    const skilled = (points: number) => 1 + points * WORK_SKILL_EFFECT
    const tenth = (n: number) => `${Math.floor(n * 10 + 1e-9) / 10}`
    /** The list's rows as [name, what, how much]. */
    const amounts = (more: Partial<TileThings>) => {
      const list = tile(more).lists?.find((l) => l.title === 'Made a game day')
      return list?.rows.map((r) => [r.name, r.detail, r.amount?.text])
    }

    it('gives a farm’s workers by their Strength and skill, and the total', () => {
      const farm = building({ kind: 'farm', cityId: 'c-me' })
      const perDay = WORK_OUTPUT_PER_DAY.food!
      const ana = perDay * (15 / WORK_STRENGTH_AVERAGE) * skilled(50)
      const bo = perDay * (7 / WORK_STRENGTH_AVERAGE)
      const residents = [worker(farm, 'Ana', 15, { farming: 50 }), worker(farm, 'Bo', 7)]
      expect(amounts({ buildings: [farm], residents })).toEqual([
        ['Ana', 'Food', tenth(ana)],
        ['Bo', 'Food', tenth(bo)],
        ['Total', 'Food', tenth(ana + bo)],
      ])
      // The rows say what it makes, so the line doesn't.
      expect(linesOf({ buildings: [farm], residents })).not.toContain('Makes food')
    })

    it('gives a mine what its node yields, the same way', () => {
      const mine = building({ kind: 'mine' })
      const nodeAt = (x: number, y: number) =>
        x === 6 && y === 6 ? { kind: 'goldOre' as const, x, y } : undefined
      const perDay = WORK_OUTPUT_PER_DAY.goldOre!
      const ana = perDay * (20 / WORK_STRENGTH_AVERAGE) * skilled(10)
      const bo = perDay * (5 / WORK_STRENGTH_AVERAGE)
      const residents = [worker(mine, 'Ana', 20, { mining: 10 }), worker(mine, 'Bo', 5)]
      expect(amounts({ buildings: [mine], residents, nodeAt })).toEqual([
        ['Ana', 'Gold ore', tenth(ana)],
        ['Bo', 'Gold ore', tenth(bo)],
        ['Total', 'Gold ore', tenth(ana + bo)],
      ])
    })

    it('counts a smelter’s and a mint’s batches times what a batch yields', () => {
      const smelter = building({ kind: 'smelter' })
      expect(amounts({ buildings: [smelter], residents: [worker(smelter, 'Ana', 10)] })).toEqual([
        ['Ana', 'Iron', `${BATCHES_PER_DAY.smelter}`],
        ['Total', 'Iron', `${BATCHES_PER_DAY.smelter}`],
      ])
      const mint = building({ kind: 'mint' })
      const coins = BATCHES_PER_DAY.mint! * RECIPES.mint![0]!.output.coins!
      expect(amounts({ buildings: [mint], residents: [worker(mint, 'Ana', 10)] })).toEqual([
        ['Ana', 'Coins', `${coins}`],
        ['Total', 'Coins', `${coins}`],
      ])
    })

    it('gives a smithy one total for each item being made', () => {
      const smithy = building({ kind: 'smithy' })
      const perDay = BATCHES_PER_DAY.smithy!
      const ana = perDay * (15 / WORK_STRENGTH_AVERAGE)
      const bo = perDay * skilled(20)
      const cy = perDay
      const residents = [
        worker(smithy, 'Ana', 15, {}, 'sword'),
        worker(smithy, 'Bo', 10, { smithing: 20 }, 'shield'),
        worker(smithy, 'Cy', 10, {}, 'sword'),
      ]
      expect(amounts({ buildings: [smithy], residents })).toEqual([
        ['Ana', 'Sword', tenth(ana)],
        ['Bo', 'Shield', tenth(bo)],
        ['Cy', 'Sword', tenth(cy)],
        ['Total', 'Sword', tenth(ana + cy)],
        ['Total', 'Shield', tenth(bo)],
      ])
      expect(linesOf({ buildings: [smithy], residents }).join()).not.toMatch(/make/i)
    })

    it('opens a worker’s card from their row, and has no card behind a total', () => {
      const farm = building({ kind: 'farm', cityId: 'c-me' })
      const card = tile({ buildings: [farm], residents: [worker(farm, 'Ana', 10)] })
      const rows = card.lists?.find((l) => l.title === 'Made a game day')?.rows
      expect(rows?.map((r) => r.opens)).toEqual(['resident', undefined])
    })

    it('doesn’t count another realm’s worker, whose stats aren’t known', () => {
      const farm = building({ kind: 'farm', cityId: 'c-me' })
      const them = resident({
        id: 'Cid',
        order: { kind: 'workAt', buildingId: farm.id, at: { x: 5, y: 5 }, progress: 0 },
      })
      const ana = worker(farm, 'Ana', 10)
      const perDay = `${WORK_OUTPUT_PER_DAY.food}`
      expect(amounts({ buildings: [farm], residents: [ana, them] })).toEqual([
        ['Ana', 'Food', perDay],
        ['Total', 'Food', perDay],
      ])
      // With only them there the card says what it does with nobody counted.
      expect(amounts({ buildings: [farm], residents: [them] })).toBeUndefined()
      expect(linesOf({ buildings: [farm], residents: [them] })).toContain('Makes food')
    })

    it('still says what another realm’s workers make at a smithy', () => {
      const smithy = building({ kind: 'smithy' })
      const theirs = worker(smithy, 'Cid', 10, {}, 'spear', 'them')
      const mine = worker(smithy, 'Ana', 10, {}, 'sword')
      const lines = linesOf({ buildings: [smithy], residents: [mine, theirs] })
      expect(lines).toContain('Others make spear (1)')
      expect(linesOf({ buildings: [smithy], residents: [theirs] })).toContain(
        'Its workers make spear (1)',
      )
    })

    it('leaves the rows out with no worker there, and for one only on the way', () => {
      const farm = building({ kind: 'farm', cityId: 'c-me' })
      expect(amounts({ buildings: [farm] })).toBeUndefined()
      expect(linesOf({ buildings: [farm] })).toContain('Makes food')
      const away = { ...worker(farm, 'Ana', 10), order: null }
      expect(amounts({ buildings: [farm], residents: [away] })).toBeUndefined()
      const smithy = building({ kind: 'smithy' })
      expect(amounts({ buildings: [smithy] })).toBeUndefined()
      expect(linesOf({ buildings: [smithy] })).toContain('Makes weapons and armour, nobody at it')
    })
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

  it('lists each trainee with their value, their ceiling, and whether they wait', () => {
    const ground = building({ id: 'g1', kind: 'trainingGround', x: 4, y: 4 })
    const tick = 30 * TICKS_PER_GAME_YEAR
    const stats = (strength: number, trained = 0) => ({
      strength: { base: strength, trained },
      endurance: { base: 10, trained: 0 },
      agility: { base: 10, trained: 0 },
      intellect: { base: 10, trained: 0 },
    })
    const grown = { bornAt: 0, skills: {} }
    const ann = resident({
      ...grown,
      id: 'a',
      name: 'Ann',
      stats: stats(14),
      order: { kind: 'teach', buildingId: 'g1', subject: 'strength' },
    })
    const trainee = (id: string, name: string, s: number, t: number, learning: boolean) =>
      resident({
        ...grown,
        id,
        name,
        stats: stats(s, t),
        order: { kind: 'train', buildingId: 'g1', learning: learning ? 'strength' : null },
      })
    // Bo's cap (10 + 5) is above Ann's 14; Cy's (8 + 4) is below it, and Cy has reached it.
    const bo = trainee('b', 'Bo', 10, 1.27, true)
    const cy = trainee('c', 'Cy', 8, 4, false)
    const lines = linesOf({ buildings: [ground], residents: [ann, bo, cy], tick })
    expect(lines).toEqual(
      expect.arrayContaining([
        'Ann teaches Strength',
        'Bo trains: 11.2 of 14',
        'Cy trains: 12 of 12, waiting',
      ]),
    )
    const alone = linesOf({ buildings: [ground], residents: [cy], tick })
    expect(alone).toEqual(expect.arrayContaining(['Nobody teaches here yet', 'Cy trains, waiting']))
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
    expect(card.lines).toContain('Buys and sells here')
    expect(card.tradeHere).toEqual({ cityId: 'c-post', buildingId: 'b-warehouse' })
    expect(tileActions(card, undefined).map((a) => [a.id, a.label, a.key])).toEqual([
      ['tradeHere', 'Trade here', 'T'],
      ['addWaypoint', 'Add waypoint…', 'J'],
    ])
    const npc = tile({ buildings: [building({ kind: 'storage', cityId: 'c-npc' })], cities })
    expect(npc.tradeHere).toEqual({ cityId: 'c-npc', buildingId: 'b-storage' })
    // No prices shown to the Player (it won't trade with them): nothing to link to.
    const shut = tile({ buildings: [building({ kind: 'storage', cityId: 'c-shut' })], cities })
    expect(shut.tradeHere).toBeUndefined()
    expect(shut.lines).not.toContain('Buys and sells here')
  })

  it('offers Trade here on the tile of a wandering trader standing there (`CONTEXT.md`: Trader stop)', () => {
    const standing = { cityId: 'c-npc', x: 5, y: 5, until: 100 }
    const trader = { id: 'trader1', carriageId: 'k', driverId: 'd', escortIds: [] }
    const card = tile({ traders: [{ ...trader, standing }] })
    expect(card.lines).toContain('A wandering trader buys and sells here')
    expect(card.tradeHere).toEqual({ cityId: 'c-npc', buildingId: 'trader1' })
    expect(tileActions(card, undefined).map((a) => a.label)).toContain('Trade here')
    // Passing by, or on another tile, it trades with nobody.
    expect(tile({ traders: [trader] }).tradeHere).toBeUndefined()
    const away = { ...standing, x: 6 }
    expect(tile({ traders: [{ ...trader, standing: away }] }).tradeHere).toBeUndefined()
  })

  it('offers Trade here only where the Player trades (`tradesHere`)', () => {
    const food = [{ good: 'food' as const }] as NonNullable<TileThings['cities'][number]['trade']>
    const npc = { id: 'c-npc', name: 'Oakhollow', realmId: null, trade: food }
    const warehouse = { kind: 'warehouse' as const, prices: food as SeenBuilding['prices'] }
    const storage = { kind: 'storage' as const }
    const post = { id: 'c-post', name: 'Saltgate', realmId: null, tradeOrg: 'post' as const }
    expect(tradesHere(warehouse, post)).toBe(true)
    expect(tradesHere(storage, npc)).toBe(true)
    // A city that refuses the Player won't trade with them, even with prices still in hand.
    expect(tradesHere(storage, { ...npc, refuses: true })).toBe(false)
    expect(tradesHere(storage, { id: 'c-me', name: 'Eastmere', realmId: 'me' })).toBe(false)
    // A warehouse whose prices the Player doesn't see.
    expect(tradesHere({ kind: 'warehouse' }, post)).toBe(false)
    // An NPC city's stable, with horses it lists there (`CONTEXT.md`: Horse market).
    const offer = {
      horseId: 'h1',
      stableId: 'st1',
      name: 'Onyx',
      stats: { speed: 10, strength: 10, endurance: 10 },
      bornAt: 0,
      price: 100,
    }
    const stable = { id: 'st1', kind: 'stable' as const }
    const herd = { ...npc, horses: [offer] }
    expect(tradesHere(stable, herd)).toBe(true)
    expect(tradesHere({ id: 'st2', kind: 'stable' }, herd)).toBe(false)
    expect(tradesHere(stable, npc)).toBe(false)
    expect(tradesHere(stable, { ...herd, refuses: true })).toBe(false)
  })

  it('offers no Trade here on a warehouse only remembered', () => {
    const cities = [{ id: 'c-post', name: 'Saltgate', realmId: null, tradeOrg: 'post' as const }]
    const seen = building({
      kind: 'warehouse',
      cityId: 'c-post',
      prices: [{ good: 'food' }] as SeenBuilding['prices'],
    })
    const card = tile({ cities, lastSeen: { buildings: [{ ...seen, seenAt: 0 }], tick: 100 } })
    expect(card.tradeHere).toBeUndefined()
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

describe('who is on the way to a storage or stable (CONTEXT.md: Goods on cards)', () => {
  const storage = building({ kind: 'storage', cityId: 'c-me', stock: { wood: 3 } })
  const place = { kind: 'storage' as const, storageId: storage.id }
  const way: [number, number][] = [
    [6, 5],
    [5, 5],
  ]
  const ben = resident({
    id: 'ben',
    name: 'Ben',
    owner: 'me',
    order: {
      kind: 'store',
      goods: { wood: null },
      to: place,
      phase: 'walking',
      path: way,
      progress: 0,
    },
  })
  const cara = resident({
    id: 'cara',
    name: 'Cara',
    owner: 'me',
    order: {
      kind: 'fetch',
      goods: { stone: 10 },
      from: place,
      phase: 'walking',
      path: way,
      progress: 0,
    },
  })
  const onTheWay = (residents: Resident[], more: Partial<TileThings> = {}) =>
    tile({
      buildings: [storage],
      residents,
      strangers: residents.filter((r) => r.owner !== 'me'),
      arrivesIn: (r) => (r.id === 'ben' ? 300 : r.id === 'cara' ? 60 : undefined),
      ...more,
    }).lists?.find((l) => l.title === 'On the way')

  it('lists the Player’s residents storing and fetching there, soonest first, to pick', () => {
    const list = onTheWay([ben, cara])!
    expect(list.count).toBe('2')
    expect(list.rows.map((r) => [r.name, r.detail, r.opens])).toEqual([
      ['Cara', 'Fetch · 10 stone · about 1 min (a game hour)', 'resident'],
      ['Ben', 'Store · wood · about 5 min (5 game hours)', 'resident'],
    ])
  })

  it('says Getting food for a fetch of Food alone, and tiles or the search without an estimate', () => {
    const hungry = resident({
      id: 'dag',
      name: 'Dag',
      owner: 'me',
      order: {
        kind: 'fetch',
        goods: { food: 6 },
        from: place,
        phase: 'walking',
        path: way,
        progress: 0,
      },
    })
    const lost = resident({
      id: 'eli',
      name: 'Eli',
      owner: 'me',
      order: {
        kind: 'store',
        goods: { iron: 2 },
        to: place,
        phase: 'walking',
        path: null,
        progress: 0,
      },
    })
    expect(onTheWay([hungry, lost])!.rows.map((r) => r.detail)).toEqual([
      'Getting food · 2 tiles to go',
      'Store · 2 iron · finding the way',
    ])
  })

  it('lists a haul route’s driver heading there, with what the carriage brings and takes', () => {
    const haul = (stop: 'from' | 'to', phase: 'driving' | 'loading') =>
      resident({
        id: `fen-${stop}`,
        name: 'Fen',
        owner: 'me',
        order: {
          kind: 'haul',
          carriageId: 'k1',
          from: { x: 5, y: 5 },
          to: { x: 20, y: 20 },
          goods: ['wood'],
          returnGoods: ['iron'],
          keepFood: 0,
          stop,
          phase,
          path: way,
          progress: 0,
          moving: null,
        },
      })
    expect(onTheWay([haul('from', 'driving')])!.rows[0]!.detail).toBe(
      'Haul · brings iron · takes wood · 2 tiles to go',
    )
    // Driving to the other stop, or loading here already, is not on the way.
    expect(onTheWay([haul('to', 'driving'), haul('from', 'loading')])).toBeUndefined()
  })

  it('leaves out strangers, those there already, and those going elsewhere', () => {
    const stranger = { ...ben, id: 'x', owner: 'them' }
    const there = resident({
      id: 'gil',
      owner: 'me',
      order: { kind: 'store', goods: {}, to: place, phase: 'putting', path: null, progress: 0 },
    })
    const elsewhere = resident({
      id: 'hal',
      owner: 'me',
      order: {
        kind: 'store',
        goods: {},
        to: { kind: 'storage', storageId: 'other' },
        phase: 'walking',
        path: way,
        progress: 0,
      },
    })
    expect(onTheWay([stranger, there, elsewhere])).toBeUndefined()
  })

  it('lists who comes to a stable too, not to another building', () => {
    const stable = building({ kind: 'stable', cityId: 'c-me', stock: { food: 0 } })
    const feeding = resident({
      id: 'ida',
      name: 'Ida',
      owner: 'me',
      order: {
        kind: 'store',
        goods: { food: 10 },
        to: { kind: 'storage', storageId: stable.id },
        phase: 'walking',
        path: way,
        progress: 0,
      },
    })
    expect(onTheWay([feeding], { buildings: [stable] })!.rows[0]!.detail).toBe(
      'Store · 10 food · 2 tiles to go',
    )
    const house = building({ kind: 'house', cityId: 'c-me', id: stable.id })
    expect(onTheWay([feeding], { buildings: [house] })).toBeUndefined()
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
