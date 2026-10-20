import {
  SIGHT_RANGE,
  STRIKE_TICKS,
  blowDamage,
  combatLearned,
  dodgeChance,
  inContact,
  isArmed,
  onOwnWall,
  WALL_DEFENCE,
  wrapDistance,
  type AttackOrder,
  type OrderRequest,
  type Realm,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { OrderKind } from './orders.js'
import { hash, mulberry32 } from './residents.js'
import { realmOf } from './starting-city.js'
import { dieAll } from './survival.js'

/**
 * An action a resident with an attack order requests once they are in contact with their target
 * and ready for their next blow: strike the target. The world checks and resolves it at the end
 * of the tick.
 */
export interface StrikeAction {
  attackerId: string
  targetId: string
}

/** The input of an attack order: which of the Player's residents attacks whom. */
interface AttackRequest extends OrderRequest {
  kind: 'attack'
  residentId: string
  targetId: string
}

/** A fresh attack order on `targetId`; `started` when the fight is already in the realm logs. */
export function attackOrder(targetId: string, started = false): AttackOrder {
  return { kind: 'attack', targetId, path: null, progress: 0, strike: 0, started }
}

/**
 * The attack order (`CONTEXT.md`: Combat): one of the Player's residents goes after a resident of
 * another realm, or of none, that the Player sees, and strikes them once in contact.
 */
export const attack: OrderKind = {
  validate(world, sender, order, terrain) {
    const o = order as Partial<AttackRequest>
    const realm = realmOf(world, sender.userId)
    const r = world.residents.find((x) => x.id === o.residentId)
    if (!r || !realm || r.owner !== realm.id) return 'not one of your residents'
    const target = world.residents.find((x) => x.id === o.targetId)
    if (!target) return 'no such resident'
    if (target.owner === realm.id) return 'that is one of your own residents'
    const size = terrain?.size
    const seen = world.residents.some(
      (x) => x.owner === realm.id && size && wrapDistance(size, x, target) <= SIGHT_RANGE,
    )
    if (size && !seen) return 'that resident is out of sight'
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
 * whose target is gone or out of the attacker's sight ends. An attacker in contact with their
 * target stops walking and gets `1 / STRIKE_TICKS` closer to their next blow; once there, they
 * strike.
 */
export function requestStrikes(world: WorldState, size: number): StrikeAction[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const strikes: StrikeAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'attack') continue
    const target = byId.get(o.targetId)
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
 * fights back, unless already attacking someone, and one who is not flees home.
 */
export function resolveStrikes(
  world: WorldState,
  strikes: StrikeAction[],
  size: number,
): CombatResult {
  const killers = new Map<string, string>()
  const died: Resident[] = []
  let blows = 0
  for (const { attackerId, targetId } of strikes) {
    const a = world.residents.find((x) => x.id === attackerId)
    const t = world.residents.find((x) => x.id === targetId)
    if (!a || !t || a.health <= 0 || t.health <= 0) continue
    const o = a.order
    if (o?.kind !== 'attack' || o.targetId !== t.id || !inContact(size, a, t)) continue
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
    }
    a.skills.combat = (a.skills.combat ?? 0) + combatLearned(a, world.tick)
    t.skills.combat = (t.skills.combat ?? 0) + combatLearned(t, world.tick)
    const roll = mulberry32(hash(`${world.seed}:${world.tick}:${a.id}:strike`))()
    if (roll < dodgeChance(t, world.tick)) continue
    const cover = onOwnWall(world, t) ? WALL_DEFENCE : 1
    t.health = Math.max(0, t.health - blowDamage(a, t, world.tick) * cover)
    if (t.health <= 0) {
      died.push(t)
      killers.set(t.id, a.name)
      continue
    }
    react(world, t, a)
  }
  const ended = dieAll(world, died, 'killed', killers)
  const gone = new Set(died.map((r) => r.id))
  for (const r of world.residents) {
    if (r.order?.kind === 'attack' && gone.has(r.order.targetId)) r.order = null
  }
  return { blows, died, ended }
}

/**
 * A resident `t` hit by `a` and still alive (`CONTEXT.md`: Combat): armed, they fight back unless
 * they are already attacking someone; unarmed, they flee home, walking to their city's town hall.
 */
function react(world: WorldState, t: Resident, a: Resident): void {
  if (isArmed(t)) {
    if (t.order?.kind !== 'attack') t.order = attackOrder(a.id, true)
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
