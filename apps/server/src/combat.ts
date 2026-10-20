import {
  commands,
  SIGHT_RANGE,
  STRIKE_TICKS,
  blowDamage,
  combatLearned,
  dodgeChance,
  inContact,
  isArmed,
  onOwnWall,
  WALL_DEFENCE,
  attackPower,
  brokenReturns,
  foreignWall,
  isWallOrGate,
  wallStrength,
  wallStrengthLeft,
  wrapDistance,
  type AttackOrder,
  type Building,
  type OrderRequest,
  type Realm,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { updateCityMembership } from './cities.js'
import { buildingOrganization, commitCrime, organizationOf } from './crimes.js'
import { recordEvent } from './events.js'
import { noteMade } from './goods-made.js'
import type { OrderKind } from './orders.js'
import { hash, mulberry32 } from './residents.js'
import { realmOf } from './starting-city.js'
import { dieAll, dropGoods } from './survival.js'

/**
 * An action a resident with an attack order requests once they are in contact with their target
 * and ready for their next blow: strike the target. The world checks and resolves it at the end
 * of the tick.
 */
export interface StrikeAction {
  attackerId: string
  targetId: string
}

/**
 * What an attack order goes after: the resident `targetId`, or else the finished wall or gate of
 * that id (`CONTEXT.md`: Walls in combat, broken); undefined once it is gone.
 */
export function attackTarget(world: WorldState, targetId: string): Resident | Building | undefined {
  const r = world.residents.find((x) => x.id === targetId)
  if (r) return r
  const b = world.buildings.find((x) => x.id === targetId)
  return b && isWallOrGate(b) ? b : undefined
}

/** Whether an attack target is a wall or gate rather than a resident. */
function isBuilding(t: Resident | Building): t is Building {
  return 'kind' in t
}

/** The input of an attack order: which of the Player's residents attacks whom. */
interface AttackRequest extends OrderRequest {
  kind: 'attack'
  residentId: string
  targetId: string
}

/**
 * A fresh attack order on `targetId`; `started` when the fight is already in the realm logs,
 * `defending` when it is fighting back at someone who hit the resident.
 */
export function attackOrder(targetId: string, started = false, defending = false): AttackOrder {
  const o: AttackOrder = { kind: 'attack', targetId, path: null, progress: 0, strike: 0, started }
  if (defending) o.defending = true
  return o
}

/**
 * Whether `a` striking `t` is a crime (`CONTEXT.md`: Crime): not when `a` fights back at someone
 * who hit them, nor when `t` is attacking someone of `a`'s Organization on their own account.
 */
function isAggression(world: WorldState, a: Resident, t: Resident): boolean {
  if (a.order?.kind === 'attack' && a.order.defending) return false
  const o = t.order
  if (o?.kind !== 'attack' || o.defending) return true
  const theirTarget = world.residents.find((x) => x.id === o.targetId)
  return !theirTarget || organizationOf(theirTarget) !== organizationOf(a)
}

/**
 * The attack order (`CONTEXT.md`: Combat): one of the Player's residents goes after a resident of
 * another realm, or of none, that the Player sees, and strikes them once in contact. The target
 * may also be a wall or gate of another realm's city, or of none, to break it (`CONTEXT.md`:
 * Walls in combat).
 */
export const attack: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<AttackRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!realm || !commands(world, realm.id, r)) return 'not one of your residents'
    const resident = world.residents.find((x) => x.id === o.targetId)
    if (resident?.owner === realm.id) return 'that is one of your own residents'
    let target: { x: number; y: number } | undefined = resident
    if (!target) {
      const wall = foreignWall(world, realm.id, o.targetId)
      if (typeof wall === 'string')
        return world.buildings.some((b) => b.id === o.targetId) ? wall : 'no such resident'
      target = wall
    }
    const size = terrain?.size
    const seen = world.residents.some(
      (x) => commands(world, realm.id, x) && size && wrapDistance(size, x, target) <= SIGHT_RANGE,
    )
    if (size && !seen)
      return resident ? 'that resident is out of sight' : 'that wall is out of sight'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, targetId } = order as AttackRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (r) r.order = attackOrder(targetId)
  },
}

/**
 * Requests this tick's blows from residents' attack orders, on a map of `size` tiles. An order
 * whose target (a resident, or a wall or gate) is gone or out of the attacker's sight ends. An attacker in contact with their
 * target stops walking and gets `1 / STRIKE_TICKS` closer to their next blow; once there, they
 * strike.
 */
export function requestStrikes(world: WorldState, size: number): StrikeAction[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const strikes: StrikeAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'attack') continue
    const target = byId.get(o.targetId) ?? attackTarget(world, o.targetId)
    if (!target || target === r || wrapDistance(size, r, target) > SIGHT_RANGE) {
      r.order = null
      continue
    }
    if (!inContact(size, r, target)) continue
    o.path = null
    o.progress = 0
    o.strike += 1 / STRIKE_TICKS
    if (o.strike < 1 - 1e-9) continue
    o.strike = 0
    strikes.push({ attackerId: r.id, targetId: target.id })
  }
  return strikes
}

/** What combat did this tick. */
export interface CombatResult {
  /** Blows struck, landed or dodged. */
  blows: number
  /** Residents killed this tick. */
  died: Resident[]
  /** Walls and gates broken this tick. */
  broken: Building[]
  /** Realms that ended because their Leader was killed. */
  ended: Realm[]
}

