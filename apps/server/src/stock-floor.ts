import { TICKS_PER_GAME_DAY, stockFloor, tradeOrgHq, type Good, type WorldState } from '@csp/shared'
import { noteMade } from './goods-made.js'

/**
 * The stock floor (`CONTEXT.md`: Stock floor, ADR 0003, ADR 0023): at the end of each game day,
 * after food has spoiled, each warehouse of the Trade Org HQ tops up each good it keeps
 * (`stockFloor`) that is below its floor to the floor. A trading post's floor tops up nothing: it
 * only says what its spare hands, caravan and traders go for. The one place goods appear from
 * nothing; the floor applies to goods, never to people.
 */
export function stepStockFloor(world: WorldState): void {
  if (world.tick % TICKS_PER_GAME_DAY !== TICKS_PER_GAME_DAY - 1) return
  const hq = tradeOrgHq(world)
  if (!hq) return
  for (const b of world.buildings) {
    if (b.kind !== 'warehouse' || b.cityId !== hq.id) continue
    const floor = stockFloor(world, b)
    for (const [good, min] of Object.entries(floor) as [Good, number][]) {
      const have = b.stock?.[good] ?? 0
      if (have >= min) continue
      b.stock = { ...b.stock, [good]: min }
      noteMade(world, { [good]: min - have })
    }
  }
}
