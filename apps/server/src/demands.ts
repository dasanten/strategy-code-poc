import {
  DEMANDS_PER_GAME_DAY,
  DEMAND_MAX_DAYS,
  DEMAND_NOTE_MAX_LENGTH,
  GOODS,
  TICKS_PER_GAME_DAY,
  demandNoteProblem,
  demandsCounted,
  demandsLeft,
  realmName,
  realmsKnownTo,
  type City,
  type Demand,
  type DemandTerms,
  type Good,
  type OrderRequest,
  type Realm,
  type RealmEventWhat,
  type Remembered,
  type WorldState,
} from '@csp/shared'
import { handOverCity } from './capture.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { sightOf } from './sight.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Demands (`CONTEXT.md`: Demand; ADR 0024): a realm sends another realm it knows of terms, a note
 * and a deadline. It arrives at once, wherever the other is. They accept or decline it, or let it
 * lapse, and both realm logs say so. Accepting carries out the terms. Otherwise it is only words:
 * nothing happens by itself when it is ignored, and the sender acts on it or doesn't.
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
): { name: string; realmId: string | null } | undefined {
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
  if (!city) return 'you don’t know of that city'
  if (city.realmId !== toId) return 'as far as you know, that city isn’t theirs'
  return { kind: 'city', cityId: t.cityId as string, cityName: city.name }
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
  const toId = order.realmId
  if (toId === realm.id) return 'send a demand to another realm'
  if (typeof toId !== 'string' || !world.realms.some((r) => r.id === toId)) {
    return 'send a demand to a realm'
  }
  if (
    !realmsKnownTo(world, realm.id, []).includes(toId) &&
    !seesResidentsOf(world, realm.id, toId, size)
  ) {
    return 'you don’t know of that realm'
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
  leaderDied?: 'sender' | 'receiver',
): void {
  const base = {
    kind: 'demand' as const,
    demandId: d.id,
    terms: d.terms,
    ...(leaderDied === undefined ? {} : { leaderDied }),
  }
  recordEvent(world, d.fromId, {
    ...base,
    what: what.sender,
    mine: true,
    other: realmName(world, d.toId),
  })
  recordEvent(world, d.toId, {
    ...base,
    what: what.receiver,
    mine: false,
    other: realmName(world, d.fromId),
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
function answered(world: WorldState, d: Demand, answer: 'accepted' | 'declined'): void {
  world.demands = world.demands.filter((x) => x !== d)
  tellBoth(world, d, { sender: answer, receiver: answer })
}

/** The city a demand names, while it is still the city of the realm the demand was sent to. */
function cityToHandOver(world: WorldState, d: Demand): City | undefined {
  const { terms } = d
  if (terms.kind !== 'city') return undefined
  return world.cities.find((c) => c.id === terms.cityId && c.realmId === d.toId)
}

/**
 * Accepting a demand (`CONTEXT.md`: Demand): a named city joins the sender's realm at once, as a
 * captured one does, also the receiver's last. It is their own choice: no crime, no standing lost.
 * A city no longer theirs can't be handed over, so that demand stays open until they decline it or
 * it lapses. Goods and Coins are only recorded for now.
 */
const acceptDemand: OrderKind = {
  validate(world, sender, order) {
    const d = demandToAnswer(world, sender.userId, order)
    if (typeof d === 'string') return d
    if (d.terms.kind === 'city' && !cityToHandOver(world, d)) {
      return `${d.terms.cityName} is no longer yours to hand over`
    }
    return undefined
  },
  apply(world, sender, order, terrain) {
    const d = demandToAnswer(world, sender.userId, order)
    if (typeof d === 'string') return
    if (d.terms.kind === 'city') {
      // It may have gone since the order came, to another demand accepted in this same tick too.
      const city = cityToHandOver(world, d)
      if (!city || !terrain) return
      handOverCity(world, city, d.fromId, terrain.size)
    }
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
      d.fromId === realmId ? 'sender' : 'receiver',
    )
  }
}

/**
 * Demands lapse at their deadline, as a tick ends, and that is all: whatever was threatened is the
 * sender's to carry out, or not (`CONTEXT.md`: Demand).
 */
export function stepDemands(world: WorldState): void {
  if (world.demands.length === 0) return
  const lapsed = world.demands.filter((d) => world.tick >= d.deadline)
  if (lapsed.length === 0) return
  world.demands = world.demands.filter((d) => !lapsed.includes(d))
  for (const d of lapsed) tellBoth(world, d, { sender: 'lapsed', receiver: 'lapsed' })
}

/**
 * Demands hold together (`CONTEXT.md`: Demand): two different realms that exist, a deadline that
 * lies ahead and was set after it was sent, a note kept as the order allows, and terms that ask
 * for something. No realm has sent more than it may in a game day.
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
      for (const realm of [d.fromId, d.toId]) {
        if (!world.realms.some((r) => r.id === realm)) {
          report(`demand ${d.id} has realm ${realm}, which does not exist`, [d.id])
        }
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
