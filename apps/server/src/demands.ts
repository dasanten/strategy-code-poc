import {
  DEMANDS_PER_GAME_DAY,
  DEMAND_DECLINED_STANDING_LOSS,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  DEMAND_TRADE_ORG_STANDING_LOSS,
  GOODS,
  NPC_PLAN_TICKS,
  TICKS_PER_GAME_DAY,
  TRADE_ORG,
  TRADE_ORG_DEBT_DEMAND_DAYS,
  answeredByGame,
  demandHandOverProblem,
  demandNoteProblem,
  demandsCounted,
  demandsLeft,
  deliveryStorage,
  forSale,
  freeStock,
  goodsHandedOver,
  goodsToHandOver,
  isAllianceCity,
  npcOrgsKnownTo,
  npcStorages,
  offerStorage,
  organizationLabel,
  realmName,
  realmsKnownTo,
  standingOrganization,
  transferLoads,
  yieldsToDemand,
  type Building,
  type City,
  type Debt,
  type Demand,
  type DemandHandOver,
  type DemandHandedOver,
  type DemandTerms,
  type Good,
  type OrderRequest,
  type Realm,
  type RealmEventWhat,
  type Remembered,
  type Stock,
  type WorldState,
} from '@csp/shared'
import { handOverCity } from './capture.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { planDue } from './npc-plan.js'
import { seesStorageOf, setAsideForDemand } from './offers.js'
import type { OrderKind } from './orders.js'
import { sightOf } from './sight.js'
import { changeStanding } from './standing.js'
import { newId, realmOf } from './starting-city.js'
import { orderDebtCollection, orderPickUp } from './transfers.js'

/*
 * Demands (`CONTEXT.md`: Demand; ADR 0024): a realm sends another realm it knows of terms, a note
 * and a deadline. It arrives at once, wherever the other is. They accept or decline it, or let it
 * lapse, and both realm logs say so. Accepting carries out the terms. Otherwise it is only words:
 * nothing happens by itself when it is ignored, and the sender acts on it or doesn't. The game
 * answers for an NPC city and the Trade Organization, at the next planning pass (ADR 0016).
 */

/** Whether the realm has anyone of `toId`'s in sight, on a map of `size` tiles when known. */
function seesResidentsOf(world: WorldState, realmId: string, toId: string, size?: number): boolean {
  if (size === undefined) return false
  const sees = sightOf(world, size, realmId)
  return world.residents.some((r) => r.owner === toId && sees(r))
}

/**
 * The city as the realm knows it: as it stands while the realm sees any of it, else as it last saw
 * it (`CONTEXT.md`: Last seen). Undefined when it doesn't know the city.
 */
function knownCity(
  world: WorldState,
  realm: Realm,
  cityId: unknown,
  size?: number,
): Pick<City, 'name' | 'realmId' | 'tradeOrg'> | undefined {
  const city = world.cities.find((c) => c.id === cityId)
  if (city && size !== undefined) {
    const sees = sightOf(world, size, realm.id)
    if (world.buildings.some((b) => b.cityId === city.id && sees(b))) return city
  }
  const remembered = world.lastSeen[realm.userId] ?? []
  return remembered.find(
    (m): m is Extract<Remembered, { is: 'city' }> => m.is === 'city' && m.id === cityId,
  )
}

/** The goods a demand names as plain data, with nothing else in it, or a reason they are not good. */
function readGoods(goods: unknown): Partial<Record<Good, number>> | string {
  if (typeof goods !== 'object' || goods === null || Array.isArray(goods)) {
    return 'name the goods and how many of each'
  }
  const out: Partial<Record<Good, number>> = {}
  for (const [good, n] of Object.entries(goods)) {
    if (!(GOODS as readonly string[]).includes(good)) return `no such good: ${good}`
    if (!Number.isSafeInteger(n) || (n as number) < 1) return 'demand a whole number of each good'
    out[good as Good] = n as number
  }
  return Object.keys(out).length === 0 ? 'name the goods and how many of each' : out
}