/**
 * Resolves blows (ADR 0002), one after another (`CONTEXT.md`: Combat), on a map of `size` tiles.
 * A blow is struck only by a living attacker still attacking a living target in contact. The
 * first blow of a fight goes in both realms' logs. Both learn Combat from it; the target dodges
 * it by Agility, or it lands and takes its `blowDamage` off their health, only `WALL_DEFENCE` of it
 * for a target on their own city's wall (`CONTEXT.md`: Walls in combat). A target left with no
 * health is killed and drops what they carried (`CONTEXT.md`: Loot); otherwise one who is armed
 * fights back, unless already attacking someone, and one who is not flees home. A climber can't
 * defend themselves: they don't dodge, fight back or flee (`CONTEXT.md`: Walls in combat).
 * A blow at a wall or gate always lands (`breakWall`).
 */
export function resolveStrikes(
  world: WorldState,
  strikes: StrikeAction[],
  size: number,
): CombatResult {
  const killers = new Map<string, string>()
  const died: Resident[] = []
  const broken: Building[] = []
  let blows = 0
  for (const { attackerId, targetId } of strikes) {
    const a = world.residents.find((x) => x.id === attackerId)
    const target = attackTarget(world, targetId)
    if (!a || !target || a.health <= 0) continue
    const o = a.order
    if (o?.kind !== 'attack' || o.targetId !== target.id || !inContact(size, a, target)) continue
    if (isBuilding(target)) {
      blows++
      if (breakWall(world, a, target, size)) broken.push(target)
      continue
    }
    const t = target
    if (t.health <= 0) continue
    blows++
    if (!o.started) {
      o.started = true
      const fight = { kind: 'fight' } as const
      recordEvent(world, a.owner, {
        ...fight,
        residentId: a.id,
        name: a.name,
        otherId: t.id,
        other: t.name,
        attacker: true,
      })
      recordEvent(world, t.owner, {
        ...fight,
        residentId: t.id,
        name: t.name,
        otherId: a.id,
        other: a.name,
        attacker: false,
      })
      if (isAggression(world, a, t)) {
        commitCrime(world, size, 'attack', a, { victimOrg: organizationOf(t), victim: t })
      }
    }
    a.skills.combat = (a.skills.combat ?? 0) + combatLearned(a, world.tick)
    t.skills.combat = (t.skills.combat ?? 0) + combatLearned(t, world.tick)
    const roll = mulberry32(hash(`${world.seed}:${world.tick}:${a.id}:strike`))()
    const climbing = t.order?.kind === 'climb'
    if (!climbing && roll < dodgeChance(t, world.tick)) continue
    const cover = onOwnWall(world, t) ? WALL_DEFENCE : 1
    t.health = Math.max(0, t.health - blowDamage(a, t, world.tick) * cover)
    if (t.health <= 0) {
      died.push(t)
      killers.set(t.id, a.name)
      if (isAggression(world, a, t)) {
        commitCrime(world, size, 'killing', a, { victimOrg: organizationOf(t), victim: t })
      }
      continue
    }
    react(world, t, a)
  }
  const ended = dieAll(world, died, 'killed', size, killers)
  if (broken.length > 0) updateCityMembership(world, size)
  const gone = new Set([...died, ...broken].map((x) => x.id))
  for (const r of world.residents) {
    if (r.order?.kind === 'attack' && gone.has(r.order.targetId)) r.order = null
  }
  return { blows, died, broken, ended }
}

/**
 * A blow from `a` at the wall or gate `b` (`CONTEXT.md`: Walls in combat, broken): it always
 * lands, its attacker's `attackPower` going onto the wall's damage, and teaches Combat. Once the
 * wall has taken its `wallStrength` it falls: it is gone and `brokenReturns` of its materials
 * lie on its tile. Breaking another Organization's wall is a crime of tearing down by whoever
 * strikes the last blow (`CONTEXT.md`: Crime). Returns whether it fell.
 */
function breakWall(world: WorldState, a: Resident, b: Building, size: number): boolean {
  a.skills.combat = (a.skills.combat ?? 0) + combatLearned(a, world.tick)
  b.damage = Math.min(wallStrength(b), (b.damage ?? 0) + attackPower(a, world.tick))
  if (wallStrengthLeft(b) > 0) return false
  const victimOrg = buildingOrganization(world, b)
  commitCrime(world, size, 'tearDown', a, { victimOrg, building: b.kind })
  world.buildings = world.buildings.filter((x) => x !== b)
  const returned = brokenReturns(b)
  dropGoods(world, b.x, b.y, returned)
  noteMade(world, returned)
  return true
}

/**
 * A resident `t` hit by `a` and still alive (`CONTEXT.md`: Combat): armed, they fight back unless
 * they are already attacking someone; unarmed, they flee home, walking to their city's town hall.
 */
function react(world: WorldState, t: Resident, a: Resident): void {
  if (t.order?.kind === 'climb') return
  if (isArmed(t)) {
    if (t.order?.kind !== 'attack') t.order = attackOrder(a.id, true, true)
    return
  }
  const city = world.cities.find((c) => c.id === t.cityId)
  const hall = city && world.buildings.find((b) => b.id === city.townHallId)
  if (!hall) return
  const o = t.order
  const fleeing = o?.kind === 'walkTo' && o.target.x === hall.x && o.target.y === hall.y
  if (fleeing || (t.x === hall.x && t.y === hall.y)) return
  t.order = { kind: 'walkTo', target: { x: hall.x, y: hall.y }, path: null, progress: 0 }
  recordEvent(world, t.owner, { kind: 'fled', residentId: t.id, name: t.name })
}
