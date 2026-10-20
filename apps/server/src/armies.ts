import {
  ARMY_NAME_MAX_LENGTH,
  ARMY_SPREAD,
  SIGHT_RANGE,
  armyOf,
  commanderOf,
  commands,
  inContact,
  wrapDistance,
  type Army,
  type AttackOrder,
  type OrderRequest,
  type Resident,
  type ResidentOrder,
  type WalkOrder,
  type WorldState,
} from '@csp/shared'
import { attackOrder } from './combat.js'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind } from './orders.js'
import { newId, realmOf } from './starting-city.js'

/*
 * Armies (`CONTEXT.md`: Army): a named group of a realm's residents under one order. The army's
 * order is plain data on the army (ADR 0002); each tick it gives its members walk or attack
 * orders tagged with the army, and walking holds back a member who gets ahead, so the army keeps
 * together at the pace of the slowest. A member given an order of their own leaves the army.
 */

/** An army order: `check` gives a reason to reject it, on a map of `size` tiles when known. */
function armyOrderKind(
  check: (
    world: WorldState,
    realmId: string,
    order: OrderRequest,
    size?: number,
  ) => string | undefined,
  act: (world: WorldState, realmId: string, order: OrderRequest) => void,
): OrderKind {
  return {
    validate(world, sender, order, terrain) {
      const realmId = realmOf(world, sender.userId)?.id
      if (!realmId) return 'you have no realm'
      return check(world, realmId, order, terrain?.size)
    },
    apply(world, sender, order) {
      const realmId = realmOf(world, sender.userId)?.id
      if (realmId && !check(world, realmId, order)) act(world, realmId, order)
    },
  }
}

/** The realm's army named by `order.armyId`, or a reason it is not one. */
function ownArmy(world: WorldState, realmId: string, order: OrderRequest): Army | string {
  const army = world.armies.find((a) => a.id === order.armyId)
  if (!army || army.realmId !== realmId) return 'not one of your armies'
  return army
}

/** Whether any of the realm's residents sees the spot. */
function inSightOf(world: WorldState, realmId: string, at: Resident, size: number): boolean {
  return world.residents.some(
    (x) => x.owner === realmId && wrapDistance(size, x, at) <= SIGHT_RANGE,
  )
}

/** A reason the army can't go after resident `order.targetId`, if any. */
function badTarget(
  world: WorldState,
  realmId: string,
  order: OrderRequest,
  size: number | undefined,
): string | undefined {
  const target = world.residents.find((x) => x.id === order.targetId)
  if (!target) return 'no such resident'
  if (size !== undefined && !inSightOf(world, realmId, target, size)) {
    return 'that resident is out of sight'
  }
  return undefined
}

/** A reason `order.x`, `order.y` is not a tile, if it is not. */
const badTile = (order: OrderRequest) =>
  Number.isInteger(order.x) && Number.isInteger(order.y) ? undefined : 'the target must be a tile'

/** Ends the army's own orders for its members: they stop what they did for it. */
function stopMembers(world: WorldState, army: Army): void {
  for (const r of world.residents) if (forArmy(r.order, army.id)) r.order = null
}

/** Takes residents out of every army; an army left with nobody is gone. */
export function leaveArmies(world: WorldState, ids: Set<string>): void {
  for (const a of world.armies) a.memberIds = a.memberIds.filter((id) => !ids.has(id))
  world.armies = world.armies.filter((a) => a.memberIds.length > 0)
}

/**
 * Forming an army: a name and some residents the realm commands, who leave any army they were in.
 * It starts idle; its members go on with what they were doing until it gets an order.
 */
export const formArmy = armyOrderKind(
  (world, realmId, order) => {
    const name = typeof order.name === 'string' ? order.name.trim() : ''
    if (name.length === 0) return 'the army needs a name'
    if (name.length > ARMY_NAME_MAX_LENGTH) {
      return `an army name is at most ${ARMY_NAME_MAX_LENGTH} characters`
    }
    const ids = order.residentIds
    if (!Array.isArray(ids) || ids.length === 0) return 'an army needs at least one resident'
    if (new Set(ids).size !== ids.length) return 'a resident is named twice'
    const own = (id: unknown) =>
      commands(
        world,
        realmId,
        world.residents.find((r) => r.id === id),
      )
    if (!ids.every(own)) return 'not all of them are your residents'
    return undefined
  },
  (world, realmId, order) => {
    const ids = order.residentIds as string[]
    leaveArmies(world, new Set(ids))
    world.armies.push({
      id: newId(world, 'army'),
      name: (order.name as string).trim(),
      realmId,
      memberIds: [...ids],
      order: null,
    })
  },
)

/** Disbanding an army: it is gone, and its members stop what they did for it. */
export const disbandArmy = armyOrderKind(
  (world, realmId, order) => {
    const army = ownArmy(world, realmId, order)
    return typeof army === 'string' ? army : undefined
  },
  (world, realmId, order) => {
    const army = ownArmy(world, realmId, order) as Army
    stopMembers(world, army)
    world.armies = world.armies.filter((a) => a !== army)
  },
)

