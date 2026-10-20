import {
  ALLIANCE_LEAVE_DELAY,
  ALLIANCE_NAME_MAX_LENGTH,
  ALLIANCE_RECALL_DELAY,
  allianceOf,
  carriageCommanderOf,
  commanderOf,
  drivenCarriageId,
  handedOverTo,
  isArmed,
  realmName,
  type Alliance,
  type AllianceArmyPart,
  type OrderRequest,
  type RealmEventWhat,
  type WorldState,
} from '@csp/shared'
import { leaveArmies } from './armies.js'
import { recordEvent } from './events.js'
import type { OrderKind, OrderSender } from './orders.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Alliance orders (`CONTEXT.md`: Alliance, Alliance leader) are agreements between Players, not
 * physical actions: they change the alliance records, plain data, which is all a script could do
 * too (ADR 0002). Each is checked when it arrives and again when it applies, since the alliance
 * may have changed in between.
 */

/** The sender's realm id, if they have a realm. */
const realmIdOf = (world: WorldState, sender: OrderSender) => realmOf(world, sender.userId)?.id

/** An order that only needs the sender's realm: `check` gives a reason to reject it. */
function allianceOrder(
  check: (world: WorldState, realmId: string, order: OrderRequest) => string | undefined,
  act: (world: WorldState, realmId: string, order: OrderRequest) => void,
): OrderKind {
  return {
    validate(world, sender, order) {
      const realmId = realmIdOf(world, sender)
      if (!realmId) return 'you have no realm'
      return check(world, realmId, order)
    },
    apply(world, sender, order) {
      const realmId = realmIdOf(world, sender)
      if (realmId && !check(world, realmId, order)) act(world, realmId, order)
    },
  }
}

/** The alliance the realm leads, or a reason it can't act as an alliance leader. */
function ledBy(world: WorldState, realmId: string): Alliance | string {
  const alliance = allianceOf(world, realmId)
  if (!alliance) return 'you are in no alliance'
  if (alliance.leaderId !== realmId) return 'only the alliance leader can do that'
  return alliance
}

/** Founding an alliance: the realm becomes its only member and its alliance leader. */
export const foundAlliance = allianceOrder(
  (world, realmId, order) => {
    if (allianceOf(world, realmId)) return 'you are already in an alliance'
    const name = typeof order.name === 'string' ? order.name.trim() : ''
    if (name.length === 0) return 'the alliance needs a name'
    if (name.length > ALLIANCE_NAME_MAX_LENGTH) {
      return `an alliance name is at most ${ALLIANCE_NAME_MAX_LENGTH} characters`
    }
    return undefined
  },
  (world, realmId, order) => {
    world.alliances.push({
      id: newId(world, 'alliance'),
      name: (order.name as string).trim(),
      leaderId: realmId,
      members: [{ realmId, joinedAt: world.tick, leaving: null }],
      invites: [],
      army: [],
    })
    dropInvitesTo(world, realmId)
  },
)

/** The alliance leader invites a realm in no alliance (`realmId`) to join. */
export const inviteToAlliance = allianceOrder(
  (world, realmId, order) => {
    const alliance = ledBy(world, realmId)
    if (typeof alliance === 'string') return alliance
    if (!world.realms.some((r) => r.id === order.realmId)) return 'no such realm'
    if (allianceOf(world, order.realmId as string)) return 'that realm is already in an alliance'
    if (alliance.invites.includes(order.realmId as string)) return 'already invited'
    return undefined
  },
  (world, realmId, order) => {
    const alliance = allianceOf(world, realmId)!
    alliance.invites.push(order.realmId as string)
    recordEvent(world, order.realmId as string, {
      kind: 'allianceInvited',
      allianceId: alliance.id,
      name: alliance.name,
    })
  },
)

/** The alliance leader takes back an invitation (`realmId`) not yet answered. */
export const withdrawInvite = allianceOrder(
  (world, realmId, order) => {
    const alliance = ledBy(world, realmId)
    if (typeof alliance === 'string') return alliance
    if (!alliance.invites.includes(order.realmId as string)) return 'that realm is not invited'
    return undefined
  },
  (world, realmId, order) => {
    const alliance = allianceOf(world, realmId)!
    alliance.invites = alliance.invites.filter((id) => id !== order.realmId)
  },
)

