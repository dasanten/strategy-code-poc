// Ported from packages/shared/src/names.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { CITY_NAME_MAX_LENGTH } from '@csp/balance'
import type { City, Realm } from '@csp/shared-types'
import { nameProblem } from '@csp/lang-wasm'

export { renameProblem, horseRenameProblem } from '@csp/lang-wasm'

export { nameProblem, foundingProblem } from '@csp/lang-wasm'

/**
 * Why the Player of `realm` can't rename `city` to `name` now (`CONTEXT.md`: Renaming a city),
 * or undefined when they can: any city of their realm, from anywhere. NPC cities and other
 * realms' cities keep their names.
 */
export function cityRenameProblem(
  realm: Pick<Realm, 'id'>,
  city: City | undefined,
  name: unknown,
): string | undefined {
  if (!city || city.realmId !== realm.id) return 'not one of your cities'
  const bad = nameProblem(name, CITY_NAME_MAX_LENGTH)
  return bad ? `Name: ${bad}` : undefined
}
