import { TICKS_PER_GAME_DAY, stockFloor, type Good, type WorldState } from '@csp/shared'
import { noteMade } from './goods-made.js'

/**
 * The stock floor (`CONTEXT.md`: Stock floor, ADR 0003): at the end of each game day, after food
 * has spoiled, every Trade Org warehouse tops up each good it keeps (`stockFloor`) that is below
 * its floor to the floor. The one place goods appear from nothing; the floor applies to goods,
 * never to people.
 */
export function stepStockFloor(world: WorldState): void {
  if (world.tick % TICKS_PER_GAME_DAY !== TICKS_PER_GAME_DAY - 1) return
  for (const b of world.buildings) {
    if (b.kind !== 'warehouse') continue
    const floor = stockFloor(world, b)
    for (const [good, min] of Object.entries(floor) as [Good, number][]) {
      const have = b.stock?.[good] ?? 0
      if (have >= min) continue
      b.stock = { ...b.stock, [good]: min }
      noteMade(world, { [good]: min - have })
    }
  }
}
