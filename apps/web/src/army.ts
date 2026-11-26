// What the client works out of armies and their supply wagons. Its rules with a Rust original are
// twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client asks
// them per frame or per row.

import type { Carriage, Resident, WorldState } from '@csp/shared-types'

/** World queries about armies (ADR 0002: the game API orders and scripts share). */

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
