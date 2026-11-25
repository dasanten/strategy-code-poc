// Ported from packages/shared/src/world.ts for the client (T88.2, ADR 0030). Plain TypeScript: the
// types come from @csp/shared-types and the balance numbers from @csp/balance.

import { GOOD_KINDS, GOOD_SPECS } from '@csp/balance'
import type {
  BuildingKind,
  Good,
  ResourceKind,
  SkillName,
  TrainingSubject,
  Weapon,
} from '@csp/shared-types'

/** A resident's stats (`CONTEXT.md`: Stats). */
export const STAT_NAMES = ['strength', 'endurance', 'agility', 'intellect'] as const

/** A horse's stats (`CONTEXT.md`: Horse stats). */
export const HORSE_STAT_NAMES = ['speed', 'strength', 'endurance'] as const

/** Every skill, in the order the UI lists them. */
export const SKILL_NAMES: readonly SkillName[] = [
  'mining',
  'woodcutting',
  'smelting',
  'smithing',
  'construction',
  'farming',
  'combat',
  'driving',
]

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

/** Why a resident carrying a child is turned down for work, building, tearing down or hauling. */
export const CARRYING_A_CHILD = 'carrying a child'

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

/** The workplace built on each kind of node (`CONTEXT.md`: Workplace, Where buildings go). */
export const NODE_WORKPLACE: Record<ResourceKind, BuildingKind> = {
  forest: 'lumberCamp',
  stone: 'quarry',
  ironOre: 'mine',
  goldOre: 'mine',
  coal: 'mine',
}
