import {
  MAP_SIZE,
  canWork,
  handOverProblem,
  inCityArea,
  servesOthers,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'

/*
 * The Leader handover (`CONTEXT.md`: Leader handover) is the Player's choice of who leads their
 * realm, not a physical action: it changes which resident the realm record names as its Leader,
 * plain data, which is all a script could do too (ADR 0002). It is checked when it arrives and
 * again when it applies, since the Leader or the new one may have moved in between.
 */

/** The input of a handover order: the Leader (`residentId`) names the new one. */
interface HandOverRequest extends OrderRequest {
  kind: 'handOver'
  residentId: string
  newLeaderId: string
}

function problem(
  world: WorldState,
  sender: OrderSender,
  order: OrderRequest,
  size: number,
): string | undefined {
  const realm = realmOf(world, sender.userId)
  if (!realm) return 'you have no realm'
  const o = order as Partial<HandOverRequest>
  const leader = world.residents.find((r) => r.id === o.residentId)
  const target = world.residents.find((r) => r.id === o.newLeaderId)
  return handOverProblem(world, realm, leader, target, size)
}

/**
 * The handover order: the realm's Leader makes another resident its Leader, free and at once,
 * also in the middle of a fight. Only `leaderId` changes: cities, contracts, alliances, standing,
 * scripts and the realm log stay with the realm, and the old Leader goes on as an ordinary
 * resident, doing what they were doing. The realm log records it.
 */
export const handOver: OrderKind = {
  validate(world, sender, order, terrain) {
    return problem(world, sender, order, terrain?.size ?? MAP_SIZE)
  },
  apply(world, sender, order, terrain) {
    const size = terrain?.size ?? MAP_SIZE
    if (problem(world, sender, order, size)) return
    const { residentId, newLeaderId } = order as HandOverRequest
    const realm = realmOf(world, sender.userId)!
    const from = world.residents.find((r) => r.id === residentId)!
    const to = world.residents.find((r) => r.id === newLeaderId)!
    const city = world.cities.find(
      (c) =>
        c.realmId === realm.id &&
        inCityArea(world, c, from.x, from.y, size) &&
        inCityArea(world, c, to.x, to.y, size),
    )!
    realm.leaderId = to.id
    recordEvent(world, realm.id, {
      kind: 'leaderHandedOver',
      fromId: from.id,
      from: from.name,
      toId: to.id,
      to: to.name,
      cityId: city.id,
      city: city.name,
      x: from.x,
      y: from.y,
    })
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Leader, Leader handover): every realm's Leader is a living
 * adult of that realm who serves no one else: rented out by no mercenary contract in force, and
 * in no alliance army.
 */
export const leadersServeNoOne: Invariant = {
  name: 'leaders-serve-no-one',
  check(world) {
    const out: InvariantViolation[] = []
    for (const realm of world.realms) {
      const leader = world.residents.find((r) => r.id === realm.leaderId)
      // A missing Leader or one of another realm is `realmsHaveLeaders`' to report.
      if (!leader || leader.owner !== realm.id) continue
      const fail = (p: string) =>
        out.push({
          invariant: this.name,
          message: `realm ${realm.id}'s Leader ${leader.id} ${p}`,
          entityIds: [realm.id, leader.id],
        })
      if (leader.health <= 0) fail('is dead')
      if (!canWork(leader, world.tick)) fail('is a child')
      const serves = servesOthers(world, leader.id)
      if (serves === 'contract') fail('is rented out by a mercenary contract')
      if (serves === 'allianceArmy') fail('is in an alliance army')
    }
    return out
  },
}
