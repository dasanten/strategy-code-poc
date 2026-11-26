// Ported from packages/shared/src/horses.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { isAt } from './footprint.js'
import { STABLE_BREED_DAYS, TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building, Horse, KeptBreeding, Resident } from '@csp/shared-types'

export { riderSpareFood } from '@csp/lang-wasm'

/** World queries about horses and stables (ADR 0002: the game API orders and scripts share). */

/** Ticks a resident tends two horses at a stable before their foal is born (`STABLE_BREED_DAYS`). */
export const STABLE_BREED_TICKS = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY

/** The horses standing in a stable, hitched or not. */
export function horsesIn<H extends { x: number; y: number }>(
  horses: readonly H[],
  stable: Building,
): H[] {
  return horses.filter((h) => isAt(h, stable))
}

/** The residents breeding at a stable (`BreedOrder`). */
export function breedersAt<R extends Pick<Resident, 'order'>>(
  residents: readonly R[],
  stable: Building,
): R[] {
  return residents.filter((r) => r.order?.kind === 'breed' && r.order.stableId === stable.id)
}

/** The breeding progress the stable keeps for the two horses, in either order, if it keeps any. */
export function keptBreeding(
  stable: Pick<Building, 'breedings'>,
  horseIds: readonly string[],
): KeptBreeding | undefined {
  return stable.breedings?.find(
    (k) => horseIds.includes(k.horseIds[0]) && horseIds.includes(k.horseIds[1]),
  )
}

/** The horse a resident rides (`CONTEXT.md`: Riding), if they ride one. */
export function horseRidden<H extends Pick<Horse, 'id'>>(
  world: { horses: readonly H[] },
  resident: Pick<Resident, 'riding'>,
): H | undefined {
  return resident.riding === undefined
    ? undefined
    : world.horses.find((h) => h.id === resident.riding)
}

/** The resident riding a horse, if anyone is. */
export function riderOf<R extends Pick<Resident, 'riding'>>(
  world: { residents: readonly R[] },
  horse: Pick<Horse, 'id'>,
): R | undefined {
  return world.residents.find((r) => r.riding === horse.id)
}

/**
 * Whether a horse is the resident's to ride: one of their realm, or for a resident of an NPC city
 * one of that city.
 */
export function horseOfResident(
  horse: Pick<Horse, 'realmId' | 'cityId'>,
  resident: Pick<Resident, 'owner' | 'cityId'>,
): boolean {
  if (resident.owner !== null) return horse.realmId === resident.owner
  return horse.realmId === null && resident.cityId !== null && horse.cityId === resident.cityId
}
