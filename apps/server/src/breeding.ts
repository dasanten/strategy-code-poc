import {
  CARRYING_A_CHILD,
  FOAL_STAT_SPREAD,
  HORSE_STAT_NAMES,
  MAX_HEALTH,
  MAX_HUNGER,
  STABLE_BREED_TICKS,
  STABLE_CAPACITY,
  breedProblem,
  canWork,
  horsesIn,
  isAt,
  type Building,
  type Horse,
  type HorseOwner,
  type HorseStats,
  type OrderRequest,
  type Resident,
  type WorldState,
} from '@csp/shared'
import { recordEvent } from './events.js'
import { orderedResident } from './order-sender.js'
import type { OrderKind, OrderSender } from './orders.js'
import { hash, mulberry32 } from './residents.js'
import { realmOf, newId } from './starting-city.js'

/** An action a resident with a breed order requests: tend the two horses for a tick. */
export interface BreedAction {
  residentId: string
}

/** The input of a breed order: which resident, at which stable, and which two horses in it. */
interface BreedRequest extends OrderRequest {
  kind: 'breed'
  residentId: string
  stableId: string
  horseIds: [string, string]
}

/** Whose horses the sender's residents breed: the Player's realm's, or the NPC city's. */
function ownerOf(world: WorldState, sender: OrderSender): HorseOwner | undefined {
  if (sender.npcCityId !== undefined) return { cityId: sender.npcCityId }
  const realm = realmOf(world, sender.userId)
  return realm && { realmId: realm.id }
}

/**
 * The breed order (`CONTEXT.md`: Breeding): one of the Player's adult residents, standing at a
 * finished stable, tends two fed horses of the Player's realm in it (`breedProblem`). The tending
 * happens in later ticks.
 */
export const breed: OrderKind = {
  validate(world, sender, order) {
    const o = order as Partial<BreedRequest>
    const r = orderedResident(world, sender, o.residentId)
    const owner = ownerOf(world, sender)
    if (!r || !owner) return 'not one of your residents'
    if (!canWork(r, world.tick)) return 'children can’t breed horses'
    if (r.carrying) return CARRYING_A_CHILD
    const stable = world.buildings.find((b) => b.id === o.stableId)
    if (!stable || !isAt(r, stable)) return 'not standing at that stable'
    return breedProblem(world, stable, owner, r, o.horseIds)
  },
  apply(world, _sender, order) {
    const { residentId, stableId, horseIds } = order as BreedRequest
    const r = world.residents.find((x) => x.id === residentId)
    if (!r) return
    const ids: [string, string] = [horseIds[0], horseIds[1]]
    r.order = { kind: 'breed', stableId, horseIds: ids, at: { x: r.x, y: r.y }, progress: 0 }
  },
}

/** Requests this tick's tending from residents' breed orders. */
export function requestBreeding(world: WorldState): BreedAction[] {
  return world.residents.filter((r) => r.order?.kind === 'breed').map((r) => ({ residentId: r.id }))
}

/**
 * Whether a resident's breeding goes on (`CONTEXT.md`: Breeding): they still stand where they
 * started, at the finished stable, both horses are alive and in it, and it has room for a foal.
 */
export function breedingGoesOn(world: WorldState, r: Resident, size?: number): boolean {
  const o = r.order
  if (o?.kind !== 'breed' || r.x !== o.at.x || r.y !== o.at.y) return false
  const stable = world.buildings.find((b) => b.id === o.stableId)
  if (!stable || stable.site || !isAt(r, stable, size)) return false
  const horses = o.horseIds.map((id) => world.horses.find((h) => h.id === id))
  if (horses.some((h) => !h || !isAt(h, stable, size))) return false
  return horsesIn(world.horses, stable).length < STABLE_CAPACITY
}

/**
 * A foal's stats (`CONTEXT.md`: Breeding): its parents' average in each, plus or minus up to
 * `FOAL_STAT_SPREAD`, whole and at least 1.
 */
export function foalStats(rand: () => number, a: HorseStats, b: HorseStats): HorseStats {
  return Object.fromEntries(
    HORSE_STAT_NAMES.map((s) => {
      const noise = Math.floor(rand() * (2 * FOAL_STAT_SPREAD + 1)) - FOAL_STAT_SPREAD
      return [s, Math.max(1, Math.round((a[s] + b[s]) / 2) + noise)]
    }),
  ) as HorseStats
}

/**
 * Resolves breeding (ADR 0002), one action after another. Breeding that no longer goes on
 * (`breedingGoesOn`) stops, and its progress is lost. Otherwise the resident tends the horses a
 * tick; after `STABLE_BREED_TICKS` a foal of their parents' owner is born in the stable, with
 * stats from both (`foalStats`), it goes in the realm log, and the order is done. Returns the
 * foals born.
 */
export function resolveBreeding(world: WorldState, actions: BreedAction[], size?: number): Horse[] {
  const foals: Horse[] = []
  for (const a of actions) {
    const r = world.residents.find((x) => x.id === a.residentId)
    const o = r?.order
    if (!r || o?.kind !== 'breed') continue
    if (!breedingGoesOn(world, r, size)) {
      r.order = null
      continue
    }
    o.progress++
    if (o.progress < STABLE_BREED_TICKS) continue
    r.order = null
    const stable = world.buildings.find((b) => b.id === o.stableId)!
    const [mother, father] = o.horseIds.map((id) => world.horses.find((h) => h.id === id)!)
    const foal = newFoal(world, stable, mother!, father!)
    world.horses.push(foal)
    foals.push(foal)
    recordEvent(world, foal.realmId, { kind: 'foaled', horseId: foal.id, stableId: stable.id })
  }
  return foals
}

/** A foal of the two horses, born now in the stable, fed and healthy. */
function newFoal(world: WorldState, stable: Building, a: Horse, b: Horse): Horse {
  const id = newId(world, 'horse')
  return {
    id,
    realmId: a.realmId,
    cityId: a.cityId,
    x: stable.x,
    y: stable.y,
    hunger: MAX_HUNGER,
    health: MAX_HEALTH,
    stats: foalStats(mulberry32(hash(`${world.seed}:foal:${id}`)), a.stats, b.stats),
    bornAt: world.tick,
  }
}
