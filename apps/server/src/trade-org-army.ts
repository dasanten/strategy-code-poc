import {
  TICKS_PER_GAME_DAY,
  TICKS_PER_GAME_WEEK,
  TRADE_ORG,
  TRADE_ORG_ARMY,
  TRADE_ORG_HQ,
  canWork,
  contractOf,
  contractWeeks,
  handedOverTo,
  inCityArea,
  inInnerRingAround,
  isArmed,
  realmName,
  townHallOf,
  punishers,
  tradeOrgHq,
  tradeOrgRefuses,
  warehouseKeeps,
  wrapDelta,
  wrapDistance,
  type Building,
  type City,
  type MercenaryContract,
  type Resident,
  type WorldState,
  middleOf,
} from '@csp/shared'
import { caravanCrew } from './caravans.js'
import { attackOrder } from './combat.js'
import { cannotStart, payInto, startContract } from './contracts.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import { walkTo } from './npc-behaviour.js'
import { attackersOf } from './npc-defence.js'
import { newId } from './starting-city.js'
import { hqLayout } from './trade-org.js'

/*
 * The Trade Org army (`CONTEXT.md`: Trade Org army): the Trade Org HQ's soldiers, which it arms
 * itself (`stepNpcDefence`). In mercenary contracts the Trade Organization is a side like a realm
 * (`TRADE_ORG`): it hires out its spare soldiers, keeps its inner ring clear by force, and hires
 * Players' residents itself when it has lost too many. Like an NPC city it only gives orders a
 * Player could give (ADR 0002), and opens and closes its own gates.
 */

/** Whether the resident is one of the HQ's own. */
const ofHq = (hq: City, r: Resident) => r.owner === null && r.cityId === hq.id

/** The Trade Org HQ's soldiers: its living armed residents, a caravan's crew aside. */
export function hqSoldiers(world: WorldState): Resident[] {
  const hq = tradeOrgHq(world)
  if (!hq) return []
  const crew = caravanCrew(world)
  return world.residents.filter((r) => ofHq(hq, r) && r.health > 0 && isArmed(r) && !crew.has(r.id))
}

/**
 * The HQ soldiers it would hire out now: those in no contract, offered or in force, except the
 * `TRADE_ORG_ARMY.guard` that always stay (`CONTEXT.md`: Trade Org army). By id, so the same
 * ones go first.
 */
