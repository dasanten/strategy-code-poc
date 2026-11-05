import {
  CRIME_STANDING_LOSS,
  TRADE_ORG_ARMY,
  TRADE_ORG_LOSS,
  TRADE_ORG_PUNISH,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  TRADE_ORG,
  Terrain,
  debtOf,
  diplomacyFor,
  townHallOf,
  tradeOrgRefuses,
  warehouseKeeps,
  type Building,
  type City,
  type Crime,
  type Stock,
  type TerrainMap,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { captureCity } from './capture.js'
import { giveDirective } from './directives.js'
import { nothingLeftOfTheHq } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { OrderQueue } from './orders.js'
import { mulberry32, newResident } from './residents.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { foundTradeOrgHq } from './trade-org.js'
import {
  debtOrdersDone,
  debtPaymentsOf,
  debtPaymentsSound,
  debtsSound,
  stepDebts,
} from './trade-org-debt.js'
import { lossOf, stepPunishments, worthOf } from './trade-org-punishment.js'
import { Walking } from './walking.js'
import { createWorld, stepWorld } from './world.js'

const terrain: TerrainMap = { size: 640, tiles: new Uint8Array(640 * 640).fill(Terrain.Plains) }
const size = terrain.size
const player = { userId: 7, account: { name: 'Mara', isAdmin: false } }

/** Where the HQ's town hall stands. */
const MID = 320

/** What the army comes for after a theft of 10 Iron. */
const WORTH = TRADE_ORG_PUNISH.times * worthOf({ iron: 10 })

/** The Trade Org HQ; realm r1 (Player 7, Leader a1) with city c1, its storage s1 holding `stock`. */
function setup(stock: Stock = {}) {
  const world = createWorld(terrain)
  const hq = foundTradeOrgHq(world, terrain, MID, MID, mulberry32(7))
  world.realms.push({ id: 'r1', userId: 7, leaderId: 'a1' })
  addCity(world, { id: 'c1', realmId: 'r1', x: MID, y: MID + 88, name: 'Ashford' })
  world.buildings.push({ id: 's1', kind: 'storage', cityId: 'c1', x: MID + 4, y: MID + 88, stock })
  const a1 = newResident(mulberry32(1), {
    id: 'a1',
    owner: 'r1',
    cityId: 'c1',
    x: MID - 4,
    y: MID + 92,
    tick: 0,
  })
  a1.bornAt = -20 * 24 * 3600
  a1.lifespan = 60
  world.residents.push(a1)
  const soldiers = world.residents.filter((r) => r.owner === null && r.cityId === hq.id)
  for (const r of soldiers.slice(0, TRADE_ORG_ARMY.guard + 4)) r.carried.spear = 1
  return {
    world,
    hq,
    a1,
    city: world.cities.find((c) => c.id === 'c1')!,
    queue: new OrderQueue(undefined, terrain),
    walking: new Walking(terrain),
  }
}

/** A1 of r1 stole `goods` from the HQ, and the Trade Organization knows of it. */
function theft(world: WorldState, hq: City, goods: Stock = { iron: 10 }): Crime {
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

/** Sends the army out for a theft and stands it in the city, ready to look in its storages. */
function armyAtTheCity(world: WorldState, hq: City, city: City) {
  theft(world, hq)
  stepPunishments(world, size)
  const p = world.punishments[0]!
  const hall = townHallOf(world, city)!
  for (const m of p.members) {
    const r = world.residents.find((x) => x.id === m.residentId)!
    r.x = hall.x
    r.y = hall.y
    m.packed = true
  }
  return p
}

const debtEvents = (world: WorldState) =>
  world.events.filter((e) => e.kind === 'debt' || e.kind === 'debtPaid')

describe('what the army can’t take', () => {
  it('stays owed after an empty trip, from when it heads home', () => {
    const { world, hq, city } = setup()
    const p = armyAtTheCity(world, hq, city)
    expect(world.debts).toEqual([])
    stepPunishments(world, size)
    expect(p.heading).toBe('home')
    expect(world.debts).toEqual([{ org: 'r1', coins: WORTH, cityId: 'c1' }])
    expect(world.events.at(-1)).toMatchObject({
      kind: 'debt',
      what: 'owed',
      coins: WORTH,
      owed: WORTH,
    })
    expect(world.events.at(-2)).toMatchObject({ kind: 'punished', what: 'left', why: 'empty' })
    expect(debtsSound.check(world, terrain)).toEqual([])
  })

  it('leaves only what it didn’t take', () => {
    const { world, hq, city } = setup()
    const p = armyAtTheCity(world, hq, city)
    const member = world.residents.find((r) => r.id === p.members[0]!.residentId)!
    member.carried.coins = (member.carried.coins ?? 0) + 30
    stepPunishments(world, size)
    expect(p.took).toBe(30)
    expect(debtOf(world, 'r1')).toBe(WORTH - 30)
  })

  it('leaves nothing once it got what it came for', () => {
    const { world, hq, city } = setup()
    const p = armyAtTheCity(world, hq, city)
    const member = world.residents.find((r) => r.id === p.members[0]!.residentId)!
    member.carried.coins = (member.carried.coins ?? 0) + WORTH
    stepPunishments(world, size)
    expect(p.heading).toBe('home')
    expect(world.debts).toEqual([])
    expect(debtEvents(world)).toEqual([])
  })

  it('leaves all of it when it turned back on the road', () => {
    const { world, hq } = setup()
    theft(world, hq)
    stepPunishments(world, size)
    const p = world.punishments[0]!
    p.startedAt = world.tick - 100_000_000
    stepPunishments(world, size)
    expect(p.heading).toBe('home')
    expect(world.events.some((e) => e.kind === 'punished' && e.what === 'turnedBack')).toBe(true)
    expect(debtOf(world, 'r1')).toBe(WORTH)
  })

  it('leaves all of it when the army is lost before it heads home, once when lost after', () => {
    const lost = setup()
    const out = armyAtTheCity(lost.world, lost.hq, lost.city)
    const ids = new Set(out.members.map((m) => m.residentId))
    lost.world.residents = lost.world.residents.filter((r) => !ids.has(r.id))
    stepPunishments(lost.world, size)
    expect(debtOf(lost.world, 'r1')).toBe(WORTH)

    const home = setup()
    const p = armyAtTheCity(home.world, home.hq, home.city)
    stepPunishments(home.world, size)
    expect(p.heading).toBe('home')
    const homeIds = new Set(p.members.map((m) => m.residentId))
    home.world.residents = home.world.residents.filter((r) => !homeIds.has(r.id))
    stepPunishments(home.world, size)
    expect(home.world.punishments).toEqual([])
    expect(debtOf(home.world, 'r1')).toBe(WORTH)
  })

  it('is owed in whole Coins', () => {
    const { world, hq, city } = setup()
    const p = armyAtTheCity(world, hq, city)
    p.worth = WORTH + 0.5
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH + 1)
  })

  it('is nothing for an army sent by admin directive', () => {
    const { world, city } = setup()
    const d = giveDirective(
      world,
      {
        target: 'r1',
        withAlliance: false,
        reason: 'farms new Players',
        price: null,
        goals: [{ kind: 'soldiers', count: 1000 }],
      },
      'Daniel',
    )
    if (typeof d === 'string') throw new Error(d)
    stepPunishments(world, size)
    const p = world.punishments[0]!
    expect(p.directiveId).toBe(d.id)
    const hall = townHallOf(world, city)!
    for (const m of p.members) {
      const r = world.residents.find((x) => x.id === m.residentId)!
      r.x = hall.x
      r.y = hall.y
      m.packed = true
    }
    stepPunishments(world, size)
    expect(p.heading).toBe('home')
    expect(world.debts).toEqual([])
  })
})

describe('later crimes', () => {
  /** R1 owing what an empty trip left, with that army gone. */
  function owing() {
    const s = setup()
    armyAtTheCity(s.world, s.hq, s.city)
    stepPunishments(s.world, size)
    s.world.punishments = []
    return s
  }

  it('add what they cost, once, and send no army', () => {
    const { world, hq } = owing()
    const crime = theft(world, hq, { iron: 5 })
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH + lossOf(crime))
    expect(crime.punished).toBe(true)
    expect(world.punishments).toEqual([])
    expect(world.events.at(-1)).toMatchObject({
      kind: 'debt',
      what: 'rose',
      coins: lossOf(crime),
      owed: WORTH + lossOf(crime),
    })
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH + lossOf(crime))
  })

  it('count other crimes too, at what they cost', () => {
    const { world, hq } = owing()
    const crime = theft(world, hq)
    crime.kind = 'killing'
    delete crime.goods
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH + TRADE_ORG_LOSS.killing)
  })

  it('wait until the Trade Organization knows of them', () => {
    const { world, hq } = owing()
    const crime = theft(world, hq, { iron: 5 })
    crime.knownBy = []
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH)
    crime.knownBy = [hq.id]
    stepPunishments(world, size)
    expect(debtOf(world, 'r1')).toBe(WORTH + lossOf(crime))
  })

  it('send an army again once the debt is paid', () => {
    const { world, hq } = owing()
    world.debts = []
    theft(world, hq, { iron: 5 })
    stepPunishments(world, size)
    expect(world.punishments).toHaveLength(1)
  })
})

