import {
  CRIME_STANDING_LOSS,
  FOOD_PER_DAY,
  MAP_SIZE,
  OWN_FOOD,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  Terrain,
  WALK_TICKS_PER_TILE,
  carryCapacity,
  inCityArea,
  isArmed,
  standingOf,
  stockFloor,
  stockWeight,
  townHallOf,
  tradeOrgRefuses,
  tripFood,
  warehouseKeeps,
  type City,
  type Crime,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { attackOrder } from './combat.js'
import { carriageOrganization } from './crimes.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import {
  punishmentsSound,
  stepPunishments,
  takenBy,
  tookSoFar,
  worthOf,
} from './trade-org-punishment.js'
import { refusedTradeNothing, tradesOf } from './trading.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Where the HQ's town hall stands. */
const MID = 320

/**
 * The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 4 soldiers; realm r1 (Player 7,
 * Leader a1) with city c1 south of it, its storage s1 holding `stock`, and a far city c2 east.
 */
function setup(stock: Stock = { coins: 1000, iron: 40 }) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 88, name: 'Ashford' })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: MID + 4, y: MID + 88, stock })
  addCity(world, { id: 'c2', realmId: 'r1', x: MID + 240, y: MID, name: 'Farhold' })
  resident(world, 'a1', MID - 4, MID + 92, 'c1')
  const soldiers = hqPeople(world, hq).slice(0, TRADE_ORG_ARMY.guard + 4)
  for (const r of soldiers) r.carried.spear = 1
  return { world, hq, queue: new OrderQueue(undefined, terrain), walking: new Walking(terrain) }
}

/** A grown resident of realm r1. */
function resident(world: WorldState, id: string, x: number, y: number, cityId: string | null) {
  const r = newResident(mulberry32(world.residents.length + 1), {
    id,
    owner: 'r1',
    cityId,
    x,
    y,
    tick: 0,
  })
  r.bornAt = -20 * 24 * 3600
  r.lifespan = 60
  world.residents.push(r)
  return r
}

/** The HQ's own residents. */
const hqPeople = (world: WorldState, hq: City) =>
  world.residents.filter((r) => r.owner === null && r.cityId === hq.id)

/**
 * A1 of r1 stole `goods` from the HQ near c1, and a witness has brought the news home: the
 * Trade Organization knows of it and holds r1 lower for it.
 */
function theft(world: WorldState, hq: City, goods: Stock): Crime {
  const crime: Crime = {
    id: `x${world.crimes.length + 1}`,
    kind: 'theft',
    tick: world.tick,
    x: MID,
    y: MID + 60,
    culprit: { residentId: 'a1', name: 'Aldo', org: 'r1', orgName: 'the realm of Aldo' },
    victimOrg: hq.id,
    goods,
    witnesses: [],
    knownBy: [hq.id],
  }
  world.crimes.push(crime)
  changeStanding(world, hq.id, 'r1', -CRIME_STANDING_LOSS.theft)
  return crime
}

/** The HQ's warehouse that keeps `good`. */
function warehouseFor(world: WorldState, hq: City, good: 'coins' | 'iron') {
  return world.buildings.find((b) => b.cityId === hq.id && warehouseKeeps(world, b).includes(good))!
}

/** Steps the world, keeping everyone fed, and checks every invariant now and then. */
function run(world: WorldState, walking: Walking, ticks: number, until?: () => boolean) {
  for (let i = 0; i < ticks; i++) {
    for (const r of world.residents) r.hunger = 100
    stepWorld(world, terrain, walking)
    if (i % 200 === 0) expect(checkInvariants(world, terrain)).toEqual([])
    if (until?.()) break
  }
  expect(checkInvariants(world, terrain)).toEqual([])
}

/** Sends an order from the Player, applies it and answers whether it was taken. */
function order(world: WorldState, queue: OrderQueue, o: Record<string, unknown>) {
  const answer = queue.receive(world, player, 'q', { kind: 'x', ...o })
  queue.applyAll(world)
  return answer.type === 'ack' ? 'ack' : (answer as { reason: string }).reason
}

const at = (world: WorldState, id: string) => world.residents.find((r) => r.id === id)!