/** The invitation the realm holds from the alliance `allianceId`, or a reason it holds none. */
function invitation(world: WorldState, realmId: string, order: OrderRequest): Alliance | string {
  const alliance = world.alliances.find((a) => a.id === order.allianceId)
  if (!alliance || !alliance.invites.includes(realmId)) return 'you hold no such invitation'
  return alliance
}

/**
 * Accepting an invitation: the realm joins the alliance as its newest member. Its other
 * invitations lapse, since a realm is in at most one alliance.
 */
export const acceptInvite = allianceOrder(
  (world, realmId, order) => {
    const alliance = invitation(world, realmId, order)
    if (typeof alliance === 'string') return alliance
    if (allianceOf(world, realmId)) return 'you are already in an alliance'
    return undefined
  },
  (world, realmId, order) => {
    const alliance = invitation(world, realmId, order) as Alliance
    alliance.members.push({ realmId, joinedAt: world.tick, leaving: null })
    dropInvitesTo(world, realmId)
    tellMembers(world, alliance, {
      kind: 'allianceJoined',
      allianceId: alliance.id,
      name: alliance.name,
      realmId,
      realm: realmName(world, realmId),
    })
  },
)

/** Declining an invitation: it is gone, and the realm stays out. */
export const declineInvite = allianceOrder(
  (world, realmId, order) => {
    const alliance = invitation(world, realmId, order)
    return typeof alliance === 'string' ? alliance : undefined
  },
  (world, realmId, order) => {
    const alliance = invitation(world, realmId, order) as Alliance
    alliance.invites = alliance.invites.filter((id) => id !== realmId)
  },
)

/** Leaving the alliance: the realm stops being a member after the leave delay. */
export const leaveAlliance = allianceOrder(
  (world, realmId) => {
    const member = allianceOf(world, realmId)?.members.find((m) => m.realmId === realmId)
    if (!member) return 'you are in no alliance'
    if (member.leaving) return 'you are already leaving'
    return undefined
  },
  (world, realmId) => {
    const member = allianceOf(world, realmId)!.members.find((m) => m.realmId === realmId)!
    member.leaving = { at: world.tick + ALLIANCE_LEAVE_DELAY, removed: false }
  },
)

/** The alliance leader removes a member (`realmId`); it stops being one after the leave delay. */
export const removeFromAlliance = allianceOrder(
  (world, realmId, order) => {
    const alliance = ledBy(world, realmId)
    if (typeof alliance === 'string') return alliance
    if (order.realmId === realmId) return 'to go yourself, leave the alliance'
    const member = alliance.members.find((m) => m.realmId === order.realmId)
    if (!member) return 'that realm is not a member'
    if (member.leaving) return 'that realm is already leaving'
    return undefined
  },
  (world, realmId, order) => {
    const member = allianceOf(world, realmId)!.members.find((m) => m.realmId === order.realmId)!
    member.leaving = { at: world.tick + ALLIANCE_LEAVE_DELAY, removed: true }
  },
)

/** The realm's alliance, or a reason it can't hand over or recall: it is in none, or leaving. */
function standingMember(world: WorldState, realmId: string): Alliance | string {
  const alliance = allianceOf(world, realmId)
  const member = alliance?.members.find((m) => m.realmId === realmId)
  if (!alliance || !member) return 'you are in no alliance'
  if (member.leaving) return 'you are leaving the alliance'
  return alliance
}

/** The ids in `order[key]`, or undefined when that is not a list of distinct strings. */
function idList(order: OrderRequest, key: string): string[] | undefined {
  const ids = order[key] ?? []
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return undefined
  return new Set(ids).size === ids.length ? ids : undefined
}

/**
 * Handing over soldiers (`residentIds`) and carriages (`carriageIds`) to the alliance army
 * (`CONTEXT.md`: Alliance army): they stay the realm's but take orders only from the alliance
 * leader from then on. They stop what they were doing and leave any army they were in.
 */
