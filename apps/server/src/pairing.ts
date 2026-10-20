import {
  TICKS_PER_GAME_YEAR,
  canWork,
  commands,
  freeHousing,
  hasFoodSurplus,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { OrderKind } from './orders.js'
import { hash, mulberry32, newChild } from './residents.js'
import { newId, realmOf } from './starting-city.js'

/**
 * An action a pair requests once a game year has passed since they paired or last had a child:
 * to have a child. The world checks and resolves it at the end of the tick.
 */
export interface BirthAction {
  parentIds: [string, string]
}

/** The input of a pairing order: two of the Player's residents. */
interface PairRequest extends OrderRequest {
  kind: 'pair'
  residentId: string
  partnerId: string
}

/**
 * The pairing order (`CONTEXT.md`: Pairing): two adult residents of the same city, both the
 * Player's, are set to have children. Both get a pair order naming the other. A pair ordered
 * again keeps its time since the last child; a new pair starts counting now.
 */
export const pair: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<PairRequest>
    const realm = realmOf(world, sender.userId)
    const mine = (id: unknown) =>
      world.residents.find((x) => x.id === id && realm && commands(world, realm.id, x))
    const r = mine(o.residentId)
    const partner = mine(o.partnerId)
    if (!r || !partner) return 'not one of your residents'
    if (r === partner) return 'a resident can’t pair with themselves'
    if (!canWork(r, world.tick) || !canWork(partner, world.tick)) return 'children can’t pair'
    if (r.cityId === null || r.cityId !== partner.cityId) return 'they must live in the same city'
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, partnerId } = order as PairRequest
    const r = world.residents.find((x) => x.id === residentId)
    const partner = world.residents.find((x) => x.id === partnerId)
    if (!r || !partner) return
    const already = pairedWith(r, partner) && pairedWith(partner, r) ? r.order : null
    const since = already?.kind === 'pair' ? already.since : world.tick
    r.order = { kind: 'pair', partnerId: partner.id, since }
    partner.order = { kind: 'pair', partnerId: r.id, since }
  },
}

function pairedWith(r: Resident, partner: Resident): boolean {
  return r.order?.kind === 'pair' && r.order.partnerId === partner.id
}

/**
 * Ends pair orders whose partner is gone or no longer pairs back (given another order, or paired
 * with someone else), then requests a birth for every pair whose game year has passed.
 */
export function requestBirths(world: WorldState): BirthAction[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const broken = world.residents.filter((r) => {
    if (r.order?.kind !== 'pair') return false
    const partner = byId.get(r.order.partnerId)
    return !partner || !pairedWith(partner, r)
  })
  for (const r of broken) r.order = null

  const actions: BirthAction[] = []
  for (const r of world.residents) {
    const o = r.order
    if (o?.kind !== 'pair' || r.id > o.partnerId) continue
    if (world.tick - o.since >= TICKS_PER_GAME_YEAR)
      actions.push({ parentIds: [r.id, o.partnerId] })
  }
  return actions
}

/**
 * Resolves birth actions (ADR 0002), one after another (`CONTEXT.md`: Pairing, Child). A child
 * is born only to a pair still paired, in the same city, when that city has free housing and a
 * food surplus; it appears on the first parent's tile, lives in their city and belongs to their
 * realm, and goes in the Player's realm log. Both parents' year starts again. A pair whose city
 * has no room or food waits, and asks again next tick.
 */
export function resolveBirths(world: WorldState, actions: BirthAction[]): Resident[] {
  const born: Resident[] = []
  for (const { parentIds } of actions) {
    const [a, b] = parentIds.map((id) => world.residents.find((r) => r.id === id))
    if (!a || !b || !pairedWith(a, b) || !pairedWith(b, a)) continue
    const city = world.cities.find((c) => c.id === a.cityId)
    if (!city || b.cityId !== city.id) continue
    if (freeHousing(world, city) <= 0 || !hasFoodSurplus(world, city)) continue
    const id = newId(world, 'r')
    const child = newChild(mulberry32(hash(`${world.seed}:${id}`)), [a, b], {
      id,
      owner: a.owner,
      cityId: city.id,
      x: a.x,
      y: a.y,
      tick: world.tick,
    })
    world.residents.push(child)
    born.push(child)
    for (const parent of [a, b]) {
      if (parent.order?.kind === 'pair') parent.order.since = world.tick
    }
    recordEvent(world, child.owner, {
      kind: 'born',
      residentId: child.id,
      name: child.name,
      parents: [a.name, b.name],
    })
  }
  return born
}
