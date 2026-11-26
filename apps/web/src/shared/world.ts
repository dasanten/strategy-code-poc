// Ported from packages/shared/src/world.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { GOOD_KINDS, GOOD_SPECS } from '@csp/balance'
import type { Good, SkillName, TrainingSubject, Weapon } from '@csp/shared-types'
import { STAT_NAMES, SKILL_NAMES as ALL_SKILL_NAMES } from '@csp/shared-types'

export { STAT_NAMES, HORSE_STAT_NAMES, CARRYING_A_CHILD, NODE_WORKPLACE } from '@csp/shared-types'

/**
 * Every skill the client lists, in the order the UI lists them. Seafaring is left out for now, as
 * it was before the list came from Rust (decided overnight, Daniel to confirm: bug #1629).
 */
export const SKILL_NAMES: readonly SkillName[] = ALL_SKILL_NAMES.filter((s) => s !== 'seafaring')

/** Whether `x` names a stat or a skill, something a training ground can teach. */
export function isTrainingSubject(x: unknown): x is TrainingSubject {
  return (
    (STAT_NAMES as readonly unknown[]).includes(x) ||
    (SKILL_NAMES as readonly unknown[]).includes(x)
  )
}

/**
 * Whether a resident or horse is Down (`CONTEXT.md`: Down), lying unconscious and doing nothing:
 * from the world, or as a Player sees them (`SeenResident.down`, `SeenHorse.down`).
 */
export function isDown(r: { downUntil?: number; down?: true }): boolean {
  return r.downUntil !== undefined || r.down === true
}

/**
 * PoC goods (`CONTEXT.md`: Good, Weapons and armour), in the order of their specs. Amounts are
 * counted in units; `GOOD_WEIGHT` weighs them.
 */
export const GOODS = GOOD_KINDS

/** Goods that make a resident armed (`CONTEXT.md`: Soldier, Weapons and armour). */
// The Rust specs check that these are the goods of `Weapon`.
export const WEAPONS = GOODS.filter((g) => GOOD_SPECS[g].weapon !== null) as readonly Weapon[]

/** Goods that take off damage (`CONTEXT.md`: Weapons and armour): shields and armour, of iron or steel. */
export const PROTECTION: readonly Good[] = GOODS.filter((g) => GOOD_SPECS[g].protection !== null)

/**
 * The kinds of protection (`CONTEXT.md`: Weapons and armour): a shield and armour, each of iron or
 * steel. Only the best of each kind a resident carries counts.
 */
export const PROTECTION_KINDS: readonly (readonly Good[])[] = (['shield', 'armour'] as const).map(
  (kind) => GOODS.filter((g) => GOOD_SPECS[g].protection === kind),
)