describe('paying the debt', () => {
  /** R1 owing `coins`, and a1 on the HQ's goods warehouse with `coins` of their own to pay with. */
  function atWarehouse(owed: number, held: number) {
    const s = setup()
    s.world.debts = [{ org: 'r1', coins: owed }]
    const warehouses = s.world.buildings.filter(
      (b) => b.cityId === s.hq.id && b.kind === 'warehouse',
    )
    const coins = warehouses.find((b) => warehouseKeeps(s.world, b).includes('coins'))!
    const goods = warehouses.find((b) => !warehouseKeeps(s.world, b).includes('coins'))!
    standOn(s.a1, goods)
    s.a1.carried = held > 0 ? { coins: held } : {}
    return { ...s, coins, goods }
  }

  function standOn(r: { x: number; y: number }, b: Pick<Building, 'x' | 'y'>) {
    r.x = b.x
    r.y = b.y
  }

  const pay = (coins: unknown, carriageId: string | null = null) => ({
    kind: 'payDebt',
    residentId: 'a1',
    coins,
    carriageId,
  })

  it('in part leaves the rest owed; the coins go into the coin warehouse', () => {
    const { world, a1, coins, goods, queue, walking } = atWarehouse(100, 70)
    const before = coins.stock!.coins ?? 0
    expect(queue.receive(world, player, 'q', pay(30)).type).toBe('ack')
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.debts).toMatchObject([{ org: 'r1', coins: 70 }])
    expect(a1.carried.coins).toBe(40)
    expect(a1.order).toBeNull()
    expect(coins.stock!.coins).toBe(before + 30)
    expect(goods.stock?.coins).toBeUndefined()
    expect(world.events.filter((e) => e.kind === 'debtPaid')).toEqual([
      expect.objectContaining({ coins: 30, owed: 70, x: goods.x, y: goods.y }),
    ])
    expect(debtPaymentsOf(world)).toHaveLength(1)
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('in full ends it, and takes no more than is owed', () => {
    const { world, a1, queue, walking } = atWarehouse(100, 150)
    expect(queue.receive(world, player, 'q', pay(500)).type).toBe('ack')
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.debts).toEqual([])
    expect(a1.carried.coins).toBe(50)
    expect(world.events.at(-1)).toMatchObject({ kind: 'debtPaid', coins: 100, owed: 0 })
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('takes what they hold when it is less than they offer', () => {
    const { world, a1, queue, walking } = atWarehouse(100, 40)
    queue.receive(world, player, 'q', pay(90))
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(debtOf(world, 'r1')).toBe(60)
    expect(a1.carried.coins).toBeUndefined()
  })

  it('can come from a carriage there', () => {
    const { world, a1, goods, queue, walking } = atWarehouse(100, 0)
    world.carriages.push({
      id: 'k1',
      realmId: 'r1',
      cityId: null,
      x: goods.x,
      y: goods.y,
      horseId: null,
      load: { coins: 100 },
    } as WorldState['carriages'][number])
    expect(queue.receive(world, player, 'q', pay(100, 'k1')).type).toBe('ack')
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.debts).toEqual([])
    expect(world.carriages[0]!.load.coins).toBeUndefined()
    expect(a1.carried.coins).toBeUndefined()
  })

  it('works at the coin warehouse itself, and from a realm it refuses to trade with', () => {
    const { world, a1, coins, queue, walking } = atWarehouse(100, 100)
    standOn(a1, coins)
    changeStanding(world, TRADE_ORG, 'r1', TRADE_ORG_REFUSES_TRADE_BELOW - 1)
    expect(tradeOrgRefuses(world, 'r1')).toBe(true)
    expect(queue.receive(world, player, 'q', pay(100)).type).toBe('ack')
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(world.debts).toEqual([])
  })

  it('is refused with nothing owed, no coins, no whole number, or off a warehouse', () => {
    const { world, a1, goods } = atWarehouse(100, 100)
    const ask = (o: Record<string, unknown>) =>
      new OrderQueue(undefined, terrain).receive(world, player, 'q', o)
    expect(ask(pay(1)).type).toBe('ack')
    for (const bad of [0, -5, 1.5, 'lots']) {
      expect(ask(pay(bad))).toMatchObject({ reason: 'pay a whole number of coins' })
    }
    expect(ask(pay(1, 'nope'))).toMatchObject({ reason: 'not one of your carriages' })
    a1.carried = {}
    expect(ask(pay(1))).toMatchObject({ reason: 'no coins to pay with' })
    a1.carried = { coins: 100 }
    standOn(a1, { x: goods.x + 30, y: goods.y + 30 })
    expect(ask(pay(1))).toMatchObject({ reason: 'not at a Trade Org warehouse' })
    standOn(a1, goods)
    world.debts = []
    expect(ask(pay(1))).toMatchObject({
      reason: 'your realm owes the Trade Organization nothing',
    })
  })

  it('does nothing when the debt was paid since the order', () => {
    const { world, a1, queue, walking } = atWarehouse(100, 100)
    queue.receive(world, player, 'q', pay(100))
    world.debts = []
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(a1.carried.coins).toBe(100)
    expect(a1.order).toBeNull()
    expect(debtPaymentsOf(world)).toEqual([])
    expect(checkInvariants(world, terrain)).toEqual([])
  })

  it('shows in the Player’s diplomacy, and only theirs', () => {
    const { world } = atWarehouse(100, 100)
    expect(diplomacyFor(world, 'r1', [], []).debt).toBe(100)
    world.debts = []
    expect(diplomacyFor(world, 'r1', [], [])).not.toHaveProperty('debt')
    world.debts = [{ org: 'someone else', coins: 5 }]
    expect(diplomacyFor(world, 'r1', [], [])).not.toHaveProperty('debt')
  })
})

describe('the end of a debt', () => {
  it('comes with the Fall of the HQ, with a line in the log', () => {
    const { world, hq } = setup()
    world.realms.push({ id: 'r2', userId: 8, leaderId: 'b1' })
    world.debts = [{ org: 'r1', coins: 100 }]
    captureCity(world, hq, 'r2', size)
    expect(world.debts).toEqual([])
    expect(world.events.filter((e) => e.kind === 'debt')).toEqual([
      expect.objectContaining({ what: 'ended', coins: 100, owed: 0 }),
    ])
    expect(nothingLeftOfTheHq.check(world, terrain)).toEqual([])
    world.debts = [{ org: 'r1', coins: 100 }]
    expect(nothingLeftOfTheHq.check(world, terrain)).toHaveLength(1)
  })

  it('comes with the end of the Organization that owes it', () => {
    const { world } = setup()
    world.debts = [{ org: 'r1', coins: 100 }]
    stepDebts(world)
    expect(world.debts).toHaveLength(1)
    world.realms = []
    stepDebts(world)
    expect(world.debts).toEqual([])
  })
})

describe('the debt invariants', () => {
  it('catch a debt that isn’t positive, of an Organization that is gone, or kept twice', () => {
    const { world, hq } = setup()
    const messages = () => debtsSound.check(world, terrain).map((v) => v.message)
    expect(messages()).toEqual([])
    world.debts = [{ org: 'r1', coins: 0 }]
    expect(messages()).toEqual(['the debt of r1 is 0'])
    world.debts = [{ org: 'r1', coins: -3 }]
    expect(messages()).toEqual(['the debt of r1 is -3'])
    world.debts = [{ org: 'gone', coins: 5 }]
    expect(messages()).toEqual(['gone owes a debt but is gone'])
    world.debts = [{ org: hq.id, coins: 5 }]
    expect(messages()).toEqual([`the Trade Organization owes itself, as ${hq.id}`])
    world.debts = [
      { org: 'r1', coins: 5 },
      { org: 'r1', coins: 6 },
    ]
    expect(messages()).toEqual(['r1 has two debts'])
  })

  it('catch a payment that made or lost coins, or a debt that fell by something else', () => {
    const { world, hq, a1, walking, queue } = setup()
    world.debts = [{ org: 'r1', coins: 100 }]
    const w = world.buildings.find((b) => b.cityId === hq.id && b.kind === 'warehouse')!
    a1.x = w.x
    a1.y = w.y
    a1.carried = { coins: 50 }
    queue.receive(world, player, 'q', {
      kind: 'payDebt',
      residentId: 'a1',
      coins: 50,
      carriageId: null,
    })
    queue.applyAll(world)
    stepWorld(world, terrain, walking)
    expect(debtPaymentsSound.check(world, terrain)).toEqual([])
    const record = debtPaymentsOf(world)[0]!
    record.coinsAfter += 1
    record.owedAfter -= 1
    expect(debtPaymentsSound.check(world, terrain)).toHaveLength(2)
  })

  it('catch a pay-debt order that outlasts its tick', () => {
    const { world, a1 } = setup()
    a1.order = { kind: 'payDebt', coins: 1, carriageId: null }
    expect(debtOrdersDone.check(world, terrain)).toHaveLength(1)
  })
})
