// Ported from packages/shared/src/leader.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { handedOverTo } from './alliance.js'
import { inCityArea } from './city.js'
import { contractOf } from './contract.js'
import { canWork } from './stats.js'
import { type WorldState } from './world.js'
import type { Resident } from '@csp/shared-types'

/**
 * Whom a resident serves besides their own realm (`CONTEXT.md`: Leader, Leader handover): a
 * mercenary contract in force that rents them out, or an alliance army they were handed over to.
 * Undefined when they serve no one else.
 */
export function servesOthers(
  world: Pick<WorldState, 'alliances' | 'contracts'>,
  residentId: string,
): 'contract' | 'allianceArmy' | undefined {
  if (handedOverTo(world, residentId)) return 'allianceArmy'
  if (contractOf(world, residentId)) return 'contract'
  return undefined
}

/**
 * Why the realm's Leader `leader` can't hand the realm over to `target` now (`CONTEXT.md`: Leader
 * handover), or undefined when they can: the target is a living adult of the same realm, not the
 * Leader already, serving no one else, and both stand in the area of the same city of the realm.
 * `leaderId` is the realm's Leader; `size` is the map's.
 */
export function handOverProblem(
  world: Pick<WorldState, 'alliances' | 'contracts' | 'cities' | 'buildings' | 'tick'>,
  realm: { id: string; leaderId: string },
  leader: Resident | undefined,
  target: Resident | undefined,
  size: number,
): string | undefined {
  if (!leader || leader.id !== realm.leaderId || leader.owner !== realm.id) {
    return 'only your Leader can hand over the realm'
  }
  if (!target || target.owner !== realm.id || target.health <= 0) {
    return 'not one of your residents'
  }
  if (target.id === leader.id) return `${target.name} is your Leader already`
  if (!canWork(target, world.tick)) return `${target.name} is a child`
  const serves = servesOthers(world, target.id)
  if (serves === 'contract') return `${target.name} is in a mercenary contract`
  if (serves === 'allianceArmy') return `${target.name} is in the alliance army`
  // An offer could start once they lead, and a Leader is never hired out.
  if (world.contracts.some((c) => c.residentIds.includes(target.id))) {
    return `${target.name} is named in a mercenary contract offer`
  }
  const shared = world.cities.find(
    (c) =>
      c.realmId === realm.id &&
      inCityArea(world, c, leader.x, leader.y, size) &&
      inCityArea(world, c, target.x, target.y, size),
  )
  if (!shared) return `${target.name} must stand in the same city as your Leader`
  return undefined
}

/**
 * Why `target` can't be named the realm's heir (`CONTEXT.md`: Heir), or undefined when they can:
 * the residents a Leader handover allows (a living adult of the realm who isn't its Leader and
 * serves no one else), who also lives in a city of the realm. Unlike a handover, they need not
 * stand anywhere in particular. The server's `heir_problem`.
 */
export function heirProblem(
  world: Pick<WorldState, 'alliances' | 'contracts' | 'cities' | 'tick'>,
  realm: { id: string; leaderId: string },
  target: Resident | undefined,
): string | undefined {
  if (!target || target.owner !== realm.id || target.health <= 0) {
    return 'not one of your residents'
  }
  if (target.id === realm.leaderId) return `${target.name} is your Leader`
  if (!canWork(target, world.tick)) return `${target.name} is a child`
  const serves = servesOthers(world, target.id)
  if (serves === 'contract') return `${target.name} is in a mercenary contract`
  if (serves === 'allianceArmy') return `${target.name} is in the alliance army`
  if (world.contracts.some((c) => c.residentIds.includes(target.id))) {
    return `${target.name} is named in a mercenary contract offer`
  }
  const home = world.cities.find((c) => c.id === target.cityId)
  if (!home || home.realmId !== realm.id) return `${target.name} lives in no city of your realm`
  return undefined
}
