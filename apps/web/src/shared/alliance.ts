// Ported from packages/shared/src/alliance.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { contractOf } from './contract.js'
import { TRADE_ORG, TRADE_ORG_NAME } from './trade-org.js'
import type { Alliance, Carriage, Resident, WorldState } from '@csp/shared-types'

export { ALLIANCE_NAME_MAX_LENGTH } from '@csp/shared-types'

/**
 * World queries about alliances (ADR 0002: the game API orders and scripts share). A member is
 * a Player's realm or an NPC city (`CONTEXT.md`: NPC city in an alliance), named by its id.
 */

/** The alliance whose army holds the resident or carriage `id` (`CONTEXT.md`: Alliance army). */
export function handedOverTo(
  world: Pick<WorldState, 'alliances'>,
  id: string,
): Alliance | undefined {
  return world.alliances.find((a) => a.army.some((p) => p.id === id))
}

/**
 * The realm whose orders the resident takes: the alliance leader's while they are handed over to
 * its army (`CONTEXT.md`: Alliance army), the hirer's while a mercenary contract rents them out
 * (`CONTEXT.md`: Mercenary contract), their own realm's otherwise; null for a resident of no
 * realm.
 */
export function commanderOf(
  world: Pick<WorldState, 'alliances' | 'contracts'>,
  r: Pick<Resident, 'id' | 'owner'>,
): string | null {
  return handedOverTo(world, r.id)?.leaderId ?? contractOf(world, r.id)?.hirerId ?? r.owner
}

/** The realm whose orders the carriage takes, as `commanderOf` for a resident. */
export function carriageCommanderOf(
  world: Pick<WorldState, 'alliances'>,
  k: Pick<Carriage, 'id' | 'realmId'>,
): string | null {
  return handedOverTo(world, k.id)?.leaderId ?? k.realmId
}

/** Whether the realm's Player may give the resident orders. */
export function commands(
  world: Pick<WorldState, 'alliances' | 'contracts'>,
  realmId: string,
  r: Resident | undefined,
): r is Resident {
  return r !== undefined && commanderOf(world, r) === realmId
}

/**
 * Whether the realm driving the carriage off would steal it (`CONTEXT.md`: Stealing a carriage or
 * horse): it is another organization's, and not one of the alliance army the realm commands.
 */
export function stealsCarriage(
  world: Pick<WorldState, 'alliances'>,
  realmId: string,
  k: Pick<Carriage, 'id' | 'realmId'>,
): boolean {
  return k.realmId !== realmId && carriageCommanderOf(world, k) !== realmId
}

/** The alliance the realm is a member of, if any (`CONTEXT.md`: Alliance: at most one). */
export function allianceOf(
  world: Pick<WorldState, 'alliances'>,
  realmId: string,
): Alliance | undefined {
  return world.alliances.find((a) => a.members.some((m) => m.realmId === realmId))
}

/**
 * The realm and its allies: every member of its alliance, or just itself when in none. A member
 * that is leaving counts until the leave delay is over (`CONTEXT.md`: Alliance).
 */
export function alliedRealms(world: Pick<WorldState, 'alliances'>, realmId: string): string[] {
  const alliance = allianceOf(world, realmId)
  return alliance ? alliance.members.map((m) => m.realmId) : [realmId]
}

/**
 * Whether two realms stand together: the same realm, or members of one alliance. Allies pass
 * each other's gates, stand on each other's walls, and don't attack each other unless ordered
 * to (`CONTEXT.md`: Alliance).
 */
export function allied(world: Pick<WorldState, 'alliances'>, a: string, b: string): boolean {
  return a === b || alliedRealms(world, a).includes(b)
}

/**
 * How a realm is called to other Players: by its realm name, or its Leader's name while it has
 * none (`CONTEXT.md`: Realm name). The Trade Organization, a side like a realm in contracts, by
 * its own.
 */
export function realmName(
  world: Pick<WorldState, 'realms' | 'residents'>,
  realmId: string,
): string {
  if (realmId === TRADE_ORG) return TRADE_ORG_NAME
  const realm = world.realms.find((r) => r.id === realmId)
  if (realm?.name) return realm.name
  const leader = realm && world.residents.find((r) => r.id === realm.leaderId)
  return leader?.name ?? 'a fallen realm'
}
