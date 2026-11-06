import {
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_NOTE_MAX_LENGTH,
  NPC_PLAN_TICKS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_DEBT_DEMAND_DAYS,
  TRADE_ORG_REFUSES_TRADE_BELOW,
  debtOf,
  demandsFor,
  freeStock,
  standingOf,
  tradeOrgHq,
  transferLoad,
  type WorldState,
} from '@csp/shared'
import { describe, expect, it } from 'vitest'
import { answerDemands, demandsSound, lapseDemandsOnLeaderDeath, stepDemands } from './demands.js'
import { hqFalls, nothingLeftOfTheHq } from './hq-fall.js'
import { checkInvariants } from './invariants.js'
import { offersSound, stepOffers } from './offers.js'
import { changeStanding } from './standing.js'
import { addCity } from './test-terrain.js'
import { debtDemandsSound, oweTradeOrg, stepDebts } from './trade-org-debt.js'
import { collectsTransferFrom, transfersSound } from './transfers.js'
import { eventsOf, mara, order, plains, runUntil, setup, total } from './transfers.fixture.js'

const OWED = 300

/** Mara's realm owes the Trade Organization `coins`, and has its demand for them. */
function owing(coins = OWED) {
  const s = setup()
  oweTradeOrg(s.world, s.realm.id, coins)
  stepDebts(s.world)
  const debt = () => s.world.debts.find((d) => d.org === s.realm.id)
  return { ...s, debt, demand: () => s.world.demands.find((d) => d.fromId === TRADE_ORG) }
}
type Setup = ReturnType<typeof owing>

/** Mara's answer to the demand, applied, and what it says. */
function answer(s: Setup, kind: 'acceptDemand' | 'declineDemand', handOver?: object) {
  const said = s.queue.receive(s.world, mara, 'a', {
    kind,
    demandId: s.demand()!.id,
    ...(handOver && { handOver }),
  })
  s.queue.applyAll(s.world)
  return said.type === 'ack' ? 'ack' : (said as { reason: string }).reason
}

const setAside = (s: Setup) => ({ way: 'setAside', storageId: s.storage.id })
const byTransfer = (s: Setup) => ({ way: 'transfer', fromCityId: s.city.id, toCityId: '' })

/** The Coins the Trade Organization's warehouses hold. */
const tradeOrgCoins = (world: WorldState) =>
  world.buildings
    .filter((b) => b.kind === 'warehouse')
    .reduce((n, b) => n + (b.stock?.coins ?? 0), 0)

const overdue = (world: WorldState) =>
  eventsOf(world, 'debt', mara.userId).filter((e) => e.what === 'overdue')

const lastDemandLine = (world: WorldState) => eventsOf(world, 'demand', mara.userId).at(-1)