/** An order for an army: checks it is the realm's, then `check`; `act` sets the army's order. */
function commandArmy(
  check: (
    world: WorldState,
    realmId: string,
    order: OrderRequest,
    army: Army,
    size?: number,
  ) => string | undefined,
  act: (army: Army, order: OrderRequest) => Army['order'],
): OrderKind {
  return armyOrderKind(
    (world, realmId, order, size) => {
      const army = ownArmy(world, realmId, order)
      if (typeof army === 'string') return army
      return check(world, realmId, order, army, size)
    },
    (world, realmId, order) => {
      const army = ownArmy(world, realmId, order) as Army
      stopMembers(world, army)
      army.order = act(army, order)
    },
  )
}

/** The army walks to a tile together. */
export const armyWalkTo = commandArmy(
  (_w, _r, order) => badTile(order),
  (_a, order) => ({
    kind: 'walkTo',
    target: { x: order.x as number, y: order.y as number },
    started: false,
  }),
)

/** The army walks to a tile together and stays there. */
export const armyGuard = commandArmy(
  (_w, _r, order) => badTile(order),
  (_a, order) => ({
    kind: 'guard',
    at: { x: order.x as number, y: order.y as number },
    started: false,
  }),
)

/** The army goes after a resident of another realm, or of none, in sight (`CONTEXT.md`: Combat). */
export const armyAttack = commandArmy(
  (world, realmId, order, _army, size) => {
    const bad = badTarget(world, realmId, order, size)
    if (bad) return bad
    const target = world.residents.find((x) => x.id === order.targetId)
    return target?.owner === realmId ? 'that is one of your own residents' : undefined
  },
  (_a, order) => ({ kind: 'attack', targetId: order.targetId as string, started: false }),
)

/** The army keeps in contact with a resident in sight, not one of its own, wherever they go. */
export const armyFollow = commandArmy(
  (world, realmId, order, army, size) => {
    const bad = badTarget(world, realmId, order, size)
    if (bad) return bad
    return army.memberIds.includes(order.targetId as string) ? 'that is one of the army' : undefined
  },
  (_a, order) => ({ kind: 'follow', targetId: order.targetId as string, started: false }),
)

/** The army stops: its order ends, and its members stop what they did for it. */
export const armyStop = commandArmy(
  () => undefined,
  () => null,
)

/** The army order kinds. */
export const armyOrders: Record<string, OrderKind> = {
  formArmy,
  disbandArmy,
  armyWalkTo,
  armyGuard,
  armyAttack,
  armyFollow,
  armyStop,
}

/** Whether the order is one the army `armyId` gave. */
function forArmy(o: ResidentOrder | null, armyId: string): o is WalkOrder | AttackOrder {
  return (o?.kind === 'walkTo' || o?.kind === 'attack') && o.army === armyId
}

/** Each army member's order as it is now, to tell later whether they got one of their own. */
export function memberOrders(world: WorldState): Map<string, ResidentOrder | null> {
  const out = new Map<string, ResidentOrder | null>()
  if (world.armies.length === 0) return out
  const members = new Set(world.armies.flatMap((a) => a.memberIds))
  for (const r of world.residents) if (members.has(r.id)) out.set(r.id, r.order)
  return out
}

/**
 * Members whose order changed since `before` (`memberOrders`) got an order of their own, and
 * leave their army (`CONTEXT.md`: Army).
 */
export function leaveOnOwnOrders(
  world: WorldState,
  before: Map<string, ResidentOrder | null>,
): void {
  if (before.size === 0) return
  const left = new Set<string>()
  for (const r of world.residents) {
    if (before.has(r.id) && before.get(r.id) !== r.order) left.add(r.id)
  }
  if (left.size > 0) leaveArmies(world, left)
}

const walkFor = (army: Army, x: number, y: number): WalkOrder => ({
  kind: 'walkTo',
  target: { x, y },
  path: null,
  progress: 0,
  army: army.id,
})

/**
 * Keeps armies sound and carries out their orders, on a map of `size` tiles, as a tick ends: a
 * member who died or no longer takes orders from the army's realm leaves it, an army with nobody
 * left or whose realm ended is gone, and an order tagged with an army the resident is not in is
 * their own from then on. Then each army's order gives its members their orders for the next
 * tick.
 */
export function stepArmies(world: WorldState, size: number): void {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const realms = new Set(world.realms.map((r) => r.id))
  for (const a of world.armies) {
    a.memberIds = a.memberIds.filter((id) => {
      const r = byId.get(id)
      return r !== undefined && commanderOf(world, r) === a.realmId
    })
  }
  world.armies = world.armies.filter((a) => a.memberIds.length > 0 && realms.has(a.realmId))
  const armyIdOf = new Map(world.armies.flatMap((a) => a.memberIds.map((id) => [id, a.id])))
  for (const r of world.residents) {
    const o = r.order
    if ((o?.kind === 'walkTo' || o?.kind === 'attack') && o.army !== undefined) {
      if (armyIdOf.get(r.id) !== o.army) delete o.army
    }
  }
  for (const army of world.armies) {
    const members = army.memberIds.map((id) => byId.get(id)!)
    carryOut(world, army, members, size)
  }
}