describe('the Trade Organization refusing trade', () => {
  /** A1 standing on the HQ's goods warehouse with coins to buy iron. */
  function atWarehouse() {
    const s = setup()
    const w = warehouseFor(s.world, s.hq, 'iron')
    const a1 = at(s.world, 'a1')
    a1.x = w.x
    a1.y = w.y
    a1.carried.coins = 200
    return s
  }

  const buyIron = { kind: 'buy', residentId: 'a1', good: 'iron', units: 1 }

  it('trades no more once it holds the realm below its threshold', () => {
    const { world, hq, queue } = atWarehouse()
    changeStanding(world, TRADE_ORG, 'r1', TRADE_ORG_REFUSES_TRADE_BELOW)
    expect(tradeOrgRefuses(world, 'r1')).toBe(false)
    expect(order(world, queue, buyIron)).toBe('ack')
    // One theft known to it is enough.
    theft(world, hq, { iron: 1 })
    expect(tradeOrgRefuses(world, 'r1')).toBe(true)
    expect(order(world, queue, buyIron)).toBe('the Trade Organization won’t trade with you')
    expect(order(world, queue, { ...buyIron, kind: 'sell' })).toBe(
      'the Trade Organization won’t trade with you',
    )
  })

  it('carries out no trade ordered before it came to refuse the realm', () => {
    const { world, hq, queue, walking } = atWarehouse()
    expect(order(world, queue, buyIron)).toBe('ack')
    theft(world, hq, { iron: 1 })
    run(world, walking, 1)
    expect(at(world, 'a1').carried).toMatchObject({ coins: 200 })
    expect(at(world, 'a1').carried.iron).toBeUndefined()
  })

  it('hires out no soldiers to the realm and asks none of its residents', () => {
    const { world, hq, queue, walking } = atWarehouse()
    theft(world, hq, { iron: 1 })
    // Over the threshold for punishing, so the army stays home.
    changeStanding(world, TRADE_ORG, 'r1', 3)
    expect(
      order(world, queue, {
        kind: 'offerContract',
        realmId: TRADE_ORG,
        soldiers: 1,
        days: 7,
        pricePerWeek: TRADE_ORG_ARMY.pricePerSoldierWeek,
        storageId: warehouseFor(world, hq, 'coins').id,
      }),
    ).toBe('ack')
    run(world, walking, 1)
    expect(world.contracts).toEqual([])
    expect(world.events.at(-1)).toMatchObject({ kind: 'contract', what: 'declined' })
  })

  it('reports a trade by a realm it refuses', () => {
    const { world, queue, walking } = atWarehouse()
    expect(order(world, queue, buyIron)).toBe('ack')
    run(world, walking, 1)
    expect(refusedTradeNothing.check(world, terrain)).toEqual([])
    tradesOf(world)[0]!.refused = true
    expect(refusedTradeNothing.check(world, terrain)).toHaveLength(1)
  })
})

