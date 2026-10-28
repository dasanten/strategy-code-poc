import {
  CARRYING_A_CHILD,
  CARRYING_TICKS,
  commands,
  PAIRING_WAIT_TICKS,
  canWork,
  freeHousing,
  hasFoodSurplus,
  type City,
  type OrderRequest,
  type Resident,
  type ResidentOrder,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import type { OrderKind } from './orders.js'
import { baseStats, hash, mulberry32, newChild } from './residents.js'
import { newId, realmOf } from './starting-city.js'

/**
 * An action a pair requests (`CONTEXT.md`: Pairing, Carrying): once `PAIRING_WAIT_DAYS` have passed
 * since they paired, that one of them starts carrying a child; once a partner has carried for
 * `CARRYING_DAYS`, that the child is born. The world checks and resolves it at the end of the
 * tick.
 */
export type BirthAction =
  { kind: 'carry'; parentIds: [string, string] } | { kind: 'birth'; parentId: string }

/** The input of a pairing order: two of the Player's residents. */
interface PairRequest extends OrderRequest {
  kind: 'pair'
  residentId: string
  partnerId: string
}

/**
 * Orders a carrying resident can't hold (`CONTEXT.md`: Carrying): working, building, tearing down,
 * breeding horses and hauling. Walking, eating and handling goods go on.
 */
export const CARRYING_BLOCKS: ReadonlySet<ResidentOrder['kind']> = new Set([
  'workAt',
  'breed',
  'build',
  'roadLine',
  'wallLine',
  'tearDown',
  'haul',
])

/**
 * The pairing order (`CONTEXT.md`: Pairing): two adult residents of the same city, both the
 * Player's, are set to have a child. Both get a pair naming the other; neither's order changes.
 * A pair ordered again keeps its time; a new pair starts counting now. A resident carrying a
 * child can't pair until it is born.
 */
export const pair: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<PairRequest>
    const realm = realmOf(world, sender.userId)
    const mine = (id: unknown) => {
      const x = world.residents.find((y) => y.id === id)
      return realm && commands(world, realm.id, x) ? x : undefined
    }
    const r = mine(o.residentId)
    const partner = mine(o.partnerId)
    if (!r || !partner) return 'not one of your residents'
    if (r === partner) return 'a resident can’t pair with themselves'
    if (!canWork(r, world.tick) || !canWork(partner, world.tick)) return 'children can’t pair'
    if (r.cityId === null || r.cityId !== partner.cityId) return 'they must live in the same city'
    if (r.carrying || partner.carrying) return CARRYING_A_CHILD
    return undefined
  },
  apply(world, _sender, order) {
    const { residentId, partnerId } = order as PairRequest
    const r = world.residents.find((x) => x.id === residentId)
    const partner = world.residents.find((x) => x.id === partnerId)
    if (!r || !partner || r.carrying || partner.carrying) return
    const since = pairedWith(r, partner) && pairedWith(partner, r) ? r.pair!.since : world.tick
    r.pair = { partnerId: partner.id, since }
    partner.pair = { partnerId: r.id, since }
  },
}

function pairedWith(r: Resident, partner: Resident): boolean {
  return r.pair?.partnerId === partner.id
}

/**
 * Ends pairs that no longer hold (the partner gone, paired with someone else, or no longer of the
 * same city), stops what carrying residents can't do, then requests a carry for every pair whose
 * `PAIRING_WAIT_DAYS` have passed with no child on the way, and a birth for every resident who has carried
 * for `CARRYING_DAYS`.
 */
export function requestBirths(world: WorldState): BirthAction[] {
  const byId = new Map(world.residents.map((r) => [r.id, r]))
  const broken = world.residents.filter((r) => {
    if (!r.pair) return false
    const partner = byId.get(r.pair.partnerId)
    return !partner || !pairedWith(partner, r) || r.cityId === null || partner.cityId !== r.cityId
  })
  for (const r of broken) delete r.pair
  for (const r of world.residents) {
    if (r.carrying && r.order && CARRYING_BLOCKS.has(r.order.kind)) r.order = null
  }

  const actions: BirthAction[] = []
  for (const r of world.residents) {
    if (r.carrying) {
      if (world.tick - r.carrying.since >= CARRYING_TICKS)
        actions.push({ kind: 'birth', parentId: r.id })
      continue
    }
    const p = r.pair
    if (!p || r.id > p.partnerId || byId.get(p.partnerId)?.carrying) continue
    if (world.tick - p.since >= PAIRING_WAIT_TICKS)
      actions.push({ kind: 'carry', parentIds: [r.id, p.partnerId] })
  }
  return actions
}

/**
 * Resolves birth actions (ADR 0002), one after another (`CONTEXT.md`: Pairing, Carrying, Child).
 *
 * A pair still paired starts carrying when their city has free housing (counting the children
 * already on the way) and a food surplus: one partner, chosen at random, carries the child and
 * stops working (their order and script end); the other goes on. A pair whose city has no room
 * or food waits, and asks again next tick.
 *
 * A child is born when its time has come: on the carrying parent's tile, into their city and
 * realm, inheriting both parents' base stats; it goes in the Player's realm log, and the pair ends.
 */
export function resolveBirths(world: WorldState, actions: BirthAction[]): Resident[] {
  const born: Resident[] = []
  for (const action of actions) {
    if (action.kind === 'carry') startCarrying(world, action.parentIds)
    else {
      const child = giveBirth(world, action.parentId)
      if (child) born.push(child)
    }
  }
  return born
}

function startCarrying(world: WorldState, parentIds: [string, string]): void {
  const [a, b] = parentIds.map((id) => world.residents.find((r) => r.id === id))
  if (!a || !b || !pairedWith(a, b) || !pairedWith(b, a) || a.carrying || b.carrying) return
  const city = world.cities.find((c) => c.id === a.cityId)
  if (!city || b.cityId !== city.id) return
  if (freeHousing(world, city) - onTheWay(world, city) <= 0 || !hasFoodSurplus(world, city)) return
  const rand = mulberry32(hash(`${world.seed}:${world.tick}:${a.id}:${b.id}`))
  const [carrier, other] = rand() < 0.5 ? [a, b] : [b, a]
  carrier.carrying = {
    since: world.tick,
    partnerId: other.id,
    partnerName: other.name,
    partnerBase: baseStats(other),
  }
  carrier.order = null
  delete carrier.script
}

/** Children being carried by residents of a city: they will need its housing. */
function onTheWay(world: WorldState, city: City): number {
  return world.residents.filter((r) => r.carrying && r.cityId === city.id).length
}

function giveBirth(world: WorldState, parentId: string): Resident | undefined {
  const parent = world.residents.find((r) => r.id === parentId)
  const carrying = parent?.carrying
  if (!parent || !carrying || world.tick - carrying.since < CARRYING_TICKS) return undefined
  const id = newId(world, 'r')
  const child = newChild(
    mulberry32(hash(`${world.seed}:${id}`)),
    [baseStats(parent), carrying.partnerBase],
    { id, owner: parent.owner, cityId: parent.cityId, x: parent.x, y: parent.y, tick: world.tick },
  )
  world.residents.push(child)
  delete parent.carrying
  const partner = parent.pair && world.residents.find((r) => r.id === parent.pair!.partnerId)
  if (partner && pairedWith(partner, parent)) delete partner.pair
  delete parent.pair
  recordEvent(world, child.owner, {
    kind: 'born',
    residentId: child.id,
    name: child.name,
    parents: [parent.name, carrying.partnerName],
  })
  return child
}
