import type { RegionMap, Territory } from '@csp/shared'
import type { InvariantViolation } from './invariants.js'

/**
 * Invariant (ADR 0004): the Region map sent to a Player shows territory only on terrain they
 * have explored (`CONTEXT.md`: Region map), and every tile on it as the territory has it: held by
 * that holder, and by no other.
 */
export function regionMapUnsound(
  region: RegionMap,
  territory: Territory,
  size: number,
  isExplored: (x: number, y: number) => boolean,
  realmId: string,
): InvariantViolation[] {
  const out: InvariantViolation[] = []
  const shown = new Set<number>()
  for (const holder of region.holders) {
    for (const t of holder.tiles) {
      const [x, y] = [t % size, Math.floor(t / size)]
      let problem: string | undefined
      if (!isExplored(x, y)) problem = 'unexplored'
      else if (shown.has(t)) problem = 'shown twice'
      else if (territory.owners.get(`${x},${y}`) !== holder.id) problem = 'not theirs'
      shown.add(t)
      if (!problem) continue
      out.push({
        invariant: 'region-map-sound',
        message: `tile ${x},${y} went to realm ${realmId} as held by ${holder.id}: ${problem}`,
        entityIds: [holder.id, realmId],
      })
    }
  }
  return out
}