describe('the Trade Organization demands a debt', () => {
  it('sends a demand for what is owed, with a deadline and a note, at once', () => {
    const s = owing()
    expect(s.world.demands).toHaveLength(1)
    const d = s.demand()!
    expect(d).toMatchObject({
      fromId: TRADE_ORG,
      toId: s.realm.id,
      terms: { kind: 'goods', goods: { coins: OWED } },
      sentAt: s.world.tick,
      deadline: s.world.tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY,
    })
    expect(d.note.length).toBeGreaterThan(0)
    expect(d.note.length).toBeLessThanOrEqual(DEMAND_NOTE_MAX_LENGTH)
    expect(s.debt()).toMatchObject({ step: 'demanded', deadline: d.deadline })
    expect(lastDemandLine(s.world)).toMatchObject({
      what: 'received',
      mine: false,
      other: 'the Trade Organization',
      otherIs: 'tradeOrg',
      terms: { kind: 'goods', goods: { coins: OWED } },
    })
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('shows in the Demands of who owes it, from the Trade Organization', () => {
    const s = owing()
    expect(demandsFor(s.world, s.realm.id)).toMatchObject([
      {
        from: { realmId: TRADE_ORG, realm: 'the Trade Organization' },
        to: { realmId: s.realm.id },
        terms: { kind: 'goods', goods: { coins: OWED } },
      },
    ])
  })

  it('is sent once per debt, also through a rise and once answered', () => {
    const s = owing()
    stepDebts(s.world)
    oweTradeOrg(s.world, s.realm.id, 50)
    stepDebts(s.world)
    expect(s.world.demands).toHaveLength(1)
    expect(answer(s, 'declineDemand')).toBe('ack')
    oweTradeOrg(s.world, s.realm.id, 50)
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
    const sent = eventsOf(s.world, 'demand', mara.userId).filter((e) => e.what === 'received')
    expect(sent).toHaveLength(1)
  })

  it('sends a new one for a new debt, after the old one is settled', () => {
    const s = owing()
    expect(answer(s, 'declineDemand')).toBe('ack')
    s.world.debts = []
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
    oweTradeOrg(s.world, s.realm.id, 40)
    stepDebts(s.world)
    expect(s.demand()!.terms).toEqual({ kind: 'goods', goods: { coins: 40 } })
    expect(s.debt()!.step).toBe('demanded')
  })

  it('asks for what is owed now, as it rises or is paid in part', () => {
    const s = owing()
    oweTradeOrg(s.world, s.realm.id, 50)
    stepDebts(s.world)
    expect(s.demand()!.terms).toEqual({ kind: 'goods', goods: { coins: OWED + 50 } })
    expect(order(s.world, s.queue, { kind: 'payDebt', coins: 100 })).toBe('ack')
    runUntil(s.world, s.terrain, () => debtOf(s.world, s.realm.id) === OWED - 50, 1)
    expect(s.demand()!.terms).toEqual({ kind: 'goods', goods: { coins: OWED - 50 } })
  })

  it('sends none with the HQ fallen', () => {
    const s = setup()
    hqFalls(s.world, tradeOrgHq(s.world)!)
    s.world.debts = [{ org: s.realm.id, coins: 10 }]
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
  })
})

describe('paying at a warehouse', () => {
  it('settles it: the demand goes and no next step starts', () => {
    const s = owing()
    expect(order(s.world, s.queue, { kind: 'payDebt', coins: OWED })).toBe('ack')
    runUntil(s.world, s.terrain, () => s.debt() === undefined, 1)
    expect(s.world.demands).toEqual([])
    expect(overdue(s.world)).toEqual([])
    expect(eventsOf(s.world, 'debtPaid', mara.userId).at(-1)).toMatchObject({ owed: 0 })
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('in part leaves the demand and its deadline as they were', () => {
    const s = owing()
    const { deadline } = s.demand()!
    expect(order(s.world, s.queue, { kind: 'payDebt', coins: 100 })).toBe('ack')
    runUntil(s.world, s.terrain, () => debtOf(s.world, s.realm.id) === OWED - 100, 1)
    expect(s.demand()!.deadline).toBe(deadline)
    expect(s.debt()!.step).toBe('demanded')
  })

  it('in full ends what was set aside, for a caravan not yet on its way', () => {
    const s = owing()
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    expect(s.world.transfers).toHaveLength(1)
    s.world.debts = []
    stepDebts(s.world)
    expect(s.world.transfers).toEqual([])
    expect(s.world.offers).toEqual([])
    expect(freeStock(s.world, s.storage).coins).toBe(s.storage.stock!.coins)
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })
})

describe('declining or letting it lapse', () => {
  it('starts the next step when it lapses', () => {
    const s = owing()
    s.demand()!.deadline = s.world.tick
    stepDemands(s.world)
    expect(s.world.demands).toEqual([])
    expect(s.debt()).toEqual({ org: s.realm.id, coins: OWED, step: 'wrecks' })
    expect(lastDemandLine(s.world)).toMatchObject({ what: 'lapsed', otherIs: 'tradeOrg' })
    expect(overdue(s.world)).toMatchObject([{ owed: OWED }])
    stepDebts(s.world)
    expect(s.world.demands).toEqual([])
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('starts the next step when it is declined, without waiting for the deadline', () => {
    const s = owing()
    expect(answer(s, 'declineDemand')).toBe('ack')
    expect(s.debt()).toEqual({ org: s.realm.id, coins: OWED, step: 'wrecks' })
    expect(overdue(s.world)).toHaveLength(1)
    expect(lastDemandLine(s.world)).toMatchObject({ what: 'declined', mine: false })
    expect(checkInvariants(s.world, s.terrain)).toEqual([])
  })

  it('is the Trade Organization’s doing alone: a realm’s demand that lapses starts no step', () => {
    const s = owing()
    s.world.demands.push({
      ...s.demand()!,
      id: 'other',
      fromId: s.other.id,
      deadline: s.world.tick,
    })
    stepDemands(s.world)
    expect(s.debt()!.step).toBe('demanded')
  })

  it('goes with the debt when the Leader dies: it just ends', () => {
    const s = owing()
    lapseDemandsOnLeaderDeath(s.world, s.realm.id)
    expect(s.world.demands).toEqual([])
    expect(overdue(s.world)).toEqual([])
  })
})

describe('accepting', () => {
  const slow = { tags: ['slow'], timeout: 240_000 }

  it(
    'sets the Coins aside for a caravan, which fetches them for no fee and settles the debt',
    slow,
    () => {
      const s = owing()
      const before = s.storage.stock!.coins!
      const held = tradeOrgCoins(s.world)
      const all = total(s.world, 'coins')
      expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
      expect(s.world.demands).toEqual([])
      expect(s.world.offers).toMatchObject([
        { realmId: s.realm.id, storageId: s.storage.id, gives: 'coins', times: OWED },
      ])
      expect(s.world.offers[0]!.direct!.toId).toBe(TRADE_ORG)
      expect(freeStock(s.world, s.storage).coins).toBe(before - OWED)
      expect(s.world.transfers).toMatchObject([
        {
          realmId: s.realm.id,
          toRealmId: TRADE_ORG,
          units: OWED,
          debt: { storageId: s.storage.id, offerId: s.world.offers[0]!.id },
        },
      ])
      expect(lastDemandLine(s.world)).toMatchObject({
        what: 'accepted',
        handedOver: { way: 'setAside', goods: { coins: OWED } },
      })
      // It still owes until the caravan has brought them in.
      expect(debtOf(s.world, s.realm.id)).toBe(OWED)
      runUntil(s.world, s.terrain, () => s.debt() === undefined)
      expect(s.world.offers).toEqual([])
      expect(s.world.transfers).toEqual([])
      expect(s.storage.stock!.coins).toBe(before - OWED)
      expect(tradeOrgCoins(s.world) - held).toBeGreaterThanOrEqual(OWED - 1)
      expect(total(s.world, 'coins')).toBe(all)
      expect(eventsOf(s.world, 'debt', mara.userId).at(-1)).toMatchObject({
        what: 'collected',
        coins: OWED,
        owed: 0,
      })
      expect(overdue(s.world)).toEqual([])
    },
  )

  it(
    'sends them by a Transfer to its nearest warehouse for the fee, whoever it refuses',
    slow,
    () => {
      const s = owing()
      changeStanding(s.world, TRADE_ORG, s.realm.id, TRADE_ORG_REFUSES_TRADE_BELOW - 1)
      const before = s.storage.stock!.coins!
      expect(answer(s, 'acceptDemand', byTransfer(s))).toBe('ack')
      expect(s.world.offers).toEqual([])
      const t = s.world.transfers[0]!
      expect(t).toMatchObject({
        toRealmId: TRADE_ORG,
        units: OWED,
        debt: { storageId: s.storage.id },
      })
      expect(t.debt!.offerId).toBeUndefined()
      expect(lastDemandLine(s.world)).toMatchObject({
        what: 'accepted',
        handedOver: { way: 'transfer', goods: { coins: OWED } },
      })
      let collecting = false
      const driverOf = () => {
        const c = s.world.caravans.find((x) => x.transfer !== null)
        return s.world.residents.find((r) => r.id === c?.driverId)
      }
      runUntil(s.world, s.terrain, () => {
        const driver = driverOf()
        collecting ||= !!driver && collectsTransferFrom(s.world, driver, s.storage.id)
        return s.debt() === undefined
      })
      expect(collecting).toBe(true)
      expect(s.storage.stock!.coins).toBeLessThan(before - OWED)
      expect(checkInvariants(s.world, s.terrain, [transfersSound, debtDemandsSound])).toEqual([])
    },
  )

  it('splits what is more than a load into several trips', () => {
    const load = transferLoad('coins')
    const s = owing(load + 5)
    s.storage.stock!.coins = 2 * load
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    expect(s.world.transfers.map((t) => t.units)).toEqual([load, 5])
    expect(checkInvariants(s.world, s.terrain, [transfersSound])).toEqual([])
  })

  it(
    'leaves what a short storage doesn’t cover owed, and starts the next step at the deadline',
    slow,
    () => {
      const s = owing()
      s.storage.stock!.coins = 100
      expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
      runUntil(s.world, s.terrain, () => debtOf(s.world, s.realm.id) === OWED - 100)
      expect(s.world.transfers).toEqual([])
      expect(s.debt()!.step).toBe('demanded')
      expect(overdue(s.world)).toEqual([])
      stepDebts(s.world)
      expect(s.debt()!.step).toBe('demanded')
      s.debt()!.deadline = s.world.tick
      stepDebts(s.world)
      expect(s.debt()).toEqual({ org: s.realm.id, coins: OWED - 100, step: 'wrecks' })
      expect(overdue(s.world)).toMatchObject([{ owed: OWED - 100 }])
    },
  )

  it('waits at the deadline for a caravan still bringing them in', () => {
    const s = owing()
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    s.debt()!.deadline = s.world.tick
    stepDebts(s.world)
    expect(s.debt()!.step).toBe('demanded')
    expect(overdue(s.world)).toEqual([])
  })

  it('takes only what is still owed when the caravan gets there', slow, () => {
    const s = owing()
    const before = s.storage.stock!.coins!
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    s.world.debts[0]!.coins = 100
    runUntil(s.world, s.terrain, () => s.debt() === undefined)
    expect(s.storage.stock!.coins).toBe(before - 100)
    expect(s.world.offers).toEqual([])
    expect(freeStock(s.world, s.storage).coins).toBe(before - 100)
  })

  it('refuses a storage outside a city, for its caravans fetch from cities', () => {
    const s = owing()
    s.storage.cityId = null
    s.storage.realmId = s.realm.id
    expect(answer(s, 'acceptDemand', setAside(s))).toBe(
      'its caravans fetch only from a storage in a city',
    )
    expect(s.demand()).toBeDefined()
  })

  it('refuses a Transfer from a city not theirs', () => {
    const s = owing()
    expect(
      answer(s, 'acceptDemand', { way: 'transfer', fromCityId: s.toCity.id, toCityId: '' }),
    ).toBe('not one of your cities')
  })

  it('leaves it owed when what was set aside is taken back', slow, () => {
    const s = owing()
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    s.world.offers = []
    runUntil(s.world, s.terrain, () => s.world.transfers.length === 0)
    expect(debtOf(s.world, s.realm.id)).toBe(OWED)
    expect(s.debt()!.step).toBe('demanded')
  })
})

describe('the Fall of the HQ', () => {
  it('ends its demands, and what was set aside for it is ordinary again', () => {
    const s = owing()
    expect(answer(s, 'acceptDemand', setAside(s))).toBe('ack')
    oweTradeOrg(s.world, s.other.id, 20)
    stepDebts(s.world)
    expect(s.world.demands).toHaveLength(1)
    hqFalls(s.world, tradeOrgHq(s.world)!)
    expect(s.world.demands).toEqual([])
    expect(nothingLeftOfTheHq.check(s.world, s.terrain)).toEqual([])
    stepDebts(s.world)
    stepOffers(s.world)
    expect(s.world.offers).toEqual([])
    expect(freeStock(s.world, s.storage).coins).toBe(s.storage.stock!.coins)
    expect(checkInvariants(s.world, s.terrain, [offersSound, demandsSound])).toEqual([])
  })
})

describe('an NPC city that owes', () => {
  it('answers like any demand: it declines, thinks less of it, and the next step starts', () => {
    const s = setup()
    addCity(s.world, { id: 'n1', realmId: null, x: 400, y: 100, name: 'Oakford' })
    oweTradeOrg(s.world, 'n1', 30)
    stepDebts(s.world)
    expect(s.world.demands).toMatchObject([{ fromId: TRADE_ORG, toId: 'n1' }])
    expect(checkInvariants(s.world, s.terrain, [demandsSound, debtDemandsSound])).toEqual([])
    for (let t = 0; t < NPC_PLAN_TICKS && s.world.demands.length > 0; t++) {
      s.world.tick++
      answerDemands(s.world, plains(512).size)
    }
    expect(s.world.demands).toEqual([])
    expect(standingOf(s.world, 'n1', TRADE_ORG)).toBe(-DEMAND_DECLINED_STANDING_LOSS)
    expect(s.world.debts).toEqual([{ org: 'n1', coins: 30, step: 'wrecks' }])
  })

  it('goes with a city that joined a realm', () => {
    const s = setup()
    const city = addCity(s.world, { id: 'n1', realmId: null, x: 400, y: 100, name: 'Oakford' })
    oweTradeOrg(s.world, 'n1', 30)
    stepDebts(s.world)
    city.realmId = s.realm.id
    stepDebts(s.world)
    expect(s.world.debts).toEqual([])
    expect(s.world.demands).toEqual([])
  })
})

describe('the invariant', () => {
  it('sees a demand for no debt', () => {
    const s = owing()
    s.world.debts = []
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })

  it('sees a demand for less than is owed', () => {
    const s = owing()
    s.debt()!.coins += 1
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })

  it('sees two demands for one debt', () => {
    const s = owing()
    s.world.demands.push({ ...s.demand()!, id: 'twice' })
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })

  it('sees a demand out past its step', () => {
    const s = owing()
    s.debt()!.step = 'wrecks'
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })

  it('sees a debt demanded with no deadline', () => {
    const s = owing()
    delete s.debt()!.deadline
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })

  it('sees a caravan collecting a debt for someone else', () => {
    const s = owing()
    answer(s, 'acceptDemand', setAside(s))
    s.world.transfers[0]!.toRealmId = s.other.id
    expect(debtDemandsSound.check(s.world, s.terrain)).toHaveLength(1)
  })
})
