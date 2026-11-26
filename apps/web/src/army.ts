// Ported from packages/shared/src/army.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import type { Army, Carriage, Resident, WorldState } from '@csp/shared-types'

/** World queries about armies (ADR 0002: the game API orders and scripts share). */

/** The army the resident is in, if any (`CONTEXT.md`: Army: at most one). */
export function armyOf(world: Pick<WorldState, 'armies'>, residentId: string): Army | undefined {
  return world.armies.find((a) => a.memberIds.includes(residentId))
}

/**
 * The army a driver's carriage goes after now (`CONTEXT.md`: Supply line): the one a drive order
 * follows as its supply wagon, or the one a haul route has as its second stop while it is bound
 * there or stands with it.
 */
export function armyDrivenTo(driver: Resident): string | undefined {
  const o = driver.order
  if (o?.kind === 'drive') return o.army
  if (o?.kind === 'haul' && o.stop === 'to') return o.toArmy
  return undefined
}

/**
 * The Food on a carriage that army members may take (`CONTEXT.md`: Refilling from a carriage):
 * all of it, except what a haul route keeps on board for the horse.
 */
export function spareFood(world: Pick<WorldState, 'residents'>, carriage: Carriage): number {
  const driver = world.residents.find((r) => {
    const o = r.order
    return o?.kind === 'haul' && o.carriageId === carriage.id
  })
  const o = driver?.order
  const keep = o?.kind === 'haul' ? o.keepFood : 0
  return Math.max(0, (carriage.load.food ?? 0) - keep)
}
