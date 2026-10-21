import {
  PERSUADE_ASK_AGAIN_DAYS,
  PERSUADE_CHECK_TICKS,
  TICKS_PER_GAME_DAY,
  forSale,
  holdsHigh,
  persuadedBy,
  respectSeenBy,
  standingOf,
  townHallOf,
  type City,
  type JoinRequest,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import { joinRealm } from './capture.js'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { realmOf } from './starting-city.js'

/*
 * Persuading a city (`CONTEXT.md`: Persuading a city, Respect): an NPC city that holds a realm in
 * high standing and sees more of its armed residents and walls than it has soldiers asks to join
 * it. The Player accepts, and the city joins the realm as when bought, or declines, and the city
 * doesn't ask that realm again for `PERSUADE_ASK_AGAIN_DAYS`.
 */

/** Whether a city still is one a realm can be asked by: an NPC city that isn't gone. */
const askable = (world: WorldState, cityId: string): City | undefined => {
  const city = world.cities.find((c) => c.id === cityId)
  return city && forSale(city) ? city : undefined
}

/**
 * One tick of persuasion. A city's ask is withdrawn, with a line in the realm log, once the city
 * is no NPC city any more, the realm is gone or the city no longer holds it in high standing; a
 * declined ask is forgotten after `PERSUADE_ASK_AGAIN_DAYS`. Every `PERSUADE_CHECK_TICKS`, each
 * NPC city that asks nobody yet asks the realm it is persuaded by (`persuadedBy`) and hasn't been
 * declined by lately: the one it holds in the highest standing, then the one it sees the most
 * respect from. `size` is the map's.
 */
export function stepPersuasion(world: WorldState, size: number): void {
  const realms = new Set(world.realms.map((r) => r.id))
  world.joinRequests = world.joinRequests.filter((q) => {
    const city = askable(world, q.cityId)
    if (q.declined) {
      return (
        city !== undefined &&
        realms.has(q.realmId) &&
        world.tick - q.at < PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY
      )
    }
    if (city && realms.has(q.realmId) && holdsHigh(world, city, q.realmId)) return true
    const name = city?.name ?? world.cities.find((c) => c.id === q.cityId)?.name
    if (realms.has(q.realmId) && name !== undefined) {
      recordEvent(world, q.realmId, { kind: 'joinWithdrawn', cityId: q.cityId, city: name })
    }
    return false
  })
  if (world.tick % PERSUADE_CHECK_TICKS !== 0) return
  for (const city of world.cities) {
    if (!forSale(city)) continue
    const asked = world.joinRequests.filter((q) => q.cityId === city.id)
    if (asked.some((q) => !q.declined)) continue
    const declined = new Set(asked.map((q) => q.realmId))
    const candidates = world.realms
      .map((r) => r.id)
      .filter((id) => !declined.has(id) && persuadedBy(world, city, id, size))
      .map((id) => ({
        id,
        standing: standingOf(world, city.id, id),
        respect: respectSeenBy(world, city, id, size),
      }))
      .sort((a, b) => b.standing - a.standing || b.respect - a.respect || (a.id < b.id ? -1 : 1))
    const realmId = candidates[0]?.id
    const hall = townHallOf(world, city)
    if (realmId === undefined || !hall) continue
    world.joinRequests.push({ cityId: city.id, realmId, at: world.tick, declined: false })
    recordEvent(world, realmId, {
      kind: 'joinAsked',
      cityId: city.id,
      city: city.name,
      x: hall.x,
      y: hall.y,
    })
  }
}

/** The ask of `order.cityId` to the sender's realm that stands now, or a reason. */
function askOf(
  world: WorldState,
  userId: number,
  order: OrderRequest,
): { realmId: string; ask: JoinRequest; city: City } | string {
  const realmId = realmOf(world, userId)?.id
  if (!realmId) return 'you have no realm'
  const ask = world.joinRequests.find(
    (q) => q.cityId === order.cityId && q.realmId === realmId && !q.declined,
  )
  const city = ask && askable(world, ask.cityId)
  if (!ask || !city) return 'that city isn’t asking to join your realm'
  return { realmId, ask, city }
}

/**
 * Accepting a city's ask to join (`CONTEXT.md`: Persuading a city): it joins the realm with
 * everything in it, as when bought (`joinRealm`), at the start of the next tick.
 */
export const acceptJoin: OrderKind = {
  validate(world, sender, order) {
    const found = askOf(world, sender.userId, order)
    return typeof found === 'string' ? found : undefined
  },
  apply(world, sender, order, terrain) {
    const found = askOf(world, sender.userId, order)
    if (typeof found === 'string' || !terrain) return
    const { realmId, city } = found
    world.joinRequests = world.joinRequests.filter((q) => q.cityId !== city.id)
    const residents = joinRealm(world, city, realmId, terrain.size)
    const hall = townHallOf(world, city)
    recordEvent(world, realmId, {
      kind: 'cityPersuaded',
      cityId: city.id,
      city: city.name,
      residents,
      x: hall?.x ?? 0,
      y: hall?.y ?? 0,
    })
  },
}

/** Declining a city's ask to join: it doesn't ask the realm again for a while. */
export const declineJoin: OrderKind = {
  validate(world, sender, order) {
    const found = askOf(world, sender.userId, order)
    return typeof found === 'string' ? found : undefined
  },
  apply(world, sender, order) {
    const found = askOf(world, sender.userId, order)
    if (typeof found === 'string') return
    found.ask.declined = true
    found.ask.at = world.tick
  },
}

/** The persuasion order kinds. */
export const persuasionOrders: Record<string, OrderKind> = { acceptJoin, declineJoin }

/**
 * Asks to join hold together (`CONTEXT.md`: Persuading a city): each from an NPC city to a realm
 * that exists, at most one per city and realm, at most one standing ask per city, made no later
 * than now, a standing one only toward a realm the city holds in high standing, and a declined
 * one forgotten in time.
 */
export const joinRequestsSound: Invariant = {
  name: 'join-requests-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const pairs = new Set<string>()
    const asking = new Set<string>()
    const realms = new Set(world.realms.map((r) => r.id))
    for (const q of world.joinRequests ?? []) {
      const report = (message: string) =>
        out.push({ invariant: this.name, message, entityIds: [q.cityId, q.realmId] })
      const pair = `${q.cityId} → ${q.realmId}`
      const city = askable(world, q.cityId)
      if (!city) report(`${q.cityId} asks ${q.realmId} to join but is no NPC city`)
      if (!realms.has(q.realmId)) report(`${q.cityId} asks ${q.realmId}, a realm that is gone`)
      if (q.at > world.tick) report(`the ask ${pair} is from the future`)
      if (pairs.has(pair)) report(`the ask ${pair} is kept twice`)
      pairs.add(pair)
      if (q.declined) {
        if (world.tick - q.at > PERSUADE_ASK_AGAIN_DAYS * TICKS_PER_GAME_DAY)
          report(`the declined ask ${pair} is remembered too long`)
        continue
      }
      if (asking.has(q.cityId)) report(`${q.cityId} asks more than one realm to join`)
      asking.add(q.cityId)
      if (city && !holdsHigh(world, city, q.realmId))
        report(`${q.cityId} asks ${q.realmId} to join without holding it in high standing`)
    }
    return out
  },
}
