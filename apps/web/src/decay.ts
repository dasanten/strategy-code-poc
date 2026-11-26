// Decay, repairing and ruins (`CONTEXT.md`: Decay, Repairing, Ruin), as the server's `repair.rs`
// and `ruins.rs` have them.
import * as B from '@csp/balance'
import type { Building, BuildingKind } from '@csp/shared-types'
import { repairWork, rebuildWork } from '@csp/lang-wasm'
import { conditionOf } from '@csp/lang-wasm'

/** Game days a finished building of each kind takes to lose all its condition, unrepaired. */
export const DECAY_DAYS = B.DECAY_DAYS as unknown as Partial<Record<BuildingKind, number>>

/** How a building's condition reads: good, worn, nearly a ruin, or a ruin. */
export type Condition = 'good' | 'worn' | 'nearlyRuin' | 'ruin'

/** How each condition reads on a building's card. */
const CONDITION_NAMES: Record<Condition, string> = {
  good: 'Good',
  worn: 'Worn',
  nearlyRuin: 'Nearly a ruin',
  ruin: 'A ruin',
}

type Decaying = Pick<Building, 'kind' | 'site' | 'decay' | 'ruinedAt'>

/** Whether it is a ruin: it stands but does nothing (`CONTEXT.md`: Ruin). */
export function isRuin(b: Pick<Building, 'ruinedAt'>): boolean {
  return b.ruinedAt !== undefined
}

/**
 * The card's line on its condition: "Condition: worn", and how far a repair has come; for a ruin,
 * that it does nothing, and how far its rebuilding has come.
 */
export function conditionLine(b: Decaying & Pick<Building, 'repair'>): string | undefined {
  const c = conditionOf(b)
  if (!c) return undefined
  const ruin = c === 'ruin'
  const line = ruin
    ? 'A ruin: it does nothing until it is rebuilt, and collapses if left'
    : `Condition: ${CONDITION_NAMES[c].toLowerCase()}`
  if (!b.repair) return line
  const work = ruin ? rebuildWork(b.kind) : repairWork(b.kind)
  const done = work > 0 ? Math.min(100, Math.floor((b.repair.work / work) * 100)) : 100
  return `${line} · being ${ruin ? 'rebuilt' : 'repaired'}, ${done}% of the work done`
}
