// Mirror of the server's condition check (`crates/csp-sim/src/conditions.rs`, `condition_of`),
// so the planner refuses what the server would.

import type { Condition } from '@csp/shared-types'
import { GOODS } from './world.js'

/**
 * Conditions (`CONTEXT.md`: Condition): what a Wait until, an If block or a Repeat until asks.
 * They are checked by the server, for each resident by themself.
 */

/** Every kind of condition, in the order the condition editor offers them. */
export const CONDITION_KINDS: readonly Condition['kind'][] = [
  'carries',
  'load',
  'stock',
  'need',
  'mounted',
  'aboard',
  'hour',
]

/** The highest hour a condition names: a day's hours run 0 to 23. */
export const LAST_HOUR = 23

/** The fields each kind of condition holds besides its kind, and whether each must be there. */
const FIELDS: Record<Condition['kind'], Record<string, boolean>> = {
  carries: { vehicle: false, good: true, compare: true, amount: true },
  load: { vehicle: false, load: true },
  stock: { placeId: true, good: true, compare: true, amount: true },
  need: { need: true, side: true, share: true },
  mounted: { is: true },
  aboard: { is: true },
  hour: { side: true, hour: true },
}

/** The words each field may be, for the fields that are one of a few words. */
const WORDS: Record<string, readonly string[]> = {
  compare: ['atLeast', 'lessThan'],
  load: ['full', 'empty'],
  need: ['hunger', 'health'],
}

const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0

/**
 * Why a condition as sent isn't one, if it isn't (`condition_of`): one of the kinds with its
 * fields, an amount a whole number from 0, a share from 0 to 1, an hour a whole number from 0 to
 * 23.
 */
export function conditionProblem(c: unknown): string | undefined {
  if (c === undefined) return 'needs a condition'
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return 'that is no condition'
  const v = c as Record<string, unknown>
  const fields = FIELDS[v.kind as Condition['kind']]
  if (!fields || typeof v.kind !== 'string') return 'that is no condition'
  for (const key of Object.keys(v))
    if (key !== 'kind' && !(key in fields)) return 'that is no condition'
  for (const [key, needed] of Object.entries(fields)) {
    if (needed && !(key in v)) return 'that is no condition'
  }
  const sides = v.kind === 'need' ? ['above', 'below'] : ['before', 'after']
  if ('side' in v && !sides.includes(v.side as string)) return 'that is no condition'
  for (const [key, words] of Object.entries(WORDS))
    if (key in v && !words.includes(v[key] as string)) return 'that is no condition'
  if ('good' in v && !GOODS.includes(v.good as never)) return 'that is no condition'
  if ('vehicle' in v && typeof v.vehicle !== 'boolean') return 'that is no condition'
  if ('is' in v && typeof v.is !== 'boolean') return 'that is no condition'
  if ('placeId' in v && typeof v.placeId !== 'string') return 'that is no condition'
  if ('amount' in v && typeof v.amount !== 'number') return 'that is no condition'
  if ('share' in v && typeof v.share !== 'number') return 'that is no condition'
  if ('hour' in v && typeof v.hour !== 'number') return 'that is no condition'
  if ((v.kind === 'carries' || v.kind === 'stock') && !whole(v.amount))
    return "a condition's amount is a whole number from 0"
  if (v.kind === 'stock' && v.placeId === '') return 'a condition on stock needs a place'
  if (v.kind === 'need' && !((v.share as number) >= 0 && (v.share as number) <= 1))
    return "a condition's share is from 0 to 1"
  if (v.kind === 'hour' && !(whole(v.hour) && (v.hour as number) <= LAST_HOUR))
    return "a condition's hour is a whole number from 0 to 23"
  return undefined
}
