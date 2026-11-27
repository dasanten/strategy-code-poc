// The client's lists of goods, skills and stats, and who is Down. Its rules with a Rust original
// are twins of it, held to it by `client-twins.test.ts` (T122.8, docs/wasm-rules.md): the client
// asks them per frame or per row.

import { GOOD_KINDS, GOOD_SPECS } from '@csp/balance'
import type { Good, SkillName, Weapon } from '@csp/shared-types'
import { SKILL_NAMES as ALL_SKILL_NAMES } from '@csp/shared-types'

/** Every skill the client lists, in the order the UI lists them: Rust's `SkillName`, Seafaring too. */
export const SKILL_NAMES: readonly SkillName[] = ALL_SKILL_NAMES

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
