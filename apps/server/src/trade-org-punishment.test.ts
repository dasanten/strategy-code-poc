import {
  CRIME_STANDING_LOSS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_PUNISH,
  TRADE_ORG_PUNISHES_BELOW,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  Terrain,
  inCityArea,
  standingOf,
  townHallOf,
  tradeOrgRefuses,
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
import { punishmentsSound, stepPunishments, worthOf } from './trade-org-punishment.js'
import { refusedTradeNothing, tradesOf } from './trading.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 160, tiles: new Uint8Array(160 * 160).fill(Terrain.Plains) }
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Where the HQ's town hall stands. */
const MID = 80

/**
 * The Trade Org HQ at (MID, MID) with `TRADE_ORG_ARMY.guard` + 4 soldiers; realm r1 (Player 7,
 * Leader a1) with city c1 south of it, its storage s1 holding `stock`, and a far city c2 east.
 */
function setup(stock: Stock = { coins: 1000, iron: 40 }) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 22, name: 'Ashford' })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: MID + 1, y: MID + 22, stock })
  addCity(world, { id: 'c2', realmId: 'r1', x: MID + 60, y: MID, name: 'Farhold' })
  resident(world, 'a1', MID - 1, MID + 23, 'c1')
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
    y: MID + 15,
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
    crime.x = MID + 55
    crime.y = MID
    stepPunishments(world, 160)
    expect(world.punishments[0]!.cityId).toBe('c2')
  })

  it('fights whoever attacks its soldiers', () => {
    const { world, hq } = setup()
    theft(world, hq, { iron: 10 })
    stepPunishments(world, 160)
    const target = world.punishments[0]!.members[0]!.residentId
    const defender = resident(world, 'd1', MID, MID + 20, 'c1')
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
