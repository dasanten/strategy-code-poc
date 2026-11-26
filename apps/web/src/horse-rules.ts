// Horses at stables, their riders and owners, as the client shows them. Its rules with a Rust
// original are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the
// client asks them per frame or per row.

import { STABLE_BREED_DAYS, TICKS_PER_GAME_DAY } from '@csp/balance'
import type { Building, Horse, Resident } from '@csp/shared-types'

/** World queries about horses and stables (ADR 0002: the game API orders and scripts share). */

/** Ticks a resident tends two horses at a stable before their foal is born (`STABLE_BREED_DAYS`). */
export const STABLE_BREED_TICKS = STABLE_BREED_DAYS * TICKS_PER_GAME_DAY

/** The residents breeding at a stable (`BreedOrder`). */
export function breedersAt<R extends Pick<Resident, 'order'>>(
  residents: readonly R[],
  stable: Building,
): R[] {
  return residents.filter((r) => r.order?.kind === 'breed' && r.order.stableId === stable.id)
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