export const handOverToAlliance = allianceOrder(
  (world, realmId, order) => {
    const alliance = standingMember(world, realmId)
    if (typeof alliance === 'string') return alliance
    const residentIds = idList(order, 'residentIds')
    const carriageIds = idList(order, 'carriageIds')
    if (!residentIds || !carriageIds) return 'name each soldier and carriage once'
    if (residentIds.length + carriageIds.length === 0) return 'hand over at least one'
    for (const id of residentIds) {
      const r = world.residents.find((x) => x.id === id)
      if (!r || r.owner !== realmId) return 'not all of them are your residents'
      if (handedOverTo(world, id)) return `${r.name} is already in the alliance army`
      if (world.contracts.some((c) => c.residentIds.includes(id))) {
        return `${r.name} is in a mercenary contract`
      }
      if (!isArmed(r)) return `${r.name} is not a soldier: they carry no weapon`
    }
    for (const id of carriageIds) {
      const k = world.carriages.find((x) => x.id === id)
      if (!k || k.realmId !== realmId) return 'not all of them are your carriages'
      if (handedOverTo(world, id)) return 'that carriage is already in the alliance army'
    }
    return undefined
  },
  (world, realmId, order) => {
    const alliance = allianceOf(world, realmId)!
    const residentIds = idList(order, 'residentIds')!
    const carriageIds = idList(order, 'carriageIds')!
    for (const id of residentIds) alliance.army.push({ is: 'resident', id, recallAt: null })
    for (const id of carriageIds) alliance.army.push({ is: 'carriage', id, recallAt: null })
    changedCommand(world, [...residentIds, ...carriageIds])
  },
)

/**
 * Recalling soldiers and carriages (`ids`) the realm handed over: they are theirs to command
 * again after `ALLIANCE_RECALL_DELAY`, and until then still take the alliance leader's orders.
 */
export const recallFromAlliance = allianceOrder(
  (world, realmId, order) => {
    const alliance = allianceOf(world, realmId)
    if (!alliance) return 'you are in no alliance'
    const ids = idList(order, 'ids')
    if (!ids || ids.length === 0) return 'name each soldier and carriage once'
    for (const id of ids) {
      const part = alliance.army.find((p) => p.id === id)
      if (!part || ownerOfPart(world, part) !== realmId) return 'you did not hand that over'
      if (part.recallAt !== null) return 'already recalled'
    }
    return undefined
  },
  (world, realmId, order) => {
    const ids = new Set(idList(order, 'ids'))
    for (const p of allianceOf(world, realmId)!.army) {
      if (ids.has(p.id)) p.recallAt = world.tick + ALLIANCE_RECALL_DELAY
    }
  },
)

/** The realm the soldier or carriage belongs to; undefined when it is gone. */
function ownerOfPart(world: WorldState, part: AllianceArmyPart): string | null | undefined {
  return part.is === 'resident'
    ? world.residents.find((r) => r.id === part.id)?.owner
    : world.carriages.find((k) => k.id === part.id)?.realmId
}

/**
 * The residents and carriages `ids` now take another realm's orders: the residents stop what
 * they did and leave their army; a carriage's driver who no longer commands it stops driving.
 */
function changedCommand(world: WorldState, ids: string[]): void {
  const changed = new Set(ids)
  for (const r of world.residents) {
    const drives = drivenCarriageId(r)
    const k = drives && changed.has(drives) && world.carriages.find((x) => x.id === drives)
    const lostCarriage = k && carriageCommanderOf(world, k) !== commanderOf(world, r)
    if (changed.has(r.id) || lostCarriage) {
      r.order = null
      delete r.script
    }
  }
  leaveArmies(world, changed)
}

/** Takes parts out of the alliance army: their owner commands them again. */
function giveBack(world: WorldState, alliance: Alliance, parts: AllianceArmyPart[]): void {
  if (parts.length === 0) return
  const ids = parts.map((p) => p.id)
  const before = new Map(ids.map((id) => [id, commanderOfId(world, id)]))
  alliance.army = alliance.army.filter((p) => !parts.includes(p))
  changedCommand(
    world,
    ids.filter((id) => commanderOfId(world, id) !== before.get(id)),
  )
}