/** Gives the army's members their orders from the army's, and ends an order that is done. */
function carryOut(world: WorldState, army: Army, members: Resident[], size: number): void {
  const o = army.order
  if (!o) return
  const busy = () => members.some((m) => forArmy(m.order, army.id))
  if (o.kind === 'walkTo' || o.kind === 'attack') {
    if (o.started) {
      if (!busy()) army.order = null
      return
    }
    for (const m of members) {
      m.order =
        o.kind === 'walkTo'
          ? walkFor(army, o.target.x, o.target.y)
          : { ...attackOrder(o.targetId), army: army.id }
    }
    o.started = true
    return
  }
  if (o.kind === 'guard') {
    for (const m of members) {
      const here = m.x === o.at.x && m.y === o.at.y
      // At first everyone goes; later only a member idle away from the spot walks back.
      if (o.started ? m.order === null && !here : !here) m.order = walkFor(army, o.at.x, o.at.y)
      else if (!o.started) m.order = null
    }
    o.started = true
    return
  }
  const target = world.residents.find((x) => x.id === o.targetId)
  if (!target || !members.some((m) => wrapDistance(size, m, target) <= SIGHT_RANGE)) {
    stopMembers(world, army)
    army.order = null
    return
  }
  for (const m of members) {
    if (o.started && m.order !== null && !forArmy(m.order, army.id)) continue
    const mo = m.order
    if (inContact(size, m, target)) {
      if (!o.started || forArmy(mo, army.id)) m.order = null
      continue
    }
    const keeps =
      o.started && mo?.kind === 'walkTo' && inContact(size, mo.target, target) && mo.army
    if (!keeps) m.order = walkFor(army, target.x, target.y)
  }
  o.started = true
}

/**
 * Which residents walking for an army wait this tick (`CONTEXT.md`: Army: at the pace of the
 * slowest). Members walking for the same army keep together: while any of them is still finding
 * their way, all wait; otherwise one with more than `ARMY_SPREAD` tiles fewer to go than the one
 * furthest behind waits for them. `holding` are residents that don't walk this tick anyway, such
 * as attackers in contact with their target.
 */
export function waitingForArmy(world: WorldState, holding: Set<string>): Set<string> {
  const groups = new Map<string, { id: string; left: number | null }[]>()
  for (const r of world.residents) {
    const o = r.order
    if ((o?.kind !== 'walkTo' && o?.kind !== 'attack') || o.army === undefined) continue
    if (holding.has(r.id)) continue
    const group = groups.get(o.army) ?? []
    group.push({ id: r.id, left: o.path?.length ?? null })
    groups.set(o.army, group)
  }
  const waiting = new Set<string>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const finding = group.some((m) => m.left === null)
    const behind = Math.max(...group.map((m) => m.left ?? 0))
    for (const m of group) {
      if (finding || m.left! < behind - ARMY_SPREAD) waiting.add(m.id)
    }
  }
  return waiting
}

/**
 * Armies hold together (`CONTEXT.md`: Army): each has a name, belongs to a realm that exists and
 * has members, all living residents that realm commands (`commanderOf`), none in two armies; an
 * order tagged with an army is held by one of its members.
 */
export const armiesSound: Invariant = {
  name: 'armies-sound',
  check(world) {
    const out: InvariantViolation[] = []
    const report = (message: string, entityIds: string[]) =>
      out.push({ invariant: this.name, message, entityIds })
    const byId = new Map(world.residents.map((r) => [r.id, r]))
    const seen = new Set<string>()
    for (const a of world.armies) {
      if (a.name.trim() === '') report(`army ${a.id} has no name`, [a.id])
      if (!world.realms.some((r) => r.id === a.realmId)) {
        report(`army ${a.id} belongs to realm ${a.realmId}, which does not exist`, [a.id])
      }
      if (a.memberIds.length === 0) report(`army ${a.id} has no members`, [a.id])
      for (const id of a.memberIds) {
        const r = byId.get(id)
        if (!r) report(`army ${a.id} has member ${id}, who does not exist`, [a.id, id])
        else if (commanderOf(world, r) !== a.realmId) {
          report(`army ${a.id} has member ${id} another realm commands`, [a.id, id])
        }
        if (seen.has(id)) report(`resident ${id} is in two armies`, [id])
        seen.add(id)
      }
    }
    for (const r of world.residents) {
      const o = r.order
      if ((o?.kind !== 'walkTo' && o?.kind !== 'attack') || o.army === undefined) continue
      if (armyOf(world, r.id)?.id !== o.army) {
        report(`resident ${r.id} holds an order of army ${o.army}, not theirs`, [r.id])
      }
    }
    return out
  },
}
