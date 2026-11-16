import { SHOT_REACH, WALL_SHOT_REACH_BONUS } from '@csp/balance'
import type { SeenResident } from '@csp/shared-types'
import { wrapDelta } from '../shared/terrain.js'

/** One shot on the map: an archer and the one they shoot at, by id. */
export interface Shot {
  from: string
  to: string
}

/**
 * Who is shooting at whom among the residents in sight (`CONTEXT.md`: Ranged combat): each with an
 * attack order on a resident in sight, a Bow or Crossbow equipped and the target within its reach
 * (further up on a wall)
 * but not in contact, where a shot reads as a fight already. One of yours out of Arrows (what they
 * carry shows) shoots nothing; another realm's archer is drawn shooting, as their Arrows are
 * hidden.
 */
export function shots(
  residents: readonly Pick<SeenResident, 'id' | 'x' | 'y' | 'order' | 'equipped' | 'carried' | 'up'>[],
  size: number,
): Shot[] {
  const byId = new Map(residents.map((r) => [r.id, r]))
  const out: Shot[] = []
  for (const r of residents) {
    if (r.order?.kind !== 'attack') continue
    const weapon = r.equipped?.weapon
    const ground = weapon ? (SHOT_REACH as Partial<Record<string, number>>)[weapon] : undefined
    // Up on a wall walk an archer reaches further (`CONTEXT.md`: Ranged combat).
    const reach = ground === undefined ? undefined : ground + (r.up ? WALL_SHOT_REACH_BONUS : 0)
    if (reach === undefined) continue
    if (r.carried && Object.keys(r.carried).length > 0 && !(r.carried.arrows ?? 0)) continue
    const t = byId.get(r.order.targetId)
    if (!t) continue
    const apart = Math.max(
      Math.abs(wrapDelta(Math.floor(r.x), Math.floor(t.x), size)),
      Math.abs(wrapDelta(Math.floor(r.y), Math.floor(t.y), size)),
    )
    if (apart > 1 && apart <= reach) out.push({ from: r.id, to: t.id })
  }
  return out
}
