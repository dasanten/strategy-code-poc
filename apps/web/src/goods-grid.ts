import { GOODS } from './shared/world.js'
import { OWN_FOOD } from '@csp/balance'
import { putAwayUnits } from './shared/goods.js'
import type { Good, Stock } from '@csp/shared-types'

/** Good names as the UI shows them. */
export const GOOD_LABELS: Record<Good, string> = {
  food: 'Food',
  wood: 'Wood',
  stone: 'Stone',
  ironOre: 'Iron ore',
  iron: 'Iron',
  goldOre: 'Gold ore',
  coins: 'Coins',
  spear: 'Spear',
  sword: 'Sword',
  shield: 'Shield',
  armour: 'Armour',
}

/**
 * Which file in `assets/goods/` draws each good (`CONTEXT.md`: Goods on cards): white line art in
 * the map's style, stroked in `currentColor` so it takes the text colour around it.
 */
export const GOOD_ART: Record<Good, string> = {
  food: 'food.svg',
  wood: 'wood.svg',
  stone: 'stone.svg',
  ironOre: 'iron-ore.svg',
  iron: 'iron.svg',
  goldOre: 'gold-ore.svg',
  coins: 'coins.svg',
  spear: 'spear.svg',
  sword: 'sword.svg',
  shield: 'shield.svg',
  armour: 'armour.svg',
}

/** The SVG source of every file in `assets/goods/`, by file name. */
export const GOOD_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./assets/goods/*.svg', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ).map(([path, svg]) => [path.slice(path.lastIndexOf('/') + 1), svg]),
)

/** One cell of the goods grid: a good and how much of it. */
export interface GoodsItem {
  good: Good
  amount: number
}

/**
 * An amount as the grid shows it: whole units, rounded down; below one unit to a tenth, so the
 * last bite of Food still shows.
 */
export function goodsAmount(units: number): string {
  return String(units >= 1 ? Math.floor(units + 1e-9) : Math.floor(units * 10 + 1e-9) / 10)
}

/**
 * The grid's cells for an inventory (a load, a stock, a pile), in the usual order of goods; goods
 * with nothing to show are left out.
 */
export function goodsItems(stock: Stock | undefined): GoodsItem[] {
  return GOODS.flatMap((good) => {
    const amount = stock?.[good] ?? 0
    return goodsAmount(amount) === '0' ? [] : [{ good, amount }]
  })
}

/**
 * What a resident carries, for the grid (`CONTEXT.md`: Goods on cards): their own food apart
 * (`CONTEXT.md`: Own food), and the rest, Food only beyond their own food, as cells.
 */
export function carriedItems(
  carried: Stock | undefined,
  ownFood = OWN_FOOD,
): { items: GoodsItem[]; ownFood: number } {
  const food = carried?.food ?? 0
  const rest = putAwayUnits('food', food, ownFood)
  return { items: goodsItems({ ...carried, food: rest }), ownFood: food - rest }
}