/** What a demand asks for as plain data, or a reason it can't be asked for. */
function readTerms(
  world: WorldState,
  realm: Realm,
  toId: string,
  terms: unknown,
  size?: number,
): DemandTerms | string {
  const t = (typeof terms === 'object' && terms !== null ? terms : {}) as Record<string, unknown>
  if (t.kind === 'goods') {
    const goods = readGoods(t.goods)
    return typeof goods === 'string' ? goods : { kind: 'goods', goods }
  }
  if (t.kind !== 'city') return 'demand a named city, or goods or Coins'
  const city = knownCity(world, realm, t.cityId, size)
  if (answeredByGame(world, toId) === 'city') {
    // It knows itself, also where the sender knows it only by a standing.
    if (t.cityId !== toId) return 'an NPC city can only hand over itself'
    return { kind: 'city', cityId: toId, cityName: city?.name ?? organizationLabel(world, toId) }
  }
  if (!city) return 'you don’t know of that city'
  const theirs = toId === TRADE_ORG ? city.tradeOrg !== undefined : city.realmId === toId
  if (!theirs) return 'as far as you know, that city isn’t theirs'
  return { kind: 'city', cityId: t.cityId as string, cityName: city.name }
}

/** Whether the realm knows of `toId`, a realm or what the game answers for (`CONTEXT.md`: Demand). */
function knowsOf(world: WorldState, realm: Realm, toId: string, size?: number): boolean {
  if (!answeredByGame(world, toId)) {
    return (
      realmsKnownTo(world, realm.id, []).includes(toId) ||
      seesResidentsOf(world, realm.id, toId, size)
    )
  }
  return (
    npcOrgsKnownTo(world, realm.id, []).includes(toId) ||
    knownCity(world, realm, toId, size)?.realmId === null
  )
}

/** A demand as plain data, not yet sent, or a reason it can't be sent. */
function readDemand(
  world: WorldState,
  realm: Realm,
  order: OrderRequest,
  size?: number,
): Demand | string {
  if (demandsLeft(realm, world.tick) === 0) {
    return `a realm can send at most ${DEMANDS_PER_GAME_DAY} demands a game day`
  }
  if (order.realmId === realm.id) return 'send a demand to another realm'
  if (typeof order.realmId !== 'string') return 'send a demand to a realm'
  // A trading post's id names the Trade Organization, whose cities are all one Organization.
  const toId = standingOrganization(world, order.realmId)
  if (!knowsOf(world, realm, toId, size)) {
    return world.realms.some((r) => r.id === toId) || isAllianceCity(world, toId)
      ? 'you don’t know of that realm'
      : 'send a demand to a realm'
  }
  const terms = readTerms(world, realm, toId, order.terms, size)
  if (typeof terms === 'string') return terms
  const noteProblem = demandNoteProblem(order.note)
  if (noteProblem) return noteProblem
  const days = order.days
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > DEMAND_MAX_DAYS) {
    return `a deadline is 1 to ${DEMAND_MAX_DAYS} game days away`
  }
  return {
    id: '',
    fromId: realm.id,
    toId,
    terms,
    note: (order.note as string).trim(),
    sentAt: world.tick,
    deadline: world.tick + (days as number) * TICKS_PER_GAME_DAY,
  }
}

/** An event about the demand for both its sides. Call it while both realms still stand. */
function tellBoth(
  world: WorldState,
  d: Demand,
  what: { sender: DemandWhat; receiver: DemandWhat },
  extra: { leaderDied?: 'sender' | 'receiver'; handedOver?: DemandHandedOver } = {},
): void {
  const base = { kind: 'demand' as const, demandId: d.id, terms: d.terms, ...extra }
  const otherIs = answeredByGame(world, d.toId)
  const senderIs = d.fromId === TRADE_ORG ? ('tradeOrg' as const) : undefined
  recordEvent(world, d.fromId, {
    ...base,
    what: what.sender,
    mine: true,
    other: organizationLabel(world, d.toId),
    ...(otherIs && { otherIs }),
  })
  recordEvent(world, d.toId, {
    ...base,
    what: what.receiver,
    mine: false,
    other: realmName(world, d.fromId),
    ...(senderIs && { otherIs: senderIs }),
  })
}