/** Who commands the resident or carriage `id` now. */
function commanderOfId(world: WorldState, id: string): string | null | undefined {
  const r = world.residents.find((x) => x.id === id)
  if (r) return commanderOf(world, r)
  const k = world.carriages.find((x) => x.id === id)
  return k && carriageCommanderOf(world, k)
}

/** The alliance orders that exist. */
export const allianceOrders: Record<string, OrderKind> = {
  foundAlliance,
  inviteToAlliance,
  withdrawInvite,
  acceptInvite,
  declineInvite,
  leaveAlliance,
  removeFromAlliance,
  handOverToAlliance,
  recallFromAlliance,
}

/** Takes back every invitation to the realm. */
function dropInvitesTo(world: WorldState, realmId: string): void {
  for (const a of world.alliances) a.invites = a.invites.filter((id) => id !== realmId)
}

/** Writes an event in the realm log of every member of the alliance. */
function tellMembers(world: WorldState, alliance: Alliance, what: RealmEventWhat): void {
  for (const m of alliance.members) recordEvent(world, m.realmId, what)
}

/**
 * Ends the realm's membership now (`CONTEXT.md`: Alliance, Alliance leader): it is told, as are
 * the members staying. When it was the alliance leader, the role passes to the longest-standing
 * member left; an alliance with nobody left ends.
 */
function endMembership(
  world: WorldState,
  alliance: Alliance,
  realmId: string,
  why: 'left' | 'removed' | 'leaderDied',
): void {
  const realm = realmName(world, realmId)
  const left = { kind: 'allianceLeft', allianceId: alliance.id, name: alliance.name } as const
  tellMembers(world, alliance, { ...left, realmId, realm, why })
  // Leaving recalls everything the realm handed over (`CONTEXT.md`: Alliance army).
  const own = alliance.army.filter((p) => ownerOfPart(world, p) === realmId)
  giveBack(world, alliance, own)
  alliance.members = alliance.members.filter((m) => m.realmId !== realmId)
  const next = alliance.members[0]
  if (!next) {
    world.alliances = world.alliances.filter((a) => a !== alliance)
    return
  }
  if (alliance.leaderId !== realmId) return
  alliance.leaderId = next.realmId
  tellMembers(world, alliance, {
    kind: 'allianceLeader',
    allianceId: alliance.id,
    name: alliance.name,
    realmId: next.realmId,
    realm: realmName(world, next.realmId),
  })
}

/**
 * A realm whose Leader died leaves its alliance at once (`CONTEXT.md`: Alliance), and its
 * invitations lapse. Call it before the realm ends, so its name is still known.
 */
export function leaveOnLeaderDeath(world: WorldState, realmId: string): void {
  dropInvitesTo(world, realmId)
  const alliance = allianceOf(world, realmId)
  if (alliance) endMembership(world, alliance, realmId, 'leaderDied')
}

/**
 * One tick of alliances: recalls and leaves and removals whose delay has run out take effect.
 * Members and invitations of realms that no longer exist are dropped too, so a realm ended some
 * other way still leaves at once, and so are soldiers and carriages of the alliance army that are
 * gone or no longer belong to a member.
 */
export function stepAlliances(world: WorldState): void {
  const realms = new Set(world.realms.map((r) => r.id))
  for (const alliance of [...world.alliances]) {
    alliance.invites = alliance.invites.filter((id) => realms.has(id))
    const members = new Set(alliance.members.map((m) => m.realmId))
    const strays = alliance.army.filter((p) => !members.has(ownerOfPart(world, p) ?? ''))
    giveBack(world, alliance, strays)
    const due = alliance.army.filter((p) => p.recallAt !== null && p.recallAt <= world.tick)
    giveBack(world, alliance, due)
    for (const m of [...alliance.members]) {
      if (!realms.has(m.realmId)) {
        endMembership(world, alliance, m.realmId, 'leaderDied')
      } else if (m.leaving && m.leaving.at <= world.tick) {
        endMembership(world, alliance, m.realmId, m.leaving.removed ? 'removed' : 'left')
      }
    }
  }
}
