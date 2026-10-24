import {
  CITY_NAME_MAX_LENGTH,
  RESIDENT_NAME_MAX_LENGTH,
  cityRenameProblem,
  nameProblem,
  renameProblem,
  type OrderRequest,
  type WorldState,
} from '@csp/shared'
import type { Invariant, InvariantViolation } from './invariants.js'
import type { OrderKind, OrderSender } from './orders.js'
import { realmOf } from './starting-city.js'

/*
 * Renaming a resident (`CONTEXT.md`: Renaming a resident, Realm name) is the Player's choice of a
 * name, not a physical action: free, at once and from anywhere, it changes plain data, which is
 * all a script could do too (ADR 0002). The realm log keeps the names things had then, since each
 * entry stores the names it mentions.
 */

/**
 * The input of a rename order: `targetId` gets `name`, and `realmName` names the realm when the
 * target is the Leader of a realm that has none yet. `residentId` is who asked: the target from
 * the UI, the resident running the script from a script.
 */
interface RenameRequest extends OrderRequest {
  kind: 'rename'
  residentId: string
  targetId: string
  name: string
  realmName?: string
}

function problem(world: WorldState, sender: OrderSender, order: OrderRequest): string | undefined {
  const realm = realmOf(world, sender.userId)
  if (!realm) return 'you have no realm'
  const o = order as Partial<RenameRequest>
  const asker = world.residents.find((r) => r.id === o.residentId)
  if (!asker || asker.owner !== realm.id) return 'not one of your residents'
  const target = world.residents.find((r) => r.id === o.targetId)
  return renameProblem(realm, target, o.name, o.realmName)
}

/**
 * The rename order: the resident takes the new name, trimmed; renaming the Leader of an unnamed
 * realm names the realm too. Renaming the Leader never renames a named realm.
 */
export const rename: OrderKind = {
  validate(world, sender, order) {
    return problem(world, sender, order)
  },
  apply(world, sender, order) {
    if (problem(world, sender, order)) return
    const { targetId, name, realmName } = order as RenameRequest
    const realm = realmOf(world, sender.userId)!
    const target = world.residents.find((r) => r.id === targetId)!
    target.name = name.trim()
    if (target.id === realm.leaderId && !realm.name) realm.name = realmName!.trim()
  },
}

/*
 * Renaming a city (`CONTEXT.md`: Renaming a city) works the same way. Others learn the new name
 * only by sight: their Last seen keeps the copy of the city they saw, old name and all.
 */

/** The input of a city rename order: `cityId` gets `name`; `residentId` is who asked. */
interface RenameCityRequest extends OrderRequest {
  kind: 'renameCity'
  residentId: string
  cityId: string
  name: string
}

function cityProblem(
  world: WorldState,
  sender: OrderSender,
  order: OrderRequest,
): string | undefined {
  const realm = realmOf(world, sender.userId)
  if (!realm) return 'you have no realm'
  const o = order as Partial<RenameCityRequest>
  const asker = world.residents.find((r) => r.id === o.residentId)
  if (!asker || asker.owner !== realm.id) return 'not one of your residents'
  return cityRenameProblem(
    realm,
    world.cities.find((c) => c.id === o.cityId),
    o.name,
  )
}

/** The city rename order: the city of the Player's realm takes the new name, trimmed. */
export const renameCity: OrderKind = {
  validate(world, sender, order) {
    return cityProblem(world, sender, order)
  },
  apply(world, sender, order) {
    if (cityProblem(world, sender, order)) return
    const { cityId, name } = order as RenameCityRequest
    world.cities.find((c) => c.id === cityId)!.name = name.trim()
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Renaming a city): every city's name is trimmed, not empty
 * and at most `CITY_NAME_MAX_LENGTH`.
 */
export const cityNamesWellFormed: Invariant = {
  name: 'city-names-well-formed',
  check(world) {
    const out: InvariantViolation[] = []
    for (const c of world.cities) {
      const p =
        nameProblem(c.name, CITY_NAME_MAX_LENGTH) ??
        (c.name !== c.name.trim() ? 'not trimmed' : undefined)
      if (p) {
        out.push({ invariant: this.name, message: `city ${c.id}'s name: ${p}`, entityIds: [c.id] })
      }
    }
    return out
  },
}

/**
 * Invariant (ADR 0004; `CONTEXT.md`: Renaming a resident): every resident's name is trimmed, not
 * empty and at most `RESIDENT_NAME_MAX_LENGTH`. Realm names are `realmsHaveLeaders`' to check.
 */
export const residentNamesWellFormed: Invariant = {
  name: 'resident-names-well-formed',
  check(world) {
    const out: InvariantViolation[] = []
    for (const r of world.residents) {
      const p =
        nameProblem(r.name, RESIDENT_NAME_MAX_LENGTH) ??
        (r.name !== r.name.trim() ? 'not trimmed' : undefined)
      if (p) {
        out.push({
          invariant: this.name,
          message: `resident ${r.id}'s name: ${p}`,
          entityIds: [r.id],
        })
      }
    }
    return out
  },
}