type DemandWhat = Extract<RealmEventWhat, { kind: 'demand' }>['what']

/** Sending a demand (`readDemand`): it is there for the other side at once. */
export const sendDemand: OrderKind = {
  validate(world, sender, order, terrain) {
    const realm = realmOf(world, sender.userId)
    if (!realm) return 'you have no realm'
    const demand = readDemand(world, realm, order, terrain?.size)
    return typeof demand === 'string' ? demand : undefined
  },
  apply(world, sender, order, terrain) {
    const realm = realmOf(world, sender.userId)
    // Several may have come in this tick: the limit holds for what `validate` let through.
    const demand = realm && readDemand(world, realm, order, terrain?.size)
    if (!realm || !demand || typeof demand === 'string') return
    demand.id = newId(world, 'demand')
    world.demands.push(demand)
    realm.demandsSentAt = [...demandsCounted(realm, world.tick), world.tick]
    tellBoth(world, demand, { sender: 'sent', receiver: 'received' })
  },
}

/** The demand `order.demandId` sent to the Player's realm, or a reason it can't be answered. */
function demandToAnswer(world: WorldState, userId: number, order: OrderRequest): Demand | string {
  const realm = realmOf(world, userId)
  if (!realm) return 'you have no realm'
  const d = world.demands.find((x) => x.id === order.demandId)
  if (!d || (d.fromId !== realm.id && d.toId !== realm.id)) return 'no such demand'
  if (d.toId !== realm.id) return 'only the realm it was sent to can answer it'
  return d
}

/** A demand answered: it goes, and both realm logs say so. */
function answered(
  world: WorldState,
  d: Demand,
  answer: 'accepted' | 'declined' | 'lapsed',
  handedOver?: DemandHandedOver,
): void {
  world.demands = world.demands.filter((x) => x !== d)
  tellBoth(world, d, { sender: answer, receiver: answer }, handedOver && { handedOver })
  if (answer !== 'accepted') debtDemandEnded(world, d)
}

/** What the Trade Organization writes in its demand for a debt (`CONTEXT.md`: Trade Org debt). */
const DEBT_DEMAND_NOTE =
  'Pay what you owe at any of our warehouses, or hand it over here. Past the deadline our army comes for your workplaces.'

/**
 * The Trade Organization demands a debt of who owes it (`CONTEXT.md`: Trade Org debt), for all that
 * is owed, the first of its steps (ADR 0025). It goes out once for each debt (`stepDebts`).
 */
export function sendDebtDemand(world: WorldState, debt: Debt): void {
  const demand: Demand = {
    id: newId(world, 'demand'),
    fromId: TRADE_ORG,
    toId: debt.org,
    terms: { kind: 'goods', goods: { coins: debt.coins } },
    note: DEBT_DEMAND_NOTE,
    sentAt: world.tick,
    deadline: world.tick + TRADE_ORG_DEBT_DEMAND_DAYS * TICKS_PER_GAME_DAY,
  }
  world.demands.push(demand)
  debt.step = 'demanded'
  debt.deadline = demand.deadline
  tellBoth(world, demand, { sender: 'sent', receiver: 'received' })
}

/** The Trade Organization goes up to the next of its steps on a debt, as its log says (ADR 0025). */
export function debtGoesUp(world: WorldState, debt: Debt): void {
  debt.step = 'wrecks'
  delete debt.deadline
  recordEvent(world, debt.org, { kind: 'debt', what: 'overdue', coins: 0, owed: debt.coins })
}

/** Whether a demand is the Trade Organization's for a debt (`CONTEXT.md`: Trade Org debt). */
export const isDebtDemand = (d: Pick<Demand, 'fromId' | 'terms'>) =>
  d.fromId === TRADE_ORG && d.terms.kind === 'goods'

/** A demand declined or lapsed: for a debt, that starts the next step (`CONTEXT.md`: Trade Org debt). */
function debtDemandEnded(world: WorldState, d: Demand): void {
  if (!isDebtDemand(d)) return
  const debt = world.debts.find((x) => x.org === d.toId)
  if (debt) debtGoesUp(world, debt)
}