export function spareSoldiers(world: WorldState): Resident[] {
  const named = new Set([...world.contracts.flatMap((c) => c.residentIds), ...punishers(world)])
  const home = hqSoldiers(world)
    .filter((r) => !named.has(r.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  return home.slice(0, Math.max(0, home.length - TRADE_ORG_ARMY.guard))
}

/**
 * One tick of the Trade Org army, on a map of `size` tiles: it answers the offers made to it,
 * pays its mercenaries, keeps its inner ring clear, watches its outer gates, runs its
 * mercenaries, and once a game day
 * hires more when it has lost too many. Run after `stepNpcDefence` and before `stepNpcCities`, so
 * the work the HQ hands out passes its soldiers by.
 */
export function stepTradeOrgArmy(world: WorldState, size: number): void {
  const hq = tradeOrgHq(world)
  if (!hq) return
  answerOffers(world)
  payMercenaries(world, hq)
  guardInnerRing(world, hq, size)
  watchOuterGates(world, hq, size)
  runMercenaries(world, hq, size)
  if (world.tick % TICKS_PER_GAME_DAY === 0) hireMercenaries(world, hq, size)
}

/**
 * Why the Trade Organization turns down an offer for its soldiers, if it does: it refuses to trade
 * with the hirer (`CONTEXT.md`: Trade Org reaction), less than its
 * price per soldier and week, residents or a warehouse no longer its, or soldiers it can't spare
 * (one in another contract, or fewer than its guard left at the HQ).
 */
function refusal(world: WorldState, c: MercenaryContract): string | undefined {
  if (tradeOrgRefuses(world, c.hirerId)) return 'standing'
  if (c.pricePerWeek < c.residentIds.length * TRADE_ORG_ARMY.pricePerSoldierWeek) return 'price'
  if (cannotStart(world, c)) return 'changed'
  const busy = new Set(world.contracts.filter((x) => x !== c).flatMap((x) => x.residentIds))
  const soldiers = hqSoldiers(world)
  const ids = new Set(soldiers.map((r) => r.id))
  if (!c.residentIds.every((id) => ids.has(id) && !busy.has(id))) return 'not spare'
  const staying = soldiers.filter((r) => !busy.has(r.id) && !c.residentIds.includes(r.id))
  return staying.length < TRADE_ORG_ARMY.guard ? 'guard' : undefined
}

/**
 * The Trade Organization answers each offer for its soldiers at once (`CONTEXT.md`: Trade Org
 * army): it accepts unless it has a `refusal`, and otherwise declines, which the hirer hears of.
 */
function answerOffers(world: WorldState): void {
  for (const c of [...world.contracts]) {
    if (c.lenderId !== TRADE_ORG || c.startedAt !== null) continue
    if (refusal(world, c) === undefined) {
      startContract(world, c)
      continue
    }
    world.contracts = world.contracts.filter((x) => x !== c)
    recordEvent(world, c.hirerId, {
      kind: 'contract',
      contractId: c.id,
      what: 'declined',
      lender: false,
      other: realmName(world, TRADE_ORG),
      residents: c.residentIds.length,
    })
  }
}

/** The HQ's coin warehouse (`CONTEXT.md`: Warehouse), if it stands. */
function coinWarehouse(world: WorldState, hq: City): Building | undefined {
  return world.buildings.find(
    (b) => b.cityId === hq.id && warehouseKeeps(world, b).includes('coins'),
  )
}

/**
 * The Trade Organization pays each week of its mercenaries in advance as it begins, from its coin
 * warehouse straight into the lender's storage, like a transfer (`CONTEXT.md`: Trade Org army).
 * A week it can't pay (no coins, or no storage left) breaks the contract (`stepContracts`).
 */
function payMercenaries(world: WorldState, hq: City): void {
  const bank = coinWarehouse(world, hq)
  for (const c of world.contracts) {
    if (c.hirerId !== TRADE_ORG || c.startedAt === null) continue
    if (!world.buildings.some((b) => b.id === c.storageId)) continue
    while (
      c.paidWeeks < contractWeeks(c) &&
      world.tick >= c.startedAt + c.paidWeeks * TICKS_PER_GAME_WEEK &&
      (bank?.stock?.coins ?? 0) >= c.pricePerWeek
    ) {
      bank!.stock!.coins! -= c.pricePerWeek
      payInto(world, c, 1)
    }
  }
}

/** The HQ's inner gates: its gates on the inner ring, not the outer. */
function innerGates(world: WorldState, hq: City, hall: Building, size: number): Building[] {
  return world.buildings.filter(
    (b) =>
      b.cityId === hq.id &&
      b.kind === 'gate' &&
      Math.hypot(wrapDelta(hall.x, b.x, size), wrapDelta(hall.y, b.y, size)) <=
        TRADE_ORG_HQ.innerRadius + 1,
  )
}

/**
 * The HQ's outer gates: its finished gates that are not on its inner ring, on every outer ring
 * it has.
 */
function outerGates(world: WorldState, hq: City, hall: Building, size: number): Building[] {
  const inner = new Set(innerGates(world, hq, hall, size))
  return world.buildings.filter(
    (b) => b.cityId === hq.id && b.kind === 'gate' && !b.site && !inner.has(b),
  )
}

/**
 * Armed outsiders near the HQ (`CONTEXT.md`: Trade Org HQ): armed residents not of it in its area
 * or within `TRADE_ORG_ARMY.gateWatchRange` of one of its outer gates. Its own mercenaries stand
 * guard for it and don't count.
 */
export function armedOutsidersNear(world: WorldState, hq: City, size: number): Resident[] {
  const hall = townHallOf(world, hq)
  if (!hall) return []
  const gates = outerGates(world, hq, hall, size)
  const hired = new Set(mercenaries(world).map((r) => r.id))
  return world.residents.filter(
    (r) =>
      r.health > 0 &&
      isArmed(r) &&
      !ofHq(hq, r) &&
      !hired.has(r.id) &&
      (inCityArea(world, hq, r.x, r.y, size) ||
        gates.some((g) => wrapDistance(size, r, g) <= TRADE_ORG_ARMY.gateWatchRange)),
  )
}

/**
 * The HQ closes its outer gates while more armed outsiders are near it (`armedOutsidersNear`)
 * than `TRADE_ORG_ARMY.gateShare` of its soldiers at home (not hired out), and opens them again
 * once there are no more (`CONTEXT.md`: Trade Org HQ). Its own residents pass them either way.
 */
function watchOuterGates(world: WorldState, hq: City, size: number): void {
  const hall = townHallOf(world, hq)
  if (!hall) return
  const home = hqSoldiers(world).filter((r) => !contractOf(world, r.id)).length
  const close = armedOutsidersNear(world, hq, size).length > TRADE_ORG_ARMY.gateShare * home
  for (const g of outerGates(world, hq, hall, size)) {
    if (close) g.closed = true
    else delete g.closed
  }
}

/**
 * The HQ keeps its inner ring clear (`CONTEXT.md`: Trade Org army): its inner gates stay closed,
 * which its own residents pass, and each of its soldiers in its area who is not fighting yet and
 * not hired out goes after the nearest outsider on or inside the inner ring.
 */
function guardInnerRing(world: WorldState, hq: City, size: number): void {
  const hall = townHallOf(world, hq)
  if (!hall) return
  for (const g of innerGates(world, hq, hall, size)) g.closed = true
  const outsiders = world.residents.filter(
    (r) => r.health > 0 && !ofHq(hq, r) && inInnerRingAround(hall, r, size),
  )
  if (outsiders.length === 0) return
  const away = punishers(world)
  for (const r of hqSoldiers(world)) {
    if (r.order?.kind === 'attack' || contractOf(world, r.id) || away.has(r.id)) continue
    if (!inCityArea(world, hq, r.x, r.y, size)) continue
    const nearest = outsiders.reduce((a, b) =>
      wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
    )
    r.order = attackOrder(nearest.id)
  }
}

/** The residents the Trade Organization has hired, in the order it hired them. */
function mercenaries(world: WorldState): Resident[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  return world.contracts
    .filter((c) => c.hirerId === TRADE_ORG && c.startedAt !== null)
    .flatMap((c) => c.residentIds.flatMap((id) => byId.get(id) ?? []))
}

/**
 * Where the HQ's mercenaries stand guard: one tile outside each inner gate, away from the town
 * hall, round the ring.
 */
function guardPosts(hall: Building): { x: number; y: number }[] {
  const c = middleOf(hall)
  return hqLayout(c.x, c.y).innerGates.map(([x, y]) => {
    const d = Math.hypot(x - c.x, y - c.y) || 1
    return { x: x + Math.round((x - c.x) / d), y: y + Math.round((y - c.y) / d) }
  })
}

/**
 * The Trade Organization's mercenaries (`CONTEXT.md`: Trade Org army): while the HQ has
 * attackers in its area, each armed one there goes after the nearest; otherwise they walk to
 * their guard post outside the inner gates and stand there.
 */
function runMercenaries(world: WorldState, hq: City, size: number): void {
  const hired = mercenaries(world)
  const hall = townHallOf(world, hq)
  if (hired.length === 0 || !hall) return
  const posts = guardPosts(hall)
  const attackers = attackersOf(world, hq, size)
  hired.forEach((r, i) => {
    if (r.health <= 0 || r.order?.kind === 'attack') return
    if (attackers.length > 0 && isArmed(r) && inCityArea(world, hq, r.x, r.y, size)) {
      const nearest = attackers.reduce((a, b) =>
        wrapDistance(size, r, b) < wrapDistance(size, r, a) ? b : a,
      )
      r.order = attackOrder(nearest.id)
      return
    }
    const post = posts[i % posts.length]!
    if (r.order === null && (r.x !== post.x || r.y !== post.y)) walkTo(r, post)
  })
}

/**
 * How many soldiers the Trade Organization lacks (`CONTEXT.md`: Trade Org army): none while its
 * soldiers, the adults it could still arm and its mercenaries (hired or asked for) come to at
 * least `TRADE_ORG_ARMY.hireBelow` of its army's size; once they don't, it has lost too many and
 * lacks the rest of its size.
 */
export function soldiersLacking(world: WorldState, hq: City): number {
  const crew = caravanCrew(world)
  const adults = world.residents.filter(
    (r) => r.cityId === hq.id && r.owner === null && r.health > 0 && !crew.has(r.id),
  )
  const working = adults.filter((r) => canWork(r, world.tick))
  const soldiers = working.filter(isArmed).length
  const armable = Math.max(0, working.length - TRADE_ORG_ARMY.workers - soldiers)
  const hired = world.contracts
    .filter((c) => c.hirerId === TRADE_ORG)
    .reduce((n, c) => n + c.residentIds.length, 0)
  const strength = soldiers + armable + hired
  if (strength >= TRADE_ORG_ARMY.size * TRADE_ORG_ARMY.hireBelow) return 0
  return TRADE_ORG_ARMY.size - strength
}

/**
 * The Trade Organization hires mercenaries once it has lost too many (`soldiersLacking`): it asks
 * Players' realms for their armed residents nearest the HQ (never a Leader, nor anyone in a
 * contract or an alliance army, nor of a realm it refuses to trade with), the nearest realm first, as many as it lacks, at its own price
 * and length, paid into the lender's storage nearest them. It asks each realm at most once at a
 * time; the Player accepts or declines.
 */
function hireMercenaries(world: WorldState, hq: City, size: number): void {
  let lacking = soldiersLacking(world, hq)
  const hall = townHallOf(world, hq)
  if (lacking <= 0 || !hall) return
  const leaders = new Set(world.realms.map((r) => r.leaderId))
  const busy = new Set(world.contracts.flatMap((c) => c.residentIds))
  const asked = new Set(
    world.contracts
      .filter((c) => c.hirerId === TRADE_ORG && c.startedAt === null)
      .map((c) => c.lenderId),
  )
  const candidates = world.residents
    .filter(
      (r) =>
        r.owner !== null &&
        r.health > 0 &&
        isArmed(r) &&
        !leaders.has(r.id) &&
        !busy.has(r.id) &&
        !asked.has(r.owner) &&
        !tradeOrgRefuses(world, r.owner) &&
        !handedOverTo(world, r.id),
    )
    .sort(
      (a, b) =>
        wrapDistance(size, hall, a) - wrapDistance(size, hall, b) || a.id.localeCompare(b.id),
    )
  const byRealm = new Map<string, Resident[]>()
  for (const r of candidates) byRealm.set(r.owner!, [...(byRealm.get(r.owner!) ?? []), r])
  for (const [realmId, residents] of byRealm) {
    if (lacking <= 0) break
    const take = residents.slice(0, lacking)
    const storage = nearestStorage(world, realmId, take[0]!, size)
    if (!storage) continue
    const c: MercenaryContract = {
      id: newId(world, 'contract'),
      lenderId: realmId,
      hirerId: TRADE_ORG,
      offeredBy: 'hirer',
      residentIds: take.map((r) => r.id),
      days: TRADE_ORG_ARMY.hireDays,
      pricePerWeek: take.length * TRADE_ORG_ARMY.hirePricePerSoldierWeek,
      storageId: storage.id,
      startedAt: null,
      paidWeeks: 0,
    }
    world.contracts.push(c)
    recordEvent(world, realmId, {
      kind: 'contract',
      contractId: c.id,
      what: 'offered',
      lender: true,
      other: realmName(world, TRADE_ORG),
      residents: take.length,
    })
    lacking -= take.length
  }
}

/** The realm's finished storage nearest `from`, if it has one. */
function nearestStorage(
  world: WorldState,
  realmId: string,
  from: { x: number; y: number },
  size: number,
): Building | undefined {
  const cities = new Set(world.cities.filter((c) => c.realmId === realmId).map((c) => c.id))
  let best: Building | undefined
  for (const b of world.buildings) {
    if (b.kind !== 'storage' || b.site || b.cityId === null || !cities.has(b.cityId)) continue
    if (!best || wrapDistance(size, from, b) < wrapDistance(size, from, best)) best = b
  }
  return best
}

/**
 * The Trade Org army holds together (`CONTEXT.md`: Trade Org army; ADR 0004): the HQ's inner
 * gates are closed; the Trade Organization rents out only soldiers of its HQ, paid into one of its
 * warehouses; and it never hires a Leader.
 */
export const tradeOrgArmySound: Invariant = {
  name: 'trade-org-army-sound',
  check(world, terrain) {
    const out: InvariantViolation[] = []
    const fail = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const hq = tradeOrgHq(world)
    const hall = hq && townHallOf(world, hq)
    if (hq && hall) {
      for (const g of innerGates(world, hq, hall, terrain.size)) {
        if (!g.closed) fail(`inner gate ${g.id} of the Trade Org HQ is open`, [g.id])
      }
    }
    const leaders = new Set(world.realms.map((r) => r.leaderId))
    for (const c of world.contracts) {
      if (c.lenderId === TRADE_ORG) {
        for (const id of c.residentIds) {
          const r = world.residents.find((x) => x.id === id)
          if (r && (!hq || !ofHq(hq, r))) {
            fail(`contract ${c.id} rents out ${id}, who is not of the Trade Org HQ`, [c.id, id])
          }
        }
        const b = world.buildings.find((x) => x.id === c.storageId)
        if (b && b.kind !== 'warehouse') {
          fail(`contract ${c.id} is paid into ${b.id}, which is no warehouse`, [c.id, b.id])
        }
      }
      if (c.hirerId === TRADE_ORG) {
        for (const id of c.residentIds) {
          if (leaders.has(id)) fail(`the Trade Organization hires Leader ${id}`, [c.id, id])
        }
      }
    }
    return out
  },
}
