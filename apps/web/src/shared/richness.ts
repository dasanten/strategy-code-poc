// A resource node's richness on the client (`CONTEXT.md`: Richness): what it multiplies a worker's
// output by, from `@csp/balance`, and its index in a served chunk.

import { RICHNESS_FACTOR } from '@csp/balance'
import type { Richness } from '@csp/shared-types'

/** The richnesses by their index in a served chunk's node byte (the upper four bits): normal 0. */
export const RICHNESSES: readonly Richness[] = ['normal', 'poor', 'rich']

/** What a worker's output on a node of `richness` is multiplied by; 1 where none is known. */
export function richnessFactor(richness: Richness | undefined): number {
  return richness ? RICHNESS_FACTOR[richness] : 1
}