/**
 * What is set aside on a demand, at `storage` of `owner`, the one who gave in: for a realm to fetch,
 * and for the Trade Organization, its caravans come for it (`CONTEXT.md`: Trade Org debt).
 */
function setAside(
  world: WorldState,
  d: Demand,
  owner: string,
  storage: Building,
  going: Stock,
  size: number,
): void {
  const offers = setAsideForDemand(world, owner, d.fromId, storage, going)
  if (d.fromId !== TRADE_ORG) return
  for (const offer of offers) {
    orderDebtCollection(world, size, owner, storage, offer.times, offer.id)
  }
}

/** The city a demand names, while it is still the city of the realm the demand was sent to. */
function cityToHandOver(world: WorldState, d: Demand): City | undefined {
  const { terms } = d
  if (terms.kind !== 'city') return undefined
  return world.cities.find((c) => c.id === terms.cityId && c.realmId === d.toId)
}

/** Why the goods of a demand can't go the way this order names, or undefined when they can. */
function goodsProblem(
  world: WorldState,
  d: Demand,
  order: OrderRequest,
  size?: number,
): string | undefined {
  const problem = demandHandOverProblem(world, d.toId, d, order.handOver)
  if (problem) return problem
  const how = order.handOver as DemandHandOver
  if (how.way !== 'transfer' || size === undefined || d.fromId === TRADE_ORG) return undefined
  return seesStorageOf(world, d.toId, how.toCityId, size)
    ? undefined
    : 'you don’t see that city’s storage'
}

/**
 * The goods of an accepted demand change hands the way its receiver named, as far as the storage
 * holds them: set aside for the sender alone to fetch, or sent by Transfers the receiver pays for
 * (`CONTEXT.md`: Demand). For the Trade Organization its caravan brings a Transfer to its warehouse
 * nearest (`CONTEXT.md`: Trade Org debt). What went, for the logs.
 */
function handOverGoods(
  world: WorldState,
  d: Demand,
  goods: Partial<Record<Good, number>>,
  how: DemandHandOver,
  size: number,
): DemandHandedOver {
  const going = goodsHandedOver(world, d.toId, goods, how)
  if (how.way === 'setAside') {
    const storage = offerStorage(world, d.toId, how.storageId)!
    setAside(world, d, d.toId, storage, going, size)
    return { way: 'setAside', goods: going, x: storage.x, y: storage.y }
  }
  const name = (id: string) => world.cities.find((c) => c.id === id)!.name
  if (d.fromId === TRADE_ORG) {
    const storage = deliveryStorage(world, how.fromCityId)!
    orderDebtCollection(world, size, d.toId, storage, going.coins ?? 0)
    const t = world.transfers.at(-1)!
    return {
      way: 'transfer',
      goods: going,
      fromCity: name(how.fromCityId),
      toCity: name(t.toCityId),
    }
  }
  for (const { good, units } of transferLoads(going)) {
    orderPickUp(world, size, d.toId, how.fromCityId, how.toCityId, good, units)
  }
  return {
    way: 'transfer',
    goods: going,
    fromCity: name(how.fromCityId),
    toCity: name(how.toCityId),
  }
}

/**
 * Accepting a demand (`CONTEXT.md`: Demand): a named city joins the sender's realm at once, as a
 * captured one does, also the receiver's last. It is their own choice: no crime, no standing lost.
 * A city no longer theirs can't be handed over, so that demand stays open until they decline it or
 * it lapses. Goods and Coins go the way the order names (`handOverGoods`); with none of them there
 * it is refused the same way.
 */