describe('the Trade Organization punishing', () => {
  it('takes twice the loss from the culprit’s nearest city and goes home without capturing it', () => {
    const { world, hq, walking } = setup()
    const coins = warehouseFor(world, hq, 'coins')
    const before = coins.stock!.coins ?? 0
    theft(world, hq, { iron: 10 })
    const worth = TRADE_ORG_PUNISH.times * worthOf({ iron: 10 })
    run(world, walking, 1)
    const p = world.punishments[0]!
    expect(p).toMatchObject({ culpritOrg: 'r1', cityId: 'c1', worth, heading: 'out' })
    expect(p.members).toHaveLength(4)
    expect(world.events.at(-1)).toMatchObject({ kind: 'punished', what: 'coming', city: 'Ashford' })
    const ids = p.members.map((m) => m.residentId)
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => world.punishments.length === 0)
    expect(world.punishments).toEqual([])
    // Coins first: the storage had enough, so it took nothing else.
    const s1 = world.buildings.find((b) => b.id === 's1')!
    expect(s1.stock).toEqual({ coins: 1000 - worth, iron: 40 })
    expect(coins.stock!.coins).toBe(before + worth)
    // It never captured the city, and its soldiers are home again.
    expect(world.cities.find((c) => c.id === 'c1')!.realmId).toBe('r1')
    for (const id of ids)
      expect(inCityArea(world, hq, at(world, id).x, at(world, id).y, 160)).toBe(true)
    expect(world.events.at(-1)).toMatchObject({ kind: 'punished', what: 'left', took: worth })
    // The crime is punished: it doesn't come again.
    run(world, walking, 1)
    expect(world.punishments).toEqual([])
  }, 240_000)

  it('takes goods once the coins run out, the most worth first', () => {
    const { world, hq, walking } = setup({ coins: 30, wood: 50, iron: 40 })
    const goods = warehouseFor(world, hq, 'iron')
    // Nobody but its soldiers, and at its floor in every good, so its own chain (`CONTEXT.md`: Trade
    // Org HQ) leaves its Iron be for as long as the trip takes.
    world.residents = world.residents.filter((r) => r.owner !== null || isArmed(r))
    goods.stock = { ...stockFloor(world, goods), ...goods.stock }
    const iron = goods.stock!.iron ?? 0
    theft(world, hq, { iron: 4 })
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => world.punishments.length === 0)
    // 80 coins' worth: the 30 coins, then 5 iron.
    const s1 = world.buildings.find((b) => b.id === 's1')!
    expect(s1.stock).toEqual({ wood: 50, iron: 35 })
    expect(goods.stock!.iron).toBe(iron + 5)
  }, 240_000)

  it('sends nobody while it holds the culprit above its threshold for punishing', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    changeStanding(world, TRADE_ORG, 'r1', 5)
    expect(standingOf(world, TRADE_ORG, 'r1')).toBeGreaterThanOrEqual(TRADE_ORG_PUNISHES_BELOW)
    stepPunishments(world, 160)
    expect(world.punishments).toEqual([])
  })

  it('waits while it has no soldier to spare', () => {
    const { world, hq } = setup()
    for (const r of hqPeople(world, hq).slice(TRADE_ORG_ARMY.guard)) delete r.carried.spear
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 160)
    expect(world.punishments).toEqual([])
    expect(world.crimes[0]!.punished).toBeUndefined()
  })

  it('goes for the culprit’s city nearest the crime', () => {
    const { world, hq } = setup()
    const crime = theft(world, hq, { iron: 10 })
    crime.x = MID + 220
    crime.y = MID
    stepPunishments(world, 160)
    expect(world.punishments[0]!.cityId).toBe('c2')
  })

  it('fights whoever attacks its soldiers', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 160)
    const target = world.punishments[0]!.members[0]!.residentId
    const defender = resident(world, 'd1', MID, MID + 80, 'c1')
    defender.carried.spear = 1
    defender.order = attackOrder(target)
    stepPunishments(world, 160)
    for (const { residentId } of world.punishments[0]!.members) {
      expect(at(world, residentId).order).toMatchObject({ kind: 'attack', targetId: 'd1' })
    }
  })

  it('leaves the members of a punishment to it, not to the HQ', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    run(world, walking, 2)
    for (const { residentId } of world.punishments[0]!.members) {
      expect(at(world, residentId).order?.kind).toBe('walkTo')
    }
  })

  it('reports a punishment that doesn’t hold together', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 160)
    expect(punishmentsSound.check(world, terrain)).toEqual([])
    const p = world.punishments[0]!
    world.punishments.push({ ...p, id: 'p2', members: [p.members[0]!] })
    p.members.push({ residentId: 'a1', own: {} })
    world.cities[0]!.realmId = TRADE_ORG
    const messages = punishmentsSound.check(world, terrain).map((v) => v.message)
    expect(messages).toEqual(
      expect.arrayContaining([
        'r1 is punished twice at once',
        `${p.members[0]!.residentId} is in two punishments`,
        `punishment ${p.id} sends a1, who is not of the Trade Org HQ`,
        `the Trade Organization holds city ${world.cities[0]!.id}`,
      ]),
    )
  })
})

