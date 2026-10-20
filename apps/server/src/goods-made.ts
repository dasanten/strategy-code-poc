import type { Good, Stock, WorldState } from '@csp/shared'

/**
 * Goods that came into the world during the current tick, by the rules that may bring them in:
 * work at a workplace, a building torn down giving back its materials, and the Trade Org's stock
 * floor (ADR 0003). Kept beside the world, not in it: it is only for checking that goods appear
 * nowhere else (`goodsOnlyFromNothingAtTheFloor`).
 */
const made = new WeakMap<WorldState, Stock>()

/** Notes goods that came into the world by work, a teardown or the stock floor. */
export function noteMade(world: WorldState, goods: Stock): void {
  const tally = made.get(world) ?? {}
  for (const [good, n] of Object.entries(goods) as [Good, number][]) {
    if (n > 0) tally[good] = (tally[good] ?? 0) + n
  }
  made.set(world, tally)
}

/** The goods noted since the last call, and starts the count again. */
export function takeMade(world: WorldState): Stock {
  const tally = made.get(world) ?? {}
  made.delete(world)
  return tally
}

/**
 * Every unit of every good in the world: in buildings' storages, delivered to construction sites,
 * carried by residents, loaded on carriages and lying in piles.
 */
export function tallyGoods(world: WorldState): Stock {
  const tally: Stock = {}
  const add = (stock: Stock | undefined) => {
    for (const [good, n] of Object.entries(stock ?? {}) as [Good, number][]) {
      tally[good] = (tally[good] ?? 0) + n
    }
  }
  for (const b of world.buildings) {
    add(b.stock)
    add(b.site?.delivered)
  }
  for (const r of world.residents) add(r.carried)
  for (const k of world.carriages) add(k.load)
  for (const p of world.piles) add(p.goods)
  return tally
}