const acceptDemand: OrderKind = {
  validate(world, sender, order, terrain) {
    const d = demandToAnswer(world, sender.userId, order)
    if (typeof d === 'string') return d
    if (d.terms.kind === 'goods') return goodsProblem(world, d, order, terrain?.size)
    return cityToHandOver(world, d)
      ? undefined
      : `${d.terms.cityName} is no longer yours to hand over`
  },
  apply(world, sender, order, terrain) {
    const d = demandToAnswer(world, sender.userId, order)
    if (typeof d === 'string') return
    if (d.terms.kind === 'goods') {
      // The goods may have gone since the order came, to another demand in this same tick too.
      if (goodsProblem(world, d, order, terrain?.size)) return
      const how = order.handOver as DemandHandOver
      const size = terrain?.size ?? Infinity
      answered(world, d, 'accepted', handOverGoods(world, d, d.terms.goods, how, size))
      return
    }
    // It may have gone since the order came, to another demand accepted in this same tick too.
    const city = cityToHandOver(world, d)
    if (!city || !terrain) return
    handOverCity(world, city, d.fromId, terrain.size)
    answered(world, d, 'accepted')
  },
}

/** Declining a demand: that is all that happens. */
const declineDemand: OrderKind = {
  validate(world, sender, order) {
    const d = demandToAnswer(world, sender.userId, order)
    return typeof d === 'string' ? d : undefined
  },
  apply(world, sender, order) {
    const d = demandToAnswer(world, sender.userId, order)
    if (typeof d !== 'string') answered(world, d, 'declined')
  },
}

/** The demand order kinds (`CONTEXT.md`: Demand). */
export const demandOrders: Record<string, OrderKind> = {
  sendDemand,
  acceptDemand,
  declineDemand,
}

/**
 * A realm's Leader died (`CONTEXT.md`: Self-managed city): its demands, sent or received, lapse at
 * once. Call it before the realm ends, while its name is known.
 */
export function lapseDemandsOnLeaderDeath(world: WorldState, realmId: string): void {
  const ending = world.demands.filter((d) => d.fromId === realmId || d.toId === realmId)
  if (ending.length === 0) return
  world.demands = world.demands.filter((d) => !ending.includes(d))
  for (const d of ending) {
    tellBoth(
      world,
      d,
      { sender: 'lapsed', receiver: 'lapsed' },
      { leaderDied: d.fromId === realmId ? 'sender' : 'receiver' },
    )
  }
}

/** A demand the game answers no: the one it was sent to thinks less of the sender. */
function gameDeclines(world: WorldState, d: Demand, loss: number): void {
  changeStanding(world, d.toId, d.fromId, -loss)
  answered(world, d, 'declined')
}

/**
 * An NPC city gives what a demand won from it, as a Player accepting one would (`CONTEXT.md`:
 * Demand). A city joins at once, and any ask of it to join is forgotten. Goods are set aside for the
 * sender alone to fetch, at its storage that can give the most of them, as far as it holds them.
 * With none of them there it can't hand them over, so it declines.
 */
function cityGivesIn(world: WorldState, city: City, d: Demand, size: number): void {
  const { terms } = d
  if (terms.kind === 'city') {
    world.joinRequests = world.joinRequests.filter((q) => q.cityId !== city.id)
    handOverCity(world, city, d.fromId, size)
    answered(world, d, 'accepted')
    return
  }
  const units = (s: Stock) => Object.values(s).reduce((sum, n) => sum + n, 0)
  const from = npcStorages(world, city)
    .map((storage) => ({ storage, going: goodsToHandOver(terms.goods, freeStock(world, storage)) }))
    .sort((a, b) => units(b.going) - units(a.going))[0]
  if (!from || units(from.going) === 0) {
    gameDeclines(world, d, DEMAND_DECLINED_STANDING_LOSS)
    return
  }
  setAside(world, d, city.id, from.storage, from.going, size)
  answered(world, d, 'accepted', {
    way: 'setAside',
    goods: from.going,
    x: from.storage.x,
    y: from.storage.y,
  })
}

/**
 * The game's answer to a demand (`CONTEXT.md`: Demand), at the next planning pass of who it was sent
 * to (ADR 0016). The Trade Organization always declines, and being asked costs standing. An NPC city
 * gives in to respect that far outweighs its soldiers (`yieldsToDemand`), and otherwise declines and
 * its standing drops. A city that is no NPC city any more has nobody left to answer: it lapses.
 */
