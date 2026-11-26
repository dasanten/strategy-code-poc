import { RECIPES } from '@csp/balance'
import type { BuildingKind, Good, Stock } from '@csp/shared-types'
import { BUILDING_NAMES } from '../map/palette.js'
import { GOOD_LABELS } from '../residents/Residents.js'
import { num } from './wiki-view.js'

/** The smithy's recipe for `good` (`CONTEXT.md`: Smithy). */
export const forged = (good: Good) => RECIPES.smithy!.find((r) => good in r.output)!

/** Goods as a list: "40 wood, 20 stone"; "nothing" for none. */
export function goods(stock: Stock): string {
  const entries = (Object.entries(stock) as [Good, number][]).filter(([, n]) => n > 0)
  if (!entries.length) return 'nothing'
  return entries.map(([g, n]) => `${num(n)} ${GOOD_LABELS[g].toLowerCase()}`).join(', ')
}

/** A building kind as the game names it. */
export const kindName = (kind: BuildingKind) => BUILDING_NAMES[kind]

/** A good as the game names it. */
export const goodName = (good: Good) => GOOD_LABELS[good]