describe('the Trade Organization’s punishment trip', () => {
  /** As large as the real map, all Plains. */
  const big: TerrainMap = {
    size: MAP_SIZE,
    tiles: new Uint8Array(MAP_SIZE * MAP_SIZE).fill(Terrain.Plains),
  }
  /** The HQ's town hall, on the big map. */
  const HQ = 200
  /** The farthest a city can be: half the map away on both axes, on a torus. */
  const FAR = MAP_SIZE / 2

  /**
   * On the big map: the Trade Org HQ with nobody but `TRADE_ORG_ARMY.guard` + `soldiers` soldiers
   * of average Strength and Endurance, and realm r1 with its city c1 as far off as a city can be,
   * its storage s1 holding `stock`.
   */
  function farSetup(stock: Stock, soldiers = 4) {
    const world = createWorld(big)
    const hq = foundTradeOrgHq(world, big, HQ, HQ, mulberry32(7))
    world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
    addCity(world, { id: 'c1', realmId: 'r1', x: HQ + FAR, y: HQ + FAR, name: 'Ashford' })
    world.buildings.push({
      id: 's1',
      kind: 'storage',
      cityId: 'c1',
      x: HQ + FAR + 4,
      y: HQ + FAR,
      stock,
    })
    resident(world, 'a1', HQ + FAR - 4, HQ + FAR + 4, 'c1')
    const keep = hqPeople(world, hq).slice(0, TRADE_ORG_ARMY.guard + soldiers)
    world.residents = world.residents.filter((r) => r.cityId !== hq.id || keep.includes(r))
    world.caravans = []
    for (const r of keep) {
      r.carried = { spear: 1 }
      const average = { base: 10, trained: 0 }
      r.stats = { ...r.stats, strength: average, endurance: average, agility: average }
      r.bornAt = -20 * 24 * 3600
      r.lifespan = 60
    }
    return { world, hq, walking: new Walking(big) }
  }

  /** Steps the world on the big map until `until` holds, with the residents' real hunger. */
  function runBig(world: WorldState, walking: Walking, until: () => boolean, most: number) {
    for (let i = 0; i < most && !until(); i++) stepWorld(world, big, walking)
  }

  const lastPunished = (world: WorldState) => world.events.filter((e) => e.kind === 'punished')

  it(
    'walks to a city farther than its time there, robs it and comes home alive',
    { tags: ['slow'], timeout: 900_000 },
    () => {
      const { world, hq, walking } = farSetup({ coins: 1000, food: 200 })
      expect(FAR * Math.SQRT2 * WALK_TICKS_PER_TILE).toBeGreaterThan(
        TRADE_ORG_PUNISH.giveUpDays * TICKS_PER_GAME_DAY,
      )
      theft(world, hq, { iron: 10 })
      const worth = TRADE_ORG_PUNISH.times * worthOf({ iron: 10 })
      runBig(world, walking, () => world.punishments.length > 0, 2)
      const p = world.punishments[0]!
      const ids = p.members.map((m) => m.residentId)
      const c1 = world.cities.find((c) => c.id === 'c1')!
      // At average Strength, what they pack lasts the longest way there and back over Plains.
      runBig(world, walking, () => p.members.every((m) => m.packed), 2000)
      runBig(world, walking, () => false, 2)
      const flatWalk = (2 * FAR * Math.SQRT2 * WALK_TICKS_PER_TILE) / TICKS_PER_GAME_DAY
      for (const id of ids) {
        expect(at(world, id).carried.food ?? 0).toBeGreaterThanOrEqual(flatWalk * FOOD_PER_DAY)
      }
      runBig(
        world,
        walking,
        () => p.arrivedAt !== undefined || world.punishments.length === 0,
        70_000,
      )
      expect(p.arrivedAt).toBeDefined()
      expect(
        ids.some((id) => inCityArea(world, c1, at(world, id).x, at(world, id).y, MAP_SIZE)),
      ).toBe(true)
      runBig(world, walking, () => world.punishments.length === 0, 70_000)
      expect(world.punishments).toEqual([])
      expect(world.buildings.find((b) => b.id === 's1')!.stock!.coins).toBe(1000 - worth)
      for (const id of ids) {
        const r = at(world, id)
        expect(r.health).toBeGreaterThan(0)
        expect(r.downUntil).toBeUndefined()
        expect(inCityArea(world, hq, r.x, r.y, MAP_SIZE)).toBe(true)
      }
      expect(lastPunished(world).map((e) => e.kind === 'punished' && e.what)).toEqual([
        'coming',
        'arrived',
        'left',
      ])
      expect(lastPunished(world).at(-1)).toMatchObject({ what: 'left', took: worth })
      expect(checkInvariants(world, big)).toEqual([])
    },
  )

  it('sets out however empty the storages are as it leaves, and looks when it arrives', () => {
    const { world, hq, walking } = setup({})
    theft(world, hq, { iron: 10 })
    run(world, walking, 3)
    const p = world.punishments[0]!
    expect(p).toMatchObject({ heading: 'out' })
    expect(p.arrivedAt).toBeUndefined()
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => p.heading === 'home')
    expect(p.arrivedAt).toBeDefined()
    expect(world.events.filter((e) => e.kind === 'punished').at(-1)).toMatchObject({
      what: 'left',
      why: 'empty',
      took: 0,
    })
    expect(world.events.some((e) => e.kind === 'punished' && e.what === 'arrived')).toBe(true)
  }, 240_000)

  it('robs storages filled again while it was on the way', () => {
    const { world, hq, walking } = setup({})
    theft(world, hq, { iron: 10 })
    run(world, walking, 3)
    world.buildings.find((b) => b.id === 's1')!.stock = { coins: 1000 }
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => world.punishments.length === 0)
    expect(world.buildings.find((b) => b.id === 's1')!.stock!.coins).toBeLessThan(1000)
  }, 240_000)

  it('turns back on the road when the city is no longer the culprit’s, and says so', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    run(world, walking, 3)
    const p = world.punishments[0]!
    world.cities.find((c) => c.id === 'c1')!.realmId = null
    stepPunishments(world, 640)
    expect(p).toMatchObject({ heading: 'home', took: 0 })
    expect(p.arrivedAt).toBeUndefined()
    expect(world.events.filter((e) => e.kind === 'punished').at(-1)).toMatchObject({
      what: 'turnedBack',
      why: 'cityLost',
      city: 'Ashford',
    })
  })

  it('says the army was lost when every soldier falls on the way', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    run(world, walking, 3)
    const p = world.punishments[0]!
    world.residents = world.residents.filter((r) => !p.members.some((m) => m.residentId === r.id))
    run(world, walking, 1)
    expect(world.punishments).toEqual([])
    expect(world.events.filter((e) => e.kind === 'punished').at(-1)).toMatchObject({
      what: 'lost',
      where: 'wayThere',
    })
  })

  it('turns back when it can’t get there, rather than walking forever', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 640)
    const p = world.punishments[0]!
    world.tick = p.startedAt + TRADE_ORG_PUNISH.giveUpDays * TICKS_PER_GAME_DAY
    stepPunishments(world, 640)
    expect(p.heading).toBe('home')
    expect(world.events.filter((e) => e.kind === 'punished').at(-1)).toMatchObject({
      what: 'turnedBack',
      why: 'noWay',
    })
  })

  it('packs Food for the way there and back at the HQ, leaving room to carry goods home', () => {
    const { world, hq, walking } = setup()
    const crime = theft(world, hq, { iron: 10 })
    crime.x = MID + 220
    crime.y = MID
    const food = () => world.buildings.find((b) => b.cityId === hq.id && b.kind === 'storage')!
    const before = food().stock!.food!
    run(world, walking, 1)
    const p = world.punishments[0]!
    expect(p.cityId).toBe('c2')
    run(world, walking, 2000, () => p.members.every((m) => m.packed))
    run(world, walking, 2)
    const wanted = tripFood(2 * 240) + TRADE_ORG_PUNISH.giveUpDays * FOOD_PER_DAY
    for (const m of p.members) {
      const r = at(world, m.residentId)
      expect(r.carried.food ?? 0).toBeGreaterThanOrEqual(wanted - 1)
      expect(carryCapacity(r, world.tick) - stockWeight(r.carried)).toBeGreaterThanOrEqual(
        TRADE_ORG_PUNISH.packRoom,
      )
    }
    expect(food().stock!.food!).toBeLessThan(before)
    // What they packed is theirs, not what they came to take.
    expect(tookSoFar(world, p)).toBe(0)
  }, 240_000)

  it('packs from its goods warehouse when its storage has no Food', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    world.buildings.find((b) => b.cityId === hq.id && b.kind === 'storage')!.stock = {}
    const warehouse = warehouseFor(world, hq, 'iron')
    warehouse.stock = { ...warehouse.stock, food: 200 }
    run(world, walking, 1)
    const p = world.punishments[0]!
    run(world, walking, 2000, () => p.members.every((m) => m.packed))
    run(world, walking, 2)
    for (const m of p.members) {
      expect(at(world, m.residentId).carried.food ?? 0).toBeGreaterThan(OWN_FOOD)
    }
    expect(warehouse.stock.food!).toBeLessThan(200)
  }, 240_000)

  it('sets out with what it has when the HQ has no Food at all', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    for (const b of world.buildings) {
      if (b.cityId === hq.id && b.stock) delete b.stock.food
    }
    world.residents = world.residents.filter((r) => r.owner !== null || isArmed(r))
    run(world, walking, 3)
    const p = world.punishments[0]!
    expect(p.members.every((m) => m.packed)).toBe(true)
    expect(at(world, p.members[0]!.residentId).order?.kind).toBe('walkTo')
  })

  it('never packs into the room it leaves for what it carries home', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    run(world, walking, 1)
    const p = world.punishments[0]!
    // Weak, and sent so far the walk's Food alone wouldn't fit.
    p.cityId = 'c2'
    for (const m of p.members) at(world, m.residentId).stats.strength = { base: 1, trained: 0 }
    run(world, walking, 2000, () => p.members.every((m) => m.packed))
    run(world, walking, 2)
    for (const m of p.members) {
      const r = at(world, m.residentId)
      expect(carryCapacity(r, world.tick) - stockWeight(r.carried)).toBeGreaterThanOrEqual(
        TRADE_ORG_PUNISH.packRoom,
      )
    }
  }, 240_000)

  it('refills at a trading post it passes, which is no theft', () => {
    const { world, hq, walking } = setup()
    theft(world, hq, { iron: 10 })
    run(world, walking, 1)
    const p = world.punishments[0]!
    const m = p.members[0]!
    const r = at(world, m.residentId)
    addCity(world, { id: 'post', realmId: null, x: MID, y: MID + 60, name: 'Waypost' })
    world.cities.find((c) => c.id === 'post')!.tradeOrg = 'post'
    world.buildings.push({
      id: 'ps',
      kind: 'storage',
      cityId: 'post',
      x: MID + 8,
      y: MID + 60,
      stock: { food: 50 },
    })
    for (const each of p.members) each.packed = true
    r.x = MID + 2
    r.y = MID + 40
    r.carried.food = 0
    m.own.food = 0
    const crimes = world.crimes.length
    run(world, walking, 400, () => (r.carried.food ?? 0) >= 2)
    expect(r.carried.food ?? 0).toBeGreaterThanOrEqual(2)
    expect(world.buildings.find((b) => b.id === 'ps')!.stock!.food!).toBeLessThan(50)
    expect(world.crimes.length).toBe(crimes)
    expect(takenBy(r, m.own)).toEqual({})
  })

  it('takes Food for the way back at the city, apart from what it came for', () => {
    const { world, hq, walking } = setup({ coins: 1000, food: 40 })
    theft(world, hq, { iron: 10 })
    const worth = TRADE_ORG_PUNISH.times * worthOf({ iron: 10 })
    run(world, walking, 1)
    const p = world.punishments[0]!
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => p.arrivedAt !== undefined)
    // Worn down to what they need on the way back: nothing left of what they packed.
    for (const m of p.members) {
      at(world, m.residentId).carried.food = 0
      m.own.food = 0
    }
    run(world, walking, 4 * TICKS_PER_GAME_DAY, () => p.heading === 'home')
    expect(p.took).toBe(worth)
    expect(world.buildings.find((b) => b.id === 's1')!.stock!.food ?? 0).toBeLessThan(40)
  }, 240_000)

  it('reports a punishment that took anything before it arrived', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 640)
    const p = world.punishments[0]!
    expect(punishmentsSound.check(world, terrain)).toEqual([])
    p.took = 5
    expect(punishmentsSound.check(world, terrain).map((v) => v.message)).toContain(
      `punishment ${p.id} took ${p.took} before it arrived`,
    )
    p.arrivedAt = p.startedAt - 1
    expect(punishmentsSound.check(world, terrain).map((v) => v.message)).toContain(
      `punishment ${p.id} arrived before it set out`,
    )
  })
})

describe('a caravan', () => {
  it('belongs to the HQ, so robbing it is a crime against the Trade Organization', () => {
    const { world, hq } = setup()
    const hall = townHallOf(world, hq)!
    world.carriages.push({
      id: 'k1',
      realmId: null,
      cityId: hq.id,
      x: hall.x,
      y: hall.y,
      horseId: null,
      load: {},
    })
    expect(carriageOrganization(world.carriages.at(-1)!)).toBe(hq.id)
  })
})
