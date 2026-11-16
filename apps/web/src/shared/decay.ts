// Decay and repairing (`CONTEXT.md`: Decay, Repairing), as the server's `repair.rs` has them.
import * as B from '@csp/balance'
import type { Building, BuildingKind, Good, Stock } from '@csp/shared-types'
import { BUILD_MATERIALS, BUILD_WORK } from './narrowed.js'

/** Game days a finished building of each kind takes to lose all its condition, unrepaired. */
export const DECAY_DAYS = B.DECAY_DAYS as unknown as Partial<Record<BuildingKind, number>>

/** How a building's condition reads: good, worn, nearly a ruin. */
export type Condition = 'good' | 'worn' | 'nearlyRuin'

export const CONDITION_NAMES: Record<Condition, string> = {
  good: 'Good',
  worn: 'Worn',
  nearlyRuin: 'Nearly a ruin',
}

type Decaying = Pick<Building, 'kind' | 'site' | 'decay'>

/** How the building's condition reads; undefined for a site or a kind that never decays. */
export function conditionOf(b: Decaying): Condition | undefined {
  if (b.site || DECAY_DAYS[b.kind] === undefined) return undefined
  const lost = b.decay ?? 0
  return lost >= B.DECAY_NEARLY_RUIN ? 'nearlyRuin' : lost >= B.DECAY_WORN ? 'worn' : 'good'
}

/** Whether it can be repaired: worn or worse, or with a repair under way. */
export function repairable(b: Decaying & Pick<Building, 'repair'>): boolean {
  if (b.repair) return true
  const c = conditionOf(b)
  return c !== undefined && c !== 'good'
}

/** The materials a repair of a building of `kind` takes, rounded up to whole units. */
export function repairMaterials(kind: BuildingKind): Stock {
  const out: Stock = {}
  for (const [good, units] of Object.entries(BUILD_MATERIALS[kind] ?? {})) {
    const n = Math.ceil((units ?? 0) * B.REPAIR_MATERIALS_SHARE)
    if (n > 0) out[good as Good] = n
  }
  return out
}

/** The work a repair of a building of `kind` takes, in ticks of an average resident. */
export function repairWork(kind: BuildingKind): number {
  return (BUILD_WORK[kind] ?? 0) * B.REPAIR_WORK_SHARE
}

/** The card's line on its condition: "Condition: worn", and how far a repair has come. */
export function conditionLine(b: Decaying & Pick<Building, 'repair'>): string | undefined {
  const c = conditionOf(b)
  if (!c) return undefined
  const line = `Condition: ${CONDITION_NAMES[c].toLowerCase()}`
  if (!b.repair) return line
  const work = repairWork(b.kind)
  const done = work > 0 ? Math.min(100, Math.floor((b.repair.work / work) * 100)) : 100
  return `${line} · being repaired, ${done}% of the work done`
}