function answerAsGame(world: WorldState, d: Demand, size: number): void {
  const city = world.cities.find((c) => c.id === d.toId)
  if (d.toId !== TRADE_ORG && (!city || !forSale(city))) {
    answered(world, d, 'lapsed')
    return
  }
  if (!planDue(world, { id: d.toId })) return
  if (!city) gameDeclines(world, d, DEMAND_TRADE_ORG_STANDING_LOSS)
  else if (yieldsToDemand(world, city, d.fromId, size)) cityGivesIn(world, city, d, size)
  else gameDeclines(world, d, DEMAND_DECLINED_STANDING_LOSS)
}

/**
 * The game answers the demands sent to what it runs (`answerAsGame`). A city it hands over joins as
 * one captured does, so this runs before the steps that look after what a realm has just got: its
 * alliances, occupations and refills. `size` is the map's.
 */
export function answerDemands(world: WorldState, size: number): void {
  for (const d of [...world.demands]) {
    if (!world.realms.some((r) => r.id === d.toId)) answerAsGame(world, d, size)
  }
}

/**
 * Demands lapse at their deadline, as a tick ends, and that is all: whatever was threatened is the
 * sender's to carry out, or not (`CONTEXT.md`: Demand). The Trade Organization carries out what it
 * threatens over a debt (`debtDemandEnded`).
 */
export function stepDemands(world: WorldState): void {
  if (world.demands.length === 0) return
  const lapsed = world.demands.filter((d) => world.tick >= d.deadline)
  if (lapsed.length === 0) return
  world.demands = world.demands.filter((d) => !lapsed.includes(d))
  for (const d of lapsed) {
    tellBoth(world, d, { sender: 'lapsed', receiver: 'lapsed' })
    debtDemandEnded(world, d)
  }
}

/**
 * Demands hold together (`CONTEXT.md`: Demand): sent by a realm that exists, or the Trade
 * Organization for a debt (`debtDemandsSound`), to another one, or to a city or the Trade
 * Organization, who answer within a planning pass; a deadline that lies ahead and
 * was set after it was sent, a note kept as the order allows, and terms that ask for something. No
 * realm has sent more than it may in a game day.
 */
export const demandsSound: Invariant = {
  name: 'demands-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const report = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const seen = new Set<string>()
    for (const d of world.demands) {
      if (seen.has(d.id)) report(`demand ${d.id} is there twice`, [d.id])
      seen.add(d.id)
      if (d.fromId === d.toId) report(`demand ${d.id} is sent to its own sender`, [d.id])
      const byGame = answeredByGame(world, d.toId) !== undefined
      for (const realm of byGame ? [d.fromId] : [d.fromId, d.toId]) {
        if (realm !== TRADE_ORG && !world.realms.some((r) => r.id === realm)) {
          report(`demand ${d.id} has realm ${realm}, which does not exist`, [d.id])
        }
      }
      if (byGame && world.tick - d.sentAt > NPC_PLAN_TICKS) {
        report(`demand ${d.id} to ${d.toId} waited longer than a planning pass for its answer`, [
          d.id,
        ])
      }
      if (d.deadline <= world.tick) {
        report(`open demand ${d.id} has deadline ${d.deadline}, not ahead of ${world.tick}`, [d.id])
      }
      if (d.deadline <= d.sentAt) report(`demand ${d.id} had no time to be answered`, [d.id])
      if (d.note !== d.note.trim() || d.note === '' || d.note.length > DEMAND_NOTE_MAX_LENGTH) {
        report(`demand ${d.id} has a note the order wouldn't take`, [d.id])
      }
      if (d.terms.kind === 'goods') {
        const amounts = Object.values(d.terms.goods)
        if (amounts.length === 0 || !amounts.every((n) => Number.isSafeInteger(n) && n > 0)) {
          report(`demand ${d.id} asks for no goods, or not in whole units`, [d.id])
        }
      }
    }
    for (const r of world.realms) {
      if (demandsCounted(r, world.tick).length > DEMANDS_PER_GAME_DAY) {
        report(`realm ${r.id} sent more than ${DEMANDS_PER_GAME_DAY} demands in a game day`, [r.id])
      }
    }
    return out
  },
}
